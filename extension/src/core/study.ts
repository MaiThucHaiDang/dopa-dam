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

/** Combines study sources with priority manual > taskflow > rule. */
export function resolveStudy(
  now: number,
  tzOffsetMinutes: number,
  manual: readonly Session[],
  rules: readonly StudyRule[],
  external: readonly Session[],
): StudyStatus {
  const candidates: [StudySource, Session | undefined][] = [
    ["manual", pickActive(manual, now)],
    ["taskflow", pickActive(external, now)],
    ["rule", pickActive(rules.flatMap((r) => ruleOccurrences(r, now, tzOffsetMinutes)), now)],
  ];
  for (const [source, session] of candidates) {
    if (session) {
      return { active: true, source, label: session.label || DEFAULT_STUDY_LABELS[source], endsAt: session.end };
    }
  }
  return NOT_STUDYING;
}
