//! The desktop guard: watches the program in front, shows the warning window for blocked
//! programs, runs allow windows and the game delay, and counts time per tag.

use crate::core::{effective_delay, is_blocked_tag, now_ms, OpenTracker, StudyStatus};
use crate::db::KIND_EXE;
use crate::logic::{Decision, ErrorCode, ACTIVITIES};
use crate::platform::{self, Foreground};
use crate::state::{budget_view, BudgetView, Shared};
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
    /// A warning is being prepared (event being recorded) but not yet in `warning`.
    pub preparing: bool,
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
    #[cfg(windows)]
    {
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into()).to_lowercase();
        path.to_lowercase().starts_with(&windir)
    }
    #[cfg(target_os = "linux")]
    {
        platform::is_system_program(path)
    }
}

pub fn on_foreground(state: &Shared, raw: isize) {
    let now = now_ms();
    let fg = platform::describe(raw).filter(|fg| !is_no_program(raw, fg.pid, std::process::id()));
    let Some(fg) = fg else {
        // Our own window, an undescribable one or "no focus": no program is in front.
        // While a warning is up the warned program stays the subject of the decision.
        if state.guard().warning.is_none() {
            flush_usage(state, now);
            clear_foreground(&mut state.guard(), now);
        }
        return;
    };
    {
        let g = state.guard();
        if g.foreground.as_ref().is_some_and(|f| f.pid == fg.pid && f.hwnd == fg.hwnd) {
            return;
        }
        if in_exit_grace(&g, fg.pid, now) {
            // Only delayed: `tick` looks at the foreground again when the grace is over.
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

/// Focus on nothing (id 0) or on DopaDam's own process means no program is in front.
fn is_no_program(raw: isize, pid: u32, own_pid: u32) -> bool {
    raw == 0 || pid == own_pid
}

/// True while a focus event of `pid` is ignored because Thoát just minimised that program.
fn in_exit_grace(g: &Guard, pid: u32, now: i64) -> bool {
    g.just_exited.is_some_and(|(p, until)| p == pid && now < until)
}

/// True exactly once, when the exit grace has run out. The program that Thoát minimised may have
/// been brought back to the front while its focus events were ignored, so the caller must look at
/// the foreground again then (a program that really stayed minimised is simply not in front).
fn take_expired_exit_grace(g: &mut Guard, now: i64) -> bool {
    if g.just_exited.is_some_and(|(_, until)| now >= until) {
        g.just_exited = None;
        return true;
    }
    false
}

/// The warned program has exited: ends its warning and forgets it everywhere, so that nothing can
/// warn about a program that no longer exists. Returns the id of the event that was on screen.
fn drop_dead_warning(g: &mut Guard, now: i64, alive: impl Fn(u32) -> bool) -> Option<String> {
    let pid = g.warning.as_ref().filter(|w| !alive(w.fg.pid)).map(|w| w.fg.pid)?;
    let w = g.warning.take()?;
    clear_foreground_of(g, pid, now);
    g.tracker.forget(pid);
    if g.just_exited.is_some_and(|(p, _)| p == pid) {
        g.just_exited = None;
    }
    Some(w.context.event_id)
}

/// Forgets the program in front only if it is `pid`: the user may have switched to another
/// program while the warning was up, and that one is still in front.
fn clear_foreground_of(g: &mut Guard, pid: u32, now: i64) {
    if g.foreground.as_ref().is_some_and(|f| f.pid == pid) {
        clear_foreground(g, now);
    }
}

/// Forgets the program in front and pauses its open count.
fn clear_foreground(g: &mut Guard, now: i64) {
    if let Some(prev) = g.foreground.take() {
        g.tracker.leave(prev.pid, now);
    }
    g.segment_start = now;
}

/// Atomically claims the right to show a warning: nothing up, nothing being prepared, not in the
/// exit grace period and the delay is over. Sets the "preparing" marker on success.
fn claim_warning(g: &mut Guard, pid: u32, now: i64, delay_ms: i64) -> bool {
    if g.warning.is_some()
        || g.preparing
        || in_exit_grace(g, pid, now)
        || !g.tracker.is_due(pid, now, delay_ms)
    {
        return false;
    }
    g.preparing = true;
    true
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
    // A program that has exited cannot be warned about (its window may linger in our records).
    if !platform::process_alive(fg.pid) {
        let mut g = state.guard();
        clear_foreground_of(&mut g, fg.pid, now);
        g.tracker.forget(fg.pid);
        return;
    }
    if !claim_warning(&mut state.guard(), fg.pid, now, delay_ms) {
        return;
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
        g.preparing = false;
        g.tracker.mark_warned(fg.pid);
        g.warning = Some(ActiveWarning { context: context.clone(), fg: fg.clone() });
    }
    // An always-on-top window cannot cover a game in exclusive full screen: minimize the game first.
    if platform::exclusive_fullscreen() {
        platform::minimize(fg.hwnd);
    }
    present_warning(state, &fg, &context);
    state.changed();
}

fn present_warning(state: &Shared, fg: &Foreground, context: &WarningContext) {
    let Some(window) = state.app.get_webview_window("warning") else { return };
    #[cfg(windows)]
    {
        let (x, y, w, h) = platform::monitor_rect(fg.hwnd);
        let _ = window.set_position(PhysicalPosition::new(x, y));
        let _ = window.set_size(PhysicalSize::new(w as u32, h as u32));
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.emit_to("warning", "warning:show", context);
        if let Ok(h) = window.hwnd() {
            platform::bring_to_front(h.0 as isize, false);
        }
        let _ = window.set_focus();
    }
    #[cfg(target_os = "linux")]
    {
        // Wayland ignores positions; on X11 this puts the window on the program's monitor first.
        if let Some((x, y, _, _)) = platform::monitor_of(fg.hwnd) {
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
        let _ = window.show();
        let _ = window.set_fullscreen(true);
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
        let _ = window.emit_to("warning", "warning:show", context);
        // Under Wayland only the shell may put a window above the others and focus it.
        platform::raise_own_window(platform::WARNING_TITLE, true, true);
        // Under X11 `set_focus()` is refused from the second warning on: activate the window as a
        // pager would. The window may not be mapped yet, so ask again shortly.
        let state = state.clone();
        std::thread::spawn(move || {
            for wait_ms in [0, 150, 500] {
                std::thread::sleep(Duration::from_millis(wait_ms));
                if current_warning(&state).is_none() {
                    return;
                }
                platform::activate_own_window(platform::WARNING_TITLE);
            }
        });
    }
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
                platform::bring_to_front(fg.hwnd, true);
            }
        }
        Decision::Exit | Decision::Alternative => {
            if let Some(fg) = &fg {
                {
                    let mut g = state.guard();
                    g.just_exited = Some((fg.pid, now + EXIT_GRACE_MS));
                    // Focus returns to our own windows: the warned program is no longer in front.
                    clear_foreground_of(&mut g, fg.pid, now);
                }
                platform::minimize(fg.hwnd);
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
    if platform::idle_seconds() > IDLE_LIMIT_S && !platform::fullscreen_busy() {
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
    let gone = drop_dead_warning(&mut state.guard(), now, platform::process_alive);
    if let Some(id) = gone {
        state.store().auto_exit(&id, now);
        hide_warning(state);
        state.changed();
    }
    // The program that Thoát minimised may be back in front: judge it now that the grace is over.
    if take_expired_exit_grace(&mut state.guard(), now) {
        let front = platform::foreground_window();
        // Not the window Thoát just minimised, should the system still report it as being in front.
        if !platform::is_minimized(front) {
            on_foreground(state, front);
        }
    }

    let windows = state.store().allow_windows();
    let mut changed = false;
    for w in windows {
        if !w.heads_up_sent && now >= w.expires_at - 60_000 && now < w.expires_at {
            state.store().mark_heads_up(&w.object);
            // Websites get their notice from the extension.
            if platform::is_program_name(&w.object) {
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
        let keep = current_warning(state).map(|w| w.event_id);
        state.store().prune(now, keep.as_deref());
    }
}

fn slow_tick(state: &Shared, now: i64) {
    let pids = {
        let mut g = state.guard();
        g.last_slow_tick = now;
        g.tracker.known_pids()
    };
    let dead: Vec<u32> = pids.into_iter().filter(|p| !platform::process_alive(*p)).collect();
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
    let edge_running = platform::running_exes().iter().any(|e| e == platform::EDGE_EXE);
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
    let (ax, ay, aw, ah) = platform::work_area();
    let _ = window.set_size(PhysicalSize::new(w as u32, h as u32));
    let _ = window.set_position(PhysicalPosition::new(ax + aw - w - margin, ay + ah - h - margin));
    let _ = window.emit_to("toast", "toast:show", &toast);
    #[cfg(windows)]
    {
        if let Ok(hwnd) = window.hwnd() {
            platform::show_topmost_no_activate(hwnd.0 as isize);
        }
    }
    #[cfg(target_os = "linux")]
    {
        let _ = window.show();
        platform::raise_own_window(platform::NOTICE_TITLE, true, false);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn fg(pid: u32) -> Foreground {
        Foreground { hwnd: 7, pid, exe: "game".into(), path: "/usr/bin/game".into() }
    }

    #[test]
    fn own_process_and_window_zero_mean_no_program() {
        assert!(is_no_program(0, 55, 1));
        assert!(is_no_program(9, 1, 1));
        assert!(!is_no_program(9, 55, 1));
    }

    #[test]
    fn clearing_foreground_pauses_the_tracker() {
        let mut g = Guard::default();
        g.tracker.enter(5, 0);
        g.foreground = Some(fg(5));
        clear_foreground(&mut g, 1000);
        assert!(g.foreground.is_none());
        // Time after leaving does not count towards the delay.
        assert!(!g.tracker.is_due(5, 10_000, 5000));
        assert!(g.tracker.is_due(5, 10_000, 1000));
        // Leaving program 5 does not drop another program that came to the front meanwhile.
        let mut g = Guard::default();
        g.tracker.enter(7, 0);
        g.foreground = Some(fg(7));
        clear_foreground_of(&mut g, 5, 1000);
        assert_eq!(g.foreground.as_ref().map(|f| f.pid), Some(7));
        clear_foreground_of(&mut g, 7, 2000);
        assert!(g.foreground.is_none());
    }

    #[test]
    fn only_one_warning_can_be_claimed() {
        let mut g = Guard::default();
        g.tracker.enter(5, 0);
        assert!(claim_warning(&mut g, 5, 1000, 0));
        assert!(!claim_warning(&mut g, 5, 1000, 0));
        g.preparing = false;
        assert!(claim_warning(&mut g, 5, 1000, 0));
    }

    #[test]
    fn no_claim_during_exit_grace_or_before_delay() {
        let mut g = Guard::default();
        g.tracker.enter(5, 0);
        assert!(!claim_warning(&mut g, 5, 1000, 5000));
        g.just_exited = Some((5, 2000));
        assert!(!claim_warning(&mut g, 5, 1000, 0));
        assert!(!g.preparing);
    }
    fn context(id: &str) -> WarningContext {
        WarningContext {
            event_id: id.into(),
            app_name: "game".into(),
            object: "game".into(),
            level: 1,
            lock_seconds: 5,
            allow_options: vec![5],
            count_this_hour: 1,
            shown_at: 0,
            budget: BudgetView { used_minutes: 0.0, budget_minutes: 60, remaining_minutes: None, over: false },
            study: StudyStatus::none(),
            activities: vec![],
        }
    }

    /// Thoát on program `pid` at time 0: the warning was up, focus went away, the grace starts.
    fn after_thoat(pid: u32) -> Guard {
        let mut g = Guard::default();
        g.tracker.enter(pid, 0);
        g.tracker.mark_warned(pid);
        g.foreground = Some(fg(pid));
        g.just_exited = Some((pid, EXIT_GRACE_MS));
        clear_foreground_of(&mut g, pid, 0);
        g
    }

    #[test]
    fn program_back_in_front_during_the_grace_is_judged_when_it_ends() {
        let mut g = after_thoat(5);
        // Back in front 0.5 s after Thoát: the focus event is ignored and no warning may be claimed...
        assert!(in_exit_grace(&g, 5, 500));
        assert!(!claim_warning(&mut g, 5, 500, 0));
        // ...but the grace only delays: nothing to look at before it ends, exactly one look when it ends.
        assert!(!take_expired_exit_grace(&mut g, EXIT_GRACE_MS - 1));
        assert!(take_expired_exit_grace(&mut g, EXIT_GRACE_MS));
        assert!(!take_expired_exit_grace(&mut g, EXIT_GRACE_MS + 1000));
        // The look finds the program in front again: it is entered and, being a warned program, due at once.
        assert!(!in_exit_grace(&g, 5, EXIT_GRACE_MS));
        g.tracker.enter(5, EXIT_GRACE_MS);
        g.foreground = Some(fg(5));
        assert!(claim_warning(&mut g, 5, EXIT_GRACE_MS, 30_000));
    }

    #[test]
    fn program_that_stayed_minimised_is_not_warned_again_when_the_grace_ends() {
        let mut g = after_thoat(5);
        assert!(take_expired_exit_grace(&mut g, EXIT_GRACE_MS));
        // The look finds nothing in front (or another program): the minimised one is not entered,
        // so there is no foreground to evaluate and nothing to claim.
        assert!(g.foreground.is_none());
        let other = Foreground { hwnd: 9, pid: 8, exe: "editor".into(), path: "/usr/bin/editor".into() };
        g.tracker.enter(other.pid, EXIT_GRACE_MS);
        g.foreground = Some(other);
        assert!(!g.tracker.is_due(8, EXIT_GRACE_MS, 30_000));
    }

    #[test]
    fn closing_the_warned_program_ends_its_warning_for_good() {
        let mut g = Guard::default();
        g.tracker.enter(5, 0);
        g.tracker.mark_warned(5);
        g.foreground = Some(fg(5));
        g.warning = Some(ActiveWarning { context: context("e1"), fg: fg(5) });
        // Still running: nothing happens.
        assert_eq!(drop_dead_warning(&mut g, 1000, |_| true), None);
        assert!(g.warning.is_some());
        // Closed: the event that was on screen is returned once; the warning, the foreground and the
        // tracker entry are gone, so the next tick cannot claim a new warning for the dead pid.
        assert_eq!(drop_dead_warning(&mut g, 1000, |_| false), Some("e1".to_string()));
        assert!(g.warning.is_none());
        assert!(g.foreground.is_none());
        assert!(!claim_warning(&mut g, 5, 2000, 0));
        assert!(!g.preparing);
        assert_eq!(drop_dead_warning(&mut g, 2000, |_| false), None);
    }

    #[test]
    fn closing_the_warned_program_keeps_another_program_in_front() {
        let mut g = Guard::default();
        g.tracker.enter(5, 0);
        g.tracker.mark_warned(5);
        g.warning = Some(ActiveWarning { context: context("e1"), fg: fg(5) });
        // The user switched to program 7 while the warning stayed up; then program 5 died.
        g.tracker.enter(7, 500);
        g.foreground = Some(fg(7));
        assert_eq!(drop_dead_warning(&mut g, 1000, |p| p != 5), Some("e1".to_string()));
        assert_eq!(g.foreground.as_ref().map(|f| f.pid), Some(7));
    }
}
