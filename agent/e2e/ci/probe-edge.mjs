// Diagnostic for CI: which Edge launch options let http://www.youtube.com:PORT (mapped to a local server) load
// instead of being upgraded to https? Usage (after `cd extension && npm ci`): node agent/e2e/ci/probe-edge.mjs
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../extension/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<title>probe ok</title><p>ok</p>");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = ["--no-first-run", "--host-resolver-rules=MAP youtube.com 127.0.0.1, MAP *.youtube.com 127.0.0.1"];
const variants = [
  ["msedge", "default", []],
  ["msedge", "disable HTTPS upgrade features", ["--disable-features=HttpsUpgrades,HttpsFirstModeV2,HttpsFirstBalancedModeAutoEnable,HttpsFirstModeIncognito,HttpsFirstModeV2ForTypicallySecureUsers"]],
  ["msedge", "--test-type", ["--test-type"]],
  ["msedge", "--ignore-certificate-errors", ["--ignore-certificate-errors"]],
  ["msedge", "--disable-hsts?", ["--disable-features=HstsPreload", "--disable-hsts"]],
  ["chrome", "chrome default", []],
];
for (const [channel, name, extra] of variants) {
  const profile = mkdtempSync(join(tmpdir(), "probe-"));
  let line;
  try {
    const ctx = await chromium.launchPersistentContext(profile, { channel, headless: true, args: [...base, ...extra] });
    const page = await ctx.newPage();
    try {
      await page.goto(`http://www.youtube.com:${port}/x`, { timeout: 10_000 });
      line = `LOADS  title=${await page.title()} url=${page.url()}`;
    } catch (e) {
      line = `FAILS  ${String(e.message).split("\n")[0]}`;
    }
    await ctx.close();
  } catch (e) {
    line = `LAUNCH FAILED ${String(e.message).split("\n")[0]}`;
  }
  console.log(`${channel.padEnd(7)} ${name.padEnd(34)} ${line}`);
  rmSync(profile, { recursive: true, force: true });
}
server.close();
process.exit(0);
