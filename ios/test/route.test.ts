import { describe, expect, it } from "vitest";
import { FALLBACK_APP, parseRoute, queryValue, warnHash } from "../src/route";

describe("parseRoute", () => {
  it("treats an empty hash and unknown routes as home", () => {
    for (const hash of ["", "#", "#/", "#/nope", "#/home?app=x", "#/warning?app=x"]) {
      expect(parseRoute(hash)).toEqual({ name: "home" });
    }
  });

  it("reads the app of a warning", () => {
    expect(parseRoute("#/warn?app=Instagram")).toEqual({ name: "warn", app: "Instagram" });
    expect(parseRoute("#warn?app=Instagram")).toEqual({ name: "warn", app: "Instagram" });
    expect(parseRoute("#/warn/?app=Instagram")).toEqual({ name: "warn", app: "Instagram" });
  });

  it("decodes percent escapes, Vietnamese letters and spaces", () => {
    expect(parseRoute(`#/warn?app=${encodeURIComponent("Zalo Việt")}`)).toEqual({ name: "warn", app: "Zalo Việt" });
    expect(parseRoute("#/warn?app=YouTube%20Music")).toEqual({ name: "warn", app: "YouTube Music" });
  });

  it("keeps a plus sign and tolerates a stray percent sign", () => {
    expect(parseRoute("#/warn?app=Disney+")).toEqual({ name: "warn", app: "Disney+" });
    expect(parseRoute("#/warn?app=100%")).toEqual({ name: "warn", app: "100%" });
  });

  it("ignores other parameters and takes the first app", () => {
    expect(parseRoute("#/warn?t=123&app=Reddit&app=X")).toEqual({ name: "warn", app: "Reddit" });
  });

  it("falls back when there is no app", () => {
    for (const hash of ["#/warn", "#/warn?", "#/warn?app=", "#/warn?app=%20%20", "#/warn?other=1"]) {
      expect(parseRoute(hash)).toEqual({ name: "warn", app: FALLBACK_APP });
    }
  });

  it("round-trips through warnHash for odd names", () => {
    for (const app of ["Instagram", "Tiếng Việt có dấu", "A&B=C", "50% off #1", "a|b", "Disney+", "日本語", "😀 Chơi"]) {
      expect(parseRoute(warnHash(app))).toEqual({ name: "warn", app });
    }
  });
});

describe("queryValue", () => {
  it("returns null for a missing key and empty for a key without value", () => {
    expect(queryValue("a=1", "b")).toBeNull();
    expect(queryValue("a", "a")).toBe("");
  });
});
