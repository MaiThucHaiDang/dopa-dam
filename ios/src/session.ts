// What is new in this client, on top of the extension's state machine (background/logic.ts):
// opening a warning for an app, abandoned warnings, and counting granted minutes as entertainment time.
import { dayKey, type StudyStatus } from "../../extension/src/core";
import {
  addUsage,
  allowOptionsFor,
  applyDecision,
  autoExit,
  budgetView,
  cancelPendingClose,
  prune,
  recordWarning,
  resolvePendingCloses,
  studyStatus,
  takeExpiredWindows,
  type BudgetView,
  type Result,
} from "../../extension/src/background/logic";
import type { AllowWindow, State, WarningEvent } from "../../extension/src/background/state";

/** Tag of every app event: the apps that trigger the gate are the entertainment ones. */
export const APP_TAG = "entertainment" as const;

/**
 * A warning page that went away (tab hidden or closed) and stayed away this long counts as Thoát. A shorter
 * absence (a reload, a glance at a notification) keeps the same warning.
 */
export const ABANDON_GRACE_MS = 15_000;

/** An undecided warning this old, that no page claims any more, is a Thoát too (a page killed without any event). */
export const STALE_UNDECIDED_MS = 10 * 60_000;

export interface OpenInput {
  app: string;
  /** The id this page instance already has (kept in history.state), or null for a first load. */
  id: string | null;
  newId: () => string;
  now: number;
  tz: number;
}

/** Turns warnings of other pages that went away into Thoát, removes old data and expired allow windows. */
export function settle(draft: State, now: number, tz: number, keepId: string | null = null): string[] {
  const exited = resolvePendingCloses(draft, now, ABANDON_GRACE_MS);
  for (const e of draft.events) {
    if (e.decision === null && e.id !== keepId && now - e.shownAt >= STALE_UNDECIDED_MS) {
      autoExit(draft, e.id, e.shownAt);
      exited.push(e.id);
    }
  }
  takeExpiredWindows(draft, now);
  prune(draft, now, tz);
  return exited;
}

/**
 * Opens the warning for this page: the same warning again when this page instance is back within the grace time
 * (a reload) or already decided it; otherwise a new warning, and a warning of this page that was abandoned becomes
 * a Thoát first. Warnings of other pages that went away are settled too.
 */
export function openWarning(draft: State, input: OpenInput): { event: WarningEvent; resumed: boolean } {
  const { app, now, tz } = input;
  let id = input.id;
  let resumed = false;
  if (id) {
    const own = draft.events.find((e) => e.id === id);
    if (own && own.object === app) {
      const pending = draft.pendingCloses.find((c) => c.eventId === id);
      if (own.decision === null && pending && now - pending.closedAt >= ABANDON_GRACE_MS) {
        // Away for too long: that warning ended as Thoát when the page went away; this is a new one.
        autoExit(draft, own.id, pending.closedAt);
        draft.pendingCloses = draft.pendingCloses.filter((c) => c.eventId !== id);
        id = null;
      } else {
        cancelPendingClose(draft, own.id);
        resumed = true;
      }
    } else {
      id = null;
    }
  }
  settle(draft, now, tz, id);
  if (resumed && id) return { event: draft.events.find((e) => e.id === id)!, resumed };
  const event = recordWarning(draft, { id: input.newId(), object: app, tag: APP_TAG, url: `app:${app}`, now, tz });
  return { event, resumed: false };
}

/** The page left the warning (tab hidden, page unloading). Only an undecided warning can be abandoned. */
export function markAway(draft: State, eventId: string, now: number): void {
  const event = draft.events.find((e) => e.id === eventId);
  if (!event || event.decision !== null) return;
  draft.pendingCloses = draft.pendingCloses.filter((c) => c.eventId !== eventId);
  draft.pendingCloses.push({ eventId, closedAt: now });
}

/**
 * "Vào" with minutes: records the decision and counts the minutes as entertainment time of the day. Pressing
 * it again for the same decision records nothing twice.
 */
export function decideEnter(
  draft: State,
  eventId: string,
  minutes: number,
  now: number,
  tz: number,
): Result<{ event: WarningEvent; window?: AllowWindow }> {
  const before = draft.events.find((e) => e.id === eventId);
  const first = before !== undefined && before.decision === null;
  const result = applyDecision(draft, eventId, { decision: "enter", allowMinutes: minutes }, now);
  if (result.ok && first) {
    cancelPendingClose(draft, eventId);
    addUsage(draft, dayKey(now, tz), APP_TAG, minutes * 60);
  }
  return result;
}

export function decideExit(draft: State, eventId: string, now: number): Result<{ event: WarningEvent }> {
  const result = applyDecision(draft, eventId, { decision: "exit" }, now);
  if (result.ok) cancelPendingClose(draft, eventId);
  return result;
}

export function decideAlternative(
  draft: State,
  eventId: string,
  activity: string,
  minutes: number,
  now: number,
): Result<{ event: WarningEvent }> {
  const result = applyDecision(draft, eventId, { decision: "alternative", activity, activityMinutes: minutes }, now);
  if (result.ok) cancelPendingClose(draft, eventId);
  return result;
}

/** Everything the warning screen shows, from the stored state. */
export interface WarningView {
  level: number;
  lockSeconds: number;
  risk: boolean;
  /** How many times in the last hour, counting this one. */
  countThisHour: number;
  allowOptions: number[];
  budget: BudgetView;
  study: StudyStatus;
  /** Wall-clock time since the warning was first shown. */
  elapsedMs: number;
}

export function warningView(state: State, event: WarningEvent, now: number, tz: number): WarningView {
  return {
    level: event.level,
    lockSeconds: event.lockSeconds,
    risk: event.risk === true,
    countThisHour: event.n + 1,
    allowOptions: allowOptionsFor(state, event.level),
    budget: budgetView(state, now, tz),
    study: studyStatus(state, now, tz),
    elapsedMs: Math.max(0, now - event.shownAt),
  };
}

/** "Vào" window still running for this decision, as the page can know it (the shortcut enforces the real one). */
export function enterWindowEnd(event: WarningEvent): number | null {
  return event.decision === "enter" && event.decidedAt !== null && event.allowMinutes !== null
    ? event.decidedAt + event.allowMinutes * 60_000
    : null;
}

export function alternativeEnd(event: WarningEvent): number | null {
  return event.decision === "alternative" && event.decidedAt !== null && event.activityMinutes !== null
    ? event.decidedAt + event.activityMinutes * 60_000
    : null;
}
