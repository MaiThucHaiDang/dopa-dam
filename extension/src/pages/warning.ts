// The warning shown instead of a blocked page. Thoát is always one keypress away;
// Vào unlocks after the countdown and only responds to a real mouse click or touch.
import { ERROR_TEXT, sendRequest, type DecideResponse, type WarningInit } from "../shared/messages";
import type { Decision } from "../background/state";
import { byId, el, formatClock, formatMinutes, minutesUntil, show } from "./dom";

type View = "loading" | "choice" | "alternative" | "timer" | "message";

const target = location.hash.slice(1);
const eventId = currentEventId();

const sections = {
  choice: byId("choice"),
  alternative: byId("alternative"),
  timer: byId("timer"),
  message: byId("message"),
};
const exitButton = byId<HTMLButtonElement>("exit");
const enterButton = byId<HTMLButtonElement>("enter");
const allowOptions = byId("allow-options");
const allowButtons = byId("allow-buttons");

let view: View = "loading";
let busy = false;
let unlocked = false;
let chosenActivity: string | null = null;

/** The event id lives in this history entry, so reloading the same warning does not count twice. */
function currentEventId(): string {
  const saved = (history.state as { eventId?: string } | null)?.eventId;
  if (saved) return saved;
  const id = crypto.randomUUID();
  history.replaceState({ eventId: id }, "");
  return id;
}

function setView(next: View): void {
  view = next;
  show(sections.choice, next === "choice");
  show(sections.alternative, next === "alternative");
  show(sections.timer, next === "timer");
  show(sections.message, next === "message");
  if (next === "choice") exitButton.focus();
}

function showMessage(title: string, body = ""): void {
  byId("message-title").textContent = title;
  byId("message-body").textContent = body;
  setView("message");
}

// Keeps the background informed that this warning is still open; a closed tab counts as Thoát.
function keepAlive(): void {
  let port = chrome.runtime.connect({ name: `warning:${eventId}` });
  const reconnect = () => {
    port = chrome.runtime.connect({ name: `warning:${eventId}` });
    port.onDisconnect.addListener(reconnect);
  };
  port.onDisconnect.addListener(reconnect);
  setInterval(() => {
    try {
      port.postMessage("ping");
    } catch {
      reconnect();
    }
  }, 20_000);
}

async function decide(decision: Decision, extra: Record<string, unknown> = {}): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const res = await sendRequest<DecideResponse>({ type: "warning:decide", eventId, decision, ...extra });
    if (!res.ok) {
      showMessage("Chưa làm được", ERROR_TEXT[res.error]);
      return;
    }
    if (res.action === "navigate") location.replace(res.url);
    else if (res.action === "timer") startTimer(res.endsAt, chosenActivity);
    else showMessage("Đã thoát", "Làm tốt lắm. Có thể đóng tab này.");
  } finally {
    busy = false;
  }
}

/** True only for a real pointer click: keyboard activation produces detail === 0. */
function isPointerClick(event: MouseEvent): boolean {
  return event.isTrusted && event.detail > 0;
}

function startCountdown(lockSeconds: number, elapsedMs: number): void {
  // The countdown only runs while this tab is visible.
  let remaining = Math.max(0, lockSeconds * 1000 - elapsedMs);
  let last = performance.now();
  const render = () => {
    const seconds = Math.ceil(remaining / 1000);
    enterButton.textContent = seconds > 0 ? `Vào (${seconds})` : "Vào";
    enterButton.disabled = seconds > 0;
    unlocked = seconds <= 0;
  };
  render();
  if (unlocked) return;
  const timer = setInterval(() => {
    const now = performance.now();
    if (document.visibilityState === "visible") remaining -= now - last;
    last = now;
    render();
    if (unlocked) clearInterval(timer);
  }, 200);
}

function renderAllowOptions(options: number[]): void {
  allowButtons.replaceChildren(
    ...options.map((minutes) =>
      el("button", {
        class: "btn-quiet",
        tabindex: "-1",
        text: formatMinutes(minutes),
        onclick: ((e: MouseEvent) => {
          if (unlocked && isPointerClick(e)) void decide("enter", { allowMinutes: minutes });
        }) as EventListener,
      }),
    ),
  );
}

function renderAlternative(activities: string[]): void {
  const container = byId("activities");
  const buttons = activities.map((name) =>
    el("button", {
      class: "btn-secondary",
      role: "radio",
      "aria-checked": "false",
      text: name,
      onclick: (() => {
        chosenActivity = name;
        for (const b of buttons) b.setAttribute("aria-checked", String(b.textContent === name));
      }) as EventListener,
    }),
  );
  container.replaceChildren(...buttons);
  const select = byId<HTMLSelectElement>("activity-minutes");
  select.replaceChildren(
    ...Array.from({ length: 9 }, (_, i) => i + 2).map((m) => el("option", { value: m, text: String(m), selected: m === 5 })),
  );
  byId("start-activity").addEventListener("click", () => {
    if (!chosenActivity) {
      buttons[0]?.focus();
      return;
    }
    void decide("alternative", { activity: chosenActivity, activityMinutes: Number(select.value) });
  });
  byId("back").addEventListener("click", () => setView("choice"));
}

function startTimer(endsAt: number, activity: string | null): void {
  byId("timer-title").textContent = activity ? activity : "Đang nghỉ";
  setView("timer");
  const clock = byId("clock");
  const tick = () => {
    const left = endsAt - Date.now();
    clock.textContent = formatClock(left);
    if (left <= 0) {
      clearInterval(timer);
      byId("timer-title").textContent = "Xong rồi!";
      byId("timer-note").textContent = "Quay lại việc đang làm nhé.";
      show(byId("close-tab"), true);
    }
  };
  const timer = setInterval(tick, 250);
  tick();
}

function renderFooter(init: Extract<WarningInit, { skip: false }>): void {
  const { usedMinutes, budgetMinutes } = init.budget;
  byId("budget").textContent =
    budgetMinutes > 0
      ? `Hôm nay: ${Math.round(usedMinutes)} / ${budgetMinutes} phút giải trí`
      : `Hôm nay: ${Math.round(usedMinutes)} phút giải trí`;
  const study = byId("study");
  if (init.study.active && init.study.endsAt !== null) {
    study.textContent = `Đang học: ${init.study.label} · còn ${minutesUntil(init.study.endsAt)} phút`;
    show(study, true);
  }
}

document.addEventListener(
  "keydown",
  (e) => {
    if (view === "choice" && (e.key === "Enter" || e.key === "Escape")) {
      e.preventDefault();
      e.stopPropagation();
      void decide("exit");
    } else if (view === "alternative" && e.key === "Escape") {
      e.preventDefault();
      setView("choice");
    }
  },
  { capture: true },
);

exitButton.addEventListener("click", () => void decide("exit"));
byId("show-alternative").addEventListener("click", () => setView("alternative"));
enterButton.addEventListener("click", (e) => {
  if (!unlocked || !isPointerClick(e)) return;
  show(allowOptions, true);
});
byId("close-tab").addEventListener("click", async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
});

async function main(): Promise<void> {
  // The page is web-accessible (redirect target), so refuse to work inside another site's frame.
  if (window.top !== window) {
    document.body.replaceChildren();
    return;
  }
  if (!/^https?:\/\//.test(target)) {
    showMessage("Không có trang đích", "Trang cảnh báo này được mở mà không kèm địa chỉ trang web.");
    return;
  }
  const init = await sendRequest<WarningInit>({ type: "warning:init", eventId, url: target });
  if (init.skip) {
    location.replace(target);
    return;
  }
  keepAlive();
  document.title = `DopaDam · ${init.host}`;
  byId("host").textContent = init.host;
  byId("meta").textContent = `Lần thứ ${init.countThisHour} trong 60 phút qua · nút Vào khóa ${init.lockSeconds} giây`;
  renderFooter(init);
  renderAllowOptions(init.allowOptions);
  renderAlternative(init.activities);
  if (init.decision === "alternative" && init.activityEndsAt !== null) {
    startTimer(init.activityEndsAt, init.activity);
  } else if (init.decision === "exit") {
    showMessage("Đã thoát", "Có thể đóng tab này.");
  } else {
    setView("choice");
    startCountdown(init.lockSeconds, init.elapsedMs);
  }
}

void main().catch((err) => {
  console.error(err);
  showMessage("Có lỗi", "Không liên lạc được với DopaDam. Thử tải lại trang.");
});
