export const MAX_DELAY_SECONDS = 120;

/** Per-app delay (even 0) overrides the tag default; result is clamped to 0..120 seconds. */
export function effectiveDelay(
  appDelaySeconds: number | null | undefined,
  tag: string,
  tagDelays: Readonly<Record<string, number | undefined>>,
): number {
  const raw = appDelaySeconds ?? tagDelays[tag] ?? 0;
  return Math.min(MAX_DELAY_SECONDS, Math.max(0, raw));
}
