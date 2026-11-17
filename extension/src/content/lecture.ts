// Content script on YouTube: lecture mode. It asks the background whether this page is open through an allowed
// link and sets classes on <html>; lecture.css hides the distractions only under those classes.
// YouTube is a single-page app, so the question is asked again whenever the URL changes. Any failure to get an
// answer (service worker gone, extension reloaded) means "not lecture mode": the page is left as YouTube made it.
import type { LectureAnswer } from "../shared/lecture";

const LECTURE_CLASS = "dopadam-lecture";
const NO_PLAYLIST_CLASS = "dopadam-lecture-no-playlist";
const NOTE_ID = "dopadam-lecture-note";
const NOTE_TEXT = "Chế độ bài giảng của DopaDam: đã ẩn gợi ý.";
const ANSWER_TIMEOUT_MS = 4000;
const URL_GUARD_MS = 1000;

const root = document.documentElement;
let lastUrl = "";
let generation = 0;

function showNote(): void {
  if (document.getElementById(NOTE_ID)) return;
  const note = document.createElement("div");
  note.id = NOTE_ID;
  note.textContent = NOTE_TEXT;
  note.setAttribute("role", "note");
  root.appendChild(note);
}

function apply(answer: LectureAnswer["lecture"]): void {
  if (!answer) {
    root.classList.remove(LECTURE_CLASS, NO_PLAYLIST_CLASS);
    document.getElementById(NOTE_ID)?.remove();
    return;
  }
  root.classList.add(LECTURE_CLASS);
  root.classList.toggle(NO_PLAYLIST_CLASS, answer.hidePlaylistPanel);
  showNote();
}

async function ask(url: string): Promise<LectureAnswer["lecture"]> {
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ANSWER_TIMEOUT_MS));
    const answer = (await Promise.race([chrome.runtime.sendMessage({ type: "lecture:check", url }), timeout])) as
      | LectureAnswer
      | null
      | undefined;
    return answer && answer.ok === true ? answer.lecture : null;
  } catch {
    return null;
  }
}

/** Asks about the current URL; only the newest question may change the page. */
async function refresh(): Promise<void> {
  const mine = ++generation;
  lastUrl = location.href;
  const answer = await ask(lastUrl);
  if (mine === generation) apply(answer);
}

function onPossibleNavigation(): void {
  if (location.href !== lastUrl) void refresh();
}

/**
 * The autoplay-next toggle is hidden, but a "next" countdown would still carry the viewer to a video that is not
 * allowed. When a video ends outside an allowed playlist, press YouTube's own "cancel" on the countdown.
 */
function cancelAutonav(): void {
  if (!root.classList.contains(NO_PLAYLIST_CLASS)) return;
  let tries = 0;
  const timer = setInterval(() => {
    const cancel = document.querySelector<HTMLElement>(".ytp-autonav-endscreen-upnext-cancel-button");
    if (cancel) cancel.click();
    if (cancel || ++tries >= 10) clearInterval(timer);
  }, 300);
}

void refresh();
// Media events do not bubble, so listen in the capture phase.
document.addEventListener("ended", (event) => {
  if (event.target instanceof HTMLVideoElement) cancelAutonav();
}, true);
// YouTube's own events, then the standard ones, then a cheap guard for anything that slips through.
document.addEventListener("yt-navigate-finish", onPossibleNavigation);
window.addEventListener("popstate", onPossibleNavigation);
window.addEventListener("hashchange", onPossibleNavigation);
setInterval(onPossibleNavigation, URL_GUARD_MS);
// The allowed links or protection changed while the page was open.
try {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "local") void refresh();
  });
} catch {
  // Extension context gone: nothing to follow.
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refresh();
});
