import { describe, expect, it } from "vitest";
import type { AllowEntry } from "../src/core";
import { isLectureHost, lectureModeFor } from "../src/shared/lecture";

const video: AllowEntry = { kind: "video", id: "abc123" };
const playlist: AllowEntry = { kind: "playlist", id: "PLcourse" };
const prefix: AllowEntry = { kind: "prefix", value: "example.edu/course" };

describe("lectureModeFor", () => {
  it("is on for an allowed video and hides the playlist panel", () => {
    expect(lectureModeFor("https://www.youtube.com/watch?v=abc123", [video])).toEqual({ hidePlaylistPanel: true });
    expect(lectureModeFor("https://m.youtube.com/watch?v=abc123&t=30s", [video])).toEqual({ hidePlaylistPanel: true });
    expect(lectureModeFor("https://youtube.com/watch?v=abc123#t=5", [video])).toEqual({ hidePlaylistPanel: true });
  });

  it("keeps the playlist panel when the allowed entry is that playlist", () => {
    expect(lectureModeFor("https://www.youtube.com/watch?v=x1&list=PLcourse&index=2", [playlist])).toEqual({
      hidePlaylistPanel: false,
    });
    expect(lectureModeFor("https://www.youtube.com/playlist?list=PLcourse", [playlist])).toEqual({ hidePlaylistPanel: false });
  });

  it("hides the playlist panel when only the video is allowed and the URL carries another list", () => {
    expect(lectureModeFor("https://www.youtube.com/watch?v=abc123&list=PLother", [video, playlist])).toEqual({
      hidePlaylistPanel: true,
    });
  });

  it("keeps the panel when both the video and its playlist are allowed", () => {
    expect(lectureModeFor("https://www.youtube.com/watch?v=abc123&list=PLcourse", [video, playlist])).toEqual({
      hidePlaylistPanel: false,
    });
  });

  it("is off for a video that is not allowed (reached through Vào)", () => {
    expect(lectureModeFor("https://www.youtube.com/watch?v=other", [video, playlist])).toBeNull();
    expect(lectureModeFor("https://www.youtube.com/", [video, playlist])).toBeNull();
    expect(lectureModeFor("https://www.youtube.com/shorts/abc123", [video])).toBeNull();
  });

  it("is off when there is no allowed link", () => {
    expect(lectureModeFor("https://www.youtube.com/watch?v=abc123", [])).toBeNull();
  });

  it("is off outside the YouTube hosts, even for an allowed link", () => {
    expect(lectureModeFor("https://music.youtube.com/watch?v=abc123", [video])).toBeNull();
    expect(lectureModeFor("https://example.edu/course/week1", [prefix])).toBeNull();
    expect(lectureModeFor("https://youtu.be/abc123", [video])).toBeNull();
    expect(lectureModeFor("https://evilyoutube.com/watch?v=abc123", [video])).toBeNull();
  });

  it("is off for pages that are not web URLs", () => {
    expect(lectureModeFor("not a url", [video])).toBeNull();
    expect(lectureModeFor("chrome-extension://abc/warning.html#https://www.youtube.com/watch?v=abc123", [video])).toBeNull();
  });
});

describe("isLectureHost", () => {
  it("counts the desktop and mobile hosts only", () => {
    expect(isLectureHost("www.youtube.com")).toBe(true);
    expect(isLectureHost("m.youtube.com")).toBe(true);
    expect(isLectureHost("youtube.com")).toBe(true);
    expect(isLectureHost("music.youtube.com")).toBe(false);
    expect(isLectureHost("studio.youtube.com")).toBe(false);
  });
});
