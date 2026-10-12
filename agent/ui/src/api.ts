// Typed wrappers over the agent's Rust commands (src-tauri/src/commands.rs).
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AllowEntry, Tag } from "@core";

export type ErrorCode = "invalid" | "needs-confirm" | "study-locked" | "unknown-event" | "already-decided" | "locked";

export interface CmdError {
  code: ErrorCode;
  message: string;
}

export function isCmdError(e: unknown): e is CmdError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

export interface BudgetView {
  usedMinutes: number;
  budgetMinutes: number;
  remainingMinutes: number | null;
  over: boolean;
}

export interface StudyStatus {
  active: boolean;
  source: string | null;
  label: string | null;
  endsAt: number | null;
}

export interface ExtensionInfo {
  profileId: string | null;
  extVersion: string | null;
  compatible: boolean;
  lastSeen: number;
}

export interface Overview {
  version: string;
  protectionEnabled: boolean;
  warningsToday: number;
  exitsToday: number;
  budget: BudgetView;
  study: StudyStatus;
  extensions: ExtensionInfo[];
  hostRegistered: boolean;
  hostMissing: boolean;
  autostart: boolean;
}

export interface AppRow {
  exe: string;
  name: string;
  path: string | null;
  tag: Tag | null;
  delaySeconds: number | null;
  effectiveDelay: number;
}

export interface Rule {
  id: string;
  kind: string;
  pattern: string;
  tag: Tag;
  delaySeconds: number | null;
  updatedAt: number;
}

export interface SitesView {
  domainRules: Rule[];
  allowUrls: AllowEntry[];
}

export interface Settings {
  lockSeconds: number[];
  allowOptionsNormal: number[];
  allowOptionsRestricted: number[];
  budgetMinutes: number;
  tagDelays: Record<string, number>;
}

export interface WarningContext {
  eventId: string;
  appName: string;
  object: string;
  level: number;
  lockSeconds: number;
  allowOptions: number[];
  countThisHour: number;
  shownAt: number;
  budget: BudgetView;
  study: StudyStatus;
  activities: string[];
}

export interface Toast {
  id: number;
  title: string;
  body: string;
  action: string | null;
}

export const api = {
  overview: () => invoke<Overview>("get_overview"),
  listApps: () => invoke<AppRow[]>("list_apps"),
  rescanApps: () => invoke<number>("rescan_apps"),
  setAppTag: (exe: string, tag: Tag | null, confirmed: boolean) => invoke<void>("set_app_tag", { exe, tag, confirmed }),
  setAppDelay: (exe: string, delay: number | null, confirmed: boolean) =>
    invoke<void>("set_app_delay", { exe, delay, confirmed }),
  listSites: () => invoke<SitesView>("list_sites"),
  setSiteTag: (pattern: string, tag: Tag | null, confirmed: boolean) =>
    invoke<void>("set_site_tag", { pattern, tag, confirmed }),
  addAllowUrl: (entry: AllowEntry, confirmed: boolean) => invoke<void>("add_allow_url", { entry, confirmed }),
  removeAllowUrl: (entry: AllowEntry) => invoke<void>("remove_allow_url", { entry }),
  settings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings, confirmed: boolean) => invoke<void>("save_settings", { settings, confirmed }),
  setProtection: (enabled: boolean, confirmed: boolean) => invoke<void>("set_protection", { enabled, confirmed }),
  clearLog: (confirmed: boolean) => invoke<void>("clear_log", { confirmed }),
  setAutostart: (enabled: boolean, confirmed: boolean) => invoke<void>("set_autostart", { enabled, confirmed }),
  registerHost: () => invoke<string>("register_host"),
  warningCurrent: () => invoke<WarningContext | null>("warning_current"),
  warningDecide: (args: {
    eventId: string;
    decision: "enter" | "exit" | "alternative";
    allowMinutes?: number;
    activity?: string;
    activityMinutes?: number;
  }) => invoke<void>("warning_decide", args),
  toastCurrent: () => invoke<Toast | null>("toast_current"),
  toastDismiss: (open: string | null) => invoke<void>("toast_dismiss", { open }),
  quitAgent: (confirmed: boolean) => invoke<void>("quit_agent", { confirmed }),
};

export function onEvent<T>(name: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  return listen<T>(name, (e) => handler(e.payload));
}
