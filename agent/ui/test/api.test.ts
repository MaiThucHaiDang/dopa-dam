import { describe, expect, it } from "vitest";
import { normalizeDomainInput, parseAllowUrl } from "@core";
import { describeFocusSource, FALLBACK_PLATFORM, isCmdError } from "../src/api";

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

describe("platform helpers", () => {
  it("falls back to the Windows wording", () => {
    expect(FALLBACK_PLATFORM.os).toBe("windows");
  });

  it("describes each Linux focus source", () => {
    const base = { os: "linux", sessionType: "wayland", shellExtensionConnected: false } as const;
    expect(describeFocusSource({ ...base, focusBackend: "gnome-shell", shellExtensionConnected: true }).ok).toBe(true);
    expect(describeFocusSource({ ...base, focusBackend: "gnome-shell" }).ok).toBe(false);
    expect(describeFocusSource({ ...base, sessionType: "x11", focusBackend: "x11" }).ok).toBe(true);
    expect(describeFocusSource({ ...base, focusBackend: "none" }).ok).toBe(false);
  });
});
