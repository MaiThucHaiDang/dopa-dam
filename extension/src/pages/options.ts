// Options page: domain tags, allowed links, friction settings, protection and log.
import { TAGS, TAG_LABELS, describeAllowEntry, type AllowEntry, type Tag } from "../core";
import { ERROR_TEXT, sendRequest, type OptionsView, type Request, type SimpleResponse } from "../shared/messages";
import { confirmWeakening } from "./confirm";
import { byId, el, show } from "./dom";

let view: OptionsView | null = null;

function showError(text: string | null): void {
  const box = byId("error");
  box.textContent = text ?? "";
  show(box, Boolean(text));
}

async function refresh(): Promise<void> {
  view = await sendRequest<OptionsView>({ type: "options:get" });
  render(view);
}

/** Sends a change; when it weakens protection, runs the confirmation and sends it again. */
async function submit(build: (confirmed: boolean) => Request, action: string): Promise<boolean> {
  showError(null);
  let res = await sendRequest<SimpleResponse>(build(false));
  if (!res.ok && res.error === "needs-confirm") {
    if (!(await confirmWeakening(action))) {
      await refresh();
      return false;
    }
    res = await sendRequest<SimpleResponse>(build(true));
  }
  if (!res.ok) showError(ERROR_TEXT[res.error]);
  await refresh();
  return res.ok;
}

function tagSelect(selected: Tag, disabled: boolean, label: string): HTMLSelectElement {
  return el(
    "select",
    { disabled, "aria-label": label },
    TAGS.map((t) => el("option", { value: t, text: TAG_LABELS[t], selected: t === selected })),
  );
}

function setDomain(pattern: string, tag: Tag | null): Promise<boolean> {
  const action = tag
    ? `Đổi ${pattern} sang tag ${TAG_LABELS[tag]}.`
    : `Gỡ ${pattern} khỏi danh sách: trang này sẽ không bị chặn nữa.`;
  return submit((confirmed) => ({ type: "options:setDomainRule", pattern, tag, confirmed }), action);
}

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function render(v: OptionsView): void {
  const locked = v.study.active;
  byId("status-line").textContent = v.protectionEnabled ? "Bảo vệ đang bật" : "Bảo vệ đang TẮT";

  const lock = byId("study-lock");
  if (locked && v.study.endsAt !== null) {
    lock.textContent = `Đang trong phiên học "${v.study.label}" đến ${timeOf(v.study.endsAt)}: tag và mức cản trở bị khóa. Vẫn thêm được link học.`;
  }
  show(lock, locked);

  const agentLine = byId("agent-line");
  if (v.agent.incompatible) {
    agentLine.textContent = `Agent DopaDam (bản ${v.agent.agentVersion ?? "?"}) không cùng phiên bản với extension. Hãy build lại cả hai.`;
  } else if (v.agent.connected) {
    agentLine.textContent = "Đã nối với agent DopaDam trên máy: cấu hình và bộ đếm dùng chung với agent.";
  }
  show(agentLine, v.agent.connected || v.agent.incompatible);

  const existing = new Set(v.domainRules.map((r) => r.pattern));
  byId("suggestions").replaceChildren(
    ...v.suggestions
      .filter((s) => !existing.has(s))
      .map((s) =>
        el("button", {
          class: "btn-secondary",
          type: "button",
          disabled: locked,
          text: `+ ${s}`,
          onclick: (() => void setDomain(s, "entertainment")) as EventListener,
        }),
      ),
  );

  byId("domain-list").replaceChildren(
    ...v.domainRules.map((rule) => {
      const select = tagSelect(rule.tag, locked, `Tag của ${rule.pattern}`);
      select.addEventListener("change", () => void setDomain(rule.pattern, select.value as Tag));
      return el("tr", {}, [
        el("td", { text: rule.pattern }),
        el("td", {}, [select]),
        el("td", {}, [
          el("button", {
            class: "btn-quiet small-btn",
            disabled: locked,
            text: "Gỡ",
            onclick: (() => void setDomain(rule.pattern, null)) as EventListener,
          }),
        ]),
      ]);
    }),
  );

  byId("allow-list").replaceChildren(
    ...(v.allowUrls.length
      ? v.allowUrls.map((entry: AllowEntry) =>
          el("li", {}, [
            el("span", { text: describeAllowEntry(entry) }),
            el("button", {
              class: "btn-quiet small-btn",
              text: "Gỡ",
              onclick: (() =>
                void submit(() => ({ type: "options:removeAllowUrl", entry }), "Gỡ link được phép.")) as EventListener,
            }),
          ]),
        )
      : [el("li", { class: "faint", text: "Chưa có link nào." })]),
  );

  const lockInputs = document.querySelectorAll<HTMLInputElement>("#friction input[data-level]");
  lockInputs.forEach((input) => {
    input.value = String(v.settings.lockSeconds[Number(input.dataset.level)]);
    input.disabled = locked;
  });
  const budget = byId<HTMLInputElement>("budget-input");
  budget.value = String(v.settings.budgetMinutes);
  budget.disabled = locked;
  (byId("friction").querySelector("button") as HTMLButtonElement).disabled = locked;

  const toggle = byId<HTMLButtonElement>("toggle-protection");
  toggle.textContent = v.protectionEnabled ? "Tắt bảo vệ" : "Bật lại bảo vệ";
  toggle.disabled = locked && v.protectionEnabled;
}

// ---- Static controls -------------------------------------------------------

byId("domain-tag").replaceChildren(
  ...TAGS.map((t) => el("option", { value: t, text: TAG_LABELS[t], selected: t === "entertainment" })),
);

byId("add-domain").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = byId<HTMLInputElement>("domain-input");
  const tag = byId<HTMLSelectElement>("domain-tag").value as Tag;
  if (await setDomain(input.value, tag)) input.value = "";
});

byId("add-allow").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = byId<HTMLInputElement>("allow-input");
  const text = input.value;
  const ok = await submit(
    (confirmed) => ({ type: "options:addAllowUrl", text, confirmed }),
    "Thêm link được phép: mở link này sẽ không hiện cảnh báo.",
  );
  if (ok) input.value = "";
});

byId("friction").addEventListener("submit", (e) => {
  e.preventDefault();
  const lockSeconds = Array.from(document.querySelectorAll<HTMLInputElement>("#friction input[data-level]"))
    .sort((a, b) => Number(a.dataset.level) - Number(b.dataset.level))
    .map((input) => Number(input.value));
  const budgetMinutes = Number(byId<HTMLInputElement>("budget-input").value);
  void submit(
    (confirmed) => ({ type: "options:setFriction", lockSeconds, budgetMinutes, confirmed }),
    "Giảm thời gian khóa nút Vào hoặc nới ngân sách giải trí.",
  );
});

byId("toggle-protection").addEventListener("click", () => {
  const enabled = !(view?.protectionEnabled ?? true);
  void submit(
    (confirmed) => ({ type: "options:setProtection", enabled, confirmed }),
    "Tắt bảo vệ: mọi trang sẽ mở thẳng, không có cảnh báo.",
  );
});

byId("clear-log").addEventListener("click", () => {
  void submit((confirmed) => ({ type: "options:clearLog", confirmed }), "Xóa toàn bộ nhật ký chặn và thời gian dùng.");
});

void refresh();
