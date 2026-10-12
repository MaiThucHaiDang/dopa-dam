// End-to-end test in a real Microsoft Edge (headless) with the built extension loaded.
// A local HTTP server plays the "entertainment site" on localhost, so no network is needed.
// Usage: npm run build && npm run e2e
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = join(root, "dist");
const EXTENSION_ID = "oaidmfkacjppoliemldjfbpnilmeejid";
const EXT = `chrome-extension://${EXTENSION_ID}`;

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  if (req.url?.startsWith("/learn")) {
    res.end(`<!doctype html><title>Bài học</title><h1>Bài học</h1>
      <button id="spa" onclick="history.pushState({}, '', '/feed')">Sang feed (SPA)</button>`);
  } else {
    res.end(`<!doctype html><title>Trang thử nghiệm</title><h1 id="content">Nội dung giải trí ${req.url}</h1>`);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const SITE = `http://localhost:${PORT}`;

const profile = mkdtempSync(join(tmpdir(), "dopadam-e2e-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "msedge",
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--no-first-run"],
});

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

/** Sends a runtime message from an extension page (same as the options page does). */
async function send(message) {
  const page = await context.newPage();
  await page.goto(`${EXT}/popup.html`);
  const result = await page.evaluate((m) => chrome.runtime.sendMessage(m), message);
  await page.close();
  return result;
}

async function openBlocked(path) {
  const page = await context.newPage();
  await page.goto(`${SITE}${path}`).catch(() => undefined);
  await page.waitForURL((u) => u.href.startsWith(`${EXT}/warning.html`), { timeout: 10_000 });
  await page.locator("#choice").waitFor({ state: "visible" });
  return page;
}

try {
  // The service worker must be up before we talk to it.
  if (!context.serviceWorkers().length) await context.waitForEvent("serviceworker", { timeout: 15_000 });
  console.log(`Edge ${context.browser()?.version() ?? ""} · extension ${EXTENSION_ID}`);

  await test("adds localhost as an entertainment site", async () => {
    const res = await send({ type: "options:setDomainRule", pattern: "localhost", tag: "entertainment", confirmed: false });
    assert.deepEqual(res, { ok: true });
  });

  await test("redirects to the warning page before the site loads", async () => {
    const page = await openBlocked("/video");
    assert.equal(page.url(), `${EXT}/warning.html#${SITE}/video`);
    assert.equal(await page.locator("#host").textContent(), "localhost");
    assert.match(await page.locator("#meta").textContent(), /Lần thứ 1 trong 60 phút qua · nút Vào khóa 5 giây/);
    assert.equal(await page.locator("#enter").isDisabled(), true);
    assert.match(await page.locator("#enter").textContent(), /^Vào \(\d\)$/);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "exit");
    await page.close();
  });

  await test("Enter means Thoát and closes the tab", async () => {
    const page = await openBlocked("/enter-key");
    const closed = page.waitForEvent("close", { timeout: 5000 });
    await page.keyboard.press("Enter");
    await closed;
    const popup = await send({ type: "popup:get" });
    assert.ok(popup.exitsToday >= 1, `exitsToday = ${popup.exitsToday}`);
  });

  await test("level rises with repeated opens (3rd open in the hour = 10 s)", async () => {
    const page = await openBlocked("/third");
    assert.match(await page.locator("#meta").textContent(), /Lần thứ 3 .* khóa 10 giây/);
    await page.close();
  });

  await test("Enter still exits after the countdown, even with focus moved", async () => {
    const res = await send({ type: "options:setFriction", lockSeconds: [1, 1, 1, 1], budgetMinutes: 90, confirmed: true });
    assert.deepEqual(res, { ok: true });
    const page = await openBlocked("/after-countdown");
    await page.waitForFunction(() => !document.querySelector("#enter").disabled, null, { timeout: 5000 });
    await page.locator("#show-alternative").focus();
    const closed = page.waitForEvent("close", { timeout: 5000 });
    await page.keyboard.press("Enter");
    await closed;
  });

  await test("a mouse click on Vào then an allow option opens the site", async () => {
    const page = await openBlocked("/allowed");
    await page.waitForFunction(() => !document.querySelector("#enter").disabled, null, { timeout: 5000 });
    await page.locator("#enter").click();
    await page.locator("#allow-buttons").getByRole("button", { name: "5 phút", exact: true }).click();
    await page.waitForURL(`${SITE}/allowed`, { timeout: 5000 });
    assert.match(await page.locator("#content").textContent(), /Nội dung giải trí \/allowed/);
    // Inside the allow window the site opens directly.
    await page.goto(`${SITE}/other-page`);
    assert.equal(page.url(), `${SITE}/other-page`);
    await page.close();
  });

  await test("keyboard cannot activate Vào", async () => {
    // Close the allow window by switching protection off and on (allow windows survive, so use a new host).
    await send({ type: "options:setDomainRule", pattern: "127.0.0.1", tag: "entertainment", confirmed: false });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/kbd`).catch(() => undefined);
    await page.waitForURL((u) => u.href.startsWith(`${EXT}/warning.html`));
    await page.waitForFunction(() => !document.querySelector("#enter").disabled, null, { timeout: 5000 });
    // Programmatic keyboard-style activation (detail === 0) must be ignored.
    await page.evaluate(() => document.querySelector("#enter").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
    assert.equal(await page.locator("#allow-options").isHidden(), true);
    await page.close();
  });

  await test("an allowed link opens directly, in-page navigation away from it is caught", async () => {
    const add = await send({ type: "options:addAllowUrl", text: "127.0.0.1/learn", confirmed: true });
    assert.deepEqual(add, { ok: true });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/learn`);
    assert.equal(await page.title(), "Bài học");
    await page.locator("#spa").click();
    await page.waitForURL((u) => u.href.startsWith(`${EXT}/warning.html`), { timeout: 5000 });
    assert.ok(page.url().endsWith(`#http://127.0.0.1:${PORT}/feed`), page.url());
    await page.close();
  });

  await test("reloading a warning does not count it twice", async () => {
    const page = await openBlocked2("/reload");
    const before = (await send({ type: "popup:get" })).warningsToday;
    await page.reload();
    await page.locator("#choice").waitFor({ state: "visible" });
    const after = (await send({ type: "popup:get" })).warningsToday;
    assert.equal(after, before);
    await page.close();
  });

  await test("Làm việc khác starts a timer", async () => {
    const page = await openBlocked2("/alternative");
    await page.locator("#show-alternative").click();
    await page.locator("#activities button", { hasText: "Hít đất" }).click();
    await page.locator("#activity-minutes").selectOption("3");
    await page.locator("#start-activity").click();
    await page.locator("#timer").waitFor({ state: "visible" });
    assert.equal(await page.locator("#timer-title").textContent(), "Hít đất");
    assert.match(await page.locator("#clock").textContent(), /^[23]:\d\d$/);
    await page.close();
  });

  await test("removing a blocked site asks for the 60-second confirmation", async () => {
    const page = await context.newPage();
    await page.goto(`${EXT}/options.html`);
    const row = page.locator("#domain-list tr", { hasText: "youtube.com" });
    await row.locator("button", { hasText: "Gỡ" }).click();
    const modal = page.locator(".modal");
    await modal.waitFor({ state: "visible" });
    assert.match(await modal.textContent(), /Chờ \d+ giây/);
    assert.equal(await modal.locator("input").isDisabled(), true);
    await modal.locator("button", { hasText: "Giữ nguyên bảo vệ" }).click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#domain-list tr", { hasText: "youtube.com" }).count(), 1);
    await page.close();
  });

  await test("the popup starts a study session and the warning shows it", async () => {
    const popup = await context.newPage();
    await popup.goto(`${EXT}/popup.html`);
    await popup.locator("#study-label").fill("Ôn Hệ điều hành");
    await popup.locator("#study-buttons button", { hasText: "Học 25 phút" }).click();
    await popup.locator("#study").waitFor({ state: "visible" });
    assert.match(await popup.locator("#study").textContent(), /Đang học: Ôn Hệ điều hành · còn 2[45] phút/);
    assert.equal(await popup.locator("#study-start").isHidden(), true);
    await popup.close();
    const page = await openBlocked2("/during-study");
    assert.match(await page.locator("#study").textContent(), /Đang học: Ôn Hệ điều hành/);
    await page.waitForFunction(() => !document.querySelector("#enter").disabled, null, { timeout: 5000 });
    await page.locator("#enter").click();
    const options = await page.locator("#allow-buttons button").allTextContents();
    assert.deepEqual(options, ["5 phút", "10 phút"]);
    await page.close();
  });

  await test("tags are locked during study and ending early needs the confirmation", async () => {
    const res = await send({ type: "options:setDomainRule", pattern: "reddit.com", tag: "entertainment", confirmed: true });
    assert.deepEqual(res, { ok: false, error: "study-locked" });
    const page = await context.newPage();
    await page.goto(`${EXT}/options.html#study`);
    assert.match(await page.locator("#study-status").textContent(), /Đang học: Ôn Hệ điều hành \(bật tay\)/);
    await page.locator("#study-stop").click();
    const modal = page.locator(".modal");
    await modal.waitFor({ state: "visible" });
    assert.match(await modal.textContent(), /Kết thúc giờ học/);
    await modal.locator("button", { hasText: "Giữ nguyên bảo vệ" }).click();
    assert.equal((await send({ type: "popup:get" })).study.active, true);
    assert.deepEqual(await send({ type: "study:stop", confirmed: true }), { ok: true });
    assert.equal((await send({ type: "popup:get" })).study.active, false);
    await page.close();
  });

  await test("the options page adds and lists a weekly study rule", async () => {
    const page = await context.newPage();
    await page.goto(`${EXT}/options.html#study`);
    await page.locator("#rule-start").fill("06:00");
    await page.locator("#rule-end").fill("06:30");
    await page.locator("#rule-label").fill("Từ vựng");
    await page.locator("#add-rule button[type=submit]").click();
    const row = page.locator("#study-rules tr", { hasText: "Từ vựng" });
    await row.waitFor({ state: "visible" });
    assert.match(await row.textContent(), /T2–T6 · 06:00–06:30/);
    const view = await send({ type: "options:get" });
    assert.equal(view.studyRules.length, 1);
    assert.deepEqual(view.studyRules[0].days, [1, 2, 3, 4, 5]);
    await page.close();
  });

  await test("protection off lets sites through; back on blocks again", async () => {
    assert.deepEqual(await send({ type: "options:setProtection", enabled: false, confirmed: true }), { ok: true });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/free`);
    assert.equal(page.url(), `http://127.0.0.1:${PORT}/free`);
    assert.deepEqual(await send({ type: "options:setProtection", enabled: true, confirmed: false }), { ok: true });
    await page.goto(`http://127.0.0.1:${PORT}/blocked-again`).catch(() => undefined);
    await page.waitForURL((u) => u.href.startsWith(`${EXT}/warning.html`), { timeout: 5000 });
    await page.close();
  });
} finally {
  await context.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
}

async function openBlocked2(path) {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}${path}`).catch(() => undefined);
  await page.waitForURL((u) => u.href.startsWith(`${EXT}/warning.html`), { timeout: 10_000 });
  await page.locator("#choice").waitFor({ state: "visible" });
  return page;
}

console.log(failures ? `\n${failures} test(s) failed` : "\nAll end-to-end tests passed");
process.exit(failures ? 1 : 0);
