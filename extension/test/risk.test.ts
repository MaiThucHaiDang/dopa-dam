import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_RISK_WINDOWS, riskHeatmap, suggestRiskWindow, type RiskWindow } from "../src/core";
import { recordWarning, setRiskWindows, startStudy } from "../src/background/logic";
import { initialState, migrateState, type State } from "../src/background/state";
import {
  describeHeatCell,
  describeRemoval,
  describeRiskWindow,
  describeSuggestion,
  formatRiskDays,
  formatRiskRange,
  heatShade,
} from "../src/shared/riskText";

const TZ = 420;
const NOW = 1_791_810_000_000; // 2026-10-12 20:00 +07:00, a Monday
const MIN = 60_000;
const HOUR = 60 * MIN;

const evening = (id = "w1"): RiskWindow => ({ id, days: [1, 2, 3, 4, 5], start: "19:00", end: "22:00" });

let s: State;
beforeEach(() => {
  s = initialState("p");
});

function warn(id: string, now: number) {
  return recordWarning(s, { id, object: "youtube.com", tag: "entertainment", url: "https://www.youtube.com/", now, tz: TZ });
}

describe("risk windows in the state", () => {
  it("start empty, and old stored state without them migrates to empty", () => {
    expect(s.riskWindows).toEqual([]);
    expect(migrateState({ schema: 1, profileId: "x", domainRules: [] }, "p").riskWindows).toEqual([]);
    expect(migrateState({ riskWindows: "nope" }, "p").riskWindows).toEqual([]);
  });

  it("keep valid windows cleaned, drop broken ones, and cap the list at 12", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `w${i}`, days: [1], start: "7:05", end: "08:00" }));
    const m = migrateState(
      {
        riskWindows: [
          { id: "a", days: [5, 1, 1, 9], start: "7:05", end: "9:00" },
          { id: "b", days: [], start: "07:00", end: "08:00" },
          { id: "c", days: [1], start: "07:00", end: "07:00" },
          null,
          { id: "d", days: [2], start: 7 },
          ...many,
        ],
      },
      "p",
    );
    expect(m.riskWindows).toHaveLength(MAX_RISK_WINDOWS);
    expect(m.riskWindows[0]).toEqual({ id: "a", days: [1, 5], start: "07:05", end: "09:00" });
    expect(m.riskWindows[1].id).toBe("w0");
  });

  it("survive a round trip through storage", () => {
    s.riskWindows = [evening()];
    expect(migrateState(structuredClone(s), "p").riskWindows).toEqual([evening()]);
  });
});

describe("recordWarning with risk windows", () => {
  // NOW is Monday 20:00, inside evening().
  it("raises the level by one inside a window and flags the event", () => {
    s.riskWindows = [evening()];
    const first = warn("a", NOW);
    expect(first.level).toBe(1);
    expect(first.lockSeconds).toBe(10);
    expect(first.risk).toBe(true);
  });

  it("does nothing outside a window", () => {
    s.riskWindows = [evening()];
    const e = warn("a", NOW + 3 * HOUR); // 23:00
    expect(e.level).toBe(0);
    expect(e.risk).toBe(false);
  });

  it("raises level 0 to 1, 1 to 2 and 2 to 3", () => {
    s.riskWindows = [evening()];
    expect(warn("a", NOW).level).toBe(1); // base 0
    expect(warn("b", NOW + MIN).level).toBe(2); // base 1
    expect(warn("c", NOW + 2 * MIN).level).toBe(2); // base 1
    const d = warn("d", NOW + 3 * MIN); // base 2
    expect(d.level).toBe(3);
    expect(d.lockSeconds).toBe(30);
    expect(d.risk).toBe(true);
  });

  it("does not flag a warning that is already at level 3 (study)", () => {
    s.riskWindows = [evening()];
    startStudy(s, 25, null, NOW - MIN);
    const e = warn("a", NOW);
    expect(e.level).toBe(3);
    expect(e.risk).toBe(false);
  });
});

describe("setRiskWindows", () => {
  it("saves additions at once, even without confirmation or during study", () => {
    expect(setRiskWindows(s, [evening()], false, NOW, TZ)).toEqual({ ok: true });
    expect(s.riskWindows).toEqual([evening()]);
    startStudy(s, 25, null, NOW);
    const longer = { ...evening(), end: "23:00" };
    expect(setRiskWindows(s, [longer, { id: "w2", days: [6], start: "10:00", end: "12:00" }], false, NOW, TZ)).toEqual({ ok: true });
    expect(s.riskWindows).toHaveLength(2);
  });

  it("asks for confirmation to remove or shorten a window, and then saves", () => {
    s.riskWindows = [evening()];
    expect(setRiskWindows(s, [], false, NOW, TZ)).toEqual({ ok: false, error: "needs-confirm" });
    expect(setRiskWindows(s, [{ ...evening(), end: "21:00" }], false, NOW, TZ)).toEqual({ ok: false, error: "needs-confirm" });
    expect(s.riskWindows).toEqual([evening()]);
    expect(setRiskWindows(s, [], true, NOW, TZ)).toEqual({ ok: true });
    expect(s.riskWindows).toEqual([]);
  });

  it("is locked during study even when confirmed", () => {
    s.riskWindows = [evening()];
    startStudy(s, 25, null, NOW);
    expect(setRiskWindows(s, [], true, NOW, TZ)).toEqual({ ok: false, error: "study-locked" });
    expect(setRiskWindows(s, [], false, NOW, TZ)).toEqual({ ok: false, error: "study-locked" });
    expect(s.riskWindows).toEqual([evening()]);
  });

  it("rejects invalid windows and more than 12", () => {
    expect(setRiskWindows(s, [{ id: "x", days: [], start: "19:00", end: "20:00" }], true, NOW, TZ)).toEqual({ ok: false, error: "invalid" });
    expect(setRiskWindows(s, [{ id: "x", days: [1], start: "19:00", end: "19:00" }], true, NOW, TZ)).toEqual({ ok: false, error: "invalid" });
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `w${i}`, days: [1], start: "10:00", end: "11:00" }));
    expect(setRiskWindows(s, many, true, NOW, TZ)).toEqual({ ok: false, error: "invalid" });
    expect(s.riskWindows).toEqual([]);
    expect(setRiskWindows(s, many.slice(0, 12), true, NOW, TZ)).toEqual({ ok: true });
    expect(s.riskWindows).toHaveLength(12);
  });

  it("cleans windows and gives new or repeated ids their own id", () => {
    expect(
      setRiskWindows(s, [{ id: "", days: [3, 1, 1], start: "7:05", end: "9:00" }, { id: "", days: [2], start: "10:00", end: "11:00" }, { id: "k", days: [4], start: "10:00", end: "11:00" }, { id: "k", days: [5], start: "10:00", end: "11:00" }], false, NOW, TZ).ok,
    ).toBe(true);
    expect(s.riskWindows[0]).toMatchObject({ days: [1, 3], start: "07:05", end: "09:00" });
    const ids = s.riskWindows.map((w) => w.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });

  it("the suggestion from the heat map can be added as a window", () => {
    for (let i = 0; i < 6; i++) warn(`e${i}`, NOW + i); // Monday 20:00, six opens
    const heat = riskHeatmap(s.events, NOW + HOUR, TZ, 14);
    const sug = suggestRiskWindow(heat, s.riskWindows)!;
    expect(sug).toMatchObject({ days: [1, 2, 3, 4, 5], start: "19:00", end: "21:00", opens: 6 });
    expect(setRiskWindows(s, [{ id: "n", days: sug.days, start: sug.start, end: sug.end }], false, NOW, TZ).ok).toBe(true);
    // The overlapping block 20:00-22:00 (it also holds all six opens) touches the new window: nothing is suggested.
    expect(suggestRiskWindow(heat, s.riskWindows)).toBeNull();
  });
});

describe("risk wording", () => {
  it("writes days", () => {
    expect(formatRiskDays([1, 2, 3, 4, 5])).toBe("thứ 2 đến thứ 6");
    expect(formatRiskDays([6, 7])).toBe("thứ 7 và Chủ nhật");
    expect(formatRiskDays([1, 2, 3, 4, 5, 6, 7])).toBe("mỗi ngày");
    expect(formatRiskDays([2, 4, 6])).toBe("thứ 3, thứ 5 và thứ 7");
    expect(formatRiskDays([7, 1])).toBe("thứ 2 và Chủ nhật");
    expect(formatRiskDays([3])).toBe("thứ 4");
    expect(formatRiskDays([5, 6, 7])).toBe("thứ 6 đến Chủ nhật");
    expect(formatRiskDays([1, 1, 2, 9])).toBe("thứ 2 và thứ 3");
    expect(formatRiskDays([])).toBe("");
  });

  it("writes the shared wording cases", () => {
    const v = JSON.parse(readFileSync(resolve(__dirname, "../../shared/test-vectors/risk.json"), "utf8"));
    expect(v.describeDays.length).toBeGreaterThan(10);
    expect(v.describeWindow.length).toBeGreaterThan(5);
    expect(v.describeSuggestion.length).toBeGreaterThan(3);
    for (const c of v.describeDays) expect(formatRiskDays(c.input), c.name).toBe(c.expected);
    for (const c of v.describeWindow) expect(describeRiskWindow(c.input), c.name).toBe(c.expected);
    for (const c of v.describeSuggestion) expect(describeSuggestion(c.input), c.name).toBe(c.expected);
    expect(v.describeHeatCell.length).toBeGreaterThan(4);
    expect(v.describeRemoval.length).toBeGreaterThan(3);
    for (const c of v.describeHeatCell) {
      const { row, hour, opens, enters } = c.input;
      expect(describeHeatCell(row, hour, { opens, enters }), c.name).toBe(c.expected);
    }
    for (const c of v.describeRemoval) expect(describeRemoval(c.input), c.name).toBe(c.expected);
  });

  it("shows an end of 00:00 as 24:00", () => {
    expect(formatRiskRange("22:00", "00:00")).toBe("22:00–24:00");
    expect(formatRiskRange("22:00", "01:00")).toBe("22:00–01:00");
  });

  it("describes a window, a suggestion and a cell", () => {
    expect(describeRiskWindow({ days: [1, 2, 3, 4, 5], start: "22:00", end: "00:00" })).toBe(
      "22:00–24:00 · thứ 2 đến thứ 6 · thời gian chờ dài hơn một cấp",
    );
    expect(describeSuggestion({ days: [1, 2, 3, 4, 5], start: "22:00", end: "00:00", opens: 17, enters: 9 })).toBe(
      "Hay mở nhất: 22:00–24:00, thứ 2 đến thứ 6 (17 lần mở, 9 lần Vào).",
    );
    expect(describeHeatCell(1, 22, { opens: 5, enters: 3 })).toBe("Thứ 3, 22 giờ: 5 lần mở, 3 lần Vào");
    expect(describeHeatCell(6, 0, { opens: 0, enters: 0 })).toBe("Chủ nhật, 0 giờ: chưa có lần mở nào");
  });

  it("shades by opens relative to the busiest cell", () => {
    expect(heatShade(0, 10)).toBe(0);
    expect(heatShade(0, 0)).toBe(0);
    expect(heatShade(1, 100)).toBe(1);
    expect(heatShade(3, 10)).toBe(2);
    expect(heatShade(6, 10)).toBe(3);
    expect(heatShade(9, 10)).toBe(4);
    expect(heatShade(10, 10)).toBe(4);
  });
});
