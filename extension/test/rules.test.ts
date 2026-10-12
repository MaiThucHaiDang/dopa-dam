import { describe, expect, it } from "vitest";
import { hostMatches } from "../src/core";
import { evaluateUrl, type InterceptConfig } from "../src/background/logic";
import { buildDnrRules, type DnrRule } from "../src/background/rules";

const WARNING = "chrome-extension://abcdefghijklmnop/warning.html";
const NOW = 1_791_810_000_000;

/**
 * Minimal model of how Chromium evaluates these rules: highest priority wins,
 * and at equal priority "allow" beats "redirect". DNR never sees the fragment.
 */
function simulate(rules: DnrRule[], url: string): { action: "none" | "allow" | "redirect"; target?: string } {
  const u = new URL(url);
  const requestUrl = u.href.replace(/#.*$/, "");
  const matching = rules.filter((r) => {
    const c = r.condition;
    if (c.requestDomains && !c.requestDomains.some((d) => hostMatches(u.hostname, d))) return false;
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
];

describe("buildDnrRules", () => {
  const rules = buildDnrRules(cfg, NOW, WARNING);

  it("gives every rule a unique id", () => {
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
  });

  for (const url of urls) {
    it(`agrees with evaluateUrl for ${url}`, () => {
      const expected = evaluateUrl(cfg, url, NOW).intercept;
      const sim = simulate(rules, url);
      expect(sim.action === "redirect").toBe(expected);
      if (expected) expect(sim.target).toBe(`${WARNING}#${url.replace(/#.*$/, "")}`);
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
