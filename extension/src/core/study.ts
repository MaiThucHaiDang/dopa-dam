import type { ChangeKind } from "./friction";
import { DAY_MS, MINUTE_MS, formatLocalDate } from "./time";

export interface Session {
  id: string;
  start: number;
  end: number;
  label: string | null;
}

export interface StudyRule {
  id: string;
  /** ISO weekdays: 1 = Monday ... 7 = Sunday. */
  days: number[];
  /** Local time "HH:MM". If end <= start the window runs past midnight. */
  start: string;
  end: string;
  label: string | null;
  /** Local dates "YYYY-MM-DD" (keyed by the day the window starts) on which the rule is skipped. */
  exceptions: string[];
}

export type StudySource = "manual" | "taskflow" | "rule";

export interface StudyStatus {
  active: boolean;
  source: StudySource | null;
  label: string | null;
  endsAt: number | null;
}

export const DEFAULT_STUDY_LABELS: Record<StudySource, string> = {
  rule: "Khung giờ học",
  manual: "Phiên học",
  taskflow: "Phiên TaskFlow",
};

export const NOT_STUDYING: StudyStatus = { active: false, source: null, label: null, endsAt: null };

export function parseHm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Occurrences of a rule that start on the local day of `now` or the day before (overnight windows). */
export function ruleOccurrences(rule: StudyRule, now: number, tzOffsetMinutes: number): Session[] {
  const start = parseHm(rule.start);
  const end = parseHm(rule.end);
  if (start === null || end === null) return [];
  const offsetMs = tzOffsetMinutes * MINUTE_MS;
  const todayLocal = Math.floor((now + offsetMs) / DAY_MS) * DAY_MS;
  const out: Session[] = [];
  for (const dayShift of [-1, 0]) {
    const dayLocal = todayLocal + dayShift * DAY_MS;
    const weekday = ((new Date(dayLocal).getUTCDay() + 6) % 7) + 1;
    if (!rule.days.includes(weekday) || rule.exceptions.includes(formatLocalDate(dayLocal))) continue;
    const startLocal = dayLocal + start * MINUTE_MS;
    const endLocal = end > start ? dayLocal + end * MINUTE_MS : dayLocal + DAY_MS + end * MINUTE_MS;
    out.push({ id: rule.id, start: startLocal - offsetMs, end: endLocal - offsetMs, label: rule.label });
  }
  return out;
}

function pickActive(sessions: readonly Session[], now: number): Session | undefined {
  let best: Session | undefined;
  for (const s of sessions) {
    if (s.start <= now && now < s.end && (!best || s.end > best.end)) best = s;
  }
  return best;
}

/**
 * Anything that can say "these are study sessions": manual sessions, the weekly rules, and later
 * TaskFlow. Adding a source means writing one of these; the blocking side does not change.
 */
export interface StudySessionSource {
  readonly kind: StudySource;
  sessions(now: number, tzOffsetMinutes: number): Session[];
}

export function sessionListSource(kind: StudySource, sessions: readonly Session[]): StudySessionSource {
  return { kind, sessions: () => [...sessions] };
}

export function ruleSource(rules: readonly StudyRule[]): StudySessionSource {
  return { kind: "rule", sessions: (now, tz) => rules.flatMap((r) => ruleOccurrences(r, now, tz)) };
}

const SOURCE_PRIORITY: StudySource[] = ["manual", "taskflow", "rule"];

/** Studying when any source has a session running; the label comes from manual, then TaskFlow, then rules. */
export function resolveSources(now: number, tzOffsetMinutes: number, sources: readonly StudySessionSource[]): StudyStatus {
  for (const kind of SOURCE_PRIORITY) {
    const session = pickActive(
      sources.filter((s) => s.kind === kind).flatMap((s) => s.sessions(now, tzOffsetMinutes)),
      now,
    );
    if (session) {
      return { active: true, source: kind, label: session.label || DEFAULT_STUDY_LABELS[kind], endsAt: session.end };
    }
  }
  return NOT_STUDYING;
}

/** Combines study sources with priority manual > taskflow > rule. */
export function resolveStudy(
  now: number,
  tzOffsetMinutes: number,
  manual: readonly Session[],
  rules: readonly StudyRule[],
  external: readonly Session[],
): StudyStatus {
  return resolveSources(now, tzOffsetMinutes, [
    sessionListSource("manual", manual),
    sessionListSource("taskflow", external),
    ruleSource(rules),
  ]);
}

export interface RuleOccurrence {
  ruleId: string;
  /** Local date the window started on: the exception that skips it. */
  date: string;
}

/** Rule windows running at `now`, in rule order. Ending study early adds these as exceptions. */
export function activeRuleOccurrences(rules: readonly StudyRule[], now: number, tzOffsetMinutes: number): RuleOccurrence[] {
  const offsetMs = tzOffsetMinutes * MINUTE_MS;
  const out: RuleOccurrence[] = [];
  for (const rule of rules) {
    for (const s of ruleOccurrences(rule, now, tzOffsetMinutes)) {
      if (s.start <= now && now < s.end) {
        out.push({ ruleId: rule.id, date: formatLocalDate(Math.floor((s.start + offsetMs) / DAY_MS) * DAY_MS) });
      }
    }
  }
  return out;
}

/** Start and end in minutes after the start day's midnight; an end at or before the start is next day. */
function windowMinutes(rule: StudyRule): [number, number] | null {
  const start = parseHm(rule.start);
  const end = parseHm(rule.end);
  if (start === null || end === null) return null;
  return [start, end > start ? end : end + 24 * 60];
}

/**
 * Editing a weekly rule. Weakens: removing it, dropping days, a shorter window, or skipping today or a
 * session that is running. Adding a rule, more days, a longer window or skipping a later date does not.
 */
export function classifyStudyRuleChange(
  old: StudyRule | null,
  next: StudyRule | null,
  now: number,
  tzOffsetMinutes: number,
): ChangeKind {
  if (!old) return "ok";
  if (!next) return "weaken";
  if (old.days.some((d) => !next.days.includes(d))) return "weaken";
  const ow = windowMinutes(old);
  const nw = windowMinutes(next);
  if (ow && (!nw || nw[0] > ow[0] || nw[1] < ow[1])) return "weaken";
  const offsetMs = tzOffsetMinutes * MINUTE_MS;
  const protectedDates = new Set([
    formatLocalDate(Math.floor((now + offsetMs) / DAY_MS) * DAY_MS),
    ...activeRuleOccurrences([old], now, tzOffsetMinutes).map((o) => o.date),
  ]);
  const added = next.exceptions.filter((d) => !old.exceptions.includes(d));
  return added.some((d) => protectedDates.has(d)) ? "weaken" : "ok";
}

export const STUDY_LABEL_MAX = 60;
export const MANUAL_STUDY_MINUTES = [25, 50, 90];

/** Cleans a rule typed by the user; null when it cannot be a rule (no day, bad time, empty window). */
export function normalizeStudyRule(rule: StudyRule): StudyRule | null {
  const days = [...new Set(rule.days)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b);
  const start = parseHm(rule.start);
  const end = parseHm(rule.end);
  if (!days.length || start === null || end === null || start === end) return null;
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const label = (rule.label ?? "").trim().slice(0, STUDY_LABEL_MAX);
  const exceptions = [...new Set(rule.exceptions)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return { id: rule.id, days, start: hm(start), end: hm(end), label: label || null, exceptions };
}

const DAY_NAMES = ["", "T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** "T2–T6", "T2, T4, T6", "Mỗi ngày": consecutive weekdays collapse into a range. */
export function formatStudyDays(days: readonly number[]): string {
  const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (sorted.length === 7) return "Mỗi ngày";
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j - i >= 2 ? `${DAY_NAMES[sorted[i]]}–${DAY_NAMES[sorted[j]]}` : sorted.slice(i, j + 1).map((d) => DAY_NAMES[d]).join(", "));
    i = j + 1;
  }
  return parts.join(", ");
}

/** "2026-10-14" → "14/10". */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(d)}/${Number(m)}`;
}
