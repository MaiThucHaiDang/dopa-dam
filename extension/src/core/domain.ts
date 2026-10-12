import type { Tag } from "./types";

export interface DomainRule {
  /** Lower-case registrable host without "www.", e.g. "youtube.com". Covers all subdomains. */
  pattern: string;
  tag: Tag;
}

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

export function hostMatches(host: string, pattern: string): boolean {
  return host === pattern || host.endsWith("." + pattern);
}

/** The most specific (longest) rule matching the host, or null. */
export function matchDomainRule<R extends DomainRule>(host: string, rules: readonly R[]): R | null {
  const h = normalizeHost(host);
  let best: R | null = null;
  for (const rule of rules) {
    if (hostMatches(h, rule.pattern) && (!best || rule.pattern.length > best.pattern.length)) best = rule;
  }
  return best;
}

export function matchDomainTag(host: string, rules: readonly DomainRule[]): Tag | null {
  return matchDomainRule(host, rules)?.tag ?? null;
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Turns what the user typed ("https://www.YouTube.com/abc", "youtube.com") into a rule pattern.
 * Returns null when it is not a usable host name.
 */
export function normalizeDomainInput(input: string): string | null {
  let text = input.trim().toLowerCase();
  if (!text) return null;
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  text = text.split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.$/, "");
  if (text.startsWith("www.")) text = text.slice(4);
  if (text === "localhost") return text;
  const labels = text.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  return text;
}
