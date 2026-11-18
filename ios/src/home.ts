// The home screen: today at a glance, the apps seen, study mode, weekly progress, risk hours, settings and the
// install note. Changes go through the extension's logic (weaken -> 60-second confirmation, locked while studying).
import {
  MANUAL_STUDY_MINUTES,
  MAX_RISK_WINDOWS,
  dayKey,
  formatStudyDays,
  localTzOffset,
  riskHeatmap,
  suggestRiskWindow,
  type RiskWindow,
  type StudyRule,
} from "../../extension/src/core";
import {
  RETENTION_DAYS,
  budgetView,
  deleteStudyRule,
  clearLog,
  setRiskWindows,
  setStudyRule,
  startStudy,
  stopStudy,
  studyStatus,
  weeklyProgress,
  type Result,
} from "../../extension/src/background/logic";
import type { State } from "../../extension/src/background/state";
import { confirmWeakening } from "../../extension/src/pages/confirm";
import { el } from "../../extension/src/pages/dom";
import { ERROR_TEXT } from "../../extension/src/shared/messages";
import {
  RISK_NONE,
  RISK_ROW_LABELS,
  RISK_SUBTITLE,
  describeHeatCell,
  describeRemoval,
  describeRiskWindow,
  describeSuggestion,
  heatShade,
} from "../../extension/src/shared/riskText";
import { applySettings, currentSettings, parseOptions } from "./settings";
import type { Store } from "./storage";

export const GUIDE_FILE = "HUONG-DAN.md";

const WEEKDAYS: [number, string][] = [
  [1, "T2"],
  [2, "T3"],
  [3, "T4"],
  [4, "T5"],
  [5, "T6"],
  [6, "T7"],
  [7, "CN"],
];

const SOURCE_TEXT: Record<string, string> = { manual: "bật tay", rule: "theo khung giờ", taskflow: "theo TaskFlow" };

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

const pct = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`);

/** The folder this page is served from, with a trailing slash: the address to paste into the gate shortcut. */
export function baseUrl(href: string): string {
  return new URL("./", href).href;
}

export function mountHome(root: HTMLElement, store: Store): () => void {
  let error: string | null = null;
  let modalOpen = false;

  const clock = () => {
    const now = Date.now();
    return { now, tz: localTzOffset(now) };
  };

  /** Runs a change; when it weakens protection, runs the 60-second confirmation and runs it again. */
  async function submit(change: (d: State, now: number, tz: number, confirmed: boolean) => Result, action: string): Promise<boolean> {
    error = null;
    const run = (confirmed: boolean) => {
      const { now, tz } = clock();
      return store.update((d) => change(d, now, tz, confirmed));
    };
    let res = run(false);
    if (!res.ok && res.error === "needs-confirm") {
      modalOpen = true;
      const ok = await confirmWeakening(action);
      modalOpen = false;
      if (!ok) {
        render();
        return false;
      }
      res = run(true);
    }
    if (!res.ok) error = ERROR_TEXT[res.error];
    render();
    return res.ok;
  }

  function render(): void {
    const { now, tz } = clock();
    const state = store.read();
    const study = studyStatus(state, now, tz);
    const locked = study.active;
    const studying = study.active && study.endsAt !== null;
    const today = dayKey(now, tz);
    const todayEvents = state.events.filter((e) => dayKey(e.shownAt, tz) === today);
    const exits = todayEvents.filter((e) => e.decision === "exit").length;
    const budget = budgetView(state, now, tz);

    const nodes: (Node | null)[] = [
      el("header", { class: "page-header" }, [
        el("img", { src: "icons/icon-192.png", alt: "", width: 40, height: 40 }),
        el("div", {}, [
          el("h1", { text: "DopaDam" }),
          el("p", { class: "muted", text: "Một nhịp dừng trước khi mở ứng dụng giải trí" }),
        ]),
      ]),
      !store.persistent
        ? el("p", {
            class: "notice",
            role: "alert",
            text: "Trình duyệt không cho trang này lưu dữ liệu, nên số liệu chỉ giữ trong lần mở này.",
          })
        : null,
      studying
        ? el("p", {
            class: "notice",
            text: `Đang trong phiên học "${study.label}" đến ${timeOf(study.endsAt!)}: các cài đặt làm yếu bảo vệ bị khóa.`,
          })
        : null,
      error ? el("p", { class: "notice", role: "alert", id: "error", text: error }) : null,

      el("section", { class: "card", id: "today" }, [
        el("h2", { text: "Hôm nay" }),
        el("div", { class: "stats" }, [
          stat(String(todayEvents.length), "lần cảnh báo"),
          stat(todayEvents.length ? `${Math.round((exits / todayEvents.length) * 100)}%` : "–", `chọn Thoát (${exits}/${todayEvents.length})`),
          stat(
            budget.budgetMinutes > 0 ? `${Math.round(budget.usedMinutes)} / ${budget.budgetMinutes}` : String(Math.round(budget.usedMinutes)),
            "phút đã cho vào",
          ),
        ]),
        el("p", { class: "faint", text: "Tính theo số phút đã cho vào: iPhone không đo được thời gian dùng thật." }),
      ]),

      appsCard(state, now),
      studyCard(state, studying ? study : null),
      progressCard(state, now, tz),
      riskCard(state, now, tz, locked),
      settingsCard(state, locked),
      el("section", { class: "card" }, [
        el("h2", { text: "Nhật ký" }),
        el("p", { class: "muted", text: "Xóa danh sách các lần cảnh báo và số phút đã cho vào. Bị khóa khi đang học." }),
        el("div", { class: "row" }, [
          el("button", {
            id: "clear-log",
            class: "btn-quiet",
            disabled: locked,
            text: "Xóa nhật ký",
            onclick: (() => void submit((d, n, z, c) => clearLog(d, c, n, z), "Xóa toàn bộ nhật ký cảnh báo và số phút đã cho vào.")) as EventListener,
          }),
        ]),
      ]),
      installCard(),
    ];
    root.replaceChildren(el("main", { class: "page" }, nodes));
  }

  function stat(value: string, label: string): HTMLElement {
    return el("div", { class: "stat" }, [el("strong", { text: value }), el("span", { text: label })]);
  }

  function appsCard(state: State, now: number): HTMLElement {
    const counts = new Map<string, { total: number; today: number }>();
    const today = dayKey(now, localTzOffset(now));
    for (const e of state.events) {
      const c = counts.get(e.object) ?? { total: 0, today: 0 };
      c.total++;
      if (dayKey(e.shownAt, localTzOffset(now)) === today) c.today++;
      counts.set(e.object, c);
    }
    const rows = [...counts.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
    return el("section", { class: "card", id: "apps" }, [
      el("h2", { text: "Ứng dụng đã hỏi" }),
      el("p", { class: "muted", text: `Số lần cảnh báo trong ${RETENTION_DAYS} ngày qua. Ứng dụng nào được canh do lối tắt trên iPhone quyết định.` }),
      el(
        "ul",
        { class: "plain-list" },
        rows.length
          ? rows.map(([name, c]) => {
              const win = state.allowWindows.find((w) => w.object === name && w.expiresAt > now);
              return el("li", {}, [
                el("span", {}, [
                  el("strong", { text: name }),
                  win ? el("span", { class: "faint", text: ` · đã cho vào đến ${timeOf(win.expiresAt)}` }) : null,
                ]),
                el("span", { class: "faint", text: `${c.total} lần (hôm nay ${c.today})` }),
              ]);
            })
          : [el("li", { class: "faint", text: "Chưa có ứng dụng nào. Mở một ứng dụng đã cài lối tắt để thấy nó ở đây." })],
      ),
    ]);
  }

  function studyCard(state: State, studying: { label: string | null; source: string | null; endsAt: number | null } | null): HTMLElement {
    const label = el("input", {
      id: "study-label",
      type: "text",
      maxlength: "60",
      placeholder: "Học gì? vd: Ôn Hệ điều hành",
      "aria-label": "Nhãn phiên học",
    });
    const days = WEEKDAYS.map(([d, name]) => el("label", {}, [el("input", { type: "checkbox", value: String(d), checked: d <= 5 }), name]));
    const start = el("input", { id: "rule-start", type: "time", value: "19:30", required: true });
    const end = el("input", { id: "rule-end", type: "time", value: "22:00", required: true });
    const ruleLabel = el("input", { id: "rule-label", type: "text", maxlength: "60" });
    const rules = state.study.rules;
    return el("section", { class: "card", id: "study" }, [
      el("h2", { text: "Chế độ Học" }),
      el("p", { class: "muted", text: "Trong giờ học, nút Vào khóa lâu hơn, chỉ cho vào ít phút, và các cài đặt làm yếu bảo vệ bị khóa." }),
      el("p", {
        id: "study-status",
        text: studying
          ? `Đang học: ${studying.label} (${SOURCE_TEXT[studying.source ?? ""] ?? "đang bật"}), đến ${timeOf(studying.endsAt!)}.`
          : "Hiện không trong giờ học.",
      }),
      studying
        ? el("div", { class: "row" }, [
            el("button", {
              id: "study-stop",
              class: "btn-quiet",
              text: "Kết thúc sớm",
              onclick: (() =>
                void submit(
                  (d, n, z, c) => stopStudy(d, c, n, z),
                  "Kết thúc giờ học ngay bây giờ: cảnh báo trở về mức bình thường và cài đặt được mở khóa.",
                )) as EventListener,
            }),
          ])
        : el("div", { class: "grid-form" }, [
            label,
            el(
              "div",
              { class: "row", id: "study-buttons" },
              MANUAL_STUDY_MINUTES.map((m) =>
                el("button", {
                  class: "btn-primary",
                  type: "button",
                  text: `Học ${m} phút`,
                  onclick: (() => {
                    const text = label.value.trim() || null;
                    void submit((d, n) => startStudy(d, m, text, n), `Bật phiên học ${m} phút.`);
                  }) as EventListener,
                }),
              ),
            ),
          ]),
      el("h3", { text: "Khung giờ cố định" }),
      el(
        "ul",
        { class: "plain-list", id: "study-rules" },
        rules.length
          ? rules.map((rule: StudyRule) =>
              el("li", {}, [
                el("span", {}, [el("strong", { text: `${formatStudyDays(rule.days)} · ${rule.start}–${rule.end}` }), rule.label ? ` · ${rule.label}` : ""]),
                el("button", {
                  class: "btn-quiet small-btn",
                  type: "button",
                  text: "Xóa",
                  onclick: (() =>
                    void submit(
                      (d, n, z, c) => deleteStudyRule(d, rule.id, c, n, z),
                      `Xóa khung giờ học ${formatStudyDays(rule.days)} ${rule.start}–${rule.end}.`,
                    )) as EventListener,
                }),
              ]),
            )
          : [el("li", { class: "faint", text: "Chưa có khung giờ nào." })],
      ),
      el(
        "form",
        {
          id: "add-rule",
          class: "grid-form",
          onsubmit: ((e: Event) => {
            e.preventDefault();
            const chosen = days.map((l) => l.querySelector("input")!).filter((i) => i.checked).map((i) => Number(i.value));
            if (!chosen.length || !start.value || !end.value || start.value === end.value) {
              error = "Chọn ít nhất một ngày, và giờ kết thúc khác giờ bắt đầu.";
              render();
              return;
            }
            const rule: StudyRule = { id: "", days: chosen, start: start.value, end: end.value, label: ruleLabel.value.trim() || null, exceptions: [] };
            void submit((d, n, z, c) => setStudyRule(d, rule, c, n, z), "Thêm khung giờ học.");
          }) as EventListener,
        },
        [
          el("fieldset", { class: "weekdays" }, [el("legend", { text: "Ngày trong tuần" }), ...days]),
          el("div", { class: "two" }, [el("label", { class: "field" }, ["Từ", start]), el("label", { class: "field" }, ["Đến", end])]),
          el("label", { class: "field" }, ["Nhãn (không bắt buộc)", ruleLabel]),
          el("button", { class: "btn-primary", type: "submit", text: "Thêm khung giờ" }),
          el("p", { class: "faint", text: "Giờ kết thúc sớm hơn giờ bắt đầu nghĩa là khung kéo qua nửa đêm." }),
        ],
      ),
    ]);
  }

  function progressCard(state: State, now: number, tz: number): HTMLElement {
    const p = weeklyProgress(state.events, now, tz);
    const verdict = {
      better: "Tốt hơn tuần trước",
      worse: "Chưa tốt bằng tuần trước",
      same: "Gần như tuần trước",
      "not-enough-data": "Cần ít nhất 5 lần cảnh báo mỗi tuần để so sánh",
    }[p.leaveRate];
    const anyStudy = p.thisWeek.studyOpens + p.lastWeek.studyOpens > 0;
    return el("section", { class: "card", id: "progress" }, [
      el("h2", { text: "Tiến bộ tuần này" }),
      el("p", { text: `Tỉ lệ rời đi: ${pct(p.thisWeek.leaveRate)} (tuần trước ${pct(p.lastWeek.leaveRate)})` }),
      el("p", { class: "muted", text: verdict }),
      anyStudy
        ? el("p", { class: "muted", text: `Mở giải trí trong giờ học: ${p.thisWeek.studyOpens} lần (tuần trước ${p.lastWeek.studyOpens})` })
        : null,
    ]);
  }

  function riskCard(state: State, now: number, tz: number, locked: boolean): HTMLElement {
    const heatmap = riskHeatmap(state.events, now, tz, RETENTION_DAYS);
    const windows = state.riskWindows;
    const suggestion = suggestRiskWindow(heatmap, windows);
    const max = Math.max(0, ...heatmap.flat().map((c) => c.opens));
    const cells: Node[] = [el("span")];
    for (let h = 0; h < 24; h += 3) cells.push(el("span", { class: "heat-hour", text: String(h), "aria-hidden": "true" }));
    heatmap.forEach((row, r) => {
      cells.push(el("span", { class: "heat-row", text: RISK_ROW_LABELS[r], "aria-hidden": "true" }));
      row.forEach((cell, hour) => {
        const label = describeHeatCell(r, hour, cell);
        cells.push(el("div", { class: "heat-cell", role: "img", "data-shade": heatShade(cell.opens, max), title: label, "aria-label": label }));
      });
    });
    const full = windows.length >= MAX_RISK_WINDOWS;
    return el("section", { class: "card", id: "risk" }, [
      el("h2", { text: "Giờ nguy cơ" }),
      el("p", { class: "muted", text: RISK_SUBTITLE }),
      el("div", { class: "heatmap", id: "heatmap", role: "group", "aria-label": "Số lần cảnh báo theo thứ và giờ" }, cells),
      el("p", {
        id: "risk-suggestion-text",
        text: suggestion
          ? describeSuggestion(suggestion) + (full ? ` Đã đủ ${MAX_RISK_WINDOWS} khung, gỡ bớt một khung để thêm.` : "")
          : RISK_NONE,
      }),
      suggestion
        ? el("button", {
            id: "risk-add",
            class: "btn-secondary",
            type: "button",
            disabled: full,
            text: "Tăng cản trở trong khung này",
            onclick: (() => {
              const next: RiskWindow = { id: crypto.randomUUID(), days: suggestion.days, start: suggestion.start, end: suggestion.end };
              void submit((d, n, z, c) => setRiskWindows(d, [...windows, next], c, n, z), "Thêm khung giờ nguy cơ.");
            }) as EventListener,
          })
        : null,
      el("h3", { text: "Khung đang bật" }),
      el(
        "ul",
        { class: "plain-list", id: "risk-list" },
        windows.length
          ? windows.map((w) =>
              el("li", {}, [
                el("span", { text: describeRiskWindow(w) }),
                el("button", {
                  class: "btn-quiet small-btn",
                  type: "button",
                  disabled: locked,
                  text: "Gỡ",
                  onclick: (() =>
                    void submit(
                      (d, n, z, c) =>
                        setRiskWindows(
                          d,
                          windows.filter((x) => x.id !== w.id),
                          c,
                          n,
                          z,
                        ),
                      describeRemoval(w),
                    )) as EventListener,
                }),
              ]),
            )
          : [el("li", { class: "faint", text: "Chưa có khung nào." })],
      ),
    ]);
  }

  function settingsCard(state: State, locked: boolean): HTMLElement {
    const s = currentSettings(state);
    const locks = s.lockSeconds.map((v, i) =>
      el("input", { type: "number", inputmode: "numeric", min: "0", max: "300", value: String(v), "data-level": String(i), disabled: locked }),
    );
    const budget = el("input", { id: "budget-input", type: "number", inputmode: "numeric", min: "0", max: "1440", value: String(s.budgetMinutes), disabled: locked });
    const normal = el("input", { id: "options-normal", type: "text", inputmode: "numeric", value: s.allowOptionsNormal.join(", "), disabled: locked });
    const restricted = el("input", { id: "options-restricted", type: "text", inputmode: "numeric", value: s.allowOptionsRestricted.join(", "), disabled: locked });
    const names = ["Cấp 0 · lần đầu trong giờ", "Cấp 1 · lần 2–3", "Cấp 2 · từ lần 4", "Cấp 3 · đang học hoặc vượt ngân sách"];
    return el("section", { class: "card", id: "friction" }, [
      el("h2", { text: "Mức cản trở" }),
      el("p", { class: "muted", text: "Số giây khóa nút Vào ở mỗi cấp, ngân sách mỗi ngày và các lựa chọn số phút. Tăng thì áp dụng ngay, giảm thì cần xác nhận." }),
      el(
        "form",
        {
          class: "grid-form",
          onsubmit: ((e: Event) => {
            e.preventDefault();
            const normalOptions = parseOptions(normal.value);
            const restrictedOptions = parseOptions(restricted.value);
            if (!normalOptions || !restrictedOptions) {
              error = "Các lựa chọn số phút là những số nguyên, cách nhau bằng dấu phẩy.";
              render();
              return;
            }
            const input = {
              lockSeconds: locks.map((i) => Number(i.value)),
              budgetMinutes: Number(budget.value),
              allowOptionsNormal: normalOptions,
              allowOptionsRestricted: restrictedOptions,
            };
            void submit((d, n, z, c) => applySettings(d, input, c, n, z), "Giảm thời gian khóa nút Vào, nới ngân sách giải trí hoặc cho vào lâu hơn.");
          }) as EventListener,
        },
        [
          ...locks.map((input, i) => el("label", { class: "field" }, [names[i], input])),
          el("label", { class: "field" }, ["Ngân sách mỗi ngày (phút, 0 = tắt)", budget]),
          el("label", { class: "field" }, ["Số phút được chọn khi Vào (cấp 0 đến 2), vd: 5, 15, 30", normal]),
          el("label", { class: "field" }, ["Số phút được chọn khi Vào (cấp 3), vd: 5, 10", restricted]),
          el("button", { class: "btn-primary", type: "submit", disabled: locked, text: "Lưu" }),
        ],
      ),
    ]);
  }

  function installCard(): HTMLElement {
    const url = baseUrl(location.href);
    return el("section", { class: "card", id: "install" }, [
      el("h2", { text: "Cài trên iPhone" }),
      el("p", { class: "muted" }, ["Dán địa chỉ này vào bước \"Mở URL\" của lối tắt DopaDam Cổng, rồi nối thêm ", el("code", { text: "#/warn?app=" }), " và tên ứng dụng:"]),
      el("p", {}, [el("code", { id: "base-url", text: url })]),
      el("button", {
        class: "btn-secondary",
        id: "copy-url",
        text: "Sao chép địa chỉ",
        onclick: (async (e: MouseEvent) => {
          const button = e.currentTarget as HTMLButtonElement;
          try {
            await navigator.clipboard.writeText(url);
            button.textContent = "Đã sao chép";
          } catch {
            button.textContent = "Không sao chép được, hãy chọn và chép tay";
          }
        }) as unknown as EventListener,
      }),
      el("p", { class: "muted" }, ["Các bước tạo ba lối tắt và tự động hóa nằm trong tệp ", el("strong", { text: GUIDE_FILE }), "."]),
      el("p", { class: "faint", text: "Dữ liệu chỉ nằm trong Safari trên máy này. Safari có thể dọn dữ liệu của trang web lâu ngày không được mở." }),
    ]);
  }

  // Keep the page current (study countdown, windows) without disturbing someone who is typing or confirming.
  const refresh = () => {
    const active = document.activeElement;
    const typing = active instanceof HTMLInputElement || active instanceof HTMLSelectElement;
    if (!modalOpen && !typing && document.visibilityState === "visible") render();
  };
  const timer = setInterval(refresh, 30_000);
  const onVisible = () => {
    if (document.visibilityState === "visible" && !modalOpen) render();
  };
  document.addEventListener("visibilitychange", onVisible);

  render();
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
