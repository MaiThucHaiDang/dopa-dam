export type AllowEntry =
  | { kind: "video"; id: string }
  | { kind: "playlist"; id: string }
  | { kind: "prefix"; value: string };

function toUrl(text: string): URL | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : "https://" + trimmed;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname !== "localhost" && !url.hostname.includes(".")) return null;
  return url;
}

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

export function isYoutubeHost(host: string): boolean {
  return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
}

/** host + path (trailing "/" removed) + query, without scheme, "www." and fragment. */
function normalizedPrefix(url: URL): { host: string; path: string } {
  const path = url.pathname.replace(/\/+$/, "");
  return { host: stripWww(url.hostname.toLowerCase()), path: path + url.search };
}

/** Parses a link the user wants to allow. YouTube only supports single videos and playlists. */
export function parseAllowUrl(text: string): AllowEntry | null {
  const url = toUrl(text);
  if (!url) return null;
  const host = stripWww(url.hostname.toLowerCase());
  if (isYoutubeHost(host)) {
    if (host === "youtu.be") {
      const id = url.pathname.split("/")[1];
      return id ? { kind: "video", id } : null;
    }
    const v = url.searchParams.get("v");
    const list = url.searchParams.get("list");
    if (url.pathname === "/watch") {
      if (v) return { kind: "video", id: v };
      return list ? { kind: "playlist", id: list } : null;
    }
    if (url.pathname === "/playlist" && list) return { kind: "playlist", id: list };
    return null;
  }
  const { path } = normalizedPrefix(url);
  if (url.pathname.replace(/\/+$/, "") === "") return null;
  return { kind: "prefix", value: host + path };
}

export function isAllowedUrl(urlText: string, allowList: readonly AllowEntry[]): boolean {
  if (allowList.length === 0) return false;
  const url = toUrl(urlText);
  if (!url) return false;
  const host = stripWww(url.hostname.toLowerCase());
  if (isYoutubeHost(host)) {
    let videoId: string | null = null;
    let listId: string | null = url.searchParams.get("list");
    if (host === "youtu.be") videoId = url.pathname.split("/")[1] || null;
    else if (url.pathname === "/watch") videoId = url.searchParams.get("v");
    else if (url.pathname !== "/playlist") listId = null;
    return allowList.some(
      (e) => (e.kind === "video" && e.id === videoId) || (e.kind === "playlist" && e.id === listId),
    );
  }
  const p = normalizedPrefix(url);
  const full = p.host + p.path;
  return allowList.some(
    (e) =>
      e.kind === "prefix" &&
      (full === e.value || (full.startsWith(e.value) && "/?#".includes(full[e.value.length]))),
  );
}

export function describeAllowEntry(entry: AllowEntry): string {
  switch (entry.kind) {
    case "video":
      return `Video YouTube ${entry.id}`;
    case "playlist":
      return `Playlist YouTube ${entry.id}`;
    case "prefix":
      return entry.value;
  }
}

export function sameAllowEntry(a: AllowEntry, b: AllowEntry): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "prefix" ? a.value === (b as { value: string }).value : a.id === (b as { id: string }).id;
}
