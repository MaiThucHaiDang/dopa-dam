import { describe, expect, it } from "vitest";
import type { DayStat } from "../src/api";
import { weeklyProgress } from "../src/progress";

const TODAY = "2026-11-16";

function day(offset: number, p: Partial<DayStat> = {}): DayStat {
  const d = new Date(Date.UTC(2026, 10, 16 - offset)).toISOString().slice(0, 10);
  return { day: d, enter: 0, exit: 0, alternative: 0, exitSecondsSum: 0, exitCount: 0, studyWarnings: 0, minutes: {}, ...p };
}

/** One day per week with the given figures: offset 0 is this week, 7 is last week. */
function weeks(thisWeek: Partial<DayStat>, lastWeek: Partial<DayStat>): DayStat[] {
  return [day(7, lastWeek), day(0, thisWeek)];
}

describe("weeklyProgress", () => {
  it("compares two full weeks", () => {
    const stats: DayStat[] = [];
    for (let i = 0; i < 14; i++) {
      stats.push(day(i, i < 7 ? { exit: 2, enter: 1, exitSecondsSum: 6, exitCount: 2, studyWarnings: 1 } : { exit: 1, enter: 2, exitSecondsSum: 20, exitCount: 1, studyWarnings: 2 }));
    }
    const p = weeklyProgress(stats, TODAY);
    expect(p.thisWeek.total).toBe(21);
    expect(p.thisWeek.leaveRate).toBeCloseTo(2 / 3);
    expect(p.lastWeek.leaveRate).toBeCloseTo(1 / 3);
    expect(p.thisWeek.avgExitSeconds).toBe(3);
    expect(p.lastWeek.avgExitSeconds).toBe(20);
    expect([p.leaveRate, p.seconds, p.studyOpens]).toEqual(["better", "better", "better"]);
  });

  it("is not enough data when a week has no interceptions", () => {
    const p = weeklyProgress(weeks({ exit: 9 }, {}), TODAY);
    expect(p.lastWeek.leaveRate).toBeNull();
    expect(p.lastWeek.avgExitSeconds).toBeNull();
    expect(p.enough).toBe(false);
    expect([p.leaveRate, p.seconds, p.studyOpens]).toEqual(["not-enough-data", "not-enough-data", "not-enough-data"]);
  });

  it("needs 5 interceptions in each week", () => {
    expect(weeklyProgress(weeks({ exit: 5 }, { exit: 4 }), TODAY).enough).toBe(false);
    expect(weeklyProgress(weeks({ exit: 4 }, { exit: 5 }), TODAY).enough).toBe(false);
    expect(weeklyProgress(weeks({ exit: 5 }, { exit: 5 }), TODAY).enough).toBe(true);
  });

  it("leave rate changes by 5 points at the boundary", () => {
    // last week 10/20 = 50%
    const last = { exit: 10, enter: 10 };
    expect(weeklyProgress(weeks({ exit: 11, enter: 9 }, last), TODAY).leaveRate).toBe("better"); // +5
    expect(weeklyProgress(weeks({ exit: 10, enter: 9 }, last), TODAY).leaveRate).toBe("same"); // 52.6%
    expect(weeklyProgress(weeks({ exit: 9, enter: 11 }, last), TODAY).leaveRate).toBe("worse"); // -5
    expect(weeklyProgress(weeks({ exit: 10, alternative: 1, enter: 10 }, last), TODAY).leaveRate).toBe("same"); // 52.4%
  });

  it("seconds change by 1 at the boundary, and need an average in both weeks", () => {
    const base = { exit: 5, exitCount: 5 };
    const last = { ...base, exitSecondsSum: 15 }; // 3 s
    expect(weeklyProgress(weeks({ ...base, exitSecondsSum: 10 }, last), TODAY).seconds).toBe("better"); // 2 s
    expect(weeklyProgress(weeks({ ...base, exitSecondsSum: 11 }, last), TODAY).seconds).toBe("same"); // 2.2 s
    expect(weeklyProgress(weeks({ ...base, exitSecondsSum: 20 }, last), TODAY).seconds).toBe("worse"); // 4 s
    expect(weeklyProgress(weeks({ ...base, exitSecondsSum: 19 }, last), TODAY).seconds).toBe("same"); // 3.8 s
    expect(weeklyProgress(weeks({ enter: 5 }, last), TODAY).seconds).toBe("not-enough-data");
  });

  it("study opens: lower is better, higher is worse, equal is same", () => {
    const base = { exit: 5 };
    expect(weeklyProgress(weeks({ ...base, studyWarnings: 1 }, { ...base, studyWarnings: 2 }), TODAY).studyOpens).toBe("better");
    expect(weeklyProgress(weeks({ ...base, studyWarnings: 3 }, { ...base, studyWarnings: 2 }), TODAY).studyOpens).toBe("worse");
    expect(weeklyProgress(weeks({ ...base, studyWarnings: 2 }, { ...base, studyWarnings: 2 }), TODAY).studyOpens).toBe("same");
  });

  it("counts missing days as zero and ignores days outside the two weeks", () => {
    const p = weeklyProgress([day(0, { exit: 5 }), day(6, { exit: 1 }), day(7, { exit: 5 }), day(13, { enter: 1 }), day(14, { enter: 50 })], TODAY);
    expect(p.thisWeek.total).toBe(6);
    expect(p.lastWeek.total).toBe(6);
    expect(weeklyProgress([], TODAY).enough).toBe(false);
  });
});
