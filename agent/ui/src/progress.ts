// Weekly progress: the last 7 days against the 7 before, for the three trends the product aims at.
import type { DayStat } from "./api";

export type Verdict = "better" | "worse" | "same" | "not-enough-data";

export interface WeekFigures {
  total: number;
  /** (exit + alternative) / total, or null with no interceptions. */
  leaveRate: number | null;
  /** Average seconds from the warning to Thoát, or null with no Thoát. */
  avgExitSeconds: number | null;
  studyOpens: number;
}

export interface WeeklyProgress {
  thisWeek: WeekFigures;
  lastWeek: WeekFigures;
  /** Both weeks have at least MIN_INTERCEPTIONS interceptions. */
  enough: boolean;
  leaveRate: Verdict;
  seconds: Verdict;
  studyOpens: Verdict;
}

export const MIN_INTERCEPTIONS = 5;
const RATE_STEP = 0.05;
const SECONDS_STEP = 1;
// Tolerance for floating point at the thresholds (0.55 - 0.5 is not exactly 0.05).
const EPS = 1e-9;

/** The day key `delta` days from `key` ("YYYY-MM-DD"). */
function shiftDay(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function figures(days: DayStat[]): WeekFigures {
  let enter = 0, exit = 0, alternative = 0, secondsSum = 0, exitCount = 0, studyOpens = 0;
  for (const d of days) {
    enter += d.enter;
    exit += d.exit;
    alternative += d.alternative;
    secondsSum += d.exitSecondsSum;
    exitCount += d.exitCount;
    studyOpens += d.studyWarnings;
  }
  const total = enter + exit + alternative;
  return {
    total,
    leaveRate: total > 0 ? (exit + alternative) / total : null,
    avgExitSeconds: exitCount > 0 ? secondsSum / exitCount : null,
    studyOpens,
  };
}

export function weeklyProgress(stats: DayStat[], today: string): WeeklyProgress {
  const byDay = new Map(stats.map((s) => [s.day, s]));
  const week = (offset: number) => {
    const days: DayStat[] = [];
    for (let i = 0; i < 7; i++) {
      const s = byDay.get(shiftDay(today, -(offset + i)));
      if (s) days.push(s);
    }
    return figures(days);
  };
  const thisWeek = week(0);
  const lastWeek = week(7);
  const enough = thisWeek.total >= MIN_INTERCEPTIONS && lastWeek.total >= MIN_INTERCEPTIONS;
  if (!enough) {
    const none: Verdict = "not-enough-data";
    return { thisWeek, lastWeek, enough, leaveRate: none, seconds: none, studyOpens: none };
  }
  let leaveRate: Verdict = "same";
  if (thisWeek.leaveRate !== null && lastWeek.leaveRate !== null) {
    const diff = thisWeek.leaveRate - lastWeek.leaveRate;
    leaveRate = diff >= RATE_STEP - EPS ? "better" : diff <= -(RATE_STEP - EPS) ? "worse" : "same";
  }
  let seconds: Verdict = "not-enough-data";
  if (thisWeek.avgExitSeconds !== null && lastWeek.avgExitSeconds !== null) {
    const diff = thisWeek.avgExitSeconds - lastWeek.avgExitSeconds;
    seconds = diff <= -(SECONDS_STEP - EPS) ? "better" : diff >= SECONDS_STEP - EPS ? "worse" : "same";
  }
  const studyOpens: Verdict =
    thisWeek.studyOpens < lastWeek.studyOpens ? "better" : thisWeek.studyOpens > lastWeek.studyOpens ? "worse" : "same";
  return { thisWeek, lastWeek, enough, leaveRate, seconds, studyOpens };
}
