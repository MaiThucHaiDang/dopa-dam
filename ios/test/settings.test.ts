import { beforeEach, describe, expect, it } from "vitest";
import { startStudy } from "../../extension/src/background/logic";
import { initialState, type State } from "../../extension/src/background/state";
import { applySettings, currentSettings, isNumberOptions, optionsWeaken, parseOptions, type SettingsInput } from "../src/settings";

const TZ = 420;
const NOW = Date.UTC(2026, 5, 10, 5, 0, 0);
let state: State;
let input: SettingsInput;

beforeEach(() => {
  state = initialState("p");
  input = currentSettings(state);
});

describe("applySettings", () => {
  it("raising a lock time or lowering the budget needs no confirmation", () => {
    input.lockSeconds = [10, 10, 20, 30];
    input.budgetMinutes = 60;
    expect(applySettings(state, input, false, NOW, TZ)).toEqual({ ok: true });
    expect(state.settings.lockSeconds).toEqual([10, 10, 20, 30]);
    expect(state.settings.budgetMinutes).toBe(60);
  });

  it("lowering a lock time or raising the budget asks for the confirmation and changes nothing until it comes", () => {
    input.lockSeconds = [2, 10, 20, 30];
    expect(applySettings(state, input, false, NOW, TZ)).toEqual({ ok: false, error: "needs-confirm" });
    expect(state.settings.lockSeconds).toEqual([5, 10, 20, 30]);
    expect(applySettings(state, input, true, NOW, TZ)).toEqual({ ok: true });
    expect(state.settings.lockSeconds).toEqual([2, 10, 20, 30]);

    const budget = { ...currentSettings(state), budgetMinutes: 200 };
    expect(applySettings(state, budget, false, NOW, TZ)).toEqual({ ok: false, error: "needs-confirm" });
  });

  it("longer minute options weaken, shorter ones do not", () => {
    input.allowOptionsNormal = [5, 15, 45];
    expect(applySettings(state, input, false, NOW, TZ)).toEqual({ ok: false, error: "needs-confirm" });
    input.allowOptionsNormal = [5, 10];
    expect(applySettings(state, input, false, NOW, TZ)).toEqual({ ok: true });
    expect(state.settings.allowOptionsNormal).toEqual([5, 10]);
  });

  it("applies nothing when one part is refused", () => {
    input.lockSeconds = [10, 10, 20, 30];
    input.allowOptionsRestricted = [5, 60];
    expect(applySettings(state, input, false, NOW, TZ)).toEqual({ ok: false, error: "needs-confirm" });
    expect(state.settings.lockSeconds).toEqual([5, 10, 20, 30]);
    expect(state.settings.allowOptionsRestricted).toEqual([5, 10]);
  });

  it("is locked during a study session, weakening or not", () => {
    startStudy(state, 25, null, NOW - 1000);
    input.lockSeconds = [10, 10, 20, 30];
    expect(applySettings(state, input, true, NOW, TZ)).toEqual({ ok: false, error: "study-locked" });
    input = currentSettings(state);
    input.allowOptionsNormal = [5];
    expect(applySettings(state, input, true, NOW, TZ)).toEqual({ ok: false, error: "study-locked" });
    expect(state.settings.allowOptionsNormal).toEqual([5, 15, 30]);
  });

  it("an unchanged form is fine, even during study", () => {
    startStudy(state, 25, null, NOW - 1000);
    expect(applySettings(state, input, false, NOW, TZ)).toEqual({ ok: true });
  });

  it("refuses invalid values", () => {
    input.allowOptionsNormal = [15, 5];
    expect(applySettings(state, input, true, NOW, TZ)).toEqual({ ok: false, error: "invalid" });
    input = currentSettings(state);
    input.lockSeconds = [5, 10, 20, 999];
    expect(applySettings(state, input, true, NOW, TZ)).toEqual({ ok: false, error: "invalid" });
  });
});

describe("options helpers", () => {
  it("validates lists", () => {
    expect(isNumberOptions([5, 15, 30])).toBe(true);
    expect(isNumberOptions([])).toBe(false);
    expect(isNumberOptions([5, 5])).toBe(false);
    expect(isNumberOptions([0, 5])).toBe(false);
    expect(isNumberOptions([1, 2, 3, 4, 5])).toBe(false);
    expect(isNumberOptions([5.5])).toBe(false);
    expect(isNumberOptions([181])).toBe(false);
  });

  it("parses typed text", () => {
    expect(parseOptions("5, 15, 30")).toEqual([5, 15, 30]);
    expect(parseOptions("5 10;20")).toEqual([5, 10, 20]);
    expect(parseOptions("5, x")).toBeNull();
    expect(parseOptions("")).toBeNull();
    expect(parseOptions("-5")).toBeNull();
  });

  it("weakening is a longer option or more options", () => {
    expect(optionsWeaken([5, 15, 30], [5, 15, 31])).toBe(true);
    expect(optionsWeaken([5, 10], [5, 7, 10])).toBe(true);
    expect(optionsWeaken([5, 15, 30], [5, 15])).toBe(false);
  });
});
