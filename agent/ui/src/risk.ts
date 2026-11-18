// Wording and shapes for the "Giờ nguy cơ" card (docs/thiet-ke-ky-thuat.md, 2.5). Pure functions only.
import type { RiskCell, RiskSuggestion, RiskWindow } from "./api";

/** The agent refuses more windows than this (MAX_RISK_WINDOWS in risk.rs). */
export const MAX_RISK_WINDOWS = 12;

/** "thứ 2" (Monday) ... "thứ 7", "Chủ nhật" for ISO weekday 1..7. */
export function dayName(day: number): string {
  return day === 7 ? "Chủ nhật" : `thứ ${day + 1}`;
}

/** The same with a capital letter, for the start of a sentence or a label: "Thứ 3", "Chủ nhật". */
export function dayNameCapital(day: number): string {
  const name = dayName(day);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Days in a sentence: "thứ 2 đến thứ 6", "thứ 7 và Chủ nhật", "mỗi ngày"; a run of three or more consecutive days
 * is "A đến B", anything else is a list ("thứ 2, thứ 4 và thứ 6"). Same wording as extension/src/shared/riskText.ts.
 */
export function formatDays(days: readonly number[]): string {
  const sorted = [...new Set(days)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 7) return "mỗi ngày";
  const run = sorted.length >= 3 && sorted[sorted.length - 1] - sorted[0] === sorted.length - 1;
  if (run) return `${dayName(sorted[0])} đến ${dayName(sorted[sorted.length - 1])}`;
  const names = sorted.map(dayName);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} và ${names[names.length - 1]}`;
}

/** An end of "00:00" reads as "24:00" ("22:00–24:00"); other times are shown as they are. */
export function clockEnd(end: string): string {
  return end === "00:00" ? "24:00" : end;
}

/** "22:00–24:00". */
export function formatRange(start: string, end: string): string {
  return `${start}–${clockEnd(end)}`;
}

/** "22:00–24:00 · thứ 2 đến thứ 6 · thời gian chờ dài hơn một cấp". */
export function formatWindow(w: Pick<RiskWindow, "days" | "start" | "end">): string {
  return `${formatRange(w.start, w.end)} · ${formatDays(w.days)} · thời gian chờ dài hơn một cấp`;
}

/** "Hay mở nhất: 22:00–24:00, thứ 2 đến thứ 6 (17 lần mở, 9 lần Vào)." */
export function formatSuggestion(s: RiskSuggestion): string {
  return `Hay mở nhất: ${formatRange(s.start, s.end)}, ${formatDays(s.days)} (${s.opens} lần mở, ${s.enters} lần Vào).`;
}

/** The window that the suggestion button adds. */
export function suggestionToWindow(s: RiskSuggestion, id: string): RiskWindow {
  return { id, days: [...s.days], start: s.start, end: s.end };
}

/** "Thứ 3, 22 giờ: 5 lần mở, 3 lần Vào"; an empty hour says so plainly. */
export function cellLabel(row: number, hour: number, cell: RiskCell): string {
  const where = `${dayNameCapital(row + 1)}, ${hour} giờ`;
  return cell.opens > 0 ? `${where}: ${cell.opens} lần mở, ${cell.enters} lần Vào` : `${where}: chưa có lần mở nào`;
}

/** The confirmation text when a window is removed. */
export function formatRemoval(w: Pick<RiskWindow, "days" | "start" | "end">): string {
  return `Gỡ khung giờ nguy cơ ${formatRange(w.start, w.end)}, ${formatDays(w.days)}: thời gian chờ trong khung này sẽ không còn dài hơn một cấp.`;
}

/** Weakest visible shade for a non-empty cell, so that one opening is still seen. */
export const HEAT_FLOOR = 0.2;

/** Strength 0..1 of a cell's colour by its opens against the busiest cell; 0 only for an empty cell. */
export function heatIntensity(opens: number, maxOpens: number): number {
  if (opens <= 0 || maxOpens <= 0) return 0;
  return HEAT_FLOOR + (1 - HEAT_FLOOR) * Math.min(1, opens / maxOpens);
}

/** The most opens in one cell. */
export function busiestCell(cells: readonly (readonly RiskCell[])[]): number {
  return cells.reduce((m, row) => row.reduce((n, c) => Math.max(n, c.opens), m), 0);
}
