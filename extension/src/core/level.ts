import type { FrictionSettings } from "./types";

export type Level = 0 | 1 | 2 | 3;

export interface LevelResult {
  level: Level;
  lockSeconds: number;
  allowOptions: number[];
}

/** Friction level from the number of warnings in the previous hour, study mode and the daily budget. */
export function computeLevel(n: number, inStudy: boolean, overBudget: boolean, settings: FrictionSettings): LevelResult {
  const level: Level = inStudy || overBudget ? 3 : n <= 0 ? 0 : n <= 2 ? 1 : 2;
  const options = level === 3 ? settings.allowOptionsRestricted : settings.allowOptionsNormal;
  return { level, lockSeconds: settings.lockSeconds[level], allowOptions: [...options] };
}
