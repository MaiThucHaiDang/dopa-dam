import { beforeEach, describe, expect, it } from "vitest";
import { dayKey } from "../src/core";
import {
  addAllowUrl,
  addUsage,
  applyDecision,
  autoExit,
  budgetView,
  clearLog,
  evaluateUrl,
  interceptConfig,
  prune,
  recordWarning,
  removeAllowUrl,
  setDomainRule,
  setFriction,
  setProtection,
  takeExpiredWindows,
} from "../src/background/logic";
import { initialState, migrateState, type State } from "../src/background/state";

const TZ = 420;
const NOW = 1_791_810_000_000; // 2026-10-12 20:00 +07:00, a Monday
const MIN = 60_000;

let s: State;
beforeEach(() => {
  s = initialState("profile-1");
});

function warn(id: string, now: number) {
  return recordWarning(s, { id, object: "youtube.com", tag: "entertainment", url: "https://www.youtube.com/", now, tz: TZ });
}

describe("recordWarning", () => {
  it("escalates with the number of warnings in the last hour", () => {
    expect(warn("a", NOW).level).toBe(0);
    expect(warn("b", NOW + MIN).level).toBe(1);
    expect(warn("c", NOW + 2 * MIN).level).toBe(1);
    const d = warn("d", NOW + 3 * MIN);
    expect(d.level).toBe(2);
    expect(d.lockSeconds).toBe(20);
    expect(d.n).toBe(3);
    // An hour after the first ones, the window has slid.
    expect(warn("e", NOW + 3 * MIN + 61 * MIN).level).toBe(0);
  });

  it("returns the same event when the same warning page reloads", () => {
    const first = warn("a", NOW);
    const again = warn("a", NOW + 5000);
    expect(again).toBe(first);
    expect(s.events).toHaveLength(1);
  });

  it("goes to level 3 once the daily budget is used up", () => {
    addUsage(s, dayKey(NOW, TZ), "entertainment", 80 * 60);
    addUsage(s, dayKey(NOW, TZ), "game", 10 * 60);
    expect(budgetView(s, NOW, TZ)).toMatchObject({ usedMinutes: 90, over: true, remainingMinutes: 0 });
    const e = warn("a", NOW);
    expect(e.level).toBe(3);
    expect(e.lockSeconds).toBe(30);
  });

  it("goes to level 3 during a study session and remembers its label", () => {
    s.study.manual.push({ id: "m", start: NOW - MIN, end: NOW + 30 * MIN, label: "Ôn Hệ điều hành" });
    const e = warn("a", NOW);
    expect(e.level).toBe(3);
    expect(e.studyLabel).toBe("Ôn Hệ điều hành");
  });
});

describe("applyDecision", () => {
  it("refuses to enter while the button is still locked", () => {
    warn("a", NOW);
    expect(applyDecision(s, "a", { decision: "enter", allowMinutes: 5 }, NOW + 2000)).toEqual({ ok: false, error: "locked" });
  });

  it("opens an allow window for the matched site", () => {
    warn("a", NOW);
    const r = applyDecision(s, "a", { decision: "enter", allowMinutes: 15 }, NOW + 6000);
    expect(r.ok).toBe(true);
    expect(s.allowWindows).toEqual([{ object: "youtube.com", expiresAt: NOW + 6000 + 15 * MIN, headsUpSent: false }]);
    expect(evaluateUrl(interceptConfig(s), "https://www.youtube.com/watch?v=x", NOW + 7000).intercept).toBe(false);
    expect(evaluateUrl(interceptConfig(s), "https://www.youtube.com/", NOW + 6000 + 15 * MIN).intercept).toBe(true);
  });

  it("only accepts the allow options of the event's level", () => {
    s.study.manual.push({ id: "m", start: NOW - MIN, end: NOW + 30 * MIN, label: null });
    warn("a", NOW);
    expect(applyDecision(s, "a", { decision: "enter", allowMinutes: 15 }, NOW + 31_000)).toEqual({ ok: false, error: "invalid" });
    expect(applyDecision(s, "a", { decision: "enter", allowMinutes: 10 }, NOW + 31_000).ok).toBe(true);
  });

  it("validates the alternative activity", () => {
    warn("a", NOW);
    expect(applyDecision(s, "a", { decision: "alternative", activity: "Ngủ", activityMinutes: 5 }, NOW).ok).toBe(false);
    expect(applyDecision(s, "a", { decision: "alternative", activity: "Hít đất", activityMinutes: 11 }, NOW).ok).toBe(false);
    expect(applyDecision(s, "a", { decision: "alternative", activity: "Hít đất", activityMinutes: 3 }, NOW).ok).toBe(true);
    expect(s.events[0]).toMatchObject({ decision: "alternative", activity: "Hít đất", activityMinutes: 3 });
  });

  it("lets Thoát through immediately and does not decide twice", () => {
    warn("a", NOW);
    expect(applyDecision(s, "a", { decision: "exit" }, NOW + 100).ok).toBe(true);
    expect(applyDecision(s, "a", { decision: "enter", allowMinutes: 5 }, NOW + 60_000)).toEqual({ ok: false, error: "already-decided" });
    expect(autoExit(s, "a", NOW + 70_000)).toBe(false);
  });

  it("records a closed tab as leaving", () => {
    warn("a", NOW);
    expect(autoExit(s, "a", NOW + 3000)).toBe(true);
    expect(s.events[0]).toMatchObject({ decision: "exit", decidedAt: NOW + 3000 });
  });
});

describe("allow windows", () => {
  it("expires windows and reports which sites", () => {
    s.allowWindows = [
      { object: "youtube.com", expiresAt: NOW, headsUpSent: true },
      { object: "tiktok.com", expiresAt: NOW + 1, headsUpSent: false },
    ];
    expect(takeExpiredWindows(s, NOW)).toEqual(["youtube.com"]);
    expect(s.allowWindows.map((w) => w.object)).toEqual(["tiktok.com"]);
  });
});

describe("options", () => {
  it("needs confirmation to untag a site but not to tag one", () => {
    expect(setDomainRule(s, "youtube.com", "study", false, NOW, TZ)).toEqual({ ok: false, error: "needs-confirm" });
    expect(setDomainRule(s, "youtube.com", "study", true, NOW, TZ).ok).toBe(true);
    expect(setDomainRule(s, "https://www.Instagram.com/reels", "entertainment", false, NOW, TZ)).toEqual({
      ok: true,
      pattern: "instagram.com",
    });
    expect(setDomainRule(s, "not a domain", "entertainment", false, NOW, TZ)).toEqual({ ok: false, error: "invalid" });
    expect(setDomainRule(s, "facebook.com", null, true, NOW, TZ).ok).toBe(true);
    expect(s.domainRules.map((r) => r.pattern)).toEqual(["instagram.com", "tiktok.com", "youtube.com"]);
  });

  it("locks tags and friction during a study session, but still allows adding a link", () => {
    s.study.manual.push({ id: "m", start: NOW - MIN, end: NOW + 30 * MIN, label: null });
    expect(setDomainRule(s, "reddit.com", "entertainment", true, NOW, TZ)).toEqual({ ok: false, error: "study-locked" });
    expect(setFriction(s, [10, 10, 20, 30], 90, true, NOW, TZ)).toEqual({ ok: false, error: "study-locked" });
    expect(setProtection(s, false, true, NOW, TZ)).toEqual({ ok: false, error: "study-locked" });
    expect(addAllowUrl(s, "https://youtu.be/abc", false)).toEqual({ ok: false, error: "needs-confirm" });
    expect(addAllowUrl(s, "https://youtu.be/abc", true).ok).toBe(true);
    expect(s.allowUrls).toEqual([{ kind: "video", id: "abc" }]);
  });

  it("rejects links that cannot be allowed and removes links without confirmation", () => {
    expect(addAllowUrl(s, "https://www.youtube.com/shorts/x", true)).toEqual({ ok: false, error: "invalid" });
    addAllowUrl(s, "https://www.youtube.com/playlist?list=PL9", true);
    expect(removeAllowUrl(s, { kind: "playlist", id: "PL9" }).ok).toBe(true);
    expect(s.allowUrls).toEqual([]);
  });

  it("asks for confirmation only when friction gets weaker", () => {
    expect(setFriction(s, [5, 10, 25, 40], 60, false, NOW, TZ).ok).toBe(true);
    expect(setFriction(s, [5, 10, 20, 40], 60, false, NOW, TZ)).toEqual({ ok: false, error: "needs-confirm" });
    expect(setFriction(s, [5, 10, 25, 40], 120, false, NOW, TZ)).toEqual({ ok: false, error: "needs-confirm" });
    expect(setFriction(s, [5, 10, 25, 40], 0, true, NOW, TZ).ok).toBe(true);
    expect(s.settings.budgetMinutes).toBe(0);
    expect(setFriction(s, [5, 10, 25, -1], 0, true, NOW, TZ)).toEqual({ ok: false, error: "invalid" });
  });

  it("needs confirmation to turn protection off and clear the log", () => {
    expect(setProtection(s, false, false, NOW, TZ)).toEqual({ ok: false, error: "needs-confirm" });
    expect(setProtection(s, false, true, NOW, TZ).ok).toBe(true);
    expect(evaluateUrl(interceptConfig(s), "https://www.youtube.com/", NOW).intercept).toBe(false);
    expect(setProtection(s, true, false, NOW, TZ).ok).toBe(true);
    warn("a", NOW);
    expect(clearLog(s, false)).toEqual({ ok: false, error: "needs-confirm" });
    expect(clearLog(s, true).ok).toBe(true);
    expect(s.events).toEqual([]);
  });
});

describe("prune and migrate", () => {
  it("drops data older than two weeks", () => {
    warn("old", NOW - 15 * 24 * 60 * MIN);
    warn("new", NOW);
    addUsage(s, "2026-09-01", "entertainment", 60);
    addUsage(s, dayKey(NOW, TZ), "entertainment", 60);
    prune(s, NOW, TZ);
    expect(s.events.map((e) => e.id)).toEqual(["new"]);
    expect(Object.keys(s.usage)).toEqual([dayKey(NOW, TZ)]);
  });

  it("repairs malformed stored state", () => {
    const m = migrateState({ domainRules: [{ pattern: "x.com", tag: "bogus" }, { pattern: "y.com", tag: "game" }], settings: { lockSeconds: [1, 2] } }, "p");
    expect(m.domainRules).toEqual([{ pattern: "y.com", tag: "game" }]);
    expect(m.settings.lockSeconds).toEqual([5, 10, 20, 30]);
    expect(migrateState(null, "p").profileId).toBe("p");
  });
});
