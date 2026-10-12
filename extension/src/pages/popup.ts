import { MANUAL_STUDY_MINUTES } from "../core";
import { ERROR_TEXT, sendRequest, type PopupView, type SimpleResponse } from "../shared/messages";
import { byId, el, minutesUntil, show } from "./dom";

async function main(): Promise<void> {
  const v = await sendRequest<PopupView>({ type: "popup:get" });
  byId("protection").textContent = v.protectionEnabled ? "Bảo vệ đang bật" : "Bảo vệ đang TẮT";
  byId("warnings").textContent = String(v.warningsToday);
  byId("exits").textContent = String(v.exitsToday);
  const used = Math.round(v.budget.usedMinutes);
  byId("budget").textContent = v.budget.budgetMinutes > 0 ? `${used} / ${v.budget.budgetMinutes} phút` : `${used} phút`;
  const studying = v.study.active && v.study.endsAt !== null;
  if (studying) {
    byId("study").textContent = `Đang học: ${v.study.label} · còn ${minutesUntil(v.study.endsAt!)} phút`;
  }
  show(byId("study"), studying);
  show(byId("study-start"), !studying);
  show(byId("study-stop"), studying);
  byId("agent").textContent = v.agent.connected ? "Đã nối với agent trên máy" : "Chạy riêng (chưa nối agent)";
}

async function startStudy(minutes: number): Promise<void> {
  const label = byId<HTMLInputElement>("study-label").value.trim() || null;
  const res = await sendRequest<SimpleResponse>({ type: "study:start", minutes, label });
  const error = byId("error");
  error.textContent = res.ok ? "" : ERROR_TEXT[res.error];
  show(error, !res.ok);
  if (res.ok) byId<HTMLInputElement>("study-label").value = "";
  await main();
}

byId("study-buttons").replaceChildren(
  ...MANUAL_STUDY_MINUTES.map((m) =>
    el("button", { class: "btn-primary", type: "button", text: `Học ${m} phút`, onclick: (() => void startStudy(m)) as EventListener }),
  ),
);
// Ending early needs the 60-second confirmation, which does not fit a popup that closes on blur.
byId("study-stop").addEventListener("click", () => void chrome.tabs.create({ url: chrome.runtime.getURL("options.html#study") }));
byId("open-options").addEventListener("click", () => void chrome.runtime.openOptionsPage());
void main();
