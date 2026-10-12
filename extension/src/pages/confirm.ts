// The FR14 confirmation for changes that weaken protection: wait 60 seconds, then type a sentence.
import { CONFIRM_PHRASE, CONFIRM_WAIT_SECONDS, isConfirmPhrase } from "../core";
import { el } from "./dom";

export function confirmWeakening(action: string, waitSeconds = CONFIRM_WAIT_SECONDS): Promise<boolean> {
  return new Promise((resolve) => {
    let remaining = waitSeconds;
    const countdown = el("p", { class: "muted", "aria-live": "polite" });
    const input = el("input", {
      type: "text",
      disabled: true,
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": "Câu xác nhận",
      placeholder: CONFIRM_PHRASE,
    });
    const ok = el("button", { class: "btn-secondary", disabled: true, text: "Xác nhận" });
    const cancel = el("button", { class: "btn-primary", text: "Giữ nguyên bảo vệ" });
    const dialog = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "confirm-title" }, [
      el("h2", { id: "confirm-title", text: "Thay đổi này làm yếu bảo vệ" }),
      el("p", { text: action }),
      countdown,
      el("p", { class: "faint" }, ["Gõ chính xác: ", el("strong", { text: CONFIRM_PHRASE })]),
      input,
      el("div", { class: "modal-actions" }, [ok, cancel]),
    ]);
    const backdrop = el("div", { class: "modal-backdrop" }, [dialog]);
    document.body.append(backdrop);
    cancel.focus();

    const renderCountdown = () => {
      countdown.textContent =
        remaining > 0 ? `Chờ ${remaining} giây rồi mới gõ được câu xác nhận.` : "Bây giờ có thể gõ câu xác nhận.";
      input.disabled = remaining > 0;
    };
    renderCountdown();
    const timer = setInterval(() => {
      remaining--;
      renderCountdown();
      if (remaining <= 0) {
        clearInterval(timer);
        input.focus();
      }
    }, 1000);

    const close = (result: boolean) => {
      clearInterval(timer);
      backdrop.remove();
      resolve(result);
    };
    input.addEventListener("input", () => {
      ok.disabled = !isConfirmPhrase(input.value);
    });
    ok.addEventListener("click", () => {
      if (remaining <= 0 && isConfirmPhrase(input.value)) close(true);
    });
    cancel.addEventListener("click", () => close(false));
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(false);
    });
  });
}
