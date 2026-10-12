// Messages between extension pages (warning, options, popup) and the background service worker.
import type { AllowEntry, DomainRule, Settings, StudyRule, StudyStatus, Tag } from "../core";
import type { BudgetView, ErrorCode } from "../background/logic";
import type { Decision } from "../background/state";

export type Request =
  | { type: "warning:init"; eventId: string; url: string }
  | {
      type: "warning:decide";
      eventId: string;
      decision: Decision;
      allowMinutes?: number;
      activity?: string;
      activityMinutes?: number;
    }
  | { type: "options:get" }
  | { type: "options:setDomainRule"; pattern: string; tag: Tag | null; confirmed: boolean }
  | { type: "options:addAllowUrl"; text: string; confirmed: boolean }
  | { type: "options:removeAllowUrl"; entry: AllowEntry }
  | { type: "options:setFriction"; lockSeconds: number[]; budgetMinutes: number; confirmed: boolean }
  | { type: "options:setProtection"; enabled: boolean; confirmed: boolean }
  | { type: "options:clearLog"; confirmed: boolean }
  | { type: "study:start"; minutes: number; label: string }
  | { type: "study:stop"; confirmed: boolean }
  | { type: "study:setRules"; rules: StudyRule[]; confirmed: boolean }
  | { type: "popup:get" };

export type Failure = { ok: false; error: ErrorCode | "agent" };

export type WarningInit =
  | { ok: true; skip: true }
  | {
      ok: true;
      skip: false;
      eventId: string;
      host: string;
      object: string;
      tag: Tag;
      level: number;
      lockSeconds: number;
      allowOptions: number[];
      /** How many times this hour, counting this one. */
      countThisHour: number;
      /** Milliseconds since the warning was first shown (non-zero after a reload). */
      elapsedMs: number;
      budget: BudgetView;
      study: StudyStatus;
      activities: string[];
      /** Set when this warning was already decided (the page was reloaded). */
      decision: Decision | null;
      activity: string | null;
      activityEndsAt: number | null;
    };

export type DecideResponse =
  | { ok: true; action: "navigate"; url: string }
  | { ok: true; action: "closed" }
  | { ok: true; action: "timer"; endsAt: number }
  | Failure;

export interface OptionsView {
  ok: true;
  protectionEnabled: boolean;
  domainRules: DomainRule[];
  allowUrls: AllowEntry[];
  settings: Settings;
  suggestions: string[];
  study: StudyStatus;
  studyRules: StudyRule[];
  agent: AgentStatus;
}

export interface AgentStatus {
  connected: boolean;
  /** Set when the agent answered but speaks an incompatible protocol version. */
  incompatible: boolean;
  agentVersion: string | null;
}

export interface PopupView {
  ok: true;
  protectionEnabled: boolean;
  warningsToday: number;
  exitsToday: number;
  budget: BudgetView;
  study: StudyStatus;
  agent: AgentStatus;
}

export type SimpleResponse = { ok: true } | Failure;

export function sendRequest<T>(request: Request): Promise<T> {
  return chrome.runtime.sendMessage(request) as Promise<T>;
}

export const ERROR_TEXT: Record<ErrorCode | "agent", string> = {
  invalid: "Giá trị không hợp lệ.",
  "needs-confirm": "Thay đổi này làm yếu bảo vệ nên cần xác nhận.",
  "study-locked": "Đang trong phiên học nên không chỉnh được.",
  "unknown-event": "Không tìm thấy lần chặn này.",
  "already-decided": "Lần chặn này đã có quyết định.",
  locked: "Nút Vào vẫn đang bị khóa.",
  agent: "Agent DopaDam không phản hồi.",
};
