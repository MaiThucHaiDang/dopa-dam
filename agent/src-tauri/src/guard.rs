//! The desktop guard: watches the program in front, shows the warning window for blocked
//! programs, runs allow windows and the game delay, and counts time per tag.

use crate::core::{effective_delay, is_blocked_tag, now_ms, OpenTracker, StudyStatus};
use crate::db::KIND_EXE;
use crate::logic::{Decision, ErrorCode, ACTIVITIES};
use crate::state::{budget_view, BudgetView, Shared};
use crate::win::{self, Foreground};
use serde::Serialize;
use std::time::Duration;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize};

/// Right after Thoát the program may report itself once more while windows rearrange.
const EXIT_GRACE_MS: i64 = 1500;
/// Without keyboard or mouse input for this long, time does not count (unless something runs full screen).
const IDLE_LIMIT_S: u64 = 300;
const FLUSH_MS: i64 = 30_000;
const SLOW_TICK_MS: i64 = 30_000;
/// How long Edge may run without the extension connected before the agent says so.
const EDGE_UNLINKED_MS: i64 = 180_000;
/// No "new program" notices during the first minutes after installing.
const NEW_APP_QUIET_MS: i64 = 10 * 60_000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarningContext {
    pub event_id: String,
    pub app_name: String,
    pub object: String,
    pub level: i64,
    pub lock_seconds: i64,
    pub allow_options: Vec<i64>,
    pub count_this_hour: i64,
    pub shown_at: i64,
    pub budget: BudgetView,
    pub study: StudyStatus,
    pub activities: Vec<String>,
}

pub struct ActiveWarning {
    pub context: WarningContext,
    pub fg: Foreground,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Toast {
    pub id: u64,
    pub title: String,
    pub body: String,
    /// Route of the main window to open from the notice, e.g. "/apps".
    pub action: Option<String>,
}

#[derive(Default)]
pub struct Guard {
    pub foreground: Option<Foreground>,
    pub segment_start: i64,
    pub tracker: OpenTracker,
    pub warning: Option<ActiveWarning>,
    pub just_exited: Option<(u32, i64)>,
    pub last_flush: i64,
    pub last_slow_tick: i64,
    pub last_prune: i64,
    pub edge_unlinked_since: Option<i64>,
    pub edge_notice_sent: bool,
    /// Study state last pushed to the extensions: (active, ends at).
    pub last_study: Option<(bool, Option<i64>)>,
    pub toast: Option<Toast>,
    next_toast: u64,
}

fn app_name(state: &Shared, fg: &Foreground) -> String {
    state
        .store()
        .seen_apps()
        .into_iter()
        .find(|(exe, _, _)| *exe == fg.exe)
        .map(|(_, name, _)| name)
        .unwrap_or_else(|| fg.exe.trim_end_matches(".exe").to_string())
}

fn is_system_program(path: &str) -> bool {
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into()).to_lowercase();
    path.to_lowercase().starts_with(&windir)
}

pub fn on_foreground(state: &Shared, raw: isize) {
    let Some(fg) = win::describe(raw) else { return };
    if fg.pid == std::process::id() {
        return;
    }
    let now = now_ms();
    {
        let g = state.guard();
        if g.foreground.as_ref().is_some_and(|f| f.pid == fg.pid && f.hwnd == fg.hwnd) {
            return;
        }
        if g.just_exited.is_some_and(|(pid, until)| pid == fg.pid && now < until) {
            return;
        }
    }
    flush_usage(state, now);
    let warning_up = {
        let mut g = state.guard();
        if let Some(prev) = g.foreground.take() {
            g.tracker.leave(prev.pid, now);
        }
        g.tracker.enter(fg.pid, now);
        g.foreground = Some(fg.clone());
        g.segment_start = now;
        g.warning.is_some()
    };
    note_app(state, &fg, now);
    // While the warning is up it stays until a decision (or until the program exits).
    if !warning_up {
        evaluate(state, now);
    }
}

fn note_app(state: &Shared, fg: &Foreground, now: i64) {
    if is_system_program(&fg.path) {
        return;
    }
    let name = fg.exe.trim_end_matches(".exe").to_string();
    let (is_new, tagged, settling) = {
        let store = state.store();
        let installed_at: i64 = store.kv_get("installedAt").and_then(|v| v.parse().ok()).unwrap_or(0);
        (
            store.note_app(&fg.exe, &name, Some(&fg.path), "seen", now),
            store.rule(KIND_EXE, &fg.exe).is_some(),
            // Right after installing, almost everything is "new": stay quiet while the list fills up.
            now - installed_at < NEW_APP_QUIET_MS,
        )
    };
    if is_new && !tagged && !settling && std::env::var_os("DOPADAM_QUIET").is_none() {
        show_toast(
            state,
            &format!("Vừa mở {name}"),
            "Gán tag cho chương trình này để DopaDam biết có cần cảnh báo không.",
            Some("/apps"),
        );
        let _ = state.app.emit("state-changed", ());
    }
}

/// Shows the warning if the program in front is blocked, not allowed right now, and its delay is over.
pub fn evaluate(state: &Shared, now: i64) {
    let fg = {
        let g = state.guard();
        if g.warning.is_some() {
            return;
        }
        match g.foreground.clone() {
            Some(fg) => fg,
            None => return,
        }
    };
    let (tag, delay_ms) = {
        let store = state.store();
        if !store.protection_enabled() {
            return;
        }
        let Some(rule) = store.rule(KIND_EXE, &fg.exe) else { return };
        if !is_blocked_tag(Some(&rule.tag)) {
            return;
        }
        if store.allow_windows().iter().any(|w| w.object == fg.exe && w.expires_at > now) {
            return;
        }
        let delay = effective_delay(rule.delay_seconds, &rule.tag, &store.settings().tag_delays);
        (rule.tag, delay * 1000)
    };
    {
        let g = state.guard();
        if g.just_exited.is_some_and(|(pid, until)| pid == fg.pid && now < until)
            || !g.tracker.is_due(fg.pid, now, delay_ms)
        {
            return;
        }
    }
    show_warning(state, fg, &tag, now);
}

fn show_warning(state: &Shared, fg: Foreground, tag: &str, now: i64) {
    flush_usage(state, now);
    let event_id = uuid::Uuid::new_v4().to_string();
    let name = app_name(state, &fg);
    let context = {
        let store = state.store();
        let (event, plan) = store.record_warning(&event_id, &fg.exe, tag, now);
        WarningContext {
            event_id: event.id,
            app_name: name,
            object: fg.exe.clone(),
            level: plan.level,
            lock_seconds: plan.lock_seconds,
            allow_options: plan.allow_options,
            count_this_hour: plan.n + 1,
            shown_at: event.shown_at,
            budget: budget_view(&store, now),
            study: store.study_status(now),
            activities: ACTIVITIES.iter().map(|s| s.to_string()).collect(),
        }
    };
    {
        let mut g = state.guard();
        g.tracker.mark_warned(fg.pid);
        g.warning = Some(ActiveWarning { context: context.clone(), fg: fg.clone() });
    }
    // An always-on-top window cannot cover a game in exclusive full screen: minimize the game first.
    if win::exclusive_fullscreen() {
        win::minimize(fg.hwnd);
    }
    present_warning(state, &fg, &context);
    state.changed();
}

fn present_warning(state: &Shared, fg: &Foreground, context: &WarningContext) {
    let Some(window) = state.app.get_webview_window("warning") else { return };
    let (x, y, w, h) = win::monitor_rect(fg.hwnd);
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.set_size(PhysicalSize::new(w as u32, h as u32));
    let _ = window.set_always_on_top(true);
    let _ = window.show();
    let _ = window.emit_to("warning", "warning:show", context);
    if let Ok(h) = window.hwnd() {
        win::bring_to_front(h.0 as isize, false);
    }
    let _ = window.set_focus();
}

pub fn hide_warning(state: &Shared) {
    state.guard().warning = None;
    if let Some(window) = state.app.get_webview_window("warning") {
        let _ = window.hide();
    }
}

pub fn current_warning(state: &Shared) -> Option<WarningContext> {
    state.guard().warning.as_ref().map(|w| w.context.clone())
}

/// A decision from the warning window.
pub fn decide(
    state: &Shared,
    event_id: &str,
    decision: Decision,
    allow_minutes: Option<i64>,
    activity: Option<&str>,
    activity_minutes: Option<i64>,
) -> Result<(), ErrorCode> {
    let now = now_ms();
    let fg = state.guard().warning.as_ref().filter(|w| w.context.event_id == event_id).map(|w| w.fg.clone());
    let event = state.store().decide(event_id, decision, allow_minutes, activity, activity_minutes, now)?;
    match decision {
        Decision::Enter => {
            hide_warning(state);
            if let Some(fg) = &fg {
                state.guard().segment_start = now;
                win::bring_to_front(fg.hwnd, true);
            }
        }
        Decision::Exit | Decision::Alternative => {
            if let Some(fg) = &fg {
                state.guard().just_exited = Some((fg.pid, now + EXIT_GRACE_MS));
                win::minimize(fg.hwnd);
            }
            hide_warning(state);
            if decision == Decision::Alternative {
                schedule_alternative_end(
                    state,
                    event.activity.unwrap_or_default(),
                    event.activity_minutes.unwrap_or(5),
                    event.study_label,
                );
            }
        }
    }
    state.changed();
    Ok(())
}

fn schedule_alternative_end(state: &Shared, activity: String, minutes: i64, study_label: Option<String>) {
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(minutes.max(0) as u64 * 60)).await;
        let back = match study_label {
            Some(label) => format!("Quay lại \"{label}\" nhé."),
            None => "Quay lại việc đang làm nhé.".to_string(),
        };
        show_toast(&state, &format!("Xong {minutes} phút {}", activity.to_lowercase()), &back, None);
    });
}

/// Adds the time since the last flush to the tag of the program in front.
pub fn flush_usage(state: &Shared, now: i64) {
    let (fg, start, warning_up) = {
        let mut g = state.guard();
        let start = g.segment_start;
        g.segment_start = now;
        g.last_flush = now;
        (g.foreground.clone(), start, g.warning.is_some())
    };
    let Some(fg) = fg else { return };
    if warning_up || now <= start || start == 0 {
        return;
    }
    if win::idle_seconds() > IDLE_LIMIT_S && !win::fullscreen_busy() {
        return;
    }
    // A long gap means the computer slept: count at most a little more than one flush interval.
    let seconds = ((now - start) as f64 / 1000.0).min(90.0);
    let store = state.store();
    if let Some(rule) = store.rule(KIND_EXE, &fg.exe) {
        if rule.tag != "ignore" {
            store.add_usage(&rule.tag, seconds, now);
        }
    }
}

pub fn tick(state: &Shared) {
    let now = now_ms();
    // The warned program was closed: nothing left to decide.
    let gone = {
        let g = state.guard();
        g.warning.as_ref().filter(|w| !win::process_alive(w.fg.pid)).map(|w| w.context.event_id.clone())
    };
    if let Some(id) = gone {
        state.store().auto_exit(&id, now);
        hide_warning(state);
        state.changed();
    }

    let windows = state.store().allow_windows();
    let mut changed = false;
    for w in windows {
        if !w.heads_up_sent && now >= w.expires_at - 60_000 && now < w.expires_at {
            state.store().mark_heads_up(&w.object);
            // Websites get their notice from the extension.
            if w.object.ends_with(".exe") {
                let name = state
                    .store()
                    .seen_apps()
                    .into_iter()
                    .find(|(exe, _, _)| *exe == w.object)
                    .map(|(_, n, _)| n)
                    .unwrap_or_else(|| w.object.clone());
                show_toast(
                    state,
                    "Còn 1 phút",
                    &format!("Khoảng được phép cho {name} sắp hết. Hết giờ sẽ hiện lại màn hình cảnh báo."),
                    None,
                );
            }
        }
        if now >= w.expires_at {
            state.store().remove_allow_window(&w.object);
            changed = true;
        }
    }
    if changed {
        state.changed();
    }
    evaluate(state, now);

    let (flush_due, slow_due, prune_due) = {
        let g = state.guard();
        (now - g.last_flush >= FLUSH_MS, now - g.last_slow_tick >= SLOW_TICK_MS, now - g.last_prune >= 3_600_000)
    };
    if flush_due {
        flush_usage(state, now);
    }
    if slow_due {
        slow_tick(state, now);
    }
    if prune_due {
        state.guard().last_prune = now;
        state.store().prune(now);
    }
}

fn slow_tick(state: &Shared, now: i64) {
    let pids = {
        let mut g = state.guard();
        g.last_slow_tick = now;
        g.tracker.known_pids()
    };
    let dead: Vec<u32> = pids.into_iter().filter(|p| !win::process_alive(*p)).collect();
    {
        let mut g = state.guard();
        for pid in dead {
            g.tracker.forget(pid);
        }
    }
    // Weekly study hours start and end with the clock, not with a change: refresh the extensions
    // (their popup and options show the study state) and the agent's own windows.
    let study = state.store().study_status(now);
    let study_changed = {
        let mut g = state.guard();
        let key = Some((study.active, study.ends_at));
        let changed = g.last_study != key;
        g.last_study = key;
        changed
    };
    if study_changed {
        state.refreshed();
    }

    // Edge running while the extension is not connected: the web is not protected.
    let edge_running = win::running_exes().iter().any(|e| e == "msedge.exe");
    let linked = state.connected_extensions() > 0;
    let notify = {
        let mut g = state.guard();
        if !edge_running || linked {
            g.edge_unlinked_since = None;
            g.edge_notice_sent = false;
            false
        } else {
            let since = *g.edge_unlinked_since.get_or_insert(now);
            if now - since >= EDGE_UNLINKED_MS && !g.edge_notice_sent {
                g.edge_notice_sent = true;
                true
            } else {
                false
            }
        }
    };
    if notify {
        show_toast(
            state,
            "Extension DopaDam chưa chạy",
            "Edge đang mở nhưng extension không phản hồi, nên các trang web chưa được bảo vệ.",
            Some("/guide"),
        );
    }
}

/// A small notice in the corner of the screen that does not take the keyboard focus.
pub fn show_toast(state: &Shared, title: &str, body: &str, action: Option<&str>) {
    let toast = {
        let mut g = state.guard();
        g.next_toast += 1;
        let t = Toast { id: g.next_toast, title: title.into(), body: body.into(), action: action.map(String::from) };
        g.toast = Some(t.clone());
        t
    };
    let Some(window) = state.app.get_webview_window("toast") else { return };
    let scale = window.scale_factor().unwrap_or(1.0);
    let (w, h) = ((380.0 * scale) as i32, (130.0 * scale) as i32);
    let margin = (16.0 * scale) as i32;
    let (ax, ay, aw, ah) = win::work_area();
    let _ = window.set_size(PhysicalSize::new(w as u32, h as u32));
    let _ = window.set_position(PhysicalPosition::new(ax + aw - w - margin, ay + ah - h - margin));
    let _ = window.emit_to("toast", "toast:show", &toast);
    if let Ok(hwnd) = window.hwnd() {
        win::show_topmost_no_activate(hwnd.0 as isize);
    }
    let state = state.clone();
    let id = toast.id;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(12)).await;
        hide_toast(&state, Some(id));
    });
}

pub fn hide_toast(state: &Shared, only: Option<u64>) {
    let mut g = state.guard();
    if only.is_some_and(|id| g.toast.as_ref().map(|t| t.id) != Some(id)) {
        return;
    }
    g.toast = None;
    drop(g);
    if let Some(window) = state.app.get_webview_window("toast") {
        let _ = window.hide();
    }
}
