// Lecture mode ("Chế độ bài giảng"): when a YouTube page is open through an allowed link, the page is
// stripped of YouTube's own distractions. This file holds the decision; the content script applies it.
import { isAllowedUrl, type AllowEntry } from "../core/allowUrl";

/** Hosts where lecture mode can apply. music.youtube.com and other subdomains are out of scope. */
export const LECTURE_HOSTS: readonly string[] = ["youtube.com", "www.youtube.com", "m.youtube.com"];

export interface LectureMode {
  /** Hide the playlist panel too. False only when an allowed playlist entry covers the page's list. */
  hidePlaylistPanel: boolean;
}

/** Answer to "lecture:check". `null` means the page stays as YouTube made it. */
export type LectureAnswer = { ok: true; lecture: LectureMode | null };

export function isLectureHost(host: string): boolean {
  return LECTURE_HOSTS.includes(host.toLowerCase());
}

/**
 * Decides lecture mode for the current URL of a tab. Applies only on the YouTube hosts and only while the URL
 * matches an allowed entry, so a page reached through an allow window ("Vào") is never touched.
 * The playlist panel is the lecturer's way through a course, so it stays only when the allowed entry is that playlist.
 */
export function lectureModeFor(urlText: string, allowList: readonly AllowEntry[]): LectureMode | null {
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !isLectureHost(url.hostname)) return null;
  if (!isAllowedUrl(urlText, allowList)) return null;
  const list = url.searchParams.get("list");
  const playlistAllowed = list !== null && allowList.some((e) => e.kind === "playlist" && e.id === list);
  return { hidePlaylistPanel: !playlistAllowed };
}
