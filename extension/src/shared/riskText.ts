// Vietnamese wording for risk hours (docs/thiet-ke-ky-thuat.md, 2.5). Pure functions, so they can be tested.
import type { RiskCell, RiskSuggestion, RiskWindow } from "../core";

export const RISK_LINE = "Đây là khung giờ bạn hay mở giải trí nên thời gian chờ dài hơn một cấp.";
export const RISK_AGENT_NOTE = "Khi đã nối với DopaDam trên máy tính, giờ nguy cơ được xem và chỉnh ở trang Thống kê của ứng dụng.";
export const RISK_SUBTITLE = "2 tuần gần nhất. Ô càng đậm, bạn càng hay mở giải trí vào giờ đó.";
export const RISK_NONE = "Chưa có khung giờ nào nổi bật.";

/** Short row labels of the heat map, row 0 = Monday. */
export const RISK_ROW_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** "thứ 2" ... "thứ 7", "Chủ nhật" for ISO weekdays 1..7. */
function dayName(day: number): string {
  return day === 7 ? "Chủ nhật" : `thứ ${day + 1}`;
}

/**
 * Days in a sentence: "thứ 2 đến thứ 6", "thứ 7 và Chủ nhật", "mỗi ngày"; a run of three or more consecutive days
 * is "A đến B", anything else is a list ("thứ 2, thứ 4 và thứ 6").
 */
export function formatRiskDays(days: readonly number[]): string {
  const sorted = [...new Set(days)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 7) return "mỗi ngày";
  const run = sorted.length >= 3 && sorted[sorted.length - 1] - sorted[0] === sorted.length - 1;
  if (run) return `${dayName(sorted[0])} đến ${dayName(sorted[sorted.length - 1])}`;
  const names = sorted.map(dayName);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} và ${names[names.length - 1]}`;
}

/** "22:00–24:00": an end of "00:00" is shown as "24:00". */
export function formatRiskRange(start: string, end: string): string {
  return `${start}–${end === "00:00" ? "24:00" : end}`;
}

/** One active window on one line. */
export function describeRiskWindow(w: Pick<RiskWindow, "days" | "start" | "end">): string {
  return `${formatRiskRange(w.start, w.end)} · ${formatRiskDays(w.days)} · thời gian chờ dài hơn một cấp`;
}

/** "Hay mở nhất: 22:00–24:00, thứ 2 đến thứ 6 (17 lần mở, 9 lần Vào)." */
export function describeSuggestion(s: RiskSuggestion): string {
  return `Hay mở nhất: ${formatRiskRange(s.start, s.end)}, ${formatRiskDays(s.days)} (${s.opens} lần mở, ${s.enters} lần Vào).`;
}

/** Title and aria-label of a heat map cell: "Thứ 3, 22 giờ: 5 lần mở, 3 lần Vào"; an empty one says so plainly. row 0 = Monday. */
export function describeHeatCell(row: number, hour: number, cell: RiskCell): string {
  const day = row === 6 ? "Chủ nhật" : `Thứ ${row + 2}`;
  return cell.opens > 0 ? `${day}, ${hour} giờ: ${cell.opens} lần mở, ${cell.enters} lần Vào` : `${day}, ${hour} giờ: chưa có lần mở nào`;
}

/** The confirmation text when a window is removed. */
export function describeRemoval(w: Pick<RiskWindow, "days" | "start" | "end">): string {
  return `Gỡ khung giờ nguy cơ ${formatRiskRange(w.start, w.end)}, ${formatRiskDays(w.days)}: thời gian chờ trong khung này sẽ không còn dài hơn một cấp.`;
}

/** Shade 0 (no opens) to 4 (the busiest cell), by opens relative to the busiest cell; any open is at least 1. */
export function heatShade(opens: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (opens <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil((opens / max) * 4))) as 1 | 2 | 3 | 4;
}
