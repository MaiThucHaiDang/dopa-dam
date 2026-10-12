// Pure state transitions for the standalone extension. Callers pass a mutable draft (see store.update).
import {
  DAY_MS,
  budgetStatus,
  classifyNumberChange,
  classifyTagChange,
  computeLevel,
  dayKey,
  isAllowedUrl,
  isBlockedTag,
  matchDomainRule,
  normalizeDomainInput,
  normalizeHost,
  parseAllowUrl,
  recentCount,
  resolveStudy,
  sameAllowEntry,
  type AllowEntry,
  type DomainRule,
  type StudyStatus,
  type Tag,
} from "../core";
import { ACTIVITIES, type AllowWindow, type Decision, type State, type WarningEvent } from "./state";

export const RETENTION_DAYS = 14;
export const MAX_EVENTS = 5000;
/** Grace for the lock check, to absorb timer jitter between the page and the background. */
const LOCK_TOLERANCE_MS = 500;

export type ErrorCode =
  | "invalid"
  | "needs-confirm"
  | "study-locked"
  | "unknown-event"
  | "already-decided"
  | "locked";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode };

export interface InterceptConfig {
  protectionEnabled: boolean;
  domainRules: DomainRule[];
  allowUrls: AllowEntry[];
  allowWindows: AllowWindow[];
}

export type Evaluation = { intercept: false } | { intercept: true; object: string; tag: Tag; host: string };

export function interceptConfig(state: State): InterceptConfig {
  return {
    protectionEnabled: state.protectionEnabled,
    domainRules: state.domainRules,
    allowUrls: state.allowUrls,
    allowWindows: state.allowWindows,
  };
}

/** Whether a top-level navigation to `url` must show the warning page instead. */
export function evaluateUrl(cfg: InterceptConfig, url: string, now: number): Evaluation {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { intercept: false };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { intercept: false };
  if (!cfg.protectionEnabled) return { intercept: false };
  const rule = matchDomainRule(parsed.hostname, cfg.domainRules);
  if (!rule || !isBlockedTag(rule.tag)) return { intercept: false };
  if (isAllowedUrl(url, cfg.allowUrls)) return { intercept: false };
  if (cfg.allowWindows.some((w) => w.object === rule.pattern && w.expiresAt > now)) return { intercept: false };
  return { intercept: true, object: rule.pattern, tag: rule.tag, host: normalizeHost(parsed.hostname) };
}

export function studyStatus(state: State, now: number, tz: number): StudyStatus {
  return resolveStudy(now, tz, state.study.manual, state.study.rules, []);
}

export function entertainmentMinutes(state: State, day: string): number {
  const d = state.usage[day];
  if (!d) return 0;
  return ((d.entertainment ?? 0) + (d.game ?? 0)) / 60;
}

export interface BudgetView {
  usedMinutes: number;
  budgetMinutes: number;
  remainingMinutes: number | null;
  over: boolean;
}

export function budgetView(state: State, now: number, tz: number): BudgetView {
  const used = entertainmentMinutes(state, dayKey(now, tz));
  const status = budgetStatus(used, state.settings.budgetMinutes);
  return { usedMinutes: used, budgetMinutes: state.settings.budgetMinutes, ...status };
}

export function allowOptionsFor(state: State, level: number): number[] {
  return level === 3 ? state.settings.allowOptionsRestricted : state.settings.allowOptionsNormal;
}

/** Records that a warning is being shown. Re-initialising the same warning page returns the existing event. */
export function recordWarning(
  draft: State,
  input: { id: string; object: string; tag: Tag; url: string; now: number; tz: number },
): WarningEvent {
  const existing = draft.events.find((e) => e.id === input.id);
  if (existing) return existing;
  const { now, tz } = input;
  const n = recentCount(
    draft.events.map((e) => e.shownAt),
    now,
  );
  const study = studyStatus(draft, now, tz);
  const budget = budgetView(draft, now, tz);
  const lvl = computeLevel(n, study.active, budget.over, draft.settings);
  const event: WarningEvent = {
    id: input.id,
    object: input.object,
    tag: input.tag,
    url: input.url,
    level: lvl.level,
    lockSeconds: lvl.lockSeconds,
    n,
    shownAt: now,
    studyLabel: study.active ? study.label : null,
    decision: null,
    decidedAt: null,
    allowMinutes: null,
    activity: null,
    activityMinutes: null,
  };
  draft.events.push(event);
  if (draft.events.length > MAX_EVENTS) draft.events.splice(0, draft.events.length - MAX_EVENTS);
  return event;
}

export interface DecisionInput {
  decision: Decision;
  allowMinutes?: number;
  activity?: string;
  activityMinutes?: number;
}

export function applyDecision(
  draft: State,
  eventId: string,
  input: DecisionInput,
  now: number,
): Result<{ event: WarningEvent; window?: AllowWindow }> {
  const event = draft.events.find((e) => e.id === eventId);
  if (!event) return { ok: false, error: "unknown-event" };
  if (event.decision) {
    return event.decision === input.decision ? { ok: true, event } : { ok: false, error: "already-decided" };
  }
  let window: AllowWindow | undefined;
  if (input.decision === "enter") {
    if (now - event.shownAt < event.lockSeconds * 1000 - LOCK_TOLERANCE_MS) return { ok: false, error: "locked" };
    const minutes = input.allowMinutes;
    if (minutes === undefined || !allowOptionsFor(draft, event.level).includes(minutes)) {
      return { ok: false, error: "invalid" };
    }
    window = { object: event.object, expiresAt: now + minutes * 60_000, headsUpSent: false };
    draft.allowWindows = draft.allowWindows.filter((w) => w.object !== event.object);
    draft.allowWindows.push(window);
    event.allowMinutes = minutes;
  } else if (input.decision === "alternative") {
    const minutes = input.activityMinutes;
    if (
      !input.activity ||
      !(ACTIVITIES as readonly string[]).includes(input.activity) ||
      minutes === undefined ||
      !Number.isInteger(minutes) ||
      minutes < 2 ||
      minutes > 10
    ) {
      return { ok: false, error: "invalid" };
    }
    event.activity = input.activity;
    event.activityMinutes = minutes;
  }
  event.decision = input.decision;
  event.decidedAt = now;
  return { ok: true, event, window };
}

/** A warning page that disappears without a decision (tab closed) counts as leaving. */
export function autoExit(draft: State, eventId: string, now: number): boolean {
  const event = draft.events.find((e) => e.id === eventId);
  if (!event || event.decision) return false;
  event.decision = "exit";
  event.decidedAt = now;
  return true;
}

export function addUsage(draft: State, day: string, tag: string, seconds: number): void {
  const bucket = (draft.usage[day] ??= {});
  bucket[tag] = (bucket[tag] ?? 0) + seconds;
}

/** Removes expired allow windows and returns their objects. */
export function takeExpiredWindows(draft: State, now: number): string[] {
  const expired = draft.allowWindows.filter((w) => w.expiresAt <= now).map((w) => w.object);
  if (expired.length) draft.allowWindows = draft.allowWindows.filter((w) => w.expiresAt > now);
  return expired;
}

export function prune(draft: State, now: number, tz: number): void {
  const cutoff = now - RETENTION_DAYS * DAY_MS;
  draft.events = draft.events.filter((e) => e.shownAt >= cutoff);
  const cutoffDay = dayKey(cutoff, tz);
  for (const day of Object.keys(draft.usage)) {
    if (day < cutoffDay) delete draft.usage[day];
  }
  draft.study.manual = draft.study.manual.filter((s) => s.end >= cutoff);
}

// ---- Options ---------------------------------------------------------------

function studyLocked(draft: State, now: number, tz: number): boolean {
  return studyStatus(draft, now, tz).active;
}

export function setDomainRule(
  draft: State,
  patternInput: string,
  tag: Tag | null,
  confirmed: boolean,
  now: number,
  tz: number,
): Result<{ pattern: string }> {
  const pattern = normalizeDomainInput(patternInput);
  if (!pattern) return { ok: false, error: "invalid" };
  const index = draft.domainRules.findIndex((r) => r.pattern === pattern);
  const oldTag = index >= 0 ? draft.domainRules[index].tag : null;
  if (oldTag === tag) return { ok: true, pattern };
  if (studyLocked(draft, now, tz)) return { ok: false, error: "study-locked" };
  if (classifyTagChange(oldTag, tag) === "weaken" && !confirmed) return { ok: false, error: "needs-confirm" };
  if (tag === null) draft.domainRules.splice(index, 1);
  else if (index >= 0) draft.domainRules[index] = { pattern, tag };
  else draft.domainRules.push({ pattern, tag });
  draft.domainRules.sort((a, b) => a.pattern.localeCompare(b.pattern));
  return { ok: true, pattern };
}

/** Adding an allowed link always needs confirmation, but is permitted during study. */
export function addAllowUrl(draft: State, text: string, confirmed: boolean): Result<{ entry: AllowEntry }> {
  const entry = parseAllowUrl(text);
  if (!entry) return { ok: false, error: "invalid" };
  if (draft.allowUrls.some((e) => sameAllowEntry(e, entry))) return { ok: true, entry };
  if (!confirmed) return { ok: false, error: "needs-confirm" };
  draft.allowUrls.push(entry);
  return { ok: true, entry };
}

export function removeAllowUrl(draft: State, entry: AllowEntry): Result {
  draft.allowUrls = draft.allowUrls.filter((e) => !sameAllowEntry(e, entry));
  return { ok: true };
}

export function setFriction(
  draft: State,
  lockSeconds: number[],
  budgetMinutes: number,
  confirmed: boolean,
  now: number,
  tz: number,
): Result {
  const valid =
    lockSeconds.length === 4 &&
    lockSeconds.every((s) => Number.isInteger(s) && s >= 0 && s <= 300) &&
    Number.isInteger(budgetMinutes) &&
    budgetMinutes >= 0 &&
    budgetMinutes <= 1440;
  if (!valid) return { ok: false, error: "invalid" };
  const s = draft.settings;
  const changed = lockSeconds.some((v, i) => v !== s.lockSeconds[i]) || budgetMinutes !== s.budgetMinutes;
  if (!changed) return { ok: true };
  if (studyLocked(draft, now, tz)) return { ok: false, error: "study-locked" };
  const weakens =
    lockSeconds.some((v, i) => classifyNumberChange("lockSeconds", s.lockSeconds[i], v) === "weaken") ||
    classifyNumberChange("budgetMinutes", s.budgetMinutes, budgetMinutes) === "weaken";
  if (weakens && !confirmed) return { ok: false, error: "needs-confirm" };
  s.lockSeconds = [...lockSeconds];
  s.budgetMinutes = budgetMinutes;
  return { ok: true };
}

export function setProtection(draft: State, enabled: boolean, confirmed: boolean, now: number, tz: number): Result {
  if (enabled === draft.protectionEnabled) return { ok: true };
  if (!enabled) {
    if (studyLocked(draft, now, tz)) return { ok: false, error: "study-locked" };
    if (!confirmed) return { ok: false, error: "needs-confirm" };
  }
  draft.protectionEnabled = enabled;
  return { ok: true };
}

export function clearLog(draft: State, confirmed: boolean): Result {
  if (!confirmed) return { ok: false, error: "needs-confirm" };
  draft.events = [];
  draft.usage = {};
  return { ok: true };
}

