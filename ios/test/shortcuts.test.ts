import { describe, expect, it } from "vitest";
import { ENTER_SHORTCUT, EXIT_SHORTCUT, enterLink, exitLink } from "../src/shortcuts";

/** What the Shortcuts app would read back from the link. */
function parse(link: string): { name: string; input: string | null; text: string | null } {
  const url = new URL(link);
  expect(url.protocol).toBe("shortcuts:");
  expect(url.host).toBe("run-shortcut");
  return { name: url.searchParams.get("name")!, input: url.searchParams.get("input"), text: url.searchParams.get("text") };
}

describe("shortcuts:// links", () => {
  it("builds the exact enter link of the contract", () => {
    expect(enterLink("Instagram", 15)).toBe(
      "shortcuts://run-shortcut?name=DopaDam%20V%C3%A0o&input=text&text=Instagram%7C15",
    );
  });

  it("builds the exact exit link of the contract", () => {
    expect(exitLink()).toBe("shortcuts://run-shortcut?name=DopaDam%20Tho%C3%A1t");
  });

  it("uses the precomposed shortcut names", () => {
    expect(ENTER_SHORTCUT).toBe("DopaDam Vào".normalize("NFC"));
    expect(EXIT_SHORTCUT).toBe("DopaDam Thoát".normalize("NFC"));
    expect(ENTER_SHORTCUT).toHaveLength(11);
  });

  it("matches encodeURIComponent(app + '|' + N) for Vietnamese and odd app names", () => {
    const apps = ["Zalo", "Tiếng Việt có dấu", "Facebook Lite", "A&B=C", "50% off #1", "Disney+", "a|b", "日本語", "😀 Chơi", " spaced "];
    for (const app of apps) {
      const link = enterLink(app, 30);
      expect(link.endsWith(`&text=${encodeURIComponent(`${app}|30`)}`)).toBe(true);
      const parsed = parse(link);
      expect(parsed.name).toBe(ENTER_SHORTCUT);
      expect(parsed.input).toBe("text");
      // Reading the text back gives the app exactly, then the minutes after the last "|".
      expect(parsed.text).toBe(`${app}|30`);
      expect(parsed.text!.slice(0, parsed.text!.lastIndexOf("|"))).toBe(app);
    }
  });

  it("has no raw characters that would end the query early", () => {
    const link = enterLink("A&B=C #1?", 5);
    const query = link.slice(link.indexOf("?") + 1);
    expect(query.split("&")).toHaveLength(3);
    expect(link).not.toContain(" ");
    expect(link.indexOf("#")).toBe(-1);
  });
});
