// Connection to the DopaDam agent on Windows through native messaging (docs/thiet-ke-ky-thuat.md, section 3).
// While connected the agent is the source of truth: counts, allow windows and settings live there,
// and the extension mirrors the agent's configuration so it keeps blocking if the agent goes away.
import type { AllowEntry, DomainRule, Settings, StudyStatus } from "../core";
import type { BudgetView } from "./logic";
import type { AllowWindow } from "./state";
import type { AgentStatus } from "../shared/messages";

declare const __DOPADAM_VERSION__: string;
declare const __DOPADAM_PROTOCOL__: number;

export const HOST_NAME = "com.dang.dopadam";
const REQUEST_TIMEOUT_MS = 2500;

export interface AgentConfig {
  type: "config";
  domainRules: DomainRule[];
  allowUrls: AllowEntry[];
  settings: Settings;
  allowWindows: AllowWindow[];
  study: StudyStatus;
  budget: BudgetView;
  protectionEnabled: boolean;
  summary: { warningsToday: number; exitsToday: number };
}

export interface WarningContext {
  type: "warning_context";
  requestId: string;
  skip: boolean;
  eventId?: string;
  level?: number;
  lockSeconds?: number;
  allowOptions?: number[];
  n?: number;
  shownAt?: number;
  decision?: "enter" | "exit" | "alternative" | null;
  budget?: BudgetView;
  study?: StudyStatus;
  activities?: string[];
}

export interface AgentResult {
  type: "result";
  requestId: string;
  ok: boolean;
  error?: string;
}

type Incoming =
  | { type: "welcome"; protocol: number; agentVersion: string; compatible: boolean }
  | { type: "agent_offline" }
  | AgentConfig
  | WarningContext
  | AgentResult;

export class AgentBridge {
  private port: chrome.runtime.Port | null = null;
  private pending = new Map<string, (msg: Incoming | null) => void>();
  status: AgentStatus = { connected: false, incompatible: false, agentVersion: null };
  config: AgentConfig | null = null;

  constructor(private readonly onConfig: (config: AgentConfig) => Promise<void>) {}

  get connected(): boolean {
    return this.status.connected && this.port !== null;
  }

  /** Opens the connection if it is not open; safe to call often. */
  connect(profileId: string): void {
    if (this.port) return;
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch {
      return;
    }
    this.port = port;
    port.onMessage.addListener((msg: Incoming) => void this.handle(msg));
    port.onDisconnect.addListener(() => {
      // Reading lastError marks it as handled (host missing, agent not running…).
      void chrome.runtime.lastError;
      this.port = null;
      this.status = { connected: false, incompatible: this.status.incompatible, agentVersion: this.status.agentVersion };
      for (const resolve of this.pending.values()) resolve(null);
      this.pending.clear();
    });
    port.postMessage({ type: "hello", protocol: __DOPADAM_PROTOCOL__, extVersion: __DOPADAM_VERSION__, profileId });
  }

  private async handle(msg: Incoming): Promise<void> {
    switch (msg.type) {
      case "welcome":
        this.status = { connected: msg.compatible, incompatible: !msg.compatible, agentVersion: msg.agentVersion };
        return;
      case "agent_offline":
        this.status = { connected: false, incompatible: false, agentVersion: null };
        return;
      case "config":
        this.config = msg;
        await this.onConfig(msg);
        return;
      case "warning_context":
      case "result": {
        const resolve = this.pending.get(msg.requestId);
        if (resolve) {
          this.pending.delete(msg.requestId);
          resolve(msg);
        }
        return;
      }
    }
  }

  send(message: Record<string, unknown>): void {
    if (!this.connected) return;
    try {
      this.port?.postMessage(message);
    } catch {
      // The port closed between the check and the call.
    }
  }

  /** Sends a request and waits for the matching reply; null if the agent is not there or too slow. */
  request<T extends Incoming>(message: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T | null> {
    if (!this.connected || !this.port) return Promise.resolve(null);
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(null);
      }, timeoutMs);
      this.pending.set(requestId, (msg) => {
        clearTimeout(timer);
        resolve(msg as T | null);
      });
      try {
        this.port!.postMessage({ ...message, requestId });
      } catch {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve(null);
      }
    });
  }
}
