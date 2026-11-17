// End-to-end test in a real Microsoft Edge (headless) with the built extension loaded.
// A local HTTP server plays the "entertainment site" on localhost, so no network is needed.
// Usage: npm run build && npm run e2e
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = join(root, "dist");
const EXTENSION_ID = "oaidmfkacjppoliemldjfbpnilmeejid";
const EXT = `chrome-extension://${EXTENSION_ID}`;

// A stand-in for a YouTube watch page: the same tags, ids and classes lecture mode targets, with some content each.
const FAKE_WATCH_PAGE = (url) => `<!doctype html><title>Watch</title>
  <style>ytd-masthead,ytd-app,ytd-mini-guide-renderer,tp-yt-app-drawer,ytd-reel-shelf-renderer,ytd-playlist-panel-renderer,
    ytd-watch-next-secondary-results-renderer,ytd-comments,ytd-page-manager,.html5-endscreen,.ytp-ce-element,
    .ytp-autonav-toggle-button-container,.ytp-next-button,#logo,#guide,#related,#secondary,#secondary-inner,#primary,#player,#title,
    #guide-button{display:block;min-height:20px}</style>
  <ytd-app>
    <ytd-masthead><a id="logo" href="/">YouTube</a><button id="guide-button">Menu</button></ytd-masthead>
    <tp-yt-app-drawer id="guide">Guide</tp-yt-app-drawer>
    <ytd-mini-guide-renderer>Mini guide</ytd-mini-guide-renderer>
    <ytd-page-manager>
      <div id="primary">
        <div id="player">Player
          <div class="html5-endscreen">End wall</div><div class="ytp-ce-element">Card</div>
          <div class="ytp-autonav-toggle-button-container">Autoplay</div><div class="ytp-next-button">Next</div></div>
        <h1 id="title">Tiêu đề</h1><h2 id="content">Nội dung giải trí ${url}</h2>
        <ytd-comments id="comments">Bình luận</ytd-comments>
      </div>
      <div id="secondary"><div id="secondary-inner">
        <ytd-playlist-panel-renderer id="playlist">Danh sách phát</ytd-playlist-panel-renderer>
        <div id="related"><ytd-watch-next-secondary-results-renderer>Gợi ý</ytd-watch-next-secondary-results-renderer></div>
        <ytd-reel-shelf-renderer>Shorts</ytd-reel-shelf-renderer>
      </div></div>
    </ytd-page-manager>
  </ytd-app>
  <button id="go-a2" onclick="history.pushState({}, '', '/watch?v=A2'); document.dispatchEvent(new Event('yt-navigate-finish'))">Sang A2</button>`;

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  if (req.url?.startsWith("/learn")) {
    res.end(`<!doctype html><title>Bài học</title><h1>Bài học</h1>
      <button id="spa" onclick="history.pushState({}, '', '/feed')">Sang feed (SPA)</button>`);
  } else if (req.url?.startsWith("/watch") || req.url?.startsWith("/playlist")) {
    res.end(FAKE_WATCH_PAGE(req.url));
  } else {
    res.end(`<!doctype html><title>Trang thử nghiệm</title><h1 id="content">Nội dung giải trí ${req.url}</h1>`);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const SITE = `http://localhost:${PORT}`;

const profile = mkdtempSync(join(tmpdir(), "dopadam-e2e-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.DOPADAM_E2E_CHANNEL ?? "msedge",
  headless: true,
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--no-first-run",
    // youtube.com hosts resolve to the local fake site, so YouTube rules can be exercised without a network.
    "--host-resolver-rules=MAP youtube.com 127.0.0.1, MAP *.youtube.com 127.0.0.1, MAP blocked.test 127.0.0.1",
  ],
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

  await test("a rule for a subdomain cannot lift blocking without confirmation", async () => {
    const res = await send({ type: "options:setDomainRule", pattern: "m.youtube.com", tag: "work", confirmed: false });
    assert.deepEqual(res, { ok: false, error: "needs-confirm" });
    const page = await context.newPage();
    await page.goto(`http://m.youtube.com:${PORT}/watch?v=sub`).catch(() => undefined);
    await page.waitForURL((u) => u.href.startsWith(`${EXT}/warning.html`), { timeout: 10_000 });
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

  await test("an allowed YouTube link with a #fragment opens without looping", async () => {
    const add = await send({ type: "options:addAllowUrl", text: "https://www.youtube.com/watch?v=A", confirmed: true });
    assert.deepEqual(add, { ok: true });
    const page = await context.newPage();
    const url = `http://www.youtube.com:${PORT}/watch?v=A#t=5`;
    await page.goto(url);
    await page.waitForTimeout(1500);
    assert.equal(page.url(), url);
    assert.match(await page.locator("#content").textContent(), /Nội dung giải trí \/watch\?v=A/);
    // Only the first v counts: another video first is still blocked.
    await page.goto(`http://www.youtube.com:${PORT}/watch?v=B&v=A`).catch(() => undefined);
    await page.waitForURL((u) => u.href.startsWith(`${EXT}/warning.html`), { timeout: 10_000 });
    await page.close();
  });

  await test("an allowed playlist does not stop later rule updates", async () => {
    const add = await send({ type: "options:addAllowUrl", text: "https://www.youtube.com/playlist?list=PL1", confirmed: true });
    assert.deepEqual(add, { ok: true });
    const sw = context.serviceWorkers()[0];
    const before = await sw.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length);
    assert.deepEqual(await send({ type: "options:setDomainRule", pattern: "blocked.test", tag: "entertainment", confirmed: false }), {
      ok: true,
    });
    const after = await sw.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length);
    assert.ok(after > before, `dynamic rules ${before} -> ${after}`);
    const blocked = await context.newPage();
    await blocked.goto(`http://blocked.test:${PORT}/x`).catch(() => undefined);
    await blocked.waitForURL((u) => u.href.startsWith(`${EXT}/warning.html`), { timeout: 10_000 });
    await blocked.close();
    const page = await context.newPage();
    const url = `http://www.youtube.com:${PORT}/playlist?list=PL1`;
    await page.goto(url);
    await page.waitForTimeout(1500);
    assert.equal(page.url(), url);
    await page.close();
  });

  const LECTURE_HIDDEN = [
    "#related", "ytd-watch-next-secondary-results-renderer", ".html5-endscreen", ".ytp-ce-element", "ytd-reel-shelf-renderer",
    "#logo", "#guide-button", "#guide", "ytd-mini-guide-renderer", ".ytp-autonav-toggle-button-container",
  ];
  const LECTURE_KEPT = ["#player", "#title", "#comments"];
  const watchUrl = (query) => `http://www.youtube.com:${PORT}/watch?${query}`;
  const noteText = "Chế độ bài giảng của DopaDam: đã ẩn gợi ý.";
  async function assertVisible(page, selectors, visible) {
    for (const selector of selectors) {
      assert.equal(await page.locator(selector).first().isVisible(), visible, `${selector} should be ${visible ? "visible" : "hidden"}`);
    }
  }

  await test("lecture mode: an allowed video hides the distractions and keeps the lecture", async () => {
    const page = await context.newPage();
    await page.goto(watchUrl("v=A"));
    await page.locator("#dopadam-lecture-note").waitFor({ state: "visible", timeout: 5000 });
    assert.equal(await page.locator("#dopadam-lecture-note").textContent(), noteText);
    await assertVisible(page, LECTURE_HIDDEN, false);
    await assertVisible(page, LECTURE_KEPT, true);
    // No allowed playlist covers this page, so the playlist panel and next button go too.
    await assertVisible(page, ["ytd-playlist-panel-renderer", ".ytp-next-button"], false);
    assert.equal(await page.evaluate(() => document.documentElement.className), "dopadam-lecture dopadam-lecture-no-playlist");
    await page.close();
  });

  await test("lecture mode: an allowed playlist keeps its panel", async () => {
    const page = await context.newPage();
    await page.goto(watchUrl("v=Z&list=PL1"));
    await page.locator("#dopadam-lecture-note").waitFor({ state: "visible", timeout: 5000 });
    await assertVisible(page, LECTURE_HIDDEN, false);
    await assertVisible(page, [...LECTURE_KEPT, "ytd-playlist-panel-renderer", ".ytp-next-button"], true);
    assert.equal(await page.evaluate(() => document.documentElement.className), "dopadam-lecture");
    await page.close();
  });

  await test("lecture mode: follows in-page navigation between allowed videos, and a removed link", async () => {
    assert.deepEqual(await send({ type: "options:addAllowUrl", text: "https://www.youtube.com/watch?v=A2", confirmed: true }), { ok: true });
    const page = await context.newPage();
    await page.goto(watchUrl("v=A"));
    await page.locator("#dopadam-lecture-note").waitFor({ state: "visible", timeout: 5000 });
    await page.locator("#go-a2").click();
    await page.waitForFunction(() => location.search === "?v=A2");
    await page.waitForTimeout(800);
    assert.equal(page.url(), watchUrl("v=A2"));
    assert.equal(await page.locator("#dopadam-lecture-note").isVisible(), true);
    await assertVisible(page, LECTURE_HIDDEN, false);
    // The link is removed while the page is open: the page goes back to what YouTube made it.
    assert.deepEqual(await send({ type: "options:removeAllowUrl", entry: { kind: "video", id: "A2" } }), { ok: true });
    await page.waitForFunction(() => !document.documentElement.classList.contains("dopadam-lecture"), null, { timeout: 5000 });
    assert.equal(await page.locator("#dopadam-lecture-note").count(), 0);
    await assertVisible(page, [...LECTURE_HIDDEN.filter((s) => s !== ".html5-endscreen" && s !== ".ytp-ce-element"), ...LECTURE_KEPT], true);
    await page.close();
  });

  await test("lecture mode: a video entered through Vào is left as YouTube made it", async () => {
    const page = await context.newPage();
    await page.goto(watchUrl("v=NotAllowed")).catch(() => undefined);
    await page.waitForURL((u) => u.href.startsWith(`${EXT}/warning.html`), { timeout: 10_000 });
    await page.waitForFunction(() => !document.querySelector("#enter").disabled, null, { timeout: 5000 });
    await page.locator("#enter").click();
    await page.locator("#allow-buttons").getByRole("button", { name: "5 phút", exact: true }).click();
    await page.waitForURL(watchUrl("v=NotAllowed"), { timeout: 5000 });
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => document.documentElement.className), "");
    assert.equal(await page.locator("#dopadam-lecture-note").count(), 0);
    await assertVisible(page, [...LECTURE_HIDDEN.filter((s) => s !== ".html5-endscreen" && s !== ".ytp-ce-element"), ...LECTURE_KEPT], true);
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

  // ---- Risk hours ----------------------------------------------------------------------------------
  const SHOTS = process.env.DOPADAM_E2E_SHOTS ?? "";
  const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const DAY_MS = 86_400_000;

  /** Writes events straight into the extension's storage, then stops its worker so the next message re-reads them. */
  async function seedEvents(events) {
    const sw = context.serviceWorkers()[0];
    await sw.evaluate(async (list) => {
      const { state } = await chrome.storage.local.get("state");
      state.events = list;
      await chrome.storage.local.set({ state });
    }, events);
    const page = await context.newPage();
    await page.goto(`${EXT}/popup.html`);
    const cdp = await context.newCDPSession(page);
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.stopAllWorkers");
    await page.close();
    for (let i = 0; i < 50; i++) {
      const view = await send({ type: "options:get" }).catch(() => null);
      if (view?.ok && view.risk.heatmap.flat().reduce((a, c) => a + c.opens, 0) === events.length) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("the extension did not load the seeded events");
  }

  await test("risk hours: set-up (no study rule, default friction, empty log)", async () => {
    const view = await send({ type: "options:get" });
    for (const rule of view.studyRules) assert.deepEqual(await send({ type: "study:deleteRule", id: rule.id, confirmed: true }), { ok: true });
    assert.deepEqual(await send({ type: "options:setFriction", lockSeconds: [5, 10, 20, 30], budgetMinutes: 90, confirmed: true }), { ok: true });
    assert.deepEqual(await send({ type: "options:clearLog", confirmed: true }), { ok: true });
    assert.deepEqual((await send({ type: "options:get" })).risk.windows, []);
  });

  await test("risk hours: without a window the first warning is level 0 and has no risk line", async () => {
    const page = await openBlocked2("/risk-off");
    assert.match(await page.locator("#meta").textContent(), /Lần thứ 1 .* khóa 5 giây/);
    assert.equal(await page.locator("#risk-note").isHidden(), true);
    await page.close();
  });

  await test("risk hours: the heat map and the suggestion render from seeded events, and the button adds the window", async () => {
    assert.deepEqual(await send({ type: "options:clearLog", confirmed: true }), { ok: true });
    // Weekday evenings of the last 13 days: 21:30 (Vào) and 22:30 (Thoát); a few afternoon opens on any day.
    const events = [];
    let weekdays = 0;
    let tuesdays = 0;
    for (let k = 1; k <= 13; k++) {
      const day = new Date(Date.now() - k * DAY_MS);
      const at = (h, m) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
      const dow = day.getDay(); // 0 = Sunday
      const add = (shownAt, decision) =>
        events.push({
          id: `seed-${events.length}`, object: "youtube.com", tag: "entertainment", url: "https://www.youtube.com/", level: 0,
          lockSeconds: 5, n: 0, shownAt, studyLabel: null, decision, decidedAt: shownAt + 8000, allowMinutes: null, activity: null, activityMinutes: null,
        });
      if (dow >= 1 && dow <= 5) {
        weekdays++;
        if (dow === 2) tuesdays++;
        add(at(21, 30), "enter");
        add(at(22, 30), "exit");
      }
      if (k % 3 === 0) add(at(13, 10), "exit");
    }
    await seedEvents(events);

    const page = await context.newPage();
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(`${EXT}/options.html`);
    const risk = page.locator("#risk");
    await risk.locator("#heatmap .heat-cell").first().waitFor();
    assert.equal(await risk.locator("#heatmap .heat-cell").count(), 7 * 24);
    assert.equal(await risk.locator("#risk-subtitle").textContent(), "2 tuần gần nhất. Ô càng đậm, bạn càng hay mở giải trí vào giờ đó.");
    const tuesday22 = risk.locator(`#heatmap .heat-cell[aria-label="Thứ 3, 22 giờ: ${tuesdays} lần mở, 0 lần Vào"]`);
    assert.equal(await tuesday22.count(), 1);
    assert.equal(await tuesday22.getAttribute("title"), `Thứ 3, 22 giờ: ${tuesdays} lần mở, 0 lần Vào`);
    assert.equal(await risk.locator('#heatmap .heat-cell[data-shade="4"]').count() > 0, true);
    assert.equal(await risk.locator('#heatmap .heat-cell[data-shade="0"]').count() > 100, true);
    assert.equal(
      await risk.locator("#risk-suggestion-text").textContent(),
      `Hay mở nhất: 21:00–23:00, thứ 2 đến thứ 6 (${2 * weekdays} lần mở, ${weekdays} lần Vào).`,
    );
    assert.equal(await risk.locator("#risk-list li").textContent(), "Chưa có khung nào.");
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await risk.screenshot({ path: join(SHOTS, "options-risk-desktop.png") });
    }
    await page.setViewportSize({ width: 360, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "the options page scrolls sideways at 360 px");
    assert.equal(await page.evaluate(() => document.querySelector("#heatmap").scrollWidth <= document.querySelector("#heatmap").clientWidth), true);
    if (SHOTS) await risk.screenshot({ path: join(SHOTS, "options-risk-360.png") });
    await page.setViewportSize({ width: 1000, height: 900 });

    await risk.locator("#risk-add").click();
    await risk.locator("#risk-list li", { hasText: "21:00–23:00 · thứ 2 đến thứ 6 · thời gian chờ dài hơn một cấp" }).waitFor();
    assert.equal((await send({ type: "options:get" })).risk.windows.length, 1);
    assert.notEqual(await risk.locator("#risk-suggestion-text").textContent(), `Hay mở nhất: 21:00–23:00, thứ 2 đến thứ 6 (${2 * weekdays} lần mở, ${weekdays} lần Vào).`);
    await page.close();
  });

  await test("risk hours: a window covering now locks the first warning for the level-1 time and shows the line", async () => {
    const now = new Date();
    const windows = [
      { id: "e2e", days: [1, 2, 3, 4, 5, 6, 7], start: hhmm(new Date(now.getTime() - 3_600_000)), end: hhmm(new Date(now.getTime() + 3_600_000)) },
    ];
    // Replacing the seeded window may or may not drop coverage (it depends on the time of day), so confirm.
    assert.deepEqual(await send({ type: "options:setRiskWindows", windows, confirmed: true }), { ok: true });
    assert.deepEqual(await send({ type: "options:clearLog", confirmed: true }), { ok: true });
    const page = await openBlocked2("/risk-on");
    assert.match(await page.locator("#meta").textContent(), /Lần thứ 1 .* khóa 10 giây/);
    assert.equal(await page.locator("#risk-note").isVisible(), true);
    assert.equal(
      await page.locator("#risk-note").textContent(),
      "Đây là khung giờ bạn hay mở giải trí nên thời gian chờ dài hơn một cấp.",
    );
    assert.match(await page.locator("#enter").textContent(), /^Vào \(\d+\)$/);
    await page.close();
  });

  await test("risk hours: removing a window asks for the 60-second confirmation", async () => {
    const page = await context.newPage();
    await page.goto(`${EXT}/options.html`);
    const item = page.locator("#risk-list li");
    assert.equal(await item.count(), 1);
    await item.locator("button", { hasText: "Gỡ" }).click();
    const modal = page.locator(".modal");
    await modal.waitFor({ state: "visible" });
    assert.match(await modal.textContent(), /Chờ \d+ giây/);
    assert.match(await modal.textContent(), /Gỡ khung giờ nguy cơ/);
    assert.equal(await modal.locator("input").isDisabled(), true);
    await modal.locator("button", { hasText: "Giữ nguyên bảo vệ" }).click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#risk-list li").count(), 1);
    assert.equal((await send({ type: "options:get" })).risk.windows.length, 1);
    await page.close();
  });

  await test("risk hours: the last window can be removed once confirmed, and the level drops back", async () => {
    assert.deepEqual(await send({ type: "options:setRiskWindows", windows: [], confirmed: false }), { ok: false, error: "needs-confirm" });
    assert.deepEqual(await send({ type: "options:setRiskWindows", windows: [], confirmed: true }), { ok: true });
    assert.deepEqual(await send({ type: "options:clearLog", confirmed: true }), { ok: true });
    const page = await openBlocked2("/risk-gone");
    assert.match(await page.locator("#meta").textContent(), /Lần thứ 1 .* khóa 5 giây/);
    assert.equal(await page.locator("#risk-note").isHidden(), true);
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
