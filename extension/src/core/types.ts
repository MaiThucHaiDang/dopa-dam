export type Tag = "entertainment" | "game" | "work" | "study" | "communication" | "utility" | "ignore";

export const TAGS: readonly Tag[] = ["entertainment", "game", "work", "study", "communication", "utility", "ignore"];

export const TAG_LABELS: Record<Tag, string> = {
  entertainment: "Giải trí",
  game: "Game",
  work: "Công việc",
  study: "Học tập",
  communication: "Liên lạc",
  utility: "Tiện ích",
  ignore: "Không theo dõi",
};

export function isTag(value: unknown): value is Tag {
  return typeof value === "string" && (TAGS as readonly string[]).includes(value);
}

/** Tags that trigger a warning. Game behaves like entertainment except for its default delay. */
export function isBlockedTag(tag: Tag | null | undefined): boolean {
  return tag === "entertainment" || tag === "game";
}

export interface FrictionSettings {
  /** Seconds the Enter button stays locked, indexed by level 0..3. */
  lockSeconds: number[];
  allowOptionsNormal: number[];
  allowOptionsRestricted: number[];
}

export interface Settings extends FrictionSettings {
  /** Daily entertainment budget in minutes; <= 0 disables it. */
  budgetMinutes: number;
  /** Default warning delay per tag, in seconds (used by Android and the agent). */
  tagDelays: Partial<Record<Tag, number>>;
}

export const DEFAULT_SETTINGS: Settings = {
  lockSeconds: [5, 10, 20, 30],
  allowOptionsNormal: [5, 15, 30],
  allowOptionsRestricted: [5, 10],
  budgetMinutes: 90,
  tagDelays: { game: 30 },
};
