// Runs the shared test vectors (shared/test-vectors) against the TypeScript core.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeRuleOccurrences,
  budgetStatus,
  classifyNumberChange,
  classifyRiskWindowsChange,
  classifyStudyRuleChange,
  classifyTagChange,
  computeLevel,
  dayKey,
  effectiveDelay,
  inRiskWindow,
  isAllowedUrl,
  MAX_RISK_WINDOWS,
  matchDomainTag,
  normalizeRiskWindow,
  parseAllowUrl,
  recentCount,
  RISK_BLOCK_HOURS,
  RISK_MIN_OPENS,
  resolveStudy,
  riskHeatmap,
  suggestRiskWindow,
  type AllowEntry,
  type DomainRule,
  type NumberField,
  type RiskCell,
  type RiskWindow,
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
      expect(computeLevel(c.input.n, c.input.inStudy, c.input.overBudget, s, c.input.inRisk ?? false)).toEqual(c.expected);
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

describe("study-change.json", () => {
  const v = vectors("study-change.json");
  const rules = v.rules as Record<string, StudyRule>;
  const rule = (k: string | null) => (k === null ? null : rules[k]);
  for (const c of v.changeCases) {
    it(c.name, () => expect(classifyStudyRuleChange(rule(c.old), rule(c.new), c.now, c.tzOffsetMinutes)).toBe(c.expected));
  }
  for (const c of v.activeCases) {
    it(`đang diễn ra: ${c.name}`, () =>
      expect(activeRuleOccurrences((c.rules as string[]).map((k) => rules[k]), c.now, c.tzOffsetMinutes)).toEqual(c.expected));
  }
});

describe("risk.json", () => {
  const v = vectors("risk.json");
  type SparseCell = { row: number; hour: number; opens: number; enters: number };
  const toGrid = (cells: SparseCell[]): RiskCell[][] => {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ opens: 0, enters: 0 })));
    for (const c of cells) grid[c.row][c.hour] = { opens: c.opens, enters: c.enters };
    return grid;
  };
  const toSparse = (grid: RiskCell[][]): SparseCell[] =>
    grid.flatMap((cells, row) => cells.map((c, hour) => ({ row, hour, ...c }))).filter((c) => c.opens > 0 || c.enters > 0);

  it("constants", () => {
    expect(MAX_RISK_WINDOWS).toBe(v.constants.maxWindows);
    expect(RISK_MIN_OPENS).toBe(v.constants.minOpens);
    expect(RISK_BLOCK_HOURS).toBe(v.constants.blockHours);
  });
  for (const c of v.inRiskWindow) {
    it(`inRiskWindow: ${c.name}`, () =>
      expect(inRiskWindow(c.input.windows as RiskWindow[], c.input.now, c.input.tzOffsetMinutes)).toBe(c.expected));
  }
  for (const c of v.heatmap) {
    it(`heatmap: ${c.name}`, () => {
      const grid = riskHeatmap(c.input.events, c.input.now, c.input.tzOffsetMinutes, c.input.days);
      expect(grid).toHaveLength(7);
      for (const row of grid) expect(row).toHaveLength(24);
      expect(toSparse(grid)).toEqual(c.expected);
    });
  }
  for (const c of v.suggest) {
    it(`suggest: ${c.name}`, () =>
      expect(suggestRiskWindow(toGrid(c.input.cells), c.input.windows as RiskWindow[])).toEqual(c.expected));
  }
  for (const c of v.classify) {
    it(`classify: ${c.name}`, () =>
      expect(classifyRiskWindowsChange(c.input.old as RiskWindow[], c.input.new as RiskWindow[])).toBe(c.expected));
  }
  for (const c of v.normalize) {
    it(`normalize: ${c.name}`, () => expect(normalizeRiskWindow(c.input as RiskWindow)).toEqual(c.expected));
  }
});
