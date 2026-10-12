export interface BudgetStatus {
  over: boolean;
  remainingMinutes: number | null;
}

/** A budget <= 0 means the daily budget is turned off. */
export function budgetStatus(usedMinutes: number, budgetMinutes: number): BudgetStatus {
  if (budgetMinutes <= 0) return { over: false, remainingMinutes: null };
  return { over: usedMinutes >= budgetMinutes, remainingMinutes: Math.max(0, budgetMinutes - usedMinutes) };
}
