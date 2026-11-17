import type { ChangeKind } from "./friction";
import { parseHm } from "./study";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "./time";

/** A weekly window in which the friction level is raised by one (docs/thiet-ke-ky-thuat.md, 2.5). */
export interface RiskWindow {
  id: string;
  /** ISO weekdays: 1 = Monday ... 7 = Sunday. */
  days: number[];
  /** Local time "HH:MM". If end <= start the window runs past midnight. */
  start: string;
  end: string;
}

export const MAX_RISK_WINDOWS = 12;
/** A suggested block needs at least this many warnings. */
export const RISK_MIN_OPENS = 6;
/** Length of a suggested block, in hours. */
export const RISK_BLOCK_HOURS = 2;

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];
const WEEK_MINUTES = 7 * 1440;

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * Cleans a window typed by the user: days deduplicated, sorted and limited to 1..7; times written "HH:MM".
 * Null when it cannot be a window (no day, bad time, start == end). The id is kept as given.
 */
export function normalizeRiskWindow(window: RiskWindow): RiskWindow | null {
  const days = [...new Set(window.days)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b);
  const start = parseHm(window.start);
  const end = parseHm(window.end);
  if (!days.length || start === null || end === null || start === end) return null;
  return { id: window.id, days, start: hm(start), end: hm(end) };
}

/** Valid windows only, as [days, start minute, end minute]; the end is after the start (next day when it wraps). */
function validWindows(windows: readonly RiskWindow[]): { days: number[]; start: number; end: number }[] {
  const out: { days: number[]; start: number; end: number }[] = [];
  for (const w of windows) {
    const n = normalizeRiskWindow(w);
    if (!n) continue;
    const start = parseHm(n.start)!;
    const end = parseHm(n.end)!;
    out.push({ days: n.days, start, end: end > start ? end : end + 1440 });
  }
  return out;
}

/** ISO weekday (1 = Monday) of a "local ms" value, and the minute of that local day. */
function localParts(localMs: number): { weekday: number; minute: number } {
  const dayStart = Math.floor(localMs / DAY_MS) * DAY_MS;
  return {
    weekday: ((new Date(dayStart).getUTCDay() + 6) % 7) + 1,
    minute: Math.floor((localMs - dayStart) / MINUTE_MS),
  };
}

/**
 * True when `now` is inside an occurrence of at least one window: start counted, end not counted; a window
 * that starts on a listed day and runs past midnight still counts after midnight. Invalid windows are ignored.
 */
export function inRiskWindow(windows: readonly RiskWindow[], now: number, tzOffsetMinutes: number): boolean {
  const { weekday, minute } = localParts(now + tzOffsetMinutes * MINUTE_MS);
  const yesterday = weekday === 1 ? 7 : weekday - 1;
  for (const w of validWindows(windows)) {
    if (w.days.includes(weekday) && w.start <= minute && minute < w.end) return true;
    // Yesterday's occurrence, seen after midnight (only windows that run past midnight reach this far).
    if (w.days.includes(yesterday) && w.end > 1440 && minute + 1440 < w.end) return true;
  }
  return false;
}

export interface RiskCell {
  opens: number;
  enters: number;
}

/** 7 rows (0 = Monday ... 6 = Sunday) of 24 columns (local hour 0..23). */
export type RiskHeatmap = RiskCell[][];

/** The part of an event the heat map needs; the background's event type fits. */
export interface RiskEvent {
  shownAt: number;
  decision?: string | null;
}

export function emptyHeatmap(): RiskHeatmap {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ opens: 0, enters: 0 })));
}

/**
 * Warnings with now - days * 24h <= shownAt <= now (both ends counted), by local weekday and hour of
 * `shownAt` (the 04:00 day boundary is not used). `opens` counts every warning, `enters` those decided "enter".
 */
export function riskHeatmap(events: readonly RiskEvent[], now: number, tzOffsetMinutes: number, days: number): RiskHeatmap {
  const grid = emptyHeatmap();
  const from = now - days * DAY_MS;
  for (const e of events) {
    if (e.shownAt < from || e.shownAt > now) continue;
    const local = e.shownAt + tzOffsetMinutes * MINUTE_MS;
    const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
    const row = (new Date(dayStart).getUTCDay() + 6) % 7;
    const hour = Math.floor((local - dayStart) / HOUR_MS);
    const cell = grid[row][hour];
    cell.opens++;
    if (e.decision === "enter") cell.enters++;
  }
  return grid;
}

export interface RiskSuggestion {
  days: number[];
  start: string;
  end: string;
  opens: number;
  enters: number;
}

/**
 * Is local hour `hour` of weekday `day` entirely inside one existing window? Either a window listing `day`
 * (end already moved 24 h later when it runs past midnight), or one listing the day before that runs past
 * midnight far enough. A window made of two adjacent windows does not count as one.
 */
function hourCovered(windows: ReturnType<typeof validWindows>, day: number, hour: number): boolean {
  const prev = day === 1 ? 7 : day - 1;
  const from = hour * 60;
  const to = from + 60;
  return windows.some(
    (w) =>
      (w.days.includes(day) && w.start <= from && to <= w.end) ||
      (w.days.includes(prev) && w.end > 1440 && to <= w.end - 1440),
  );
}

/**
 * The two-hour block (a group of days, starting hour h, hours h and h+1) with the highest opens per day of the
 * group, among blocks with at least RISK_MIN_OPENS warnings that no existing window already covers. Ties:
 * higher enters per day, then weekdays before weekend, then the smaller h. Integer comparisons only.
 * `cells` is a 7 x 24 grid as from riskHeatmap; missing cells count as zero.
 */
export function suggestRiskWindow(cells: readonly (readonly RiskCell[])[], existing: readonly RiskWindow[]): RiskSuggestion | null {
  const windows = validWindows(existing);
  let best: { days: number[]; h: number; opens: number; enters: number } | null = null;
  for (const group of [WEEKDAYS, WEEKEND]) {
    for (let h = 0; h <= 24 - RISK_BLOCK_HOURS; h++) {
      let opens = 0;
      let enters = 0;
      for (const d of group) {
        for (let x = h; x < h + RISK_BLOCK_HOURS; x++) {
          const cell = cells[d - 1]?.[x];
          opens += cell?.opens ?? 0;
          enters += cell?.enters ?? 0;
        }
      }
      if (opens < RISK_MIN_OPENS) continue;
      let covered = true;
      for (const d of group) {
        for (let x = h; x < h + RISK_BLOCK_HOURS; x++) if (!hourCovered(windows, d, x)) covered = false;
      }
      if (covered) continue;
      // Per-day comparison by cross-multiplication: a / group.length > b / best.days.length.
      if (best) {
        const l = group.length;
        const r = best.days.length;
        const byOpens = opens * r - best.opens * l;
        const byEnters = enters * r - best.enters * l;
        // Group order (weekdays first) and h order follow from the loop order: only strictly better replaces.
        if (byOpens < 0 || (byOpens === 0 && byEnters <= 0)) continue;
      }
      best = { days: group, h, opens, enters };
    }
  }
  if (!best) return null;
  return {
    days: [...best.days],
    start: hm(best.h * 60),
    end: hm(((best.h + RISK_BLOCK_HOURS) % 24) * 60),
    opens: best.opens,
    enters: best.enters,
  };
}

/** Which minutes of the week (0 = Monday 00:00) the windows cover; a window running past Sunday wraps to Monday. */
function weekCoverage(windows: readonly RiskWindow[]): Uint8Array {
  const covered = new Uint8Array(WEEK_MINUTES);
  for (const w of validWindows(windows)) {
    for (const d of w.days) {
      for (let m = w.start; m < w.end; m++) covered[((d - 1) * 1440 + m) % WEEK_MINUTES] = 1;
    }
  }
  return covered;
}

/**
 * "weaken" when some minute of the week was covered by the old list and is not covered by the new one
 * (a window removed, fewer days, shorter); otherwise "ok" (a window added, longer, split, reordered).
 */
export function classifyRiskWindowsChange(old: readonly RiskWindow[], next: readonly RiskWindow[]): ChangeKind {
  const a = weekCoverage(old);
  const b = weekCoverage(next);
  for (let m = 0; m < WEEK_MINUTES; m++) if (a[m] && !b[m]) return "weaken";
  return "ok";
}
