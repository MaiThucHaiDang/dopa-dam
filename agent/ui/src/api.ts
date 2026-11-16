// Typed wrappers over the agent's Rust commands (src-tauri/src/commands.rs).
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AllowEntry, StudyRule, Tag } from "@core";

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

export interface PlatformInfo {
  os: "windows" | "linux";
  sessionType: "wayland" | "x11" | null;
  focusBackend: "win32" | "gnome-shell" | "x11" | "none";
  shellExtensionConnected: boolean;
}

/** What to assume when get_platform is missing (older backend): the original Windows-only agent. */
export const FALLBACK_PLATFORM: PlatformInfo = {
  os: "windows",
  sessionType: null,
  focusBackend: "win32",
  shellExtensionConnected: false,
};

/** One line for the Overview page: where the foreground-window information comes from. */
export function describeFocusSource(p: PlatformInfo): { ok: boolean; text: string } {
  if (p.focusBackend === "gnome-shell") {
    return p.shellExtensionConnected
      ? { ok: true, text: "Đã nối với GNOME Shell qua tiện ích DopaDam. Chương trình giải trí được canh bình thường." }
      : { ok: false, text: "Đang chờ tiện ích DopaDam của GNOME Shell kết nối. Chưa canh được chương trình trên máy tính." };
  }
  if (p.focusBackend === "x11") return { ok: true, text: "Đang theo dõi cửa sổ qua X11. Chương trình giải trí được canh bình thường." };
  if (p.focusBackend === "win32") return { ok: true, text: "Đang theo dõi cửa sổ đang ở phía trước." };
  return { ok: false, text: "Chưa có nguồn nào cho biết cửa sổ đang ở phía trước nên DopaDam chưa canh được chương trình trên máy tính." };
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

export interface DayStat {
  day: string;
  enter: number;
  exit: number;
  alternative: number;
  exitSecondsSum: number;
  exitCount: number;
  studyWarnings: number;
  minutes: Record<string, number>;
}

export interface AccountStatus {
  configured: boolean;
  signedIn: boolean;
  email: string | null;
  lastSync: number | null;
  syncing: boolean;
  lastError: string | null;
}

export interface StudyView {
  status: StudyStatus;
  rules: StudyRule[];
  today: string;
}

export interface DeviceRow {
  platform: string;
  name: string;
  version: string;
  lastSeen: number;
  thisDevice: boolean;
}

export const api = {
  overview: () => invoke<Overview>("get_overview"),
  getPlatform: () => invoke<PlatformInfo>("get_platform"),
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
  stats: (days: number) => invoke<DayStat[]>("get_stats", { days }),
  account: () => invoke<AccountStatus>("account_status"),
  signIn: (email: string, password: string) => invoke<void>("account_sign_in", { email, password }),
  signUp: (email: string, password: string) => invoke<"signed-in" | "confirm-email">("account_sign_up", { email, password }),
  signInGoogle: () => invoke<void>("account_google"),
  signOut: () => invoke<void>("account_sign_out"),
  syncNow: () => invoke<{ pushed: number; pulled: number; changed: number }>("sync_now"),
  devices: () => invoke<DeviceRow[]>("account_devices"),
  deleteServerData: (confirmed: boolean) => invoke<void>("delete_server_data", { confirmed }),
  study: () => invoke<StudyView>("get_study"),
  startStudy: (minutes: number, label: string | null) => invoke<void>("start_study", { minutes, label }),
  stopStudy: (confirmed: boolean) => invoke<void>("stop_study", { confirmed }),
  setStudyRule: (rule: StudyRule, confirmed: boolean) => invoke<void>("set_study_rule", { rule, confirmed }),
  deleteStudyRule: (id: string, confirmed: boolean) => invoke<void>("delete_study_rule", { id, confirmed }),
};

export function onEvent<T>(name: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  return listen<T>(name, (e) => handler(e.payload));
}
