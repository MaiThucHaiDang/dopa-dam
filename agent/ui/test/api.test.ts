import { describe, expect, it } from "vitest";
import { normalizeDomainInput, parseAllowUrl } from "@core";
import {
  describeFocusSource,
  describeShellInstall,
  FALLBACK_PLATFORM,
  isCmdError,
  shellExtensionState,
  type PlatformInfo,
} from "../src/api";

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

const GNOME_WAYLAND: PlatformInfo = {
  os: "linux",
  sessionType: "wayland",
  focusBackend: "none",
  shellExtensionConnected: false,
  gnome: true,
  shellExtensionInstalled: false,
  shellExtensionUpdateAvailable: false,
};

describe("platform helpers", () => {
  it("falls back to the Windows wording", () => {
    expect(FALLBACK_PLATFORM.os).toBe("windows");
  });

  it("describes each Linux focus source", () => {
    const base = { ...GNOME_WAYLAND, shellExtensionConnected: false };
    expect(describeFocusSource({ ...base, focusBackend: "gnome-shell", shellExtensionConnected: true }).ok).toBe(true);
    expect(describeFocusSource({ ...base, focusBackend: "gnome-shell" }).ok).toBe(false);
    expect(describeFocusSource({ ...base, sessionType: "x11", focusBackend: "x11" }).ok).toBe(true);
    expect(describeFocusSource({ ...base, focusBackend: "none" }).ok).toBe(false);
  });
});

describe("GNOME Shell extension flow", () => {
  it("picks the message for each situation on GNOME with Wayland", () => {
    expect(shellExtensionState(GNOME_WAYLAND)).toBe("missing");
    expect(shellExtensionState({ ...GNOME_WAYLAND, shellExtensionInstalled: true })).toBe("needs-login");
    expect(shellExtensionState({ ...GNOME_WAYLAND, shellExtensionInstalled: true, shellExtensionConnected: true })).toBe("ok");
    expect(
      shellExtensionState({
        ...GNOME_WAYLAND,
        shellExtensionInstalled: true,
        shellExtensionConnected: true,
        shellExtensionUpdateAvailable: true,
      }),
    ).toBe("update");
  });

  it("stays out of the way outside GNOME on Wayland", () => {
    expect(shellExtensionState({ ...GNOME_WAYLAND, sessionType: "x11" })).toBe("none");
    expect(shellExtensionState({ ...GNOME_WAYLAND, sessionType: null })).toBe("none");
    expect(shellExtensionState({ ...GNOME_WAYLAND, gnome: false })).toBe("none");
    expect(shellExtensionState(FALLBACK_PLATFORM)).toBe("none");
  });

  it("tells the user to log out after an install or update, not after a no-op", () => {
    const base = { outcome: "installed", enabledChanged: true, needsLogout: true } as const;
    expect(describeShellInstall(base)).toContain("Đã cài");
    expect(describeShellInstall(base)).toContain("Đăng xuất rồi đăng nhập lại");
    expect(describeShellInstall({ ...base, outcome: "updated" })).toContain("Đã cập nhật");
    const same = describeShellInstall({ outcome: "upToDate", enabledChanged: false, needsLogout: false });
    expect(same).toContain("bản mới nhất");
    expect(same).not.toContain("Đăng xuất");
  });
});
