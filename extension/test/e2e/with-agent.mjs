// Integration test: the extension in a real Chromium-family browser talking to the real desktop agent
// through native messaging. Windows: Edge + dopadam.exe + registry keys. Linux: Playwright's Chromium + the
// Linux debug build, in a private headless GNOME Shell (see linux/e2e/README.md).
//
// Windows:  cd agent && npm run build:ui && cd src-tauri && cargo build
// Linux:    cd agent && npm run build:ui && cd src-tauri && . ~/.cache/dopadam-sysroot/env.sh \
//             && cargo build --features tauri/custom-protocol
// Run:      cd extension && npm run build && npm run e2e:agent
//   Linux needs PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 where Playwright does not know the distribution.
//   DOPADAM_E2E_CHANNEL picks the browser channel (default msedge on Windows, chromium on Linux);
//   DOPADAM_AGENT_BIN overrides the agent binary.
//   DOPADAM_E2E_NO_SESSION=1 (CI, Linux): no private GNOME Shell; run under
//   xvfb-run -a dbus-run-session -- node test/e2e/with-agent.mjs
//
// The agent runs hidden with its own temporary data folder and does not register itself to start with the
// system. Nothing of the real user's setup is touched:
//   Windows  the agent writes its native messaging registry entries (removed again at the end).
//   Linux    the agent is told not to write manifests (DOPADAM_NO_HOST_REGISTER); this script writes the manifest
//            into the test profile's own NativeMessagingHosts folder. The agent runs inside the private GNOME Shell
//            (its own HOME, D-Bus and Wayland display) and the browser gets a throw-away HOME, no display and the
//            private runtime directory, which holds the agent's socket. The user's ~/.config is never read or written.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { FAKE_WATCH_PAGE, LECTURE_HIDDEN, LECTURE_KEPT, LECTURE_NOTE } from "./fixtures.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repo = resolve(root, "..");
const dist = join(root, "dist");
const WIN = process.platform === "win32";
const LINUX = process.platform === "linux";
const EXTENSION_ID = "oaidmfkacjppoliemldjfbpnilmeejid";
const EXT = `chrome-extension://${EXTENSION_ID}`;
const HOST_NAME = "com.dang.dopadam";
const REG_KEYS = [
  `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
  `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
];

if (!WIN && !LINUX) {
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(2);
}
const agentExe = WIN
  ? resolve(repo, "agent/src-tauri/target/debug/dopadam.exe")
  : (process.env.DOPADAM_AGENT_BIN ??
    join(process.env.CARGO_TARGET_DIR ?? join(homedir(), ".cache/dopadam-target"), "debug/dopadam"));
if (!existsSync(agentExe)) {
  console.error(`Agent not built: ${agentExe}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(300);
  }
}

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  if (req.url?.startsWith("/watch") || req.url?.startsWith("/playlist")) {
    // youtube.com resolves to this server (see --host-resolver-rules below): a stand-in for a YouTube page.
    res.end(FAKE_WATCH_PAGE(req.url));
  } else {
    res.end(`<!doctype html><title>Trang thử nghiệm</title><h1 id="content">Nội dung ${req.url}</h1>`);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;

// youtube.com is HSTS-preloaded: Edge and Chrome upgrade http to https whatever the flags, so the stand-in speaks TLS.
const certDir = mkdtempSync(join(tmpdir(), "dopadam-cert-"));
execFileSync(
  "openssl",
  [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=www.youtube.com",
    "-addext", "subjectAltName=DNS:youtube.com,DNS:*.youtube.com",
    "-keyout", join(certDir, "key.pem"), "-out", join(certDir, "cert.pem"),
  ],
  { stdio: "ignore", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
);
const ytServer = createHttpsServer({ key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")) }, (req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(FAKE_WATCH_PAGE(req.url));
});
await new Promise((r) => ytServer.listen(0, "127.0.0.1", r));
const YT_PORT = ytServer.address().port;

const dataDir = mkdtempSync(join(tmpdir(), "dopadam-agent-"));
const dbPath = join(dataDir, "dopadam.db");
const agentLog = join(dataDir, "agent.log");
const agentEnv = { DOPADAM_DATA_DIR: dataDir, DOPADAM_NO_AUTOSTART: "1", DOPADAM_QUIET: "1" };

// Linux: a private headless GNOME Shell gives the agent (a GTK app) a display without touching the user's session.
const sessionSh = join(repo, "linux/e2e/session.sh");
let sessionEnv = null;
let ownSession = false;
// DOPADAM_E2E_NO_SESSION=1 (CI): the caller already provides a display and a session bus, e.g.
//   xvfb-run -a dbus-run-session -- node test/e2e/with-agent.mjs
// The agent then runs directly (X11), with a private runtime directory and a throw-away HOME.
const NO_SESSION = LINUX && process.env.DOPADAM_E2E_NO_SESSION === "1";
let agentHome = null;
function startSession() {
  if (NO_SESSION) {
    agentHome = mkdtempSync(join(tmpdir(), "dopadam-e2e-agent-home-"));
    const runtime = mkdtempSync(join(tmpdir(), "ddrt-"));
    chmodSync(runtime, 0o700);
    sessionEnv = { XDG_RUNTIME_DIR: runtime };
    return;
  }
  const read = () => {
    try {
      const text = execFileSync(sessionSh, ["status"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      return Object.fromEntries(text.split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    } catch {
      return null;
    }
  };
  sessionEnv = read();
  if (!sessionEnv) {
    ownSession = true;
    execFileSync(sessionSh, ["start"], { stdio: ["ignore", "ignore", "inherit"], timeout: 90_000 });
    sessionEnv = read();
  }
  if (!sessionEnv?.XDG_RUNTIME_DIR) throw new Error("the private GNOME Shell session did not start (see linux/e2e/README.md)");
}

/** Starts the agent hidden; its output goes to a log in the data folder. Returns the child process. */
function startAgent() {
  const out = openSync(agentLog, "a");
  const opts = { stdio: ["ignore", out, out] };
  let child;
  if (WIN) {
    child = spawn(agentExe, ["--hidden"], { ...opts, env: { ...process.env, ...agentEnv } });
  } else if (NO_SESSION) {
    child = spawn(agentExe, ["--hidden"], {
      ...opts,
      env: {
        PATH: process.env.PATH,
        LANG: "C.UTF-8",
        HOME: agentHome,
        DISPLAY: process.env.DISPLAY,
        XAUTHORITY: process.env.XAUTHORITY,
        DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
        GDK_BACKEND: "x11",
        // No GPU on a CI runner.
        WEBKIT_DISABLE_COMPOSITING_MODE: "1",
        WEBKIT_DISABLE_DMABUF_RENDERER: "1",
        LIBGL_ALWAYS_SOFTWARE: "1",
        XDG_RUNTIME_DIR: sessionEnv.XDG_RUNTIME_DIR,
        DOPADAM_NO_HOST_REGISTER: "1",
        ...agentEnv,
      },
    });
  } else {
    // session.sh runs the command with only the private session's environment (exec: the child keeps this PID).
    const vars = Object.entries({ ...agentEnv, DOPADAM_NO_HOST_REGISTER: "1" }).map(([k, v]) => `${k}=${v}`);
    child = spawn(sessionSh, ["exec", "env", ...vars, agentExe, "--hidden"], opts);
  }
  closeSync(out);
  child.on("exit", (code, signal) => console.log(`  (agent process ${child.pid} exited: code ${code}, signal ${signal})`));
  return child;
}
if (LINUX) startSession();
let agentProc = startAgent();
const query = (sql, ...params) => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
};

/** Changes the agent's stored settings the way its own app does (the extension cannot): read live on every warning. */
function patchAgentSettings(patch) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const row = db.prepare("SELECT json FROM settings WHERE id = 'settings'").get();
    const json = { ...JSON.parse(row?.json ?? "{}"), ...patch };
    db.prepare(
      `INSERT INTO settings(id, json, updated_at, dirty) VALUES('settings', ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, dirty = 1`,
    ).run(JSON.stringify(json), Date.now());
  } finally {
    db.close();
  }
}

const profile = mkdtempSync(join(tmpdir(), "dopadam-e2e-agent-"));
// Linux: the browser looks for native messaging hosts in NativeMessagingHosts/ inside its user-data directory,
// so the manifest goes into this throw-away profile, never into ~/.config.
const browserHome = LINUX ? mkdtempSync(join(tmpdir(), "dopadam-e2e-home-")) : null;
if (LINUX) {
  mkdirSync(join(profile, "NativeMessagingHosts"), { recursive: true });
  writeFileSync(
    join(profile, "NativeMessagingHosts", `${HOST_NAME}.json`),
    JSON.stringify({
      name: HOST_NAME,
      description: "DopaDam agent bridge",
      path: resolve(agentExe),
      type: "stdio",
      allowed_origins: [`${EXT}/`],
    }),
  );
}
let context;
let failures = 0;
let finished = false;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${String(err?.message ?? err).split("\n").join("\n        ")}`);
  }
}

async function send(message) {
  const page = await context.newPage();
  await page.goto(`${EXT}/popup.html`);
  const result = await page.evaluate((m) => chrome.runtime.sendMessage(m), message);
  await page.close();
  return result;
}

async function openBlocked(url) {
  const page = await context.newPage();
  await page.goto(url).catch(() => undefined);
  await page.waitForURL((u) => u.href.startsWith(`${EXT}/warning.html`), { timeout: 10_000 });
  await page.locator("#choice").waitFor({ state: "visible" });
  return page;
}

try {
  await until(() => existsSync(dbPath), "the agent database", 90_000);
  await sleep(1500);
  context = await chromium.launchPersistentContext(profile, {
    channel: process.env.DOPADAM_E2E_CHANNEL ?? (WIN ? "msedge" : "chromium"),
    headless: true,
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      "--no-first-run",
      // youtube.com hosts resolve to the local fake site, so lecture mode can be exercised without a network.
      "--host-resolver-rules=MAP youtube.com 127.0.0.1, MAP *.youtube.com 127.0.0.1",
    ],
    // Linux: the host program the browser starts must find the agent's socket in the private runtime directory;
    // nothing else of the user's environment (home, display, D-Bus) is passed on.
    ...(LINUX && {
      env: {
        PATH: process.env.PATH,
        LANG: "C.UTF-8",
        HOME: browserHome,
        XDG_RUNTIME_DIR: sessionEnv.XDG_RUNTIME_DIR,
        ...agentEnv,
      },
    }),
  });
  if (!context.serviceWorkers().length) await context.waitForEvent("serviceworker", { timeout: 15_000 });

  await test("the extension connects to the agent", async () => {
    await until(async () => (await send({ type: "popup:get" })).agent.connected, "agent connection", 30_000);
  });

  await test("settings changes go through the agent", async () => {
    const res = await send({ type: "options:setDomainRule", pattern: "localhost", tag: "entertainment", confirmed: false });
    assert.deepEqual(res, { ok: true });
    await send({ type: "options:setDomainRule", pattern: "127.0.0.1", tag: "entertainment", confirmed: false });
    const rows = query("SELECT pattern, tag FROM tag_rules WHERE kind = 'domain' AND deleted = 0 ORDER BY pattern");
    assert.ok(rows.some((r) => r.pattern === "localhost" && r.tag === "entertainment"), JSON.stringify(rows));
    // The agent checks friction too: untagging without confirmation is refused.
    const refused = await send({ type: "options:setDomainRule", pattern: "youtube.com", tag: null, confirmed: false });
    assert.deepEqual(refused, { ok: false, error: "needs-confirm" });
  });

  await test("the agent's config reaches the extension", async () => {
    await until(async () => (await send({ type: "options:get" })).domainRules.some((r) => r.pattern === "localhost"), "mirrored rule");
  });

  await test("a warning in Edge is recorded by the agent, Enter = Thoát", async () => {
    const page = await openBlocked(`http://localhost:${PORT}/video`);
    assert.match(await page.locator("#meta").textContent(), /Lần thứ 1 trong 60 phút qua/);
    const closed = page.waitForEvent("close", { timeout: 5000 });
    await page.keyboard.press("Enter");
    await closed;
    const events = await until(() => {
      const rows = query("SELECT object, decision FROM intercept_events");
      return rows.length && rows[0].decision ? rows : null;
    }, "decision in the agent database");
    assert.deepEqual(events.map((e) => [e.object, e.decision]), [["localhost", "exit"]]);
  });

  await test("Vào through the agent opens an allow window", async () => {
    const res = await send({ type: "options:setFriction", lockSeconds: [1, 1, 1, 1], budgetMinutes: 90, confirmed: true });
    assert.deepEqual(res, { ok: true });
    const page = await openBlocked(`http://localhost:${PORT}/second`);
    assert.match(await page.locator("#meta").textContent(), /Lần thứ 2 .* khóa 1 giây/);
    await page.waitForFunction(() => !document.querySelector("#enter").disabled, null, { timeout: 5000 });
    await page.locator("#enter").click();
    await page.locator("#allow-buttons").getByRole("button", { name: "5 phút", exact: true }).click();
    await page.waitForURL(`http://localhost:${PORT}/second`, { timeout: 5000 });
    const windows = query("SELECT object FROM allow_windows");
    assert.deepEqual(windows.map((w) => w.object), ["localhost"]);
    await page.close();
  });

  await test("the popup shows the agent's counts", async () => {
    const popup = await send({ type: "popup:get" });
    assert.equal(popup.warningsToday, 2);
    assert.equal(popup.exitsToday, 1);
  });

  // ---- Connected: who owns what ----------------------------------------------------------------------------
  await test("popup and options say the agent is connected; risk hours are viewed in the agent's app", async () => {
    const popup = await context.newPage();
    await popup.goto(`${EXT}/popup.html`);
    await popup.waitForFunction(() => document.querySelector("#agent")?.textContent === "Đã nối với agent trên máy", null, { timeout: 5000 });
    assert.equal(await popup.locator("#progress").isHidden(), true, "the weekly progress card must not show when the agent is connected");
    await popup.close();
    const options = await context.newPage();
    await options.goto(`${EXT}/options.html`);
    await options.locator("#risk-agent").waitFor({ state: "visible", timeout: 5000 });
    assert.equal(
      await options.locator("#risk-agent").textContent(),
      "Khi đã nối với DopaDam trên máy tính, giờ nguy cơ được xem và chỉnh ở trang Thống kê của ứng dụng.",
    );
    assert.equal(await options.locator("#risk-body").isHidden(), true);
    assert.match(await options.locator("#agent-line").textContent(), /Đã nối với agent DopaDam trên máy/);
    await options.close();
    // The extension does not change risk windows while the agent owns the settings.
    assert.deepEqual(await send({ type: "options:setRiskWindows", windows: [], confirmed: true }), { ok: false, error: "invalid" });
  });

  // ---- Risk hours with the agent ---------------------------------------------------------------------------
  // The agent decides the level and sends it with the warning context; the extension only shows it.
  const RISK_LINE = "Đây là khung giờ bạn hay mở giải trí nên thời gian chờ dài hơn một cấp.";
  const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const lastEvent = () => query("SELECT level, lock_seconds, n FROM intercept_events ORDER BY shown_at DESC LIMIT 1")[0];

  await test("risk hours: without a window the first warning is level 0 and has no risk line", async () => {
    assert.deepEqual(await send({ type: "options:setFriction", lockSeconds: [5, 10, 20, 30], budgetMinutes: 90, confirmed: true }), { ok: true });
    assert.deepEqual(await send({ type: "options:clearLog", confirmed: true }), { ok: true });
    assert.equal(query("SELECT COUNT(*) AS c FROM intercept_events")[0].c, 0);
    const page = await openBlocked(`http://127.0.0.1:${PORT}/risk-off`);
    assert.match(await page.locator("#meta").textContent(), /Lần thứ 1 .* khóa 5 giây/);
    assert.equal(await page.locator("#risk-note").isHidden(), true);
    assert.deepEqual({ ...lastEvent() }, { level: 0, lock_seconds: 5, n: 0 });
    await page.close();
  });

  await test("risk hours: a window added in the agent covering now raises the level by one and shows the line", async () => {
    const now = new Date();
    const windows = [
      { id: "e2e", days: [1, 2, 3, 4, 5, 6, 7], start: hhmm(new Date(now.getTime() - 3_600_000)), end: hhmm(new Date(now.getTime() + 3_600_000)) },
    ];
    patchAgentSettings({ riskWindows: windows });
    // Friction changes made from the extension keep the agent's risk windows.
    assert.deepEqual(await send({ type: "options:setFriction", lockSeconds: [5, 10, 20, 30], budgetMinutes: 90, confirmed: true }), { ok: true });
    assert.deepEqual(await send({ type: "options:clearLog", confirmed: true }), { ok: true });
    const started = Date.now();
    const page = await openBlocked(`http://127.0.0.1:${PORT}/risk-on`);
    assert.match(await page.locator("#meta").textContent(), /Lần thứ 1 .* khóa 10 giây/);
    assert.equal(await page.locator("#risk-note").isVisible(), true);
    assert.equal(await page.locator("#risk-note").textContent(), RISK_LINE);
    assert.deepEqual({ ...lastEvent() }, { level: 1, lock_seconds: 10, n: 0 });
    // The lock really is the raised one: Vào opens after 10 seconds, not 5.
    assert.equal(await page.locator("#enter").isDisabled(), true);
    await page.waitForFunction(() => !document.querySelector("#enter").disabled, null, { timeout: 15_000 });
    const locked = Date.now() - started;
    assert.ok(locked >= 9000 && locked < 15_000, `Vào opened after ${locked} ms, expected about 10 s`);
    await page.close();
  });

  await test("risk hours: the raise stacks with the repeat count and survives a reload", async () => {
    // Without a window the 2nd and 3rd opens in the hour are level 1 and the 4th is level 2: one higher each here.
    const page = await openBlocked(`http://127.0.0.1:${PORT}/risk-on-2`);
    assert.match(await page.locator("#meta").textContent(), /Lần thứ 2 .* khóa 20 giây/);
    assert.equal(await page.locator("#risk-note").isVisible(), true);
    await page.reload();
    await page.locator("#choice").waitFor({ state: "visible" });
    assert.equal(await page.locator("#risk-note").isVisible(), true);
    assert.match(await page.locator("#meta").textContent(), /Lần thứ 2 .* khóa 20 giây/);
    await page.close();
    const third = await openBlocked(`http://127.0.0.1:${PORT}/risk-on-3`);
    assert.match(await third.locator("#meta").textContent(), /Lần thứ 3 .* khóa 20 giây/);
    await third.close();
    const fourth = await openBlocked(`http://127.0.0.1:${PORT}/risk-on-4`);
    assert.match(await fourth.locator("#meta").textContent(), /Lần thứ 4 .* khóa 30 giây/);
    assert.equal(await fourth.locator("#risk-note").textContent(), RISK_LINE);
    assert.deepEqual({ ...lastEvent() }, { level: 3, lock_seconds: 30, n: 3 });
    await fourth.close();
  });

  await test("risk hours: with the window removed in the agent the level drops back", async () => {
    patchAgentSettings({ riskWindows: [] });
    assert.deepEqual(await send({ type: "options:clearLog", confirmed: true }), { ok: true });
    const page = await openBlocked(`http://127.0.0.1:${PORT}/risk-gone`);
    assert.match(await page.locator("#meta").textContent(), /Lần thứ 1 .* khóa 5 giây/);
    assert.equal(await page.locator("#risk-note").isHidden(), true);
    await page.close();
  });

  // ---- Lecture mode with the agent -------------------------------------------------------------------------
  // The allowed links live in the agent; the extension decides from its local mirror of them.
  const watchUrl = (query) => `https://www.youtube.com:${YT_PORT}/watch?${query}`;
  async function assertVisible(page, selectors, visible) {
    for (const selector of selectors) {
      assert.equal(await page.locator(selector).first().isVisible(), visible, `${selector} should be ${visible ? "visible" : "hidden"}`);
    }
  }
  const allowRows = () => query("SELECT pattern FROM tag_rules WHERE kind = 'allow_url' AND deleted = 0 ORDER BY pattern").map((r) => r.pattern);
  const mirrored = async (id) => (await send({ type: "options:get" })).allowUrls.some((e) => e.id === id);
  const ytEvents = () => query("SELECT COUNT(*) AS c FROM intercept_events WHERE object = 'youtube.com'")[0].c;
  const restored = [...LECTURE_HIDDEN.filter((s) => s !== ".html5-endscreen" && s !== ".ytp-ce-element"), ...LECTURE_KEPT];

  await test("lecture mode: a link allowed through the agent hides the distractions and records no warning", async () => {
    assert.deepEqual(await send({ type: "options:setFriction", lockSeconds: [1, 1, 1, 1], budgetMinutes: 90, confirmed: true }), { ok: true });
    assert.deepEqual(await send({ type: "options:addAllowUrl", text: "https://www.youtube.com/watch?v=A", confirmed: true }), { ok: true });
    assert.deepEqual(allowRows(), ["video:A"]);
    await until(() => mirrored("A"), "the allowed link in the mirrored config");
    const before = ytEvents();
    const page = await context.newPage();
    await page.goto(watchUrl("v=A"));
    await page.locator("#dopadam-lecture-note").waitFor({ state: "visible", timeout: 5000 });
    assert.equal(await page.locator("#dopadam-lecture-note").textContent(), LECTURE_NOTE);
    await assertVisible(page, LECTURE_HIDDEN, false);
    await assertVisible(page, LECTURE_KEPT, true);
    assert.equal(await page.evaluate(() => document.documentElement.className), "dopadam-lecture dopadam-lecture-no-playlist");
    assert.equal(ytEvents(), before, "an allowed link must not raise a warning");
    await page.close();
  });

  await test("lecture mode: an allowed playlist keeps its panel", async () => {
    assert.deepEqual(await send({ type: "options:addAllowUrl", text: "https://www.youtube.com/playlist?list=PL1", confirmed: true }), { ok: true });
    await until(() => mirrored("PL1"), "the allowed playlist in the mirrored config");
    const page = await context.newPage();
    await page.goto(watchUrl("v=Z&list=PL1"));
    await page.locator("#dopadam-lecture-note").waitFor({ state: "visible", timeout: 5000 });
    await assertVisible(page, LECTURE_HIDDEN, false);
    await assertVisible(page, [...LECTURE_KEPT, "ytd-playlist-panel-renderer", ".ytp-next-button"], true);
    assert.equal(await page.evaluate(() => document.documentElement.className), "dopadam-lecture");
    await page.close();
  });

  await test("lecture mode: follows in-page navigation, and a link removed in the agent while the page is open", async () => {
    assert.deepEqual(await send({ type: "options:addAllowUrl", text: "https://www.youtube.com/watch?v=A2", confirmed: true }), { ok: true });
    await until(() => mirrored("A2"), "the second link in the mirrored config");
    const page = await context.newPage();
    await page.goto(watchUrl("v=A"));
    await page.locator("#dopadam-lecture-note").waitFor({ state: "visible", timeout: 5000 });
    await page.locator("#go-a2").click();
    await page.waitForFunction(() => location.search === "?v=A2");
    await page.waitForTimeout(800);
    assert.equal(page.url(), watchUrl("v=A2"));
    assert.equal(await page.locator("#dopadam-lecture-note").isVisible(), true);
    await assertVisible(page, LECTURE_HIDDEN, false);
    assert.deepEqual(await send({ type: "options:removeAllowUrl", entry: { kind: "video", id: "A2" } }), { ok: true });
    assert.equal(allowRows().includes("video:A2"), false);
    await page.waitForFunction(() => !document.documentElement.classList.contains("dopadam-lecture"), null, { timeout: 8000 });
    assert.equal(await page.locator("#dopadam-lecture-note").count(), 0);
    await assertVisible(page, restored, true);
    await page.close();
  });

  await test("lecture mode: switching protection off in the agent switches lecture mode off, and on brings it back", async () => {
    assert.deepEqual(await send({ type: "options:setProtection", enabled: false, confirmed: true }), { ok: true });
    try {
      await until(async () => !(await send({ type: "options:get" })).protectionEnabled, "protection off in the mirror");
      const page = await context.newPage();
      await page.goto(watchUrl("v=A"));
      await page.waitForTimeout(1500);
      assert.equal(await page.evaluate(() => document.documentElement.className), "");
      assert.equal(await page.locator("#dopadam-lecture-note").count(), 0);
      assert.deepEqual(await send({ type: "options:setProtection", enabled: true, confirmed: false }), { ok: true });
      await page.waitForFunction(() => document.documentElement.classList.contains("dopadam-lecture"), null, { timeout: 8000 });
      await page.close();
    } finally {
      // A failure above must not leave protection off for the tests that follow.
      await send({ type: "options:setProtection", enabled: true, confirmed: false });
    }
  });

  await test("lecture mode: a video that is not allowed gets the agent's warning, and Vào leaves YouTube as it is", async () => {
    const page = await context.newPage();
    await page.goto(watchUrl("v=NotAllowed")).catch(() => undefined);
    await page.waitForURL((u) => u.href.startsWith(`${EXT}/warning.html`), { timeout: 10_000 });
    await page.locator("#choice").waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector("#enter").disabled, null, { timeout: 5000 });
    await page.locator("#enter").click();
    await page.locator("#allow-buttons").getByRole("button", { name: "5 phút", exact: true }).click();
    await page.waitForURL(watchUrl("v=NotAllowed"), { timeout: 5000 });
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => document.documentElement.className), "");
    assert.equal(await page.locator("#dopadam-lecture-note").count(), 0);
    await assertVisible(page, restored, true);
    assert.ok(query("SELECT object FROM allow_windows").some((w) => w.object === "youtube.com"));
    await page.close();
  });

  await test("study mode from the extension goes through the agent", async () => {
    assert.deepEqual(await send({ type: "study:start", minutes: 25, label: "Ôn thi" }), { ok: true });
    const sessions = query("SELECT source, label, dirty FROM study_sessions WHERE deleted = 0");
    assert.deepEqual(sessions.map((s) => [s.source, s.label, s.dirty]), [["manual", "Ôn thi", 1]]);
    await until(async () => (await send({ type: "popup:get" })).study.active, "study status from the agent");
    // The agent locks tags during study, and ending early needs the confirmation.
    const locked = await send({ type: "options:setDomainRule", pattern: "reddit.com", tag: "entertainment", confirmed: true });
    assert.deepEqual(locked, { ok: false, error: "study-locked" });
    assert.deepEqual(await send({ type: "study:stop", confirmed: false }), { ok: false, error: "needs-confirm" });
    assert.deepEqual(await send({ type: "study:stop", confirmed: true }), { ok: true });
    await until(async () => !(await send({ type: "popup:get" })).study.active, "study ended");
    // A weekly rule added in the extension lands in the agent and comes back in the config.
    const rule = { id: "", days: [6, 7], start: "08:00", end: "09:00", label: "Cuối tuần", exceptions: [] };
    assert.deepEqual(await send({ type: "study:setRule", rule, confirmed: false }), { ok: true });
    const rules = query("SELECT days, start, label FROM study_rules WHERE deleted = 0");
    assert.deepEqual(rules.map((r) => [r.days, r.start, r.label]), [["6,7", "08:00", "Cuối tuần"]]);
    await until(async () => (await send({ type: "options:get" })).studyRules.length === 1, "rules in the mirrored config");
  });

  await test("without the agent the extension keeps blocking on its own", async () => {
    agentProc.kill();
    await until(async () => !(await send({ type: "popup:get" })).agent.connected, "disconnect", 15_000);
    const page = await openBlocked(`http://127.0.0.1:${PORT}/alone`);
    assert.match(await page.locator("#meta").textContent(), /Lần thứ \d trong 60 phút qua/);
    await page.close();
  });

  await test("the extension reconnects when the agent comes back, and gets the agent's configuration again", async () => {
    agentProc = startAgent();
    // The extension looks for the agent when its worker starts and on its 1-minute tick, so allow for the tick.
    await until(async () => (await send({ type: "popup:get" })).agent.connected, "reconnection", 100_000);
    await until(async () => (await send({ type: "options:get" })).domainRules.some((r) => r.pattern === "localhost"), "mirrored rule");
    const warned = await openBlocked(`http://127.0.0.1:${PORT}/back`);
    assert.match(await warned.locator("#meta").textContent(), /Lần thứ \d+ trong 60 phút qua/);
    await warned.close();
    assert.ok(query("SELECT object FROM intercept_events WHERE object = '127.0.0.1'").length > 0);
  });
  finished = true;
} finally {
  await context?.close().catch(() => undefined);
  agentProc.kill();
  server.close();
  ytServer.close();
  rmSync(certDir, { recursive: true, force: true });
  await sleep(500);
  if (failures || !finished) {
    try {
      const tail = readFileSync(agentLog, "utf8").trim().split("\n").slice(-40).join("\n");
      if (tail) console.log(`\nAgent log (last lines):\n${tail}`);
    } catch {
      // No log.
    }
  }
  if (NO_SESSION) {
    rmSync(sessionEnv.XDG_RUNTIME_DIR, { recursive: true, force: true });
    rmSync(agentHome, { recursive: true, force: true });
  }
  if (ownSession) {
    try {
      execFileSync(sessionSh, ["stop"], { stdio: "ignore", timeout: 30_000 });
    } catch {
      // Already gone.
    }
  }
  rmSync(profile, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  if (browserHome) rmSync(browserHome, { recursive: true, force: true });
  if (WIN) {
    for (const key of REG_KEYS) {
      try {
        execFileSync("reg", ["delete", key, "/f"], { stdio: "ignore" });
      } catch {
        // Not there.
      }
    }
  }
}

console.log(failures ? `\n${failures} test(s) failed` : "\nAll agent integration tests passed");
process.exit(failures ? 1 : 0);
