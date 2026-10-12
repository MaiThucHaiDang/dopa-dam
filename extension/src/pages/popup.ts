import { sendRequest, type PopupView } from "../shared/messages";
import { byId, minutesUntil, show } from "./dom";

async function main(): Promise<void> {
  const v = await sendRequest<PopupView>({ type: "popup:get" });
  byId("protection").textContent = v.protectionEnabled ? "Bảo vệ đang bật" : "Bảo vệ đang TẮT";
  byId("warnings").textContent = String(v.warningsToday);
  byId("exits").textContent = String(v.exitsToday);
  const used = Math.round(v.budget.usedMinutes);
  byId("budget").textContent = v.budget.budgetMinutes > 0 ? `${used} / ${v.budget.budgetMinutes} phút` : `${used} phút`;
  if (v.study.active && v.study.endsAt !== null) {
    byId("study").textContent = `Đang học: ${v.study.label} · còn ${minutesUntil(v.study.endsAt)} phút`;
    show(byId("study"), true);
  }
  byId("agent").textContent = v.agent.connected ? "Đã nối với agent trên máy" : "Chạy riêng (chưa nối agent)";
}

byId("open-options").addEventListener("click", () => void chrome.runtime.openOptionsPage());
void main();
