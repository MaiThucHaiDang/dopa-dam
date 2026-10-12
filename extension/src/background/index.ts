// Background service worker: owns the state, keeps the blocking rules in sync and answers the pages.
// With the Windows agent connected, counts, decisions and settings go through the agent and the local
// state mirrors the agent's configuration; without it, everything runs here.
import {
  dayKey,
  isAllowedUrl,
  localTzOffset,
  matchDomainRule,
  normalizeDomainInput,
  parseAllowUrl,
  type AllowEntry,
  type StudyStatus,
} from "../core";
import type {
  DecideResponse,
  Failure,
  OptionsView,
  PopupView,
  Request,
  SimpleResponse,
  WarningInit,
} from "../shared/messages";
import { AgentBridge, type AgentConfig, type AgentResult, type WarningContext } from "./agent";
import * as L from "./logic";
import { buildDnrRules } from "./rules";
import { ACTIVITIES, DOMAIN_SUGGESTIONS, type AllowWindow, type State, type WarningEvent } from "./state";
import { readState, updateState } from "./store";

const WARNING_PAGE = chrome.runtime.getURL("warning.html");
const BLANK_PAGE = chrome.runtime.getURL("blank.html");
const EXTENSION_ORIGIN = chrome.runtime.getURL("");
const ICON = chrome.runtime.getURL("icons/icon-128.png");
/** A warning page that reconnects within this time (reload) is not counted as closed. */
const AUTO_EXIT_DELAY_MS = 3000;
const TICK_ALARM = "tick";

function clock() {
  const now = Date.now();
  return { now, tz: localTzOffset(now) };
}

function warningUrlFor(target: string): string {
  return `${WARNING_PAGE}#${target}`;
}

// ---- Agent -----------------------------------------------------------------

/** Mirrors the agent's configuration so blocking keeps working if the agent disappears. */
async function mirrorAgentConfig(cfg: AgentConfig): Promise<void> {
  const windows = await updateState((d) => {
    d.domainRules = cfg.domainRules;
    d.allowUrls = cfg.allowUrls;
    d.settings = { ...d.settings, ...cfg.settings };
    d.protectionEnabled = cfg.protectionEnabled;
    // Website allow windows live in the agent; programs' windows (*.exe) are not ours.
    d.allowWindows = cfg.allowWindows.filter((w) => !w.object.endsWith(".exe"));
    return d.allowWindows;
  });
  await applyRules();
  for (const w of windows) scheduleWindowAlarms(w);
}

const agent = new AgentBridge(mirrorAgentConfig);

async function ensureAgent(): Promise<void> {
  if (!agent.connected) agent.connect((await readState()).profileId);
}

function agentFailure(res: AgentResult | null): Failure | null {
  if (res === null) return { ok: false, error: "agent" };
  return res.ok ? null : { ok: false, error: (res.error as Failure["error"]) ?? "invalid" };
}

// ---- Blocking rules --------------------------------------------------------

let rulesQueue: Promise<void> = Promise.resolve();

function applyRules(): Promise<void> {
  const run = rulesQueue.then(async () => {
    const state = await readState();
    const addRules = buildDnrRules(L.interceptConfig(state), Date.now(), WARNING_PAGE);
    const removeRuleIds = (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  });
  rulesQueue = run.catch((err) => console.error("DopaDam: could not apply rules", err));
  return rulesQueue;
}

/** Catches what declarativeNetRequest cannot see: in-page navigation (YouTube) and back/forward cache. */
async function onNavigation(tabId: number, url: string, frameId: number): Promise<void> {
  if (frameId !== 0 || tabId < 0 || url.startsWith(EXTENSION_ORIGIN)) return;
  const state = await readState();
  if (L.evaluateUrl(L.interceptConfig(state), url, Date.now()).intercept) {
    await chrome.tabs.update(tabId, { url: warningUrlFor(url) });
  }
}

// ---- Allow windows ---------------------------------------------------------

function scheduleWindowAlarms(window: AllowWindow): void {
  chrome.alarms.create(`expire|${window.object}`, { when: window.expiresAt });
  const headsUpAt = window.expiresAt - 60_000;
  if (!window.headsUpSent && headsUpAt > Date.now()) {
    chrome.alarms.create(`headsup|${window.object}`, { when: headsUpAt });
  }
}

async function headsUp(object: string): Promise<void> {
  const due = await updateState((d) => {
    const w = d.allowWindows.find((x) => x.object === object);
    if (!w || w.headsUpSent) return false;
    w.headsUpSent = true;
    return true;
  });
  if (!due) return;
  chrome.notifications.create(`headsup|${object}|${Date.now()}`, {
    type: "basic",
    iconUrl: ICON,
    title: "Còn 1 phút",
    message: `Khoảng được phép cho ${object} sắp hết. Hết giờ sẽ hiện lại màn hình cảnh báo.`,
    priority: 1,
  });
}

/** Ends expired windows; tabs still on those sites get the warning again, as a new interception. */
async function expireWindows(): Promise<void> {
  const now = Date.now();
  const expired = await updateState((d) => L.takeExpiredWindows(d, now));
  if (!expired.length) return;
  await applyRules();
  const cfg = L.interceptConfig(await readState());
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url) continue;
    const ev = L.evaluateUrl(cfg, tab.url, now);
    if (ev.intercept && expired.includes(ev.object)) await chrome.tabs.update(tab.id, { url: warningUrlFor(tab.url) });
  }
}

// ---- Usage sampling --------------------------------------------------------

/** Every minute, attribute the elapsed time to the site of the active tab of the focused window. */
async function tick(): Promise<void> {
  const { now, tz } = clock();
  void ensureAgent();
  let url: string | null = null;
  try {
    const [win, idle] = await Promise.all([chrome.windows.getLastFocused({ populate: true }), chrome.idle.queryState(120)]);
    const tab = win.tabs?.find((t) => t.active);
    const watching = idle === "active" || (idle === "idle" && tab?.audible === true);
    if (win.focused && win.state !== "minimized" && watching && tab?.url) url = tab.url;
  } catch {
    // No browser window has focus (e.g. all minimized).
  }
  const viaAgent = agent.connected;
  const sample = await updateState((d) => {
    const last = d.lastTickAt;
    d.lastTickAt = now;
    L.prune(d, now, tz);
    if (!url || last === null || now <= last) return null;
    const seconds = Math.min(now - last, 120_000) / 1000;
    if (viaAgent) return { seconds };
    const tag = usageTag(d, url);
    if (tag) L.addUsage(d, dayKey(now, tz), tag, seconds);
    return null;
  });
  if (sample && url) {
    try {
      agent.send({ type: "usage", domain: new URL(url).hostname, url, seconds: sample.seconds });
    } catch {
      // Not a URL with a host.
    }
  }
  await expireWindows();
}

function usageTag(state: State, url: string): string | null {
  if (isAllowedUrl(url, state.allowUrls)) return "study";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const tag = matchDomainRule(parsed.hostname, state.domainRules)?.tag ?? null;
    return tag === "ignore" ? null : tag;
  } catch {
    return null;
  }
}

// ---- Warning page ----------------------------------------------------------

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function warningView(state: State, event: WarningEvent, now: number, tz: number): WarningInit {
  return {
    ok: true,
    skip: false,
    eventId: event.id,
    host: hostOf(event.url),
    object: event.object,
    tag: event.tag,
    level: event.level,
    lockSeconds: event.lockSeconds,
    allowOptions: L.allowOptionsFor(state, event.level),
    countThisHour: event.n + 1,
    elapsedMs: Math.max(0, now - event.shownAt),
    budget: L.budgetView(state, now, tz),
    study: L.studyStatus(state, now, tz),
    activities: [...ACTIVITIES],
    decision: event.decision,
    activity: event.activity,
    activityEndsAt:
      event.decision === "alternative" && event.decidedAt !== null && event.activityMinutes !== null
        ? event.decidedAt + event.activityMinutes * 60_000
        : null,
  };
}

/** Asks the agent for the warning (it counts across the computer); null means "do it locally". */
async function agentWarning(eventId: string, url: string, object: string, tag: WarningEvent["tag"]): Promise<WarningInit | null> {
  const ctx = await agent.request<WarningContext>({ type: "warning_request", eventId, object, url });
  if (!ctx) return null;
  if (ctx.skip || ctx.level === undefined || ctx.shownAt === undefined) return { ok: true, skip: true };
  const now = Date.now();
  const event = await updateState((d) => {
    let e = d.events.find((x) => x.id === eventId);
    if (!e) {
      e = {
        id: eventId,
        object,
        tag,
        url,
        level: ctx.level!,
        lockSeconds: ctx.lockSeconds!,
        n: ctx.n ?? 0,
        shownAt: ctx.shownAt!,
        studyLabel: ctx.study?.active ? ctx.study.label : null,
        decision: ctx.decision ?? null,
        decidedAt: null,
        allowMinutes: null,
        activity: null,
        activityMinutes: null,
      };
      d.events.push(e);
    }
    return e;
  });
  if (event.decision === "enter") return { ok: true, skip: true };
  return {
    ok: true,
    skip: false,
    eventId,
    host: hostOf(url),
    object,
    tag,
    level: ctx.level,
    lockSeconds: ctx.lockSeconds!,
    allowOptions: ctx.allowOptions ?? [],
    countThisHour: (ctx.n ?? 0) + 1,
    elapsedMs: Math.max(0, now - ctx.shownAt),
    budget: ctx.budget!,
    study: ctx.study!,
    activities: ctx.activities ?? [...ACTIVITIES],
    decision: event.decision,
    activity: event.activity,
    activityEndsAt:
      event.decision === "alternative" && event.decidedAt !== null && event.activityMinutes !== null
        ? event.decidedAt + event.activityMinutes * 60_000
        : null,
  };
}

async function initWarning(eventId: string, url: string): Promise<WarningInit> {
  const { now, tz } = clock();
  const state = await readState();
  const existing = state.events.find((e) => e.id === eventId);
  const ev = L.evaluateUrl(L.interceptConfig(state), url, now);
  if (agent.connected && (existing || ev.intercept)) {
    const object = existing?.object ?? (ev.intercept ? ev.object : "");
    const tag = existing?.tag ?? (ev.intercept ? ev.tag : "entertainment");
    const viaAgent = await agentWarning(eventId, url, object, tag);
    if (viaAgent) return viaAgent;
  }
  if (existing) {
    return existing.decision === "enter" ? { ok: true, skip: true } : warningView(state, existing, now, tz);
  }
  if (!ev.intercept) return { ok: true, skip: true };
  const event = await updateState((d) =>
    L.recordWarning(d, { id: eventId, object: ev.object, tag: ev.tag, url, now, tz }),
  );
  return warningView(await readState(), event, now, tz);
}

async function closeOrBlank(tabId: number, windowId: number): Promise<void> {
  const tabs = await chrome.tabs.query({ windowId });
  if (tabs.length > 1) await chrome.tabs.remove(tabId);
  else await chrome.tabs.update(tabId, { url: BLANK_PAGE });
}

async function decide(
  msg: Extract<Request, { type: "warning:decide" }>,
  sender: chrome.runtime.MessageSender,
): Promise<DecideResponse> {
  const now = Date.now();
  if (agent.connected) {
    const failure = agentFailure(
      await agent.request<AgentResult>({
        type: "decision",
        eventId: msg.eventId,
        decision: msg.decision,
        allowMinutes: msg.allowMinutes,
        activity: msg.activity,
        activityMinutes: msg.activityMinutes,
      }),
    );
    if (failure && failure.error !== "agent") return failure;
  }
  // Applied locally too, so the allow window works right away (the agent's config follows).
  const result = await updateState((d) => L.applyDecision(d, msg.eventId, msg, now));
  if (!result.ok) return result;
  cancelAutoExit(msg.eventId);
  const event = result.event;
  switch (event.decision) {
    case "enter":
      if (result.window) {
        await applyRules();
        scheduleWindowAlarms(result.window);
      }
      return { ok: true, action: "navigate", url: event.url };
    case "alternative": {
      const endsAt = (event.decidedAt ?? now) + (event.activityMinutes ?? 0) * 60_000;
      chrome.alarms.create(`alt|${event.id}`, { when: endsAt });
      return { ok: true, action: "timer", endsAt };
    }
    default: {
      const tab = sender.tab;
      // Answer first; closing the tab would otherwise drop the response.
      if (tab?.id !== undefined) setTimeout(() => void closeOrBlank(tab.id!, tab.windowId), 50);
      return { ok: true, action: "closed" };
    }
  }
}

async function alternativeDone(eventId: string): Promise<void> {
  const event = (await readState()).events.find((e) => e.id === eventId);
  if (!event) return;
  const back = event.studyLabel ? `Quay lại "${event.studyLabel}" nhé.` : "Quay lại việc đang làm nhé.";
  chrome.notifications.create(`alt|${eventId}`, {
    type: "basic",
    iconUrl: ICON,
    title: `Xong ${event.activityMinutes} phút ${event.activity?.toLowerCase() ?? ""}`.trim(),
    message: back,
    priority: 1,
  });
}

const autoExitTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelAutoExit(eventId: string): void {
  const timer = autoExitTimers.get(eventId);
  if (timer !== undefined) {
    clearTimeout(timer);
    autoExitTimers.delete(eventId);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.id !== chrome.runtime.id || !port.name.startsWith("warning:")) return;
  const eventId = port.name.slice("warning:".length);
  cancelAutoExit(eventId);
  // The page pings over this port so the worker stays alive while the warning is open.
  port.onMessage.addListener(() => undefined);
  port.onDisconnect.addListener(() => {
    const closedAt = Date.now();
    autoExitTimers.set(
      eventId,
      setTimeout(() => {
        autoExitTimers.delete(eventId);
        void updateState((d) => L.autoExit(d, eventId, closedAt)).then((changed) => {
          if (changed) agent.send({ type: "decision", requestId: crypto.randomUUID(), eventId, decision: "exit" });
        });
      }, AUTO_EXIT_DELAY_MS),
    );
  });
});

// ---- Options and popup -----------------------------------------------------

async function optionsView(): Promise<OptionsView> {
  const { now, tz } = clock();
  const state = await readState();
  return {
    ok: true,
    protectionEnabled: state.protectionEnabled,
    domainRules: state.domainRules,
    allowUrls: state.allowUrls,
    settings: state.settings,
    suggestions: DOMAIN_SUGGESTIONS,
    study: agent.connected && agent.config ? agent.config.study : L.studyStatus(state, now, tz),
    studyRules: state.study.rules,
    agent: agent.status,
  };
}

async function popupView(): Promise<PopupView> {
  const { now, tz } = clock();
  const state = await readState();
  if (agent.connected && agent.config) {
    const c = agent.config;
    return {
      ok: true,
      protectionEnabled: c.protectionEnabled,
      warningsToday: c.summary.warningsToday,
      exitsToday: c.summary.exitsToday,
      budget: c.budget,
      study: c.study,
      agent: agent.status,
    };
  }
  const today = dayKey(now, tz);
  const todayEvents = state.events.filter((e) => dayKey(e.shownAt, tz) === today);
  const study: StudyStatus = L.studyStatus(state, now, tz);
  return {
    ok: true,
    protectionEnabled: state.protectionEnabled,
    warningsToday: todayEvents.length,
    exitsToday: todayEvents.filter((e) => e.decision === "exit").length,
    budget: L.budgetView(state, now, tz),
    study,
    agent: agent.status,
  };
}

async function mutate(fn: (d: State, now: number, tz: number) => L.Result, rulesChanged: boolean): Promise<SimpleResponse> {
  const { now, tz } = clock();
  const result = await updateState((d) => fn(d, now, tz));
  if (result.ok && rulesChanged) await applyRules();
  return result.ok ? { ok: true } : result;
}

/** With the agent connected, settings changes go to the agent, which checks them and pushes the new config. */
async function viaAgent(message: Record<string, unknown>): Promise<SimpleResponse> {
  return agentFailure(await agent.request<AgentResult>(message)) ?? { ok: true };
}

async function handle(msg: Request, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case "warning:init":
      return initWarning(msg.eventId, msg.url);
    case "warning:decide":
      return decide(msg, sender);
    case "options:get":
      return optionsView();
    case "popup:get":
      return popupView();
    case "options:setDomainRule":
      if (agent.connected) {
        const pattern = normalizeDomainInput(msg.pattern);
        if (!pattern) return { ok: false, error: "invalid" };
        return viaAgent({ type: "set_domain_rule", pattern, tag: msg.tag, confirmed: msg.confirmed });
      }
      return mutate((d, now, tz) => L.setDomainRule(d, msg.pattern, msg.tag, msg.confirmed, now, tz), true);
    case "options:addAllowUrl":
      if (agent.connected) {
        const entry = parseAllowUrl(msg.text);
        if (!entry) return { ok: false, error: "invalid" };
        return viaAgent({ type: "add_allow_url", entry, confirmed: msg.confirmed });
      }
      return mutate((d) => L.addAllowUrl(d, msg.text, msg.confirmed), true);
    case "options:removeAllowUrl":
      if (agent.connected) return viaAgent({ type: "remove_allow_url", entry: msg.entry as AllowEntry });
      return mutate((d) => L.removeAllowUrl(d, msg.entry), true);
    case "options:setFriction":
      if (agent.connected) {
        return viaAgent({ type: "set_friction", lockSeconds: msg.lockSeconds, budgetMinutes: msg.budgetMinutes, confirmed: msg.confirmed });
      }
      return mutate((d, now, tz) => L.setFriction(d, msg.lockSeconds, msg.budgetMinutes, msg.confirmed, now, tz), false);
    case "options:setProtection":
      if (agent.connected) return viaAgent({ type: "set_protection", enabled: msg.enabled, confirmed: msg.confirmed });
      return mutate((d, now, tz) => L.setProtection(d, msg.enabled, msg.confirmed, now, tz), true);
    case "options:clearLog": {
      if (agent.connected) {
        const res = await viaAgent({ type: "clear_log", confirmed: msg.confirmed });
        if (!res.ok) return res;
      }
      return mutate((d) => L.clearLog(d, msg.confirmed), false);
    }
    case "study:start":
    case "study:stop":
    case "study:setRules":
      return { ok: false, error: "invalid" };
  }
}

chrome.runtime.onMessage.addListener((msg: Request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(msg, sender).then(sendResponse, (err) => {
    console.error("DopaDam:", msg.type, err);
    sendResponse({ ok: false, error: "invalid" });
  });
  return true;
});

// ---- Wiring ----------------------------------------------------------------

chrome.webNavigation.onHistoryStateUpdated.addListener((d) => void onNavigation(d.tabId, d.url, d.frameId));
chrome.webNavigation.onCommitted.addListener((d) => void onNavigation(d.tabId, d.url, d.frameId));

chrome.alarms.onAlarm.addListener((alarm) => {
  const sep = alarm.name.indexOf("|");
  const kind = sep < 0 ? alarm.name : alarm.name.slice(0, sep);
  const arg = sep < 0 ? "" : alarm.name.slice(sep + 1);
  if (kind === TICK_ALARM) void tick();
  else if (kind === "expire") void expireWindows();
  else if (kind === "headsup") void headsUp(arg);
  else if (kind === "alt") void alternativeDone(arg);
});

async function setup(): Promise<void> {
  await applyRules();
  for (const window of (await readState()).allowWindows) scheduleWindowAlarms(window);
  if (!(await chrome.alarms.get(TICK_ALARM))) chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  await ensureAgent();
}

chrome.runtime.onInstalled.addListener((details) => {
  void setup().then(() => {
    if (details.reason === "install") void chrome.runtime.openOptionsPage();
  });
});
chrome.runtime.onStartup.addListener(() => void setup());
// Every time the worker starts (it sleeps when idle), reconnect to the agent.
void ensureAgent();
