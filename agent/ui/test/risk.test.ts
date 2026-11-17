import { describe, expect, it } from "vitest";
import {
  HEAT_FLOOR,
  busiestCell,
  cellLabel,
  clockEnd,
  dayName,
  formatDays,
  formatRange,
  formatSuggestion,
  formatWindow,
  heatIntensity,
  suggestionToWindow,
} from "../src/risk";
import riskVectors from "../../../shared/test-vectors/risk.json";

describe("risk hours wording", () => {
  it("names the days", () => {
    expect(dayName(1)).toBe("thứ 2");
    expect(dayName(6)).toBe("thứ 7");
    expect(dayName(7)).toBe("Chủ nhật");
  });

  it("writes day lists", () => {
    expect(formatDays([1, 2, 3, 4, 5])).toBe("thứ 2 đến thứ 6");
    expect(formatDays([6, 7])).toBe("thứ 7 và Chủ nhật");
    expect(formatDays([1, 3, 5])).toBe("thứ 2, thứ 4 và thứ 6");
    expect(formatDays([2, 4])).toBe("thứ 3 và thứ 5");
    expect(formatDays([3])).toBe("thứ 4");
    expect(formatDays([7])).toBe("Chủ nhật");
    expect(formatDays([1, 2])).toBe("thứ 2 và thứ 3");
    expect(formatDays([5, 6, 7])).toBe("thứ 6 đến Chủ nhật");
    expect(formatDays([1, 2, 3, 5, 6])).toBe("thứ 2, thứ 3, thứ 4, thứ 6 và thứ 7");
    expect(formatDays([1, 2, 3, 4, 5, 6, 7])).toBe("mỗi ngày");
  });

  it("writes the shared wording cases (shared/test-vectors/risk.json)", () => {
    const v = riskVectors;
    expect(v.describeDays.length).toBeGreaterThan(10);
    expect(v.describeWindow.length).toBeGreaterThan(5);
    expect(v.describeSuggestion.length).toBeGreaterThan(3);
    for (const c of v.describeDays) expect(formatDays(c.input), c.name).toBe(c.expected);
    for (const c of v.describeWindow) expect(formatWindow(c.input), c.name).toBe(c.expected);
    for (const c of v.describeSuggestion) expect(formatSuggestion(c.input), c.name).toBe(c.expected);
  });

  it("ignores order, repeats and days outside 1..7", () => {
    expect(formatDays([5, 4, 3, 2, 1, 1, 9, 0])).toBe("thứ 2 đến thứ 6");
    expect(formatDays([])).toBe("");
  });

  it("shows an end of midnight as 24:00", () => {
    expect(clockEnd("00:00")).toBe("24:00");
    expect(clockEnd("23:00")).toBe("23:00");
    expect(clockEnd("02:00")).toBe("02:00");
    expect(formatRange("22:00", "00:00")).toBe("22:00–24:00");
    expect(formatRange("23:00", "02:00")).toBe("23:00–02:00");
  });

  it("writes a window and a suggestion", () => {
    expect(formatWindow({ days: [1, 2, 3, 4, 5], start: "22:00", end: "00:00" })).toBe(
      "22:00–24:00 · thứ 2 đến thứ 6 · thời gian chờ dài hơn một cấp",
    );
    const s = { days: [1, 2, 3, 4, 5], start: "22:00", end: "00:00", opens: 17, enters: 9 };
    expect(formatSuggestion(s)).toBe("Hay mở nhất: 22:00–24:00, thứ 2 đến thứ 6 (17 lần mở, 9 lần Vào).");
    expect(suggestionToWindow(s, "x")).toEqual({ id: "x", days: [1, 2, 3, 4, 5], start: "22:00", end: "00:00" });
    expect(suggestionToWindow(s, "x").days).not.toBe(s.days);
  });

  it("labels the cells for the tooltip and the screen reader", () => {
    expect(cellLabel(1, 22, { opens: 5, enters: 3 })).toBe("Thứ 3, 22 giờ: 5 lần mở, 3 lần Vào");
    expect(cellLabel(6, 0, { opens: 1, enters: 0 })).toBe("Chủ nhật, 0 giờ: 1 lần mở, 0 lần Vào");
    expect(cellLabel(0, 9, { opens: 0, enters: 0 })).toBe("Thứ 2, 9 giờ: chưa có lần mở nào");
  });
});

describe("heat map shades", () => {
  it("is empty only for an empty cell", () => {
    expect(heatIntensity(0, 10)).toBe(0);
    expect(heatIntensity(0, 0)).toBe(0);
    expect(heatIntensity(3, 0)).toBe(0);
    expect(heatIntensity(1, 1000)).toBeGreaterThanOrEqual(HEAT_FLOOR);
  });

  it("grows with opens and peaks at the busiest cell", () => {
    expect(heatIntensity(10, 10)).toBe(1);
    expect(heatIntensity(5, 10)).toBeGreaterThan(heatIntensity(2, 10));
    expect(heatIntensity(5, 10)).toBeLessThan(1);
    expect(heatIntensity(20, 10)).toBe(1);
  });

  it("finds the busiest cell", () => {
    const rows = [
      [{ opens: 1, enters: 0 }, { opens: 4, enters: 1 }],
      [{ opens: 9, enters: 2 }, { opens: 0, enters: 0 }],
    ];
    expect(busiestCell(rows)).toBe(9);
    expect(busiestCell([])).toBe(0);
  });
});
