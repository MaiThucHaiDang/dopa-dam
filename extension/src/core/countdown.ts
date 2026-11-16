/**
 * Visible time (ms) the warning page may count as already spent after a reload.
 * The background's wall-clock elapsed time is only an upper bound: a tab that sat hidden has not
 * shown the warning for that long. Without a stored value, the wall clock is used.
 */
export function resumeVisibleMs(backgroundElapsedMs: number, storedVisibleMs: number | null): number {
  const wall = Math.max(0, backgroundElapsedMs);
  if (storedVisibleMs === null || !Number.isFinite(storedVisibleMs)) return wall;
  return Math.min(wall, Math.max(0, storedVisibleMs));
}
