// Runs the shared test vectors (shared/test-vectors) against the TypeScript core.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  budgetStatus,
  classifyNumberChange,
  classifyTagChange,
  computeLevel,
  dayKey,
  effectiveDelay,
  isAllowedUrl,
  matchDomainTag,
  parseAllowUrl,
  recentCount,
  resolveStudy,
  type AllowEntry,
  type DomainRule,
  type NumberField,
  type Session,
  type StudyRule,
  type Tag,
} from "../src/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function vectors(name: string): any {
  const path = resolve(__dirname, "../../shared/test-vectors", name);
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("level.json", () => {
  const v = vectors("level.json");
  for (const c of v.cases) {
    it(c.name, () => {
      const s = c.settings ?? v.defaultSettings;
      expect(computeLevel(c.input.n, c.input.inStudy, c.input.overBudget, s)).toEqual(c.expected);
    });
  }
});

describe("recent-count.json", () => {
  for (const c of vectors("recent-count.json").cases) {
    it(c.name, () => expect(recentCount(c.timestamps, c.now)).toBe(c.expected));
  }
});

describe("day-key.json", () => {
  for (const c of vectors("day-key.json").cases) {
    it(c.name, () => expect(dayKey(c.t, c.tzOffsetMinutes)).toBe(c.expected));
  }
});

describe("budget.json", () => {
  for (const c of vectors("budget.json").cases) {
    it(c.name, () => expect(budgetStatus(c.usedMinutes, c.budgetMinutes)).toEqual(c.expected));
  }
});

describe("delay.json", () => {
  for (const c of vectors("delay.json").cases) {
    it(c.name, () => expect(effectiveDelay(c.appDelaySeconds, c.tag, c.tagDelays)).toBe(c.expected));
  }
});

describe("domain.json", () => {
  const v = vectors("domain.json");
  for (const c of v.cases) {
    it(c.host, () => expect(matchDomainTag(c.host, v.rules as DomainRule[])).toBe(c.expected));
  }
});

describe("allow-url.json", () => {
  const v = vectors("allow-url.json");
  for (const c of v.parseCases) {
    it(`parse ${JSON.stringify(c.input)}`, () => expect(parseAllowUrl(c.input)).toEqual(c.expected));
  }
  for (const c of v.matchCases) {
    it(`match ${c.url}`, () => expect(isAllowedUrl(c.url, v.allowList as AllowEntry[])).toBe(c.expected));
  }
});

describe("friction.json", () => {
  const v = vectors("friction.json");
  for (const c of v.tagCases) {
    it(`tag ${c.old} -> ${c.new}`, () => expect(classifyTagChange(c.old as Tag | null, c.new as Tag | null)).toBe(c.expected));
  }
  for (const c of v.numberCases) {
    it(`${c.field} ${c.old} -> ${c.new}`, () =>
      expect(classifyNumberChange(c.field as NumberField, c.old, c.new)).toBe(c.expected));
  }
});

describe("study.json", () => {
  const v = vectors("study.json");
  const rules = v.rules as Record<string, StudyRule>;
  const sessions = v.sessions as Record<string, Session>;
  for (const c of v.cases) {
    it(c.name, () => {
      const result = resolveStudy(
        c.now,
        c.tzOffsetMinutes,
        (c.manual as string[]).map((k) => sessions[k]),
        (c.rules as string[]).map((k) => rules[k]),
        (c.external as string[]).map((k) => sessions[k]),
      );
      expect(result).toEqual(c.expected);
    });
  }
});
