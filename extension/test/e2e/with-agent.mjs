// Integration test: the extension in a real Edge talking to the Windows agent through native messaging.
// Needs the agent debug build: cd agent && npm run build:ui && cd src-tauri && cargo build
// Usage: npm run build && node test/e2e/with-agent.mjs
//
// The agent runs hidden with its own temporary data folder and does not register itself to start
// with Windows. Its native messaging registry entry is removed again at the end.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = join(root, "dist");
const agentExe = resolve(root, "../agent/src-tauri/target/debug/dopadam.exe");
const EXT = "chrome-extension://oaidmfkacjppoliemldjfbpnilmeejid";
const REG_KEYS = [
  "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.dang.dopadam",
  "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.dang.dopadam",
];

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
  res.end(`<!doctype html><title>Trang thử nghiệm</title><h1 id="content">Nội dung ${req.url}</h1>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;

const dataDir = mkdtempSync(join(tmpdir(), "dopadam-agent-"));
const dbPath = join(dataDir, "dopadam.db");
let agentProc = spawn(agentExe, ["--hidden"], {
  env: { ...process.env, DOPADAM_DATA_DIR: dataDir, DOPADAM_NO_AUTOSTART: "1", DOPADAM_QUIET: "1" },
  stdio: "ignore",
});
const query = (sql, ...params) => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
};

const profile = mkdtempSync(join(tmpdir(), "dopadam-e2e-agent-"));
let context;
let failures = 0;
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
  await until(() => existsSync(dbPath), "the agent database");
  await sleep(1500);
  context = await chromium.launchPersistentContext(profile, {
    channel: "msedge",
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--no-first-run"],
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
} finally {
  await context?.close().catch(() => undefined);
  agentProc.kill();
  server.close();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  for (const key of REG_KEYS) {
    try {
      execFileSync("reg", ["delete", key, "/f"], { stdio: "ignore" });
    } catch {
      // Not there.
    }
  }
}

console.log(failures ? `\n${failures} test(s) failed` : "\nAll agent integration tests passed");
process.exit(failures ? 1 : 0);
