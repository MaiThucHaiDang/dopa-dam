export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Number of timestamps t with now - 1h < t <= now. */
export function recentCount(timestamps: readonly number[], now: number): number {
  let count = 0;
  for (const t of timestamps) {
    if (t > now - HOUR_MS && t <= now) count++;
  }
  return count;
}

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/** YYYY-MM-DD of a "local ms" value (epoch ms already shifted by the timezone offset). */
export function formatLocalDate(localMs: number): string {
  const d = new Date(localMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The app's day starts at 04:00 local time so staying up past midnight does not reset the budget. */
export function dayKey(t: number, tzOffsetMinutes: number): string {
  return formatLocalDate(t + tzOffsetMinutes * MINUTE_MS - 4 * HOUR_MS);
}

/** Minutes east of UTC for the local timezone at instant t (Vietnam: 420). */
export function localTzOffset(t: number): number {
  return -new Date(t).getTimezoneOffset();
}
