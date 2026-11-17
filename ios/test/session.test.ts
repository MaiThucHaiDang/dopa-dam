import { beforeEach, describe, expect, it } from "vitest";
import { dayKey } from "../../extension/src/core";
import { budgetView, startStudy } from "../../extension/src/background/logic";
import { initialState, type State } from "../../extension/src/background/state";
import {
  ABANDON_GRACE_MS,
  STALE_UNDECIDED_MS,
  decideAlternative,
  decideEnter,
  decideExit,
  markAway,
  openWarning,
  settle,
  warningView,
} from "../src/session";

const TZ = 420;
const T0 = Date.UTC(2026, 5, 10, 5, 0, 0); // 12:00 in Vietnam
let ids = 0;
const newId = () => `e${++ids}`;
let state: State;

beforeEach(() => {
  ids = 0;
  state = initialState("p");
  state.domainRules = [];
});

function open(app: string, now: number, id: string | null = null) {
  return openWarning(state, { app, id, newId, now, tz: TZ });
}

describe("openWarning", () => {
  it("records a level 0 warning for the app, with a 5 s lock", () => {
    const { event, resumed } = open("Instagram", T0);
    expect(resumed).toBe(false);
    expect(event).toMatchObject({ object: "Instagram", tag: "entertainment", level: 0, lockSeconds: 5, n: 0, decision: null, risk: false });
    expect(warningView(state, event, T0, TZ).countThisHour).toBe(1);
  });

  it("raises the level with warnings of any app in the last hour", () => {
    const levels = [
      open("A", T0).event,
      open("B", T0 + 60_000).event,
      open("A", T0 + 120_000).event,
      open("C", T0 + 180_000).event,
    ].map((e) => [e.level, e.lockSeconds]);
    expect(levels).toEqual([
      [0, 5],
      [1, 10],
      [1, 10],
      [2, 20],
    ]);
  });

  it("shows the same warning again for the same page (reload) and does not count twice", () => {
    const first = open("Zalo", T0).event;
    markAway(state, first.id, T0 + 1000);
    const again = open("Zalo", T0 + 2000, first.id);
    expect(again.resumed).toBe(true);
    expect(again.event.id).toBe(first.id);
    expect(state.events).toHaveLength(1);
    expect(state.pendingCloses).toEqual([]);
    expect(state.events[0].decision).toBeNull();
  });

  it("an abandoned warning becomes Thoát when the page is back too late, and a new warning starts", () => {
    const first = open("Zalo", T0).event;
    markAway(state, first.id, T0 + 5000);
    const later = open("Zalo", T0 + 5000 + ABANDON_GRACE_MS, first.id);
    expect(later.resumed).toBe(false);
    expect(later.event.id).not.toBe(first.id);
    const old = state.events.find((e) => e.id === first.id)!;
    expect(old.decision).toBe("exit");
    expect(old.decidedAt).toBe(T0 + 5000);
    expect(later.event.n).toBe(1);
    expect(state.pendingCloses).toEqual([]);
  });

  it("just inside the grace the warning continues", () => {
    const first = open("Zalo", T0).event;
    markAway(state, first.id, T0);
    expect(open("Zalo", T0 + ABANDON_GRACE_MS - 1, first.id).resumed).toBe(true);
  });

  it("a new load of another warning turns a left-behind warning (page gone) into Thoát", () => {
    const first = open("Zalo", T0).event;
    markAway(state, first.id, T0 + 1000);
    const second = open("Zalo", T0 + 60_000);
    expect(state.events.find((e) => e.id === first.id)!.decision).toBe("exit");
    expect(second.event.level).toBe(1);
  });

  it("an undecided warning nobody claims is Thoát after ten minutes, but never the page's own", () => {
    const first = open("Zalo", T0).event;
    const own = open("Reddit", T0 + 1000).event;
    open("Reddit", T0 + STALE_UNDECIDED_MS + 10_000, own.id);
    expect(state.events.find((e) => e.id === first.id)!.decision).toBe("exit");
    expect(state.events.find((e) => e.id === own.id)!.decision).toBeNull();
  });

  it("a different app with the same page id is a new warning", () => {
    const first = open("Zalo", T0).event;
    const other = open("Reddit", T0 + 1000, first.id);
    expect(other.resumed).toBe(false);
    expect(other.event.id).not.toBe(first.id);
  });

  it("a decided warning is shown again as it was", () => {
    const first = open("Zalo", T0).event;
    decideExit(state, first.id, T0 + 2000);
    const again = open("Zalo", T0 + 9000, first.id);
    expect(again.resumed).toBe(true);
    expect(again.event.decision).toBe("exit");
    expect(state.events).toHaveLength(1);
  });

  it("an allow window that is still running does not skip the warning", () => {
    const first = open("Zalo", T0).event;
    expect(decideEnter(state, first.id, 5, T0 + 6000, TZ).ok).toBe(true);
    expect(state.allowWindows).toHaveLength(1);
    const second = open("Zalo", T0 + 60_000);
    expect(second.resumed).toBe(false);
    expect(second.event.decision).toBeNull();
    expect(second.event.level).toBe(1);
  });

  it("study gives level 3 and the restricted options", () => {
    startStudy(state, 25, "Ôn thi", T0 - 1000);
    const { event } = open("Zalo", T0);
    const view = warningView(state, event, T0, TZ);
    expect(view.level).toBe(3);
    expect(view.lockSeconds).toBe(30);
    expect(view.allowOptions).toEqual([5, 10]);
    expect(view.study).toMatchObject({ active: true, label: "Ôn thi" });
  });

  it("a risk window covering now raises the level by one and says so", () => {
    state.riskWindows = [{ id: "r", days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59" }];
    const { event } = open("Zalo", T0);
    expect(event.level).toBe(1);
    expect(event.lockSeconds).toBe(10);
    expect(event.risk).toBe(true);
    expect(warningView(state, event, T0, TZ).risk).toBe(true);
  });
});

describe("markAway", () => {
  it("only marks an undecided warning, once", () => {
    const e = open("Zalo", T0).event;
    markAway(state, e.id, T0 + 1);
    markAway(state, e.id, T0 + 2);
    expect(state.pendingCloses).toEqual([{ eventId: e.id, closedAt: T0 + 2 }]);
    decideExit(state, e.id, T0 + 3);
    expect(state.pendingCloses).toEqual([]);
    markAway(state, e.id, T0 + 4);
    expect(state.pendingCloses).toEqual([]);
    markAway(state, "nope", T0);
    expect(state.pendingCloses).toEqual([]);
  });
});

describe("settle", () => {
  it("removes expired allow windows and old events", () => {
    const e = open("Zalo", T0).event;
    decideEnter(state, e.id, 5, T0 + 6000, TZ);
    settle(state, T0 + 6 * 60_000, TZ);
    expect(state.allowWindows).toEqual([]);
    settle(state, T0 + 20 * 86_400_000, TZ);
    expect(state.events).toEqual([]);
  });
});

describe("budget by granted minutes", () => {
  it("counts the minutes granted through Vào as entertainment time", () => {
    const e = open("Zalo", T0).event;
    expect(decideEnter(state, e.id, 15, T0 + 6000, TZ).ok).toBe(true);
    expect(state.usage[dayKey(T0, TZ)]).toEqual({ entertainment: 900 });
    expect(budgetView(state, T0 + 7000, TZ)).toMatchObject({ usedMinutes: 15, budgetMinutes: 90, over: false, remainingMinutes: 75 });
  });

  it("does not count twice when the same decision arrives again", () => {
    const e = open("Zalo", T0).event;
    decideEnter(state, e.id, 15, T0 + 6000, TZ);
    decideEnter(state, e.id, 15, T0 + 7000, TZ);
    expect(budgetView(state, T0 + 8000, TZ).usedMinutes).toBe(15);
  });

  it("counts nothing for Thoát, for Làm việc khác, or while the Vào button is still locked", () => {
    const a = open("A", T0).event;
    expect(decideEnter(state, a.id, 5, T0 + 1000, TZ)).toEqual({ ok: false, error: "locked" });
    decideExit(state, a.id, T0 + 2000);
    const b = open("B", T0 + 3000).event;
    expect(decideAlternative(state, b.id, "Hít đất", 5, T0 + 4000).ok).toBe(true);
    expect(state.usage).toEqual({});
  });

  it("refuses minutes that are not an option of the level", () => {
    const e = open("A", T0).event;
    expect(decideEnter(state, e.id, 7, T0 + 6000, TZ)).toEqual({ ok: false, error: "invalid" });
    expect(state.usage).toEqual({});
  });

  it("goes over budget by granted minutes: the next warning is level 3 with the short options", () => {
    state.settings.budgetMinutes = 30;
    const e = open("A", T0).event;
    decideEnter(state, e.id, 30, T0 + 6000, TZ);
    const next = open("A", T0 + 7000).event;
    expect(budgetView(state, T0 + 7000, TZ).over).toBe(true);
    expect(warningView(state, next, T0 + 7000, TZ)).toMatchObject({ level: 3, lockSeconds: 30, allowOptions: [5, 10] });
  });

  it("the next day starts at 04:00 with a clean budget", () => {
    const e = open("A", T0).event;
    decideEnter(state, e.id, 15, T0 + 6000, TZ);
    const fourAm = Date.UTC(2026, 5, 10, 21, 0, 0); // 04:00 on the 11th in Vietnam
    expect(budgetView(state, fourAm - 1, TZ).usedMinutes).toBe(15);
    expect(budgetView(state, fourAm, TZ).usedMinutes).toBe(0);
  });
});
