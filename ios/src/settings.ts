// Friction settings of this client: the lock seconds and the daily budget go through the extension's setFriction;
// the minute options of "Vào" are only editable here (no other client edits them), under the same weaken/confirm/
// study-lock rules.
import { studyStatus, setFriction, type Result } from "../../extension/src/background/logic";
import type { State } from "../../extension/src/background/state";

export const MAX_OPTION_MINUTES = 120;
export const MAX_OPTIONS = 4;

/** 1 to MAX_OPTIONS whole numbers of minutes, 1..MAX_OPTION_MINUTES, strictly increasing. */
export function isNumberOptions(value: readonly number[]): boolean {
  return (
    value.length >= 1 &&
    value.length <= MAX_OPTIONS &&
    value.every((m, i) => Number.isInteger(m) && m >= 1 && m <= MAX_OPTION_MINUTES && (i === 0 || m > value[i - 1]))
  );
}

/** Longer or more options let more entertainment in, so they weaken protection. */
export function optionsWeaken(old: readonly number[], next: readonly number[]): boolean {
  return Math.max(0, ...next) > Math.max(0, ...old) || next.length > old.length;
}

export interface SettingsInput {
  lockSeconds: number[];
  budgetMinutes: number;
  allowOptionsNormal: number[];
  allowOptionsRestricted: number[];
}

export function currentSettings(state: State): SettingsInput {
  const s = state.settings;
  return {
    lockSeconds: [...s.lockSeconds],
    budgetMinutes: s.budgetMinutes,
    allowOptionsNormal: [...s.allowOptionsNormal],
    allowOptionsRestricted: [...s.allowOptionsRestricted],
  };
}

/** All of the settings form at once: either everything is applied or nothing is. */
export function applySettings(draft: State, input: SettingsInput, confirmed: boolean, now: number, tz: number): Result {
  if (!isNumberOptions(input.allowOptionsNormal) || !isNumberOptions(input.allowOptionsRestricted)) {
    return { ok: false, error: "invalid" };
  }
  const s = draft.settings;
  const optionsChanged =
    input.allowOptionsNormal.join() !== s.allowOptionsNormal.join() ||
    input.allowOptionsRestricted.join() !== s.allowOptionsRestricted.join();
  // Try everything on a copy first, so a refusal leaves the real draft untouched.
  const trial = structuredClone(draft);
  const friction = setFriction(trial, input.lockSeconds, input.budgetMinutes, confirmed, now, tz);
  if (!friction.ok) return friction;
  if (optionsChanged) {
    if (studyStatus(draft, now, tz).active) return { ok: false, error: "study-locked" };
    const weakens =
      optionsWeaken(s.allowOptionsNormal, input.allowOptionsNormal) ||
      optionsWeaken(s.allowOptionsRestricted, input.allowOptionsRestricted);
    if (weakens && !confirmed) return { ok: false, error: "needs-confirm" };
  }
  setFriction(draft, input.lockSeconds, input.budgetMinutes, confirmed, now, tz);
  if (optionsChanged) {
    s.allowOptionsNormal = [...input.allowOptionsNormal];
    s.allowOptionsRestricted = [...input.allowOptionsRestricted];
  }
  return { ok: true };
}

/** Parses "5, 15, 30" (commas, spaces or semicolons) into numbers; null when anything in it is not a whole number. */
export function parseOptions(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  const numbers = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  return numbers.length && numbers.every(Number.isFinite) ? numbers : null;
}
