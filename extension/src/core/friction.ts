import { isBlockedTag, type Tag } from "./types";

export type ChangeKind = "weaken" | "ok";

export type NumberField = "lockSeconds" | "budgetMinutes" | "delaySeconds";

export const CONFIRM_PHRASE = "tôi chọn giảm bảo vệ";
export const CONFIRM_WAIT_SECONDS = 60;

/** Untagging entertainment/game, or moving entertainment to game (which adds a delay), weakens protection. */
export function classifyTagChange(oldTag: Tag | null, newTag: Tag | null): ChangeKind {
  if (isBlockedTag(oldTag) && !isBlockedTag(newTag)) return "weaken";
  if (oldTag === "entertainment" && newTag === "game") return "weaken";
  return "ok";
}

export function classifyNumberChange(field: NumberField, oldValue: number, newValue: number): ChangeKind {
  switch (field) {
    case "lockSeconds":
      return newValue < oldValue ? "weaken" : "ok";
    case "budgetMinutes":
      if (oldValue <= 0) return "ok";
      return newValue <= 0 || newValue > oldValue ? "weaken" : "ok";
    case "delaySeconds":
      return newValue > oldValue ? "weaken" : "ok";
  }
}

export function isConfirmPhrase(input: string): boolean {
  return input.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ") === CONFIRM_PHRASE;
}
