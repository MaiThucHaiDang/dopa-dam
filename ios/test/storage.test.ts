import { describe, expect, it } from "vitest";
import { CORRUPT_KEY, STORAGE_KEY, Store, parseStored, type KeyValueStore } from "../src/storage";

class MemoryKV implements KeyValueStore {
  data = new Map<string, string>();
  failWrites = false;
  failReads = false;
  getItem(key: string): string | null {
    if (this.failReads) throw new Error("blocked");
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("quota");
    this.data.set(key, value);
  }
}

let counter = 0;
const newId = () => `profile-${++counter}`;

describe("parseStored (migration)", () => {
  it("gives defaults for nothing, garbage and wrong types", () => {
    for (const text of [null, "", "not json", "null", "42", '"text"', "[]"]) {
      const s = parseStored(text, "p");
      expect(s.schema).toBe(1);
      expect(s.events).toEqual([]);
      expect(s.settings.lockSeconds).toEqual([5, 10, 20, 30]);
      expect(s.settings.budgetMinutes).toBe(90);
    }
  });

  it("has no domain rules or allowed links, even if the stored text has some", () => {
    const s = parseStored(JSON.stringify({ domainRules: [{ pattern: "youtube.com", tag: "entertainment" }], allowUrls: [{ kind: "domain" }] }), "p");
    expect(s.domainRules).toEqual([]);
    expect(s.allowUrls).toEqual([]);
    expect(parseStored(null, "p").domainRules).toEqual([]);
  });

  it("keeps good values and repairs bad ones", () => {
    const raw = {
      profileId: "mine",
      settings: { lockSeconds: [1, 2, 3, 4], budgetMinutes: 45, allowOptionsNormal: [], allowOptionsRestricted: "x" },
      events: [{ id: "a", object: "Zalo" }, { nope: true }, null],
      riskWindows: [{ id: "r", days: [1, 2], start: "20:00", end: "22:00" }, { id: "bad", days: [], start: "x", end: "y" }],
      pendingCloses: [{ eventId: "a", closedAt: 5 }, { eventId: 3 }],
    };
    const s = parseStored(JSON.stringify(raw), "p");
    expect(s.profileId).toBe("mine");
    expect(s.settings.lockSeconds).toEqual([1, 2, 3, 4]);
    expect(s.settings.budgetMinutes).toBe(45);
    expect(s.settings.allowOptionsNormal).toEqual([5, 15, 30]);
    expect(s.settings.allowOptionsRestricted).toEqual([5, 10]);
    expect(s.events.map((e) => e.id)).toEqual(["a"]);
    expect(s.riskWindows.map((w) => w.id)).toEqual(["r"]);
    expect(s.pendingCloses).toEqual([{ eventId: "a", closedAt: 5 }]);
  });
});

describe("Store", () => {
  it("starts empty, saves updates and reads them back in a new Store", () => {
    const kv = new MemoryKV();
    const a = new Store(kv, newId);
    expect(a.read().events).toEqual([]);
    a.update((d) => {
      d.settings.budgetMinutes = 30;
    });
    expect(kv.data.has(STORAGE_KEY)).toBe(true);
    expect(new Store(kv, newId).read().settings.budgetMinutes).toBe(30);
  });

  it("returns copies: changing a read state changes nothing", () => {
    const store = new Store(new MemoryKV(), newId);
    store.read().settings.budgetMinutes = 1;
    expect(store.read().settings.budgetMinutes).toBe(90);
  });

  it("does not save when the update throws", () => {
    const kv = new MemoryKV();
    const store = new Store(kv, newId);
    expect(() =>
      store.update((d) => {
        d.settings.budgetMinutes = 1;
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(kv.data.has(STORAGE_KEY)).toBe(false);
  });

  it("two stores on the same storage (two tabs) do not overwrite each other", () => {
    const kv = new MemoryKV();
    const tab1 = new Store(kv, newId);
    const tab2 = new Store(kv, newId);
    tab1.update((d) => {
      d.settings.budgetMinutes = 10;
    });
    tab2.update((d) => {
      d.settings.lockSeconds = [9, 9, 9, 9];
    });
    const s = tab1.read();
    expect(s.settings.budgetMinutes).toBe(10);
    expect(s.settings.lockSeconds).toEqual([9, 9, 9, 9]);
  });

  it("keeps the profile id once it has been saved", () => {
    const kv = new MemoryKV();
    const a = new Store(kv, newId);
    const id = a.update((d) => d.profileId);
    expect(new Store(kv, newId).read().profileId).toBe(id);
  });

  it("works in memory when there is no storage", () => {
    const store = new Store(null, newId);
    expect(store.persistent).toBe(false);
    store.update((d) => {
      d.settings.budgetMinutes = 15;
    });
    expect(store.read().settings.budgetMinutes).toBe(15);
  });

  it("falls back to memory when writes fail, and says so", () => {
    const kv = new MemoryKV();
    const store = new Store(kv, newId);
    store.update((d) => {
      d.settings.budgetMinutes = 20;
    });
    kv.failWrites = true;
    store.update((d) => {
      d.settings.budgetMinutes = 25;
    });
    expect(store.persistent).toBe(false);
    expect(store.read().settings.budgetMinutes).toBe(25);
  });

  it("survives reads that throw", () => {
    const kv = new MemoryKV();
    const store = new Store(kv, newId);
    kv.failReads = true;
    expect(store.read().events).toEqual([]);
    expect(store.persistent).toBe(false);
  });

  it("keeps unreadable text aside instead of silently destroying it", () => {
    const kv = new MemoryKV();
    kv.data.set(STORAGE_KEY, "{broken");
    const store = new Store(kv, newId);
    expect(store.read().events).toEqual([]);
    expect(kv.data.get(CORRUPT_KEY)).toBe("{broken");
  });
});
