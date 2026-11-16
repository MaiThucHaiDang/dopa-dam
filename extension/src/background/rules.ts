// Builds declarativeNetRequest rules so blocked sites are redirected before any byte of them loads.
import { hostMatches, isBlockedTag, type AllowEntry } from "../core";
import type { InterceptConfig } from "./logic";

export type DnrRule = chrome.declarativeNetRequest.Rule;

/** Allow windows and allowed links beat every domain rule. */
export const ALLOW_PRIORITY = 1000;

/** Deeper (more specific) patterns get a higher priority so the longest match wins, like matchDomainRule. */
export function depthPriority(pattern: string): number {
  return 10 + pattern.split(".").length * 2;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches a query string whose FIRST parameter named `name` has the value `id`, like URLSearchParams.get.
 * RE2 has no lookahead, so "an earlier parameter is not `name`" is spelled out: it is empty, or it diverges
 * from `name` at some character (or ends early), or it continues `name` with a character other than "=".
 * The match is followed by an optional rest of the query and an optional fragment.
 */
function firstParam(name: string, id: string): string {
  const alts = [`[^#&${escapeRegex(name[0])}][^#&]*`, ""];
  for (let k = 1; k < name.length; k++) {
    alts.push(`${escapeRegex(name.slice(0, k))}([^#&${escapeRegex(name[k])}][^#&]*)?`);
  }
  alts.push(`${escapeRegex(name)}[^#&=][^#&]*`);
  return `((${alts.join("|")})&)*${escapeRegex(name)}=${id}(&[^#]*)?(#.*)?$`;
}

/**
 * Any `list` parameter with the value `id`. The first-parameter form (firstParam) is too big for Chromium's
 * RE2 memory limit with a name this long ("memoryLimitExceeded"), so a repeated `list` is not matched here:
 * such a URL is intercepted and the warning page's skip handles it (see the navigation fallback).
 */
function anyParam(name: string, id: string): string {
  return `([^#]*&)?${escapeRegex(name)}=${id}(&[^#]*)?(#.*)?$`;
}

/** RE2 regexes (as used by declarativeNetRequest) matching the same URLs as isAllowedUrl. Fragments are accepted. */
export function allowRegexes(entry: AllowEntry): string[] {
  switch (entry.kind) {
    case "video": {
      const id = escapeRegex(entry.id);
      return [
        `^https?://([^/]*\\.)?youtube\\.com(:\\d+)?/watch\\?${firstParam("v", id)}`,
        `^https?://youtu\\.be(:\\d+)?/${id}([/?#].*)?$`,
      ];
    }
    case "playlist": {
      const id = escapeRegex(entry.id);
      return [
        `^https?://([^/]*\\.)?youtube\\.com(:\\d+)?/(watch|playlist)\\?${anyParam("list", id)}`,
        `^https?://youtu\\.be(:\\d+)?/[^?#]*\\?${anyParam("list", id)}`,
      ];
    }
    case "prefix": {
      // isAllowedUrl ignores the port, so the regex accepts any port between host and path.
      const cut = entry.value.search(/[/?]/);
      const host = cut < 0 ? entry.value : entry.value.slice(0, cut);
      const rest = cut < 0 ? "" : entry.value.slice(cut);
      return [`^https?://(www\\.)?${escapeRegex(host)}(:\\d+)?${escapeRegex(rest)}([/?#].*)?$`];
    }
  }
}

export function buildDnrRules(cfg: InterceptConfig, now: number, warningPageUrl: string): DnrRule[] {
  if (!cfg.protectionEnabled) return [];
  const rules: DnrRule[] = [];
  let id = 1;
  const mainFrame = ["main_frame" as chrome.declarativeNetRequest.ResourceType];
  const blocked = cfg.domainRules.filter((r) => isBlockedTag(r.tag));

  for (const rule of blocked) {
    rules.push({
      id: id++,
      priority: depthPriority(rule.pattern),
      action: {
        type: "redirect" as chrome.declarativeNetRequest.RuleActionType,
        // \0 is the whole matched URL, carried to the warning page in the fragment.
        redirect: { regexSubstitution: warningPageUrl + "#\\0" },
      },
      condition: { regexFilter: "^https?://.*$", requestDomains: [rule.pattern], resourceTypes: mainFrame },
    });
  }

  // A more specific non-blocked rule (music.youtube.com = study) carves an exception out of a blocked parent.
  for (const rule of cfg.domainRules) {
    if (isBlockedTag(rule.tag)) continue;
    if (!blocked.some((b) => b.pattern !== rule.pattern && hostMatches(rule.pattern, b.pattern))) continue;
    rules.push({
      id: id++,
      priority: depthPriority(rule.pattern) + 1,
      action: { type: "allow" as chrome.declarativeNetRequest.RuleActionType },
      condition: { requestDomains: [rule.pattern], resourceTypes: mainFrame },
    });
  }

  // evaluateUrl grants a window only to hosts whose most specific rule is the window's own pattern, so a
  // window on youtube.com must not cover m.youtube.com when that has a rule of its own.
  for (const window of cfg.allowWindows) {
    if (window.expiresAt <= now) continue;
    if (!cfg.domainRules.some((r) => r.pattern === window.object)) continue;
    const moreSpecific = cfg.domainRules
      .map((r) => r.pattern)
      .filter((p) => p !== window.object && hostMatches(p, window.object));
    rules.push({
      id: id++,
      priority: ALLOW_PRIORITY,
      action: { type: "allow" as chrome.declarativeNetRequest.RuleActionType },
      condition: {
        requestDomains: [window.object],
        ...(moreSpecific.length ? { excludedRequestDomains: moreSpecific } : {}),
        resourceTypes: mainFrame,
      },
    });
  }

  for (const entry of cfg.allowUrls) {
    for (const regexFilter of allowRegexes(entry)) {
      rules.push({
        id: id++,
        priority: ALLOW_PRIORITY,
        action: { type: "allow" as chrome.declarativeNetRequest.RuleActionType },
        condition: { regexFilter, isUrlFilterCaseSensitive: true, resourceTypes: mainFrame },
      });
    }
  }
  return rules;
}
