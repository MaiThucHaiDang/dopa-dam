// Smoke test of the Windows agent on a real desktop (GitHub Actions windows runner, or any Windows PC).
// Usage: node agent/e2e/ci/smoke.mjs <dopadam.exe> <output folder for logs and screenshots>
//
// Starts the agent hidden with its own data folder, then checks: it stays alive; its named pipe answers
// hello with welcome and config, takes several clients at once and again after they leave, refuses
// messages before hello and applies a change that reaches the database and every client; a second
// launch hands over to the first (single instance) and shows the main window; the real WebView2 UI
// renders and answers Tauri commands (driven through the WebView2 remote debugging port); the agent
// quits cleanly through its own quit_agent command and the pipe goes away.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";

const [exe, outDir] = process.argv.slice(2);
if (!exe || !outDir || !existsSync(exe)) {
  console.error(`Usage: node smoke.mjs <dopadam.exe> <outdir>   (exe: ${exe})`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const here = dirname(fileURLToPath(import.meta.url));
const PIPE = String.raw`\\.\pipe\dopadam-agent`;
const CDP_PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let v;
    try {
      v = await fn();
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

function shot(name) {
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "shot.ps1"), join(outDir, name)], {
    encoding: "utf8",
  });
  console.log(`        [${name}] ${(r.stdout || r.stderr || "").trim()}`);
}
function ps(script) {
  const r = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  return (r.stdout || "").trim();
}
// Windows of the agent that are visible (title is "DopaDam" for the main, warning and notice windows).
const visibleTitles = (pid) => ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowTitle`);

let failures = 0;
let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${String(err?.stack ?? err).split("\n").join("\n        ")}`);
  }
}

// ---- Pipe client -------------------------------------------------------------------------------
async function pipeClient(timeout = 20_000) {
  const sock = await until(
    () =>
      new Promise((res) => {
        const s = net.connect(PIPE);
        s.once("connect", () => res(s));
        s.once("error", () => res(null));
      }),
    "the agent's named pipe",
    timeout,
  );
  const received = [];
  let buf = "";
  sock.setEncoding("utf8");
  sock.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        received.push(JSON.parse(line));
      } catch {
        // Not JSON: ignored, as the agent does.
      }
    }
  });
  sock.on("error", () => undefined);
  return {
    received,
    send: (obj) => sock.write(`${JSON.stringify(obj)}\n`),
    next: (pred, what, ms = 8000) => until(() => received.find(pred), what, ms),
    close: () => sock.destroy(),
  };
}

// ---- Minimal Chrome DevTools Protocol client (the WebView2 remote debugging port) --------------------
async function cdpPages() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return (await res.json()).filter((p) => p.type === "page");
}
async function cdpEvaluate(wsUrl, expression, { awaitPromise = true, timeout = 15_000 } = {}) {
  return await new Promise((resolveP, rejectP) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      rejectP(new Error("CDP evaluate timed out"));
    }, timeout);
    ws.onopen = () =>
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise, returnByValue: true } }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (msg.error || msg.result?.exceptionDetails) rejectP(new Error(JSON.stringify(msg.error ?? msg.result.exceptionDetails)));
      else resolveP(msg.result.result.value);
    };
    ws.onclose = () => {
      clearTimeout(timer);
      rejectP(new Error("CDP socket closed before an answer"));
    };
    ws.onerror = () => rejectP(new Error("CDP socket error"));
  });
}

// ---- Start the agent ---------------------------------------------------------------------------------
const dataDir = mkdtempSync(join(tmpdir(), "dopadam-smoke-"));
const dbPath = join(dataDir, "dopadam.db");
const stdoutFd = openSync(join(outDir, "agent-stdout.log"), "w");
const stderrFd = openSync(join(outDir, "agent-stderr.log"), "w");
const env = {
  ...process.env,
  DOPADAM_DATA_DIR: dataDir,
  DOPADAM_NO_AUTOSTART: "1",
  DOPADAM_QUIET: "1",
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
};
console.log(`exe: ${exe}\ndata: ${dataDir}`);
const startedAt = Date.now();
const agent = spawn(exe, ["--hidden"], { env, stdio: ["ignore", stdoutFd, stderrFd] });
let exitInfo = null;
agent.on("exit", (code, signal) => (exitInfo = { code, signal }));
const query = (sql, ...params) => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
};

try {
  await check("the agent creates its database and stays alive", async () => {
    await until(() => existsSync(dbPath) && query("SELECT COUNT(*) AS n FROM kv")[0].n > 0, "the agent database");
    await sleep(4000);
    assert.equal(exitInfo, null, `the agent exited: ${JSON.stringify(exitInfo)}`);
    assert.ok(ps(`(Get-Process -Id ${agent.pid} -ErrorAction SilentlyContinue).Id`), "no such process");
  });
  shot("01-agent-started-hidden.png");

  let a;
  await check("the pipe answers hello with welcome and config", async () => {
    const t0 = Date.now();
    a = await pipeClient(90_000);
    console.log(`        the pipe accepted a connection ${Math.round((Date.now() - t0) / 1000)} s after the database check, ${Math.round((Date.now() - startedAt) / 1000)} s after the start`);
    a.send({ type: "hello", protocol: 1, profileId: "ci-a", extVersion: "0.0.0" });
    const welcome = await a.next((m) => m.type === "welcome", "welcome");
    assert.equal(welcome.compatible, true);
    assert.equal(welcome.protocol, 1);
    assert.equal(typeof welcome.agentVersion, "string");
    const config = await a.next((m) => m.type === "config", "config");
    for (const key of ["domainRules", "allowUrls", "settings", "allowWindows", "study", "studyRules", "budget", "protectionEnabled", "summary"]) {
      assert.ok(key in config, `config has no ${key}`);
    }
    assert.equal(config.protectionEnabled, true);
  });

  await check("a message before hello is refused, ping is accepted", async () => {
    const early = await pipeClient();
    early.send({ type: "set_domain_rule", requestId: "r0", pattern: "early.example", tag: "entertainment", confirmed: true });
    const res = await early.next((m) => m.type === "result" && m.requestId === "r0", "refusal");
    assert.equal(res.ok, false);
    early.send({ type: "ping" });
    early.send({ type: "hello", protocol: 99 });
    const w = await early.next((m) => m.type === "welcome", "welcome for a wrong protocol");
    assert.equal(w.compatible, false);
    early.close();
    assert.equal(query("SELECT COUNT(*) AS n FROM tag_rules WHERE pattern = 'early.example'")[0].n, 0);
  });

  await check("several clients at once, and a new one after they leave (accept loop)", async () => {
    const clients = [];
    for (let i = 0; i < 5; i++) {
      const c = await pipeClient();
      c.send({ type: "hello", protocol: 1, profileId: `ci-${i}`, extVersion: "0.0.0" });
      await c.next((m) => m.type === "welcome", `welcome for client ${i}`);
      clients.push(c);
    }
    clients.forEach((c) => c.close());
    await sleep(500);
    const late = await pipeClient();
    late.send({ type: "hello", protocol: 1, profileId: "ci-late", extVersion: "0.0.0" });
    await late.next((m) => m.type === "welcome", "welcome after the others left");
    late.close();
  });

  await check("a change through the pipe reaches the database and the other clients", async () => {
    const b = await pipeClient();
    b.send({ type: "hello", protocol: 1, profileId: "ci-b", extVersion: "0.0.0" });
    await b.next((m) => m.type === "config", "config for b");
    const before = a.received.length;
    b.send({ type: "set_domain_rule", requestId: "r1", pattern: "ci-test.example", tag: "entertainment", confirmed: false });
    const res = await b.next((m) => m.type === "result" && m.requestId === "r1", "result");
    assert.equal(res.ok, true, JSON.stringify(res));
    const rows = query("SELECT pattern, tag FROM tag_rules WHERE kind = 'domain' AND deleted = 0");
    assert.ok(rows.some((r) => r.pattern === "ci-test.example" && r.tag === "entertainment"), JSON.stringify(rows));
    await until(
      () => a.received.slice(before).some((m) => m.type === "config" && m.domainRules.some((r) => r.pattern === "ci-test.example")),
      "the broadcast config on the first client",
    );
    // Untagging needs confirmation (friction is enforced by the agent).
    b.send({ type: "set_domain_rule", requestId: "r2", pattern: "ci-test.example", tag: null, confirmed: false });
    const refused = await b.next((m) => m.type === "result" && m.requestId === "r2", "refusal");
    assert.deepEqual([refused.ok, refused.error], [false, "needs-confirm"]);
    b.close();
  });

  let ui = null;
  await check("the WebView2 UI renders and answers Tauri commands", async () => {
    const pages = await until(async () => {
      const p = await cdpPages();
      return p.length >= 3 ? p : null;
    }, "three WebView2 pages on the debugging port");
    console.log(`        pages: ${pages.map((p) => p.url).join(", ")}`);
    ui = pages.find((p) => !p.url.includes("#/warning") && !p.url.includes("#/toast"));
    assert.ok(ui, "no main page");
    assert.ok(pages.some((p) => p.url.includes("#/warning")), "no warning page");
    assert.ok(pages.some((p) => p.url.includes("#/toast")), "no toast page");
    const text = await until(async () => {
      const t = await cdpEvaluate(ui.webSocketDebuggerUrl, "document.body.innerText");
      return t && t.includes("Tổng quan") ? t : null;
    }, "the overview page text");
    assert.match(text, /Tổng quan/);
    const platform = await cdpEvaluate(ui.webSocketDebuggerUrl, "window.__TAURI_INTERNALS__.invoke('get_platform')");
    console.log(`        get_platform: ${JSON.stringify(platform)}`);
    assert.equal(platform.os, "windows");
    const overview = await cdpEvaluate(ui.webSocketDebuggerUrl, "window.__TAURI_INTERNALS__.invoke('get_overview')");
    assert.ok(overview && typeof overview === "object", "get_overview");
    const apps = await cdpEvaluate(ui.webSocketDebuggerUrl, "window.__TAURI_INTERNALS__.invoke('list_apps')");
    console.log(`        list_apps: ${Array.isArray(apps) ? apps.length : typeof apps} entries`);
    assert.ok(Array.isArray(apps));
  });

  await check("a second launch hands over to the running agent and shows its main window", async () => {
    const before = visibleTitles(agent.pid);
    const second = spawn(exe, [], { env, stdio: "ignore" });
    const code = await new Promise((res) => {
      const t = setTimeout(() => res("still running"), 20_000);
      second.on("exit", (c) => {
        clearTimeout(t);
        res(c);
      });
    });
    if (code === "still running") second.kill();
    assert.equal(code, 0, `the second instance did not exit by itself (${code})`);
    assert.equal(exitInfo, null, "the first agent died");
    const title = await until(() => visibleTitles(agent.pid), "the main window to become visible");
    console.log(`        main window title before: "${before}", after: "${title}"`);
    assert.equal(title, "DopaDam");
    await sleep(1500);
    shot("02-main-window-shown.png");
  });

  await check("the agent quits cleanly through quit_agent and the pipe goes away", async () => {
    assert.ok(ui, "no UI page to drive (the WebView2 check failed)");
    const pages = await cdpPages();
    const main = pages.find((p) => p.url === ui.url) ?? ui;
    cdpEvaluate(main.webSocketDebuggerUrl, "window.__TAURI_INTERNALS__.invoke('quit_agent', { confirmed: true })", { timeout: 5000 }).catch(
      () => undefined,
    );
    await until(() => exitInfo, "the agent to exit", 15_000);
    assert.equal(exitInfo.code, 0, `exit code ${exitInfo.code}`);
    await sleep(500);
    const gone = await new Promise((res) => {
      const s = net.connect(PIPE);
      s.once("connect", () => {
        s.destroy();
        res(false);
      });
      s.once("error", () => res(true));
    });
    assert.ok(gone, "the pipe still accepts connections after exit");
  });
  shot("03-after-quit.png");
} finally {
  if (!exitInfo) {
    agent.kill();
    spawnSync("taskkill", ["/PID", String(agent.pid), "/T", "/F"], { stdio: "ignore" });
  }
  await sleep(500);
  for (const f of ["agent-stdout.log", "agent-stderr.log"]) {
    const text = existsSync(join(outDir, f)) ? readFileSync(join(outDir, f), "utf8").trim() : "";
    if (text) console.log(`--- ${f}\n${text}`);
  }
  rmSync(dataDir, { recursive: true, force: true });
  for (const key of [
    "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.dang.dopadam",
    "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.dang.dopadam",
  ]) {
    spawnSync("reg", ["delete", key, "/f"], { stdio: "ignore" });
  }
}
console.log(failures ? `\nsmoke: ${passed} passed, ${failures} failed` : `\nsmoke: ${passed} passed, 0 failed`);
process.exit(failures ? 1 : 0);
