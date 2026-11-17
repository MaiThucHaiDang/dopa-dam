// The warning screen: "Bạn mở … để làm gì?" with Thoát, Làm việc khác and a locked Vào. Same wording and rules as the
// extension's warning page; the result screens hand control back to the Shortcuts app through shortcuts:// links.
import { resumeVisibleMs } from "../../extension/src/core/countdown";
import { ACTIVITIES, type WarningEvent } from "../../extension/src/background/state";
import type { Result } from "../../extension/src/background/logic";
import { ERROR_TEXT } from "../../extension/src/shared/messages";
import { RISK_LINE } from "../../extension/src/shared/riskText";
import { el, formatClock, formatMinutes, minutesUntil } from "../../extension/src/pages/dom";
import { localTzOffset } from "../../extension/src/core";
import { enterLink, exitLink } from "./shortcuts";
import {
  alternativeEnd,
  decideAlternative,
  decideEnter,
  decideExit,
  enterWindowEnd,
  markAway,
  openWarning,
  warningView,
} from "./session";
import type { Store } from "./storage";

const ACTIVITY_MINUTES = Array.from({ length: 9 }, (_, i) => i + 2);

/** The event id lives in this history entry, so reloading the same warning does not count twice. */
function savedEventId(): string | null {
  const state = history.state as { eventId?: unknown } | null;
  return typeof state?.eventId === "string" ? state.eventId : null;
}

/** True only for a real tap or click: a keyboard activation has detail === 0. */
export function isPointerClick(event: MouseEvent): boolean {
  return event.isTrusted && event.detail > 0;
}

export function mountWarning(root: HTMLElement, app: string, store: Store): () => void {
  const cleanups: (() => void)[] = [];
  let eventId = "";
  let busy = false;
  let disposed = false;
  let stopView: (() => void) | null = null;

  const clock = () => {
    const now = Date.now();
    return { now, tz: localTzOffset(now) };
  };

  function on(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn);
    cleanups.push(() => target.removeEventListener(type, fn));
  }

  /** (Re)opens the warning for this page: the same one when it is back in time, a new one when it was abandoned. */
  function open(): void {
    const { now, tz } = clock();
    const result = store.update((d) =>
      openWarning(d, { app, id: eventId || savedEventId(), newId: () => crypto.randomUUID(), now, tz }),
    );
    const changed = result.event.id !== eventId;
    eventId = result.event.id;
    if (savedEventId() !== eventId) history.replaceState({ eventId }, "");
    if (changed) renderFor(result.event);
  }

  function away(): void {
    if (!eventId) return;
    store.update((d) => markAway(d, eventId, Date.now()));
  }

  // The warning is abandoned when the page goes away; coming back soon (or reloading) continues it.
  on(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") away();
    else open();
  });
  on(window, "pagehide", away);
  on(window, "pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted) open();
  });

  // ---- Rendering ---------------------------------------------------------

  function setScreen(children: (Node | null | false)[], footer?: Node): void {
    stopView?.();
    stopView = null;
    root.replaceChildren(el("main", { class: "screen" }, [...children, footer]));
  }

  function failure(error: keyof typeof ERROR_TEXT): void {
    setScreen([
      el("section", {}, [
        el("h1", { class: "question", text: "Chưa làm được" }),
        el("p", { class: "muted", text: ERROR_TEXT[error] }),
        el("button", { class: "btn-secondary", text: "Tải lại trang", onclick: (() => location.reload()) as EventListener }),
      ]),
    ]);
  }

  function renderFor(event: WarningEvent): void {
    if (event.decision === "exit") return renderExit();
    if (event.decision === "enter") return renderEnter(event);
    if (event.decision === "alternative") return renderTimer(event);
    renderChoice(event);
  }

  function renderChoice(event: WarningEvent): void {
    const { now, tz } = clock();
    const view = warningView(store.read(), event, now, tz);

    const enterButton = el("button", { class: "btn-quiet enter", tabindex: "-1", disabled: true, text: "Vào" });
    const allowOptions = el("div", { class: "hidden" }, [
      el("p", { class: "faint", text: "Vào trong bao lâu?" }),
      el(
        "div",
        { class: "allow-buttons" },
        view.allowOptions.map((minutes) =>
          el("button", {
            class: "btn-quiet",
            tabindex: "-1",
            text: formatMinutes(minutes),
            onclick: ((e: MouseEvent) => {
              if (unlocked && isPointerClick(e)) decide(() => store.update((d) => decideEnter(d, eventId, minutes, Date.now(), clock().tz)), "enter");
            }) as EventListener,
          }),
        ),
      ),
    ]);
    let unlocked = false;

    const exitButton = el("button", {
      class: "btn-primary exit",
      text: "Thoát",
      onclick: (() => decide(() => store.update((d) => decideExit(d, eventId, Date.now())), "exit")) as EventListener,
    });
    const risk = view.risk ? el("p", { class: "muted", text: RISK_LINE }) : null;
    const budget = view.budget;
    const study = view.study.active && view.study.endsAt !== null ? view.study : null;

    setScreen(
      [
        el("p", { class: "meta", text: `Lần thứ ${view.countThisHour} trong 60 phút qua · nút Vào khóa ${view.lockSeconds} giây` }),
        el("section", {}, [
          el("h1", { class: "question" }, ["Bạn mở ", el("span", { class: "app-name", text: app }), " để làm gì?"]),
          el("p", { class: "muted subtitle", text: "Dành vài giây trả lời câu hỏi này trong đầu." }),
          risk,
          el("div", { class: "primary-actions" }, [
            exitButton,
            el("button", { class: "btn-link", text: "Làm việc khác thay vì vào", onclick: (() => renderAlternative(event)) as EventListener }),
          ]),
          el("div", { class: "enter-area" }, [enterButton, allowOptions]),
        ]),
      ],
      el("footer", { class: "footer" }, [
        el("span", {
          text:
            budget.budgetMinutes > 0
              ? `Hôm nay: ${Math.round(budget.usedMinutes)} / ${budget.budgetMinutes} phút giải trí`
              : `Hôm nay: ${Math.round(budget.usedMinutes)} phút giải trí`,
        }),
        el("span", { class: "faint", text: "Tính theo số phút đã cho vào" }),
        study ? el("span", { class: "chip", text: `Đang học: ${study.label} · còn ${minutesUntil(study.endsAt!)} phút` }) : null,
      ]),
    );

    enterButton.addEventListener("click", (e) => {
      if (!unlocked || !isPointerClick(e)) return;
      allowOptions.classList.remove("hidden");
    });
    // Thoát is one keypress away; Vào never answers the keyboard.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        exitButton.click();
      }
    };
    document.addEventListener("keydown", onKey, { capture: true });

    // The countdown only runs while the page is visible, and survives a reload.
    const key = `dopadam-ios:visible:${event.id}`;
    let stored: number | null = null;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw !== null && raw !== "") stored = Number(raw);
    } catch {
      // sessionStorage unavailable: the wall clock decides.
    }
    let visibleMs = resumeVisibleMs(view.elapsedMs, stored);
    const persist = () => {
      try {
        sessionStorage.setItem(key, String(Math.round(visibleMs)));
      } catch {
        // Not persisted; a reload then continues from the wall clock.
      }
    };
    persist();
    let remaining = Math.max(0, view.lockSeconds * 1000 - visibleMs);
    let last = performance.now();
    const render = () => {
      const seconds = Math.ceil(remaining / 1000);
      enterButton.textContent = seconds > 0 ? `Vào (${seconds})` : "Vào";
      enterButton.disabled = seconds > 0;
      unlocked = seconds <= 0;
    };
    render();
    const timer = setInterval(() => {
      const t = performance.now();
      if (document.visibilityState === "visible") {
        remaining -= t - last;
        visibleMs += t - last;
        persist();
      }
      last = t;
      render();
      if (unlocked) clearInterval(timer);
    }, 200);
    stopView = () => {
      clearInterval(timer);
      document.removeEventListener("keydown", onKey, { capture: true });
    };
  }

  function renderAlternative(event: WarningEvent): void {
    let chosen: string | null = null;
    const buttons = ACTIVITIES.map((name) =>
      el("button", {
        class: "btn-secondary",
        role: "radio",
        "aria-checked": "false",
        text: name,
        onclick: (() => {
          chosen = name;
          for (const b of buttons) b.setAttribute("aria-checked", String(b.textContent === name));
        }) as EventListener,
      }),
    );
    const select = el(
      "select",
      { id: "activity-minutes" },
      ACTIVITY_MINUTES.map((m) => el("option", { value: m, text: String(m), selected: m === 5 })),
    );
    setScreen([
      el("section", {}, [
        el("h1", { class: "question", text: "Làm gì thay vào đó?" }),
        el("div", { class: "activities", role: "radiogroup", "aria-label": "Hoạt động" }, buttons),
        el("label", { class: "field" }, ["Trong bao nhiêu phút", select]),
        el("div", { class: "primary-actions" }, [
          el("button", {
            class: "btn-primary",
            id: "start-activity",
            text: "Bắt đầu",
            onclick: (() => {
              if (!chosen) {
                buttons[0]?.focus();
                return;
              }
              const activity = chosen;
              decide(() => store.update((d) => decideAlternative(d, eventId, activity, Number(select.value), Date.now())), "alternative");
            }) as EventListener,
          }),
          el("button", { class: "btn-secondary", text: "Quay lại", onclick: (() => renderChoice(event)) as EventListener }),
        ]),
      ]),
    ]);
  }

  function renderTimer(event: WarningEvent): void {
    const endsAt = alternativeEnd(event);
    if (endsAt === null) return renderExit();
    if (endsAt <= Date.now()) return renderExit(true);
    const clockText = el("p", { class: "clock", text: formatClock(endsAt - Date.now()) });
    setScreen([
      el("section", {}, [
        el("h1", { class: "question", text: event.activity ?? "Đang nghỉ" }),
        clockText,
        el("p", { class: "muted", text: "Giữ trang này mở. Hết giờ sẽ có nút về màn hình chính." }),
      ]),
    ]);
    const timer = setInterval(() => {
      const left = endsAt - Date.now();
      if (left <= 0) {
        clearInterval(timer);
        renderExit(true);
      } else {
        clockText.textContent = formatClock(left);
      }
    }, 250);
    stopView = () => clearInterval(timer);
  }

  /** "Đã thoát." after Thoát or a finished "Làm việc khác": the way back to the Home Screen. */
  function renderExit(finishedActivity = false): void {
    setScreen([
      el("section", {}, [
        el("h1", { class: "question", id: "done-title", text: "Đã thoát." }),
        el("p", { class: "muted", text: finishedActivity ? "Xong rồi. Quay lại việc đang làm nhé." : "Làm tốt lắm." }),
        el("a", { class: "big-link", id: "home-link", href: exitLink(), text: "Về màn hình chính" }),
        el("p", { class: "faint", text: "Hoặc vuốt lên để về màn hình chính." }),
      ]),
    ]);
  }

  /** After Vào: the decision is recorded; one big link lets the "DopaDam Vào" shortcut store the allow window. */
  function renderEnter(event: WarningEvent): void {
    const minutes = event.allowMinutes ?? 0;
    const endsAt = enterWindowEnd(event);
    if (endsAt === null || endsAt <= Date.now()) {
      // The window the user chose has passed: opening it now would start a fresh, unasked-for one.
      setScreen([
        el("section", {}, [
          el("h1", { class: "question", text: "Đã hết thời gian cho vào." }),
          el("p", { class: "muted" }, [`Mở lại ${app}: lần mở kế tiếp sẽ hỏi lại.`]),
        ]),
      ]);
      return;
    }
    setScreen([
      el("section", {}, [
        el("h1", { class: "question", id: "done-title" }, ["Vào ", el("span", { class: "app-name", text: app }), ` ${formatMinutes(minutes)}.`]),
        el("a", { class: "big-link", id: "enter-link", href: enterLink(app, minutes), text: `Mở ${app} · ${formatMinutes(minutes)}` }),
        el("p", { class: "muted", text: `Nếu không có gì xảy ra: mở lại ${app}; lần mở kế tiếp sẽ hỏi lại.` }),
      ]),
    ]);
  }

  function decide(run: () => Result<{ event: WarningEvent }>, kind: "exit" | "enter" | "alternative"): void {
    if (busy || disposed) return;
    busy = true;
    try {
      const res = run();
      if (!res.ok) return failure(res.error);
      const event = res.event;
      if (kind === "exit") renderExit();
      else renderFor(event);
    } finally {
      busy = false;
    }
  }

  open();

  return () => {
    disposed = true;
    stopView?.();
    for (const c of cleanups) c();
    // A page that is replaced (navigation inside the app) is leaving too.
    away();
  };
}
