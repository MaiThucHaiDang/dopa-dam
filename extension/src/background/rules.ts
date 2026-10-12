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

/** RE2 regexes (as used by declarativeNetRequest) matching the same URLs as isAllowedUrl. */
export function allowRegexes(entry: AllowEntry): string[] {
  switch (entry.kind) {
    case "video": {
      const id = escapeRegex(entry.id);
      return [
        `^https?://([^/]*\\.)?youtube\\.com(:\\d+)?/watch\\?([^#]*&)?v=${id}(&.*)?$`,
        `^https?://youtu\\.be(:\\d+)?/${id}([/?].*)?$`,
      ];
    }
    case "playlist": {
      const id = escapeRegex(entry.id);
      return [
        `^https?://([^/]*\\.)?youtube\\.com(:\\d+)?/(watch|playlist)\\?([^#]*&)?list=${id}(&.*)?$`,
        `^https?://youtu\\.be(:\\d+)?/[^?]*\\?([^#]*&)?list=${id}(&.*)?$`,
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

  for (const window of cfg.allowWindows) {
    if (window.expiresAt <= now) continue;
    rules.push({
      id: id++,
      priority: ALLOW_PRIORITY,
      action: { type: "allow" as chrome.declarativeNetRequest.RuleActionType },
      condition: { requestDomains: [window.object], resourceTypes: mainFrame },
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
