import { describe, expect, it } from "vitest";
import { hostMatches } from "../src/core";
import { evaluateUrl, type InterceptConfig } from "../src/background/logic";
import { buildDnrRules, type DnrRule } from "../src/background/rules";

const WARNING = "chrome-extension://abcdefghijklmnop/warning.html";
const NOW = 1_791_810_000_000;

/**
 * Minimal model of how Chromium evaluates these rules: highest priority wins,
 * and at equal priority "allow" beats "redirect". The regex sees the whole URL, fragment included.
 */
function simulate(rules: DnrRule[], url: string): { action: "none" | "allow" | "redirect"; target?: string } {
  const u = new URL(url);
  const requestUrl = u.href;
  const matching = rules.filter((r) => {
    const c = r.condition;
    if (c.requestDomains && !c.requestDomains.some((d) => hostMatches(u.hostname, d))) return false;
    if (c.excludedRequestDomains?.some((d) => hostMatches(u.hostname, d))) return false;
    if (c.regexFilter && !new RegExp(c.regexFilter, c.isUrlFilterCaseSensitive ? "" : "i").test(requestUrl)) return false;
    return true;
  });
  if (!matching.length) return { action: "none" };
  const top = Math.max(...matching.map((r) => r.priority ?? 1));
  const winners = matching.filter((r) => (r.priority ?? 1) === top);
  if (winners.some((r) => r.action.type === "allow")) return { action: "allow" };
  const redirect = winners[0];
  // DNR's "\0" (whole match) corresponds to "$&" in a JS replacement string.
  const sub = redirect.action.redirect!.regexSubstitution!.replace("\\0", () => "$&");
  return { action: "redirect", target: requestUrl.replace(new RegExp(redirect.condition.regexFilter!), sub) };
}

const cfg: InterceptConfig = {
  protectionEnabled: true,
  domainRules: [
    { pattern: "youtube.com", tag: "entertainment" },
    { pattern: "music.youtube.com", tag: "study" },
    { pattern: "youtu.be", tag: "entertainment" },
    { pattern: "facebook.com", tag: "entertainment" },
    { pattern: "localhost", tag: "game" },
    { pattern: "tiktok.com", tag: "entertainment" },
    { pattern: "reddit.com", tag: "entertainment" },
    { pattern: "github.com", tag: "work" },
  ],
  allowUrls: [
    { kind: "video", id: "abc123" },
    { kind: "playlist", id: "PL1" },
    { kind: "prefix", value: "facebook.com/groups/lophoc" },
    { kind: "prefix", value: "localhost/learn" },
  ],
  allowWindows: [
    { object: "tiktok.com", expiresAt: NOW + 60_000, headsUpSent: false },
    { object: "reddit.com", expiresAt: NOW - 1, headsUpSent: false },
  ],
};

const urls = [
  "https://www.youtube.com/",
  "https://youtube.com/feed/subscriptions",
  "https://m.youtube.com/watch?v=abc123",
  "https://www.youtube.com/watch?v=abc123&t=30s",
  "https://www.youtube.com/watch?v=ABC123",
  "https://www.youtube.com/watch?v=abc1234",
  "https://www.youtube.com/watch?v=zzz&list=PL1&index=2",
  "https://www.youtube.com/watch?v=zzz&list=PL12",
  "https://www.youtube.com/playlist?list=PL1",
  "https://www.youtube.com/shorts/abc123",
  "https://youtu.be/abc123",
  "https://youtu.be/abc123?t=5",
  "https://youtu.be/zzz?list=PL1",
  "https://youtu.be/zzz",
  "https://music.youtube.com/watch?v=x",
  "https://www.facebook.com/",
  "https://www.facebook.com/groups/lophoc",
  "https://www.facebook.com/groups/lophoc/posts/1",
  "https://www.facebook.com/groups/lophoc?ref=bookmarks",
  "https://www.facebook.com/groups/lophoc2",
  "https://web.facebook.com/watch",
  "http://localhost:5173/game",
  "http://localhost:5173/learn",
  "http://localhost:5173/learn/lesson-1?x=1",
  "http://localhost:5173/learning",
  "https://www.youtube.com:443/watch?v=abc123",
  "https://www.tiktok.com/@someone",
  "https://www.reddit.com/r/all",
  "https://github.com/",
  "https://example.com/",
  "https://notyoutube.com/",
  // Fragments: the rule set and isAllowedUrl must agree (a mismatch loops through the warning page).
  "https://www.youtube.com/watch?v=abc123#t=5",
  "https://www.youtube.com/watch?v=zzz#t=5",
  "https://www.youtube.com/watch?v=abc123&t=30s#t=5",
  "https://www.youtube.com/playlist?list=PL1#top",
  "https://www.youtube.com/watch?v=zzz&list=PL1#x",
  "https://www.youtube.com/watch?v=zzz&list=PL12#x",
  "https://youtu.be/abc123#t=5",
  "https://youtu.be/abc123?t=5#x",
  "https://youtu.be/zzz?list=PL1#x",
  "https://www.facebook.com/groups/lophoc#about",
  "https://www.facebook.com/groups/lophoc/posts/1#c",
  "https://www.facebook.com/groups/lophoc2#about",
  "http://localhost:5173/learn#part",
  // Repeated and reordered parameters: only the first v / list counts.
  "https://www.youtube.com/watch?v=zzz&v=abc123",
  "https://www.youtube.com/watch?v=abc123&v=zzz",
  "https://www.youtube.com/watch?t=3&v=abc123",
  "https://www.youtube.com/watch?vx=1&v=abc123",
  "https://www.youtube.com/watch?v&v=abc123",
  "https://www.youtube.com/watch?&&v=abc123",
  "https://www.youtube.com/watch?l=1&list=PL1",
  "https://www.youtube.com/watch?v=zzz&list=PL1&list=PL12",
  "https://youtu.be/zzz?list=PL1&list=PL12",
];

// An allow window on a parent domain must not cover a subdomain that has its own rule.
const windowCfg: InterceptConfig = {
  protectionEnabled: true,
  domainRules: [
    { pattern: "youtube.com", tag: "entertainment" },
    { pattern: "m.youtube.com", tag: "entertainment" },
    { pattern: "music.youtube.com", tag: "study" },
    { pattern: "old.example.com", tag: "entertainment" },
  ],
  allowUrls: [],
  allowWindows: [
    { object: "youtube.com", expiresAt: NOW + 60_000, headsUpSent: false },
    // The rule for this object was removed, so the window no longer grants anything.
    { object: "gone.example.com", expiresAt: NOW + 60_000, headsUpSent: false },
  ],
};
const windowUrls = [
  "https://www.youtube.com/",
  "https://youtube.com/watch?v=x",
  "https://m.youtube.com/watch?v=x",
  "https://a.m.youtube.com/",
  "https://music.youtube.com/",
  "https://old.example.com/",
  "https://gone.example.com/",
];

describe("buildDnrRules with allow windows", () => {
  const rules = buildDnrRules(windowCfg, NOW, WARNING);
  for (const url of windowUrls) {
    it(`agrees with evaluateUrl for ${url}`, () => {
      expect(simulate(rules, url).action === "redirect").toBe(evaluateUrl(windowCfg, url, NOW).intercept);
    });
  }
});

describe("buildDnrRules", () => {
  const rules = buildDnrRules(cfg, NOW, WARNING);

  // Known gap: the first-list form is too big for Chromium's regex memory limit, so a repeated list is
  // matched on any occurrence. evaluateUrl still blocks it, so the warning page's skip handles it.
  it("accepts a repeated list parameter on any occurrence (documented limit)", () => {
    const url = "https://www.youtube.com/playlist?list=PL12&list=PL1";
    expect(evaluateUrl(cfg, url, NOW).intercept).toBe(true);
    expect(simulate(rules, url).action).toBe("allow");
  });

  it("gives every rule a unique id", () => {
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
  });

  for (const url of urls) {
    it(`agrees with evaluateUrl for ${url}`, () => {
      const expected = evaluateUrl(cfg, url, NOW).intercept;
      const sim = simulate(rules, url);
      expect(sim.action === "redirect").toBe(expected);
      if (expected) expect(sim.target).toBe(`${WARNING}#${url}`);
    });
  }

  it("produces no rules when protection is off", () => {
    expect(buildDnrRules({ ...cfg, protectionEnabled: false }, NOW, WARNING)).toEqual([]);
  });

  it("skips expired allow windows", () => {
    const allowsReddit = rules.some((r) => r.action.type === "allow" && r.condition.requestDomains?.includes("reddit.com"));
    expect(allowsReddit).toBe(false);
  });
});
