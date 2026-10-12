import { describe, expect, it } from "vitest";
import { normalizeDomainInput, parseAllowUrl } from "@core";
import { isCmdError } from "../src/api";

describe("agent UI helpers", () => {
  it("recognizes errors returned by the Rust commands", () => {
    expect(isCmdError({ code: "needs-confirm", message: "x" })).toBe(true);
    expect(isCmdError("boom")).toBe(false);
    expect(isCmdError(null)).toBe(false);
  });

  it("uses the extension core through the @core alias", () => {
    expect(normalizeDomainInput("https://www.YouTube.com/watch")).toBe("youtube.com");
    expect(parseAllowUrl("https://youtu.be/abc")).toEqual({ kind: "video", id: "abc" });
  });
});
