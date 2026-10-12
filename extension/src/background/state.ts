import {
  DEFAULT_SETTINGS,
  isTag,
  type AllowEntry,
  type DomainRule,
  type Session,
  type Settings,
  type StudyRule,
  type Tag,
} from "../core";

export type Decision = "enter" | "exit" | "alternative";

export interface WarningEvent {
  /** Also the warning page instance id, so a reload of the same warning keeps its event. */
  id: string;
  /** The domain rule pattern that matched, e.g. "youtube.com". Allow windows are granted per object. */
  object: string;
  tag: Tag;
  url: string;
  level: number;
  lockSeconds: number;
  /** Warnings shown in the previous hour, not counting this one. */
  n: number;
  shownAt: number;
  studyLabel: string | null;
  decision: Decision | null;
  decidedAt: number | null;
  allowMinutes: number | null;
  activity: string | null;
  activityMinutes: number | null;
}

export interface AllowWindow {
  object: string;
  expiresAt: number;
  headsUpSent: boolean;
}

export interface State {
  schema: 1;
  profileId: string;
  protectionEnabled: boolean;
  domainRules: DomainRule[];
  allowUrls: AllowEntry[];
  settings: Settings;
  allowWindows: AllowWindow[];
  events: WarningEvent[];
  /** dayKey -> tag -> seconds of active use. */
  usage: Record<string, Record<string, number>>;
  study: { manual: Session[]; rules: StudyRule[] };
  lastTickAt: number | null;
}

export const DEFAULT_DOMAIN_RULES: DomainRule[] = [
  { pattern: "youtube.com", tag: "entertainment" },
  { pattern: "facebook.com", tag: "entertainment" },
  { pattern: "tiktok.com", tag: "entertainment" },
];

export const DOMAIN_SUGGESTIONS = [
  "youtube.com",
  "facebook.com",
  "tiktok.com",
  "instagram.com",
  "x.com",
  "reddit.com",
  "netflix.com",
  "twitch.tv",
  "pinterest.com",
  "9gag.com",
];

export const ACTIVITIES = ["Nhảy dây", "Hít đất", "Đọc sách"] as const;

export function initialState(profileId: string): State {
  return {
    schema: 1,
    profileId,
    protectionEnabled: true,
    domainRules: DEFAULT_DOMAIN_RULES.map((r) => ({ ...r })),
    allowUrls: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    allowWindows: [],
    events: [],
    usage: {},
    study: { manual: [], rules: [] },
    lastTickAt: null,
  };
}

function isNumberArray(value: unknown, length?: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((x) => typeof x === "number" && Number.isFinite(x)) &&
    (length === undefined || value.length === length)
  );
}

/** Accepts whatever is in storage and fills in anything missing or malformed with defaults. */
export function migrateState(raw: unknown, profileId: string): State {
  const base = initialState(profileId);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<State>;
  const settings: Settings = { ...base.settings };
  if (r.settings && typeof r.settings === "object") {
    const s = r.settings as Partial<Settings>;
    if (isNumberArray(s.lockSeconds, 4)) settings.lockSeconds = s.lockSeconds;
    if (isNumberArray(s.allowOptionsNormal) && s.allowOptionsNormal.length) settings.allowOptionsNormal = s.allowOptionsNormal;
    if (isNumberArray(s.allowOptionsRestricted) && s.allowOptionsRestricted.length)
      settings.allowOptionsRestricted = s.allowOptionsRestricted;
    if (typeof s.budgetMinutes === "number" && Number.isFinite(s.budgetMinutes)) settings.budgetMinutes = s.budgetMinutes;
    if (s.tagDelays && typeof s.tagDelays === "object") settings.tagDelays = { ...s.tagDelays };
  }
  return {
    schema: 1,
    profileId: typeof r.profileId === "string" && r.profileId ? r.profileId : profileId,
    protectionEnabled: typeof r.protectionEnabled === "boolean" ? r.protectionEnabled : true,
    domainRules: Array.isArray(r.domainRules)
      ? r.domainRules.filter((d) => d && typeof d.pattern === "string" && isTag(d.tag))
      : base.domainRules,
    allowUrls: Array.isArray(r.allowUrls) ? r.allowUrls.filter((a) => a && typeof a.kind === "string") : [],
    settings,
    allowWindows: Array.isArray(r.allowWindows) ? r.allowWindows.filter((w) => w && typeof w.object === "string") : [],
    events: Array.isArray(r.events) ? r.events.filter((e) => e && typeof e.id === "string") : [],
    usage: r.usage && typeof r.usage === "object" ? r.usage : {},
    study: {
      manual: Array.isArray(r.study?.manual) ? r.study.manual : [],
      rules: Array.isArray(r.study?.rules) ? r.study.rules : [],
    },
    lastTickAt: typeof r.lastTickAt === "number" ? r.lastTickAt : null,
  };
}
