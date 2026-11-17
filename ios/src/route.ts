// Hash routes of the page: "#/" (home) and "#/warn?app=<name>" (the warning the gate shortcut opens).

export type Route = { name: "home" } | { name: "warn"; app: string };

/** Used when the gate shortcut passes no app name. */
export const FALLBACK_APP = "Ứng dụng";

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    // A stray "%" in an unencoded name: use the text as it came.
    return text;
  }
}

/** First value of `key` in a query string. Only %XX is decoded: a "+" stays a plus (it is part of names like "Disney+"). */
export function queryValue(query: string, key: string): string | null {
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    const name = eq < 0 ? pair : pair.slice(0, eq);
    if (decode(name) === key) return eq < 0 ? "" : decode(pair.slice(eq + 1));
  }
  return null;
}

/** Accepts "#/warn?app=X", "#warn?app=X", "/warn?app=X"; anything else is home. */
export function parseRoute(hash: string): Route {
  let rest = hash.startsWith("#") ? hash.slice(1) : hash;
  if (rest.startsWith("/")) rest = rest.slice(1);
  const q = rest.indexOf("?");
  const path = (q < 0 ? rest : rest.slice(0, q)).replace(/\/+$/, "");
  const query = q < 0 ? "" : rest.slice(q + 1);
  if (path !== "warn") return { name: "home" };
  const app = queryValue(query, "app");
  // The name is used exactly as given: the shortcuts compare it with what they stored earlier.
  return { name: "warn", app: app && app.trim() ? app : FALLBACK_APP };
}

export function warnHash(app: string): string {
  return `#/warn?app=${encodeURIComponent(app)}`;
}
