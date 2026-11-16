import { describe, expect, it } from "vitest";
import { DAY_MS } from "../src/core";
import { weeklyProgress } from "../src/background/logic";
import type { WarningEvent } from "../src/background/state";

const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
const TZ = 0;
let seq = 0;

function ev(daysAgo: number, decision: WarningEvent["decision"], over: Partial<WarningEvent> = {}): WarningEvent {
  const shownAt = NOW - daysAgo * DAY_MS;
  return {
    id: `e${seq++}`, object: "youtube.com", tag: "entertainment", url: "", level: 1, lockSeconds: 10, n: 0,
    shownAt, studyLabel: null, decision, decidedAt: decision ? shownAt + 3000 : null,
    allowMinutes: null, activity: null, activityMinutes: null, ...over,
  };
}
const many = (n: number, daysAgo: number, decision: WarningEvent["decision"], over: Partial<WarningEvent> = {}) =>
  Array.from({ length: n }, () => ev(daysAgo, decision, over));
const run = (events: WarningEvent[]) => weeklyProgress(events, NOW, TZ);

describe("extension weeklyProgress", () => {
  it("compares full weeks and leaves undecided events out", () => {
    const p = run([...many(3, 1, "exit"), ...many(1, 2, "enter"), ev(0, null), ...many(2, 8, "exit"), ...many(2, 9, "enter")]);
    expect(p.thisWeek.total).toBe(4);
    expect(p.enough).toBe(false);
    const q = run([...many(4, 1, "exit"), ...many(1, 2, "enter"), ...many(2, 8, "exit"), ...many(3, 9, "enter")]);
    expect(q.thisWeek.leaveRate).toBeCloseTo(0.8);
    expect(q.lastWeek.leaveRate).toBeCloseTo(0.4);
    expect([q.leaveRate, q.seconds, q.studyOpens]).toEqual(["better", "same", "same"]);
  });

  it("is not enough data when a week is empty or under 5", () => {
    expect(run(many(9, 1, "exit")).enough).toBe(false);
    expect(run([...many(5, 1, "exit"), ...many(4, 9, "exit")]).enough).toBe(false);
    expect(run([...many(5, 1, "exit"), ...many(5, 9, "exit")]).enough).toBe(true);
  });

  it("leave rate boundary is 5 points", () => {
    const last = [...many(10, 9, "exit"), ...many(10, 9, "enter")];
    expect(run([...many(11, 1, "exit"), ...many(9, 1, "enter"), ...last]).leaveRate).toBe("better");
    expect(run([...many(10, 1, "exit"), ...many(9, 1, "enter"), ...last]).leaveRate).toBe("same");
    expect(run([...many(9, 1, "exit"), ...many(11, 1, "enter"), ...last]).leaveRate).toBe("worse");
  });

  it("seconds boundary is 1 second", () => {
    const at = (s: number, d: number) => many(5, d, "exit", { decidedAt: NOW - d * DAY_MS + s * 1000 });
    expect(run([...at(2, 1), ...at(3, 9)]).seconds).toBe("better");
    expect(run([...at(2.5, 1), ...at(3, 9)]).seconds).toBe("same");
    expect(run([...at(4, 1), ...at(3, 9)]).seconds).toBe("worse");
    expect(run([...many(5, 1, "enter"), ...at(3, 9)]).seconds).toBe("not-enough-data");
  });

  it("study opens: lower better, higher worse, equal same; missing days are zero", () => {
    const s = (n: number, d: number) => many(n, d, "exit", { studyLabel: "Ôn" });
    const rest = (d: number) => many(5, d, "exit");
    expect(run([...s(1, 1), ...rest(2), ...s(2, 9), ...rest(10)]).studyOpens).toBe("better");
    expect(run([...s(3, 1), ...rest(2), ...s(2, 9), ...rest(10)]).studyOpens).toBe("worse");
    expect(run([...s(2, 1), ...rest(2), ...s(2, 9), ...rest(10)]).studyOpens).toBe("same");
    expect(run([...rest(0), ...rest(13), ...many(5, 14, "enter")]).lastWeek.total).toBe(5);
  });
});
