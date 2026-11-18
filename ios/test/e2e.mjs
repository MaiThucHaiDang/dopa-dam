// Browser test of the built page (ios/dist) in a phone-sized touch viewport with a mobile Safari user agent.
// A local static server plays GitHub Pages: the page is served from a sub-path, not from the root.
// Usage: node build.mjs && PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 node test/e2e.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const { chromium } = createRequire(join(root, "..", "extension", "package.json"))("playwright-core");
const SHOTS = resolve(root, "..", ".toolchain", "scratch", "ios");
mkdirSync(SHOTS, { recursive: true });

const SUBPATH = "/dopadam-ios/";
const STORAGE_KEY = "dopadam-ios:state";
const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};

const requested = [];
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  requested.push(url.pathname);
  if (!url.pathname.startsWith(SUBPATH)) {
    res.writeHead(404).end("not found");
    return;
  }
  let rel = decodeURIComponent(url.pathname.slice(SUBPATH.length)) || "index.html";
  if (rel.endsWith("/")) rel += "index.html";
  const file = join(dist, rel);
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://localhost:${server.address().port}`;
const BASE = `${ORIGIN}${SUBPATH}`;

// Linux: a throw-away HOME and XDG folders, so the browser writes nothing into the real ~/.config or ~/.cache.
const browserHome = process.platform === "linux" ? mkdtempSync(join(tmpdir(), "dopadam-ios-e2e-home-")) : null;
const browser = await chromium.launch({
  channel: process.env.DOPADAM_E2E_CHANNEL ?? "chromium",
  headless: true,
  ...(browserHome && {
    env: {
      PATH: process.env.PATH,
      LANG: "C.UTF-8",
      HOME: browserHome,
      XDG_CONFIG_HOME: join(browserHome, ".config"),
      XDG_CACHE_HOME: join(browserHome, ".cache"),
      XDG_DATA_HOME: join(browserHome, ".local/share"),
    },
  }),
});

const problems = []; // console errors and page errors of every page
let failures = 0;
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${String(err?.stack ?? err).split("\n").slice(0, 6).join("\n        ")}`);
  }
}

async function newContext(extra = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    userAgent: SAFARI_UA,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    ...extra,
  });
  ctx.on("page", (page) => {
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  });
  return ctx;
}

/** Screenshot after the short fade-in of a screen has finished. */
async function shot(page, name, fullPage = false) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(SHOTS, name), fullPage });
}

const readState = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), STORAGE_KEY);
const writeState = (page, state) => page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [STORAGE_KEY, state]);
const warnUrl = (app, n = Date.now()) => `${BASE}#/warn?app=${encodeURIComponent(app)}&t=${n}`;

/** Opens the page in a context with the stored state replaced by `state` (partial states are repaired by the page). */
async function openWith(ctx, state, hash = "") {
  const page = await ctx.newPage();
  await page.goto(BASE);
  await writeState(page, state);
  await page.goto(BASE + hash);
  await page.reload();
  return page;
}

async function waitUnlocked(page) {
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "Vào");
    return !!b && !b.disabled;
  }, null, { timeout: 40_000 });
}
const enterButton = (page) => page.locator("button.enter");
const metaLine = (page) => page.locator(".meta").textContent();

function sampleEvents(now) {
  const events = [];
  const apps = ["Instagram", "TikTok", "Một ứng dụng có tên rất dài để thử xuống dòng trên màn hình hẹp 320px"];
  for (let i = 0; i < 60; i++) {
    const shownAt = now - (i % 14) * 86_400_000 - (i % 5) * 3_600_000 - i * 60_000;
    events.push({
      id: `s${i}`,
      object: apps[i % 3],
      tag: "entertainment",
      url: "app:x",
      level: 0,
      lockSeconds: 5,
      n: 0,
      shownAt,
      studyLabel: null,
      decision: i % 3 === 0 ? "enter" : "exit",
      decidedAt: shownAt + 9000,
      allowMinutes: i % 3 === 0 ? 15 : null,
      activity: null,
      activityMinutes: null,
    });
  }
  return events;
}

try {
  // ---- The warning -------------------------------------------------------------------------------------------
  const ctxA = await newContext();
  const requestsOfA = [];
  ctxA.on("request", (r) => requestsOfA.push(r.url()));
  let page;

  await test("first warning: level 0, 5 s lock, Vào does nothing while locked", async () => {
    page = await ctxA.newPage();
    await page.goto(warnUrl("Instagram"));
    await page.locator("h1.question").waitFor();
    assert.equal(await page.locator("h1.question").textContent(), "Bạn mở Instagram để làm gì?");
    assert.equal(await metaLine(page), "Lần thứ 1 trong 60 phút qua · nút Vào khóa 5 giây");
    assert.equal(await page.locator(".exit").textContent(), "Thoát");
    assert.equal(await page.locator(".btn-link").textContent(), "Làm việc khác thay vì vào");
    assert.match(await enterButton(page).textContent(), /^Vào \([1-5]\)$/);
    assert.equal(await enterButton(page).isDisabled(), true);
    // A tap and a scripted click while locked: nothing opens.
    await enterButton(page).tap({ force: true }).catch(() => undefined);
    await page.evaluate(() => document.querySelector("button.enter").click());
    assert.equal(await page.locator(".allow-buttons").isVisible(), false);
    assert.match(await page.locator(".footer").textContent(), /Hôm nay: 0 \/ 90 phút giải trí/);
    assert.match(await page.locator(".footer").textContent(), /Tính theo số phút đã cho vào/);
    await shot(page, "warn-locked.png");
  });

  await test("Vào never answers the keyboard, only a tap", async () => {
    await waitUnlocked(page);
    assert.equal(await enterButton(page).textContent(), "Vào");
    assert.equal(await enterButton(page).getAttribute("tabindex"), "-1");
    // Scripted click (no real pointer): ignored.
    await page.evaluate(() => document.querySelector("button.enter").click());
    assert.equal(await page.locator(".allow-buttons").isVisible(), false);
    // Keyboard activation (detail 0): ignored.
    await enterButton(page).focus();
    await page.evaluate(() => {
      const b = document.querySelector("button.enter");
      b.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    assert.equal(await page.locator(".allow-buttons").isVisible(), false);
  });

  await test("a tap on Vào shows the minute options; choosing one gives exactly the shortcuts:// link", async () => {
    await enterButton(page).tap();
    await page.locator(".allow-buttons").waitFor({ state: "visible" });
    const options = await page.locator(".allow-buttons button").allTextContents();
    assert.deepEqual(options, ["5 phút", "15 phút", "30 phút"]);
    await shot(page, "warn-options.png");
    // The option buttons only react to a tap too.
    await page.evaluate(() => document.querySelectorAll(".allow-buttons button")[1].click());
    assert.equal(await page.locator("#enter-link").count(), 0);
    await page.locator(".allow-buttons button", { hasText: "15 phút" }).tap();
    const link = page.locator("a.big-link");
    await link.waitFor();
    assert.equal(await link.getAttribute("href"), "shortcuts://run-shortcut?name=DopaDam%20V%C3%A0o&input=text&text=Instagram%7C15");
    assert.equal(await link.evaluate((a) => a.tagName), "A");
    assert.match(await page.locator("body").textContent(), /Nếu không có gì xảy ra: mở lại Instagram; lần mở kế tiếp sẽ hỏi lại\./);
    await shot(page, "warn-enter-done.png");
    const state = await readState(page);
    const event = state.events[0];
    assert.equal(event.decision, "enter");
    assert.equal(event.allowMinutes, 15);
    assert.equal(Object.values(state.usage)[0].entertainment, 900);
    assert.equal(state.allowWindows.length, 1);
  });

  await test("reloading after Vào shows the same link and counts nothing twice", async () => {
    await page.reload();
    await page.locator("a.big-link").waitFor();
    assert.equal(await page.locator("a.big-link").getAttribute("href"), "shortcuts://run-shortcut?name=DopaDam%20V%C3%A0o&input=text&text=Instagram%7C15");
    const state = await readState(page);
    assert.equal(state.events.length, 1);
    assert.equal(Object.values(state.usage)[0].entertainment, 900);
  });

  await test("an app name with Vietnamese letters and symbols goes through the link intact", async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    const app = "Zalo Việt & Bạn+ #1";
    await p.goto(warnUrl(app));
    await p.locator("h1.question").waitFor();
    assert.equal(await p.locator("h1.question .app-name").textContent(), app);
    await waitUnlocked(p);
    await enterButton(p).tap();
    await p.locator(".allow-buttons button", { hasText: /^5 phút$/ }).tap();
    const href = await p.locator("a.big-link").getAttribute("href");
    assert.equal(href, `shortcuts://run-shortcut?name=DopaDam%20V%C3%A0o&input=text&text=${encodeURIComponent(app + "|5")}`);
    await ctx.close();
  });

  await test("Thoát records an exit and shows the way home", async () => {
    await page.goto(warnUrl("Zalo"));
    await page.locator("h1.question").waitFor();
    assert.equal(await metaLine(page), "Lần thứ 2 trong 60 phút qua · nút Vào khóa 10 giây");
    await page.locator(".exit").tap();
    assert.equal(await page.locator("#done-title").textContent(), "Đã thoát.");
    const link = page.locator("a.big-link");
    assert.equal(await link.getAttribute("href"), "shortcuts://run-shortcut?name=DopaDam%20Tho%C3%A1t");
    assert.equal(await link.textContent(), "Về màn hình chính");
    assert.match(await page.locator("body").textContent(), /Hoặc vuốt lên để về màn hình chính\./);
    await shot(page, "warn-exit-done.png");
    const state = await readState(page);
    assert.equal(state.events.filter((e) => e.decision === "exit").length, 1);
    assert.equal(state.events.find((e) => e.object === "Zalo").decision, "exit");
  });

  await test("the third warning in the hour has the level 1 lock, the fourth level 2", async () => {
    await page.goto(warnUrl("Reddit"));
    await page.locator("h1.question").waitFor();
    assert.equal(await metaLine(page), "Lần thứ 3 trong 60 phút qua · nút Vào khóa 10 giây");
    await page.goto(warnUrl("Reddit"));
    await page.locator("h1.question").waitFor();
    assert.equal(await metaLine(page), "Lần thứ 4 trong 60 phút qua · nút Vào khóa 20 giây");
    assert.match(await enterButton(page).textContent(), /^Vào \((1\d|20)\)$/);
  });

  await test("the Làm việc khác path records the activity, runs a timer and ends as Đã thoát", async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    await p.goto(warnUrl("TikTok"));
    await p.locator(".btn-link").tap();
    await p.locator("#start-activity").waitFor();
    // Without a chosen activity nothing starts.
    await p.locator("#start-activity").tap();
    assert.equal((await readState(p)).events[0].decision, null);
    await p.locator("button[role=radio]", { hasText: "Hít đất" }).tap();
    await p.locator("#activity-minutes").selectOption("2");
    await p.locator("#start-activity").tap();
    await p.locator(".clock").waitFor();
    assert.match(await p.locator(".clock").textContent(), /^[0-2]:\d\d$/);
    const e = (await readState(p)).events[0];
    assert.deepEqual([e.decision, e.activity, e.activityMinutes], ["alternative", "Hít đất", 2]);
    // Finish the activity: move its end into the past, then reload.
    const state = await readState(p);
    state.events[0].decidedAt -= 3 * 60_000;
    await writeState(p, state);
    await p.reload();
    await p.locator("#home-link").waitFor();
    assert.equal(await p.locator("#done-title").textContent(), "Đã thoát.");
    assert.equal(await p.locator("#home-link").getAttribute("href"), "shortcuts://run-shortcut?name=DopaDam%20Tho%C3%A1t");
    await ctx.close();
  });

  await test("the page makes no request outside its own folder", async () => {
    const outside = requestsOfA.filter((u) => !u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:"));
    assert.deepEqual(outside, []);
    assert.ok(requested.every((p) => p.startsWith(SUBPATH)), requested.filter((p) => !p.startsWith(SUBPATH)).join(", "));
  });

  // ---- Study and risk hours ---------------------------------------------------------------------------------
  await test("a study session gives the 30 s lock and the study line", async () => {
    const ctx = await newContext();
    const now = Date.now();
    const p = await openWith(ctx, { study: { manual: [{ id: "m", start: now - 60_000, end: now + 25 * 60_000, label: "Ôn Hệ điều hành" }], rules: [] } }, warnUrl("Zalo").slice(BASE.length));
    await p.locator("h1.question").waitFor();
    assert.equal(await metaLine(p), "Lần thứ 1 trong 60 phút qua · nút Vào khóa 30 giây");
    assert.match(await p.locator(".chip").textContent(), /^Đang học: Ôn Hệ điều hành · còn 2[45] phút$/);
    assert.match(await enterButton(p).textContent(), /^Vào \((29|30)\)$/);
    await ctx.close();
  });

  await test("in a study session only the short options are offered", async () => {
    const ctx = await newContext();
    const now = Date.now();
    const p = await openWith(
      ctx,
      {
        settings: { lockSeconds: [5, 10, 20, 1], budgetMinutes: 90, allowOptionsNormal: [5, 15, 30], allowOptionsRestricted: [5, 10] },
        study: { manual: [{ id: "m", start: now - 60_000, end: now + 25 * 60_000, label: "Học" }], rules: [] },
      },
      warnUrl("Zalo").slice(BASE.length),
    );
    await waitUnlocked(p);
    await enterButton(p).tap();
    assert.deepEqual(await p.locator(".allow-buttons button").allTextContents(), ["5 phút", "10 phút"]);
    await ctx.close();
  });

  await test("a risk window covering now raises the level and shows the line", async () => {
    const ctx = await newContext();
    const p = await openWith(
      ctx,
      { riskWindows: [{ id: "r1", days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59" }] },
      warnUrl("Zalo").slice(BASE.length),
    );
    await p.locator("h1.question").waitFor();
    assert.equal(await metaLine(p), "Lần thứ 1 trong 60 phút qua · nút Vào khóa 10 giây");
    assert.equal(
      await p.locator(".screen p.muted", { hasText: "khung giờ bạn hay mở" }).textContent(),
      "Đây là khung giờ bạn hay mở giải trí nên thời gian chờ dài hơn một cấp.",
    );
    await ctx.close();
  });

  await test("over the daily budget (minutes granted) the warning is level 3", async () => {
    const ctx = await newContext();
    const p = await openWith(ctx, { settings: { lockSeconds: [5, 10, 20, 30], budgetMinutes: 30, allowOptionsNormal: [5, 15, 30], allowOptionsRestricted: [5, 10] } }, "");
    await p.goto(warnUrl("Zalo"));
    await waitUnlocked(p);
    await enterButton(p).tap();
    await p.locator(".allow-buttons button", { hasText: "30 phút" }).tap();
    await p.locator("a.big-link").waitFor();
    await p.goto(warnUrl("Zalo"));
    await p.locator("h1.question").waitFor();
    assert.equal(await metaLine(p), "Lần thứ 2 trong 60 phút qua · nút Vào khóa 30 giây");
    assert.match(await p.locator(".footer").textContent(), /Hôm nay: 30 \/ 30 phút giải trí/);
    await ctx.close();
  });

  // ---- Abandoned warnings ------------------------------------------------------------------------------------
  await test("a reload of an undecided warning continues the same warning", async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    await p.goto(warnUrl("Zalo"));
    await p.locator("h1.question").waitFor();
    await p.waitForTimeout(1200);
    await p.reload();
    await p.locator("h1.question").waitFor();
    assert.equal(await metaLine(p), "Lần thứ 1 trong 60 phút qua · nút Vào khóa 5 giây");
    assert.equal((await readState(p)).events.length, 1);
    // The visible time survives the reload: the countdown did not start again from 5.
    assert.match(await enterButton(p).textContent(), /^Vào \([1-4]\)$/);
    await ctx.close();
  });

  await test("leaving a warning undecided and coming back later records it as Thoát", async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    await p.goto(warnUrl("Zalo"));
    await p.locator("h1.question").waitFor();
    // The tab goes to the background (as when the user switches apps).
    await p.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    let state = await readState(p);
    assert.equal(state.pendingCloses.length, 1);
    assert.equal(state.events[0].decision, null);
    // The tab is left (pagehide), 20 s pass, then the same tab comes back and the page loads again.
    await p.goto("about:blank");
    const other = await ctx.newPage();
    await other.goto(BASE);
    state = await readState(other);
    state.pendingCloses[0].closedAt -= 20_000;
    state.events[0].shownAt -= 20_000;
    await writeState(other, state);
    await other.close();
    await p.goBack();
    await p.locator("h1.question").waitFor();
    state = await readState(p);
    assert.equal(state.events.length, 2);
    assert.equal(state.events[0].decision, "exit");
    assert.equal(state.events[1].decision, null);
    assert.equal(state.pendingCloses.length, 0);
    assert.equal(await metaLine(p), "Lần thứ 2 trong 60 phút qua · nút Vào khóa 10 giây");
    await ctx.close();
  });

  await test("closing the tab on a warning, then opening the page much later, counts it as Thoát", async () => {
    const ctx = await newContext();
    const a = await ctx.newPage();
    await a.goto(warnUrl("Zalo"));
    await a.locator("h1.question").waitFor();
    await a.goto("about:blank"); // pagehide
    const b = await ctx.newPage();
    await b.goto(BASE);
    let state = await readState(b);
    assert.equal(state.pendingCloses.length, 1, "the page going away is noted");
    assert.equal(state.events[0].decision, null);
    state.pendingCloses[0].closedAt -= 20_000;
    await writeState(b, state);
    await b.reload();
    await b.locator("#today").waitFor();
    state = await readState(b);
    assert.equal(state.events[0].decision, "exit");
    assert.match(await b.locator("#today").textContent(), /1\s*lần cảnh báo/);
    await ctx.close();
  });

  // ---- Settings and the confirmation -------------------------------------------------------------------------
  await test("lowering a lock time asks for the 60-second confirmation; raising it does not", async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    await p.clock.install({ time: Date.now() });
    await p.goto(BASE);
    await p.locator("#friction").waitFor();
    const level0 = p.locator("#friction input[data-level='0']");
    const level1 = p.locator("#friction input[data-level='1']");
    assert.equal(await level0.inputValue(), "5");

    // Raising: saved at once.
    await level1.fill("12");
    await p.locator("#friction button[type=submit]").tap();
    await p.waitForFunction(([k]) => JSON.parse(localStorage.getItem(k)).settings.lockSeconds[1] === 12, [STORAGE_KEY]);
    assert.equal(await p.locator(".modal").count(), 0);

    // Lowering: the confirmation, nothing changes until it is completed.
    await p.locator("#friction input[data-level='0']").fill("2");
    await p.locator("#friction button[type=submit]").tap();
    await p.locator(".modal").waitFor();
    assert.match(await p.locator(".modal").textContent(), /Chờ 60 giây/);
    assert.equal(await p.locator(".modal input").isDisabled(), true);
    assert.equal((await readState(p)).settings.lockSeconds[0], 5);
    await shot(p, "home-confirm.png");
    await p.clock.runFor(30_000);
    assert.equal(await p.locator(".modal input").isDisabled(), true, "still waiting after 30 s");
    await p.clock.runFor(31_000);
    assert.equal(await p.locator(".modal input").isDisabled(), false);
    await p.locator(".modal input").fill("tôi chọn giảm bảo vệ");
    await p.locator(".modal button", { hasText: "Xác nhận" }).tap();
    await p.waitForFunction(([k]) => JSON.parse(localStorage.getItem(k)).settings.lockSeconds[0] === 2, [STORAGE_KEY]);
    assert.equal(await p.locator(".modal").count(), 0);
    await ctx.close();
  });

  await test("cancelling the confirmation keeps the protection", async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    await p.goto(BASE);
    await p.locator("#friction input[data-level='2']").fill("3");
    await p.locator("#friction button[type=submit]").tap();
    await p.locator(".modal").waitFor();
    await p.locator(".modal button", { hasText: "Giữ nguyên bảo vệ" }).tap();
    assert.equal(await p.locator(".modal").count(), 0);
    assert.equal((await readState(p)).settings.lockSeconds[2], 20);
    assert.equal(await p.locator("#friction input[data-level='2']").inputValue(), "20");
    await ctx.close();
  });

  await test("study session: settings and the log are locked, ending early needs the confirmation", async () => {
    const ctx = await newContext();
    const now = Date.now();
    const p = await openWith(ctx, { study: { manual: [{ id: "m", start: now - 60_000, end: now + 25 * 60_000, label: "Học" }], rules: [] }, riskWindows: [{ id: "r", days: [1], start: "20:00", end: "22:00" }] });
    await p.locator("#friction").waitFor();
    assert.equal(await p.locator("#friction input[data-level='0']").isDisabled(), true);
    assert.equal(await p.locator("#clear-log").isDisabled(), true);
    assert.equal(await p.locator("#risk-list button").isDisabled(), true);
    await p.locator("#study-stop").tap();
    await p.locator(".modal").waitFor();
    assert.match(await p.locator(".modal").textContent(), /Kết thúc giờ học/);
    await ctx.close();
  });

  await test("starting a study session and a weekly rule from the home screen", async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    await p.goto(BASE);
    await p.locator("#study-label").fill("Ôn thi");
    await p.locator("#study-buttons button", { hasText: "Học 25 phút" }).tap();
    await p.locator("#study-stop").waitFor();
    assert.match(await p.locator("#study-status").textContent(), /^Đang học: Ôn thi \(bật tay\), đến \d\d:\d\d\.$/);
    await p.locator("#add-rule button[type=submit]").tap();
    await p.waitForFunction(([k]) => JSON.parse(localStorage.getItem(k)).study.rules.length === 1, [STORAGE_KEY]);
    assert.match(await p.locator("#study-rules").textContent(), /19:30–22:00/);
    await p.locator("#study-rules button", { hasText: "Xóa" }).tap();
    // Studying now: deleting a rule is a weakening change and is locked.
    await p.locator("#error").waitFor();
    assert.equal((await readState(p)).study.rules.length, 1);
    await ctx.close();
  });

  // ---- Home with data ----------------------------------------------------------------------------------------
  const dataCtx = await newContext();
  const now = Date.now();
  const rich = {
    events: sampleEvents(now),
    riskWindows: [{ id: "r1", days: [1, 2, 3, 4, 5], start: "22:00", end: "00:00" }],
    study: { manual: [], rules: [{ id: "u1", days: [1, 2, 3, 4, 5], start: "19:30", end: "22:00", label: "Ôn thi", exceptions: [] }] },
    allowWindows: [{ object: "Instagram", expiresAt: now + 10 * 60_000, headsUpSent: false }],
  };

  await test("home: today, apps, progress, risk hours, settings and the install note", async () => {
    const p = await openWith(dataCtx, rich);
    await p.locator("#install").waitFor();
    assert.match(await p.locator("#apps").textContent(), /Instagram/);
    assert.match(await p.locator("#apps").textContent(), /đã cho vào đến \d\d:\d\d/);
    assert.match(await p.locator("#progress").textContent(), /Tiến bộ tuần này/);
    assert.equal(await p.locator("#heatmap .heat-cell").count(), 7 * 24);
    assert.ok((await p.locator("#heatmap .heat-cell[data-shade='4']").count()) >= 1);
    assert.match(await p.locator("#risk-suggestion-text").textContent(), /Hay mở nhất:|Chưa có khung giờ nào nổi bật/);
    assert.match(await p.locator("#risk-list").textContent(), /22:00–24:00 · thứ 2 đến thứ 6/);
    assert.equal(await p.locator("#base-url").textContent(), BASE);
    assert.match(await p.locator("#install").textContent(), /HUONG-DAN\.md/);
    assert.match(await p.locator("#today").textContent(), /Tính theo số phút đã cho vào/);
    await shot(p, "home.png", true);
    await shot(p, "home-top.png");
  });

  await test("home: removing a risk window goes through the confirmation", async () => {
    const p = dataCtx.pages().at(-1);
    await p.locator("#risk-list button", { hasText: "Gỡ" }).tap();
    await p.locator(".modal").waitFor();
    assert.match(await p.locator(".modal").textContent(), /Gỡ khung giờ nguy cơ 22:00–24:00/);
    assert.equal((await readState(p)).riskWindows.length, 1);
    await p.locator(".modal button", { hasText: "Giữ nguyên bảo vệ" }).tap();
    assert.equal((await readState(p)).riskWindows.length, 1);
  });

  await test("home: clearing the log goes through the confirmation", async () => {
    const p = dataCtx.pages().at(-1);
    await p.locator("#clear-log").tap();
    await p.locator(".modal").waitFor();
    assert.equal((await readState(p)).events.length, 60);
    await p.locator(".modal button", { hasText: "Giữ nguyên bảo vệ" }).tap();
  });

  // ---- Layout ------------------------------------------------------------------------------------------------
  for (const width of [320, 390]) {
    await test(`no horizontal overflow at ${width} px on home and on the warning`, async () => {
      const ctx = await newContext({ viewport: { width, height: 700 } });
      const p = await openWith(ctx, rich);
      await p.locator("#install").waitFor();
      const check = (where) =>
        p.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          client: document.documentElement.clientWidth,
          wide: [...document.querySelectorAll("body *")]
            .filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
            .map((e) => e.tagName + "." + e.className)
            .slice(0, 5),
        })).then((r) => {
          assert.ok(r.doc <= r.client && r.body <= r.client, `${where} at ${width}: ${JSON.stringify(r)}`);
          assert.deepEqual(r.wide, [], `${where} at ${width}`);
        });
      await check("home");
      const longApp = rich.events[2].object;
      await p.goto(warnUrl(longApp));
      await p.locator("h1.question").waitFor();
      await check("warning");
      // Also with the minute options and after the choice.
      await p.evaluate(() => {});
      await waitUnlocked(p);
      await enterButton(p).tap();
      await check("warning options");
      await p.locator(".allow-buttons button").first().tap();
      await p.locator("a.big-link").waitFor();
      await check("warning result");
      if (width === 320) await shot(p, "warn-enter-done-320.png");
      await ctx.close();
    });
  }

  await test("tap targets are at least 44 px and fields at least 16 px", async () => {
    const ctx = await newContext();
    const p = await openWith(ctx, rich);
    await p.locator("#install").waitFor();
    const small = await p.evaluate(() =>
      [...document.querySelectorAll("button, a.big-link, input:not([type=checkbox]), select")]
        .filter((e) => e.getBoundingClientRect().height > 0)
        .map((e) => ({ tag: e.tagName, text: (e.textContent || e.id || e.type).slice(0, 20), h: e.getBoundingClientRect().height, font: parseFloat(getComputedStyle(e).fontSize) }))
        .filter((e) => e.h < 43.5 || (["INPUT", "SELECT"].includes(e.tag) && e.font < 16)),
    );
    assert.deepEqual(small, []);
    assert.equal(await p.evaluate(() => getComputedStyle(document.body).minHeight !== "0px"), true);
    await ctx.close();
  });

  // ---- Offline -----------------------------------------------------------------------------------------------
  await test("the app shell loads with the network disabled after the first visit", async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    await p.goto(BASE);
    await p.locator("#install").waitFor();
    await p.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error("service worker never became ready")), 10_000))]));
    // The service worker takes control of the page on the next load.
    await p.reload();
    await p.waitForFunction(() => !!navigator.serviceWorker.controller);
    const cached = await p.evaluate(async () => (await (await caches.open((await caches.keys())[0])).keys()).length);
    assert.ok(cached >= 10, `cached files: ${cached}`);
    await ctx.setOffline(true);
    await p.reload();
    await p.locator("#install").waitFor();
    await p.goto(warnUrl("Offline App"));
    await p.locator("h1.question").waitFor();
    assert.equal(await p.locator("h1.question .app-name").textContent(), "Offline App");
    // A page opened from scratch (not a reload) works offline too.
    const fresh = await ctx.newPage();
    await fresh.goto(BASE + "#/warn?app=Fresh");
    await fresh.locator("h1.question").waitFor();
    assert.equal(await fresh.locator("h1.question .app-name").textContent(), "Fresh");
    await ctx.setOffline(false);
    await ctx.close();
  });

  await test("the manifest and icons are reachable from the sub-path", async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    await p.goto(BASE);
    const manifest = await p.evaluate(async () => (await fetch(document.querySelector("link[rel=manifest]").href)).json());
    assert.equal(manifest.start_url, "./");
    for (const icon of manifest.icons) {
      const res = await p.request.get(new URL(icon.src, BASE).href);
      assert.equal(res.status(), 200);
    }
    const touch = await p.locator("link[rel=apple-touch-icon]").getAttribute("href");
    assert.equal((await p.request.get(new URL(touch, BASE).href)).status(), 200);
    await ctx.close();
  });

  await test("no console errors or uncaught exceptions on any page", async () => {
    assert.deepEqual(problems, []);
  });

  await dataCtx.close();
  await ctxA.close();
} finally {
  await browser.close();
  if (browserHome) rmSync(browserHome, { recursive: true, force: true });
  server.close();
}

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
