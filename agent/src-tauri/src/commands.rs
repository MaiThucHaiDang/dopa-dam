//! Commands called by the agent's windows (main, warning, toast).

use crate::core::{effective_delay, now_ms, Settings, StudyStatus};
use crate::db::{AllowEntry, Rule, KIND_DOMAIN, KIND_EXE};
use crate::guard::{self, Toast, WarningContext};
use crate::logic::{Decision, ErrorCode};
use crate::nmhost;
use crate::state::{budget_view, BudgetView, Shared, AGENT_VERSION};
use serde::Serialize;
use std::collections::BTreeMap;
use tauri::{Emitter, Manager, State};

#[derive(Debug, Serialize)]
pub struct CmdError {
    code: ErrorCode,
    message: &'static str,
}

impl From<ErrorCode> for CmdError {
    fn from(code: ErrorCode) -> Self {
        CmdError { code, message: code.message() }
    }
}

type CmdResult<T = ()> = Result<T, CmdError>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInfo {
    profile_id: Option<String>,
    ext_version: Option<String>,
    compatible: bool,
    last_seen: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    version: &'static str,
    protection_enabled: bool,
    warnings_today: i64,
    exits_today: i64,
    budget: BudgetView,
    study: StudyStatus,
    extensions: Vec<ExtensionInfo>,
    host_registered: bool,
    host_missing: bool,
    autostart: bool,
}

#[tauri::command]
pub fn get_overview(state: State<'_, Shared>) -> Overview {
    let now = now_ms();
    let extensions = state
        .clients
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .values()
        .map(|c| ExtensionInfo {
            profile_id: c.profile_id.clone(),
            ext_version: c.ext_version.clone(),
            compatible: c.compatible,
            last_seen: c.last_seen,
        })
        .collect();
    let store = state.store();
    let (warnings_today, exits_today) = store.today_counts(now);
    use tauri_plugin_autostart::ManagerExt;
    Overview {
        version: AGENT_VERSION,
        protection_enabled: store.protection_enabled(),
        warnings_today,
        exits_today,
        budget: budget_view(&store, now),
        study: store.study_status(now),
        extensions,
        host_registered: nmhost::is_registered(),
        host_missing: nmhost::host_exe().is_none(),
        autostart: state.app.autolaunch().is_enabled().unwrap_or(false),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRow {
    exe: String,
    name: String,
    path: Option<String>,
    tag: Option<String>,
    delay_seconds: Option<i64>,
    effective_delay: i64,
}

/// Programs from the Start menu, programs seen in front, and programs that have a rule.
#[tauri::command]
pub fn list_apps(state: State<'_, Shared>) -> Vec<AppRow> {
    let store = state.store();
    let settings = store.settings();
    let mut rows: BTreeMap<String, AppRow> = BTreeMap::new();
    for (exe, name, path) in store.seen_apps() {
        rows.insert(exe.clone(), AppRow { exe, name, path, tag: None, delay_seconds: None, effective_delay: 0 });
    }
    for rule in store.rules(KIND_EXE) {
        let Rule { pattern, tag, delay_seconds, .. } = rule;
        let row = rows.entry(pattern.clone()).or_insert(AppRow {
            name: pattern.trim_end_matches(".exe").to_string(),
            exe: pattern,
            path: None,
            tag: None,
            delay_seconds: None,
            effective_delay: 0,
        });
        row.effective_delay = effective_delay(delay_seconds, &tag, &settings.tag_delays);
        row.tag = Some(tag);
        row.delay_seconds = delay_seconds;
    }
    let mut list: Vec<AppRow> = rows.into_values().collect();
    list.sort_by_key(|a| a.name.to_lowercase());
    list
}

#[tauri::command]
pub async fn rescan_apps(state: State<'_, Shared>) -> CmdResult<usize> {
    let found = tauri::async_runtime::spawn_blocking(crate::win::start_menu_apps).await.unwrap_or_default();
    let now = now_ms();
    let store = state.store();
    let count = found.len();
    for (exe, name, path) in found {
        store.note_app(&exe, &name, Some(&path), "start-menu", now);
    }
    Ok(count)
}

fn normalize_exe(exe: &str) -> Option<String> {
    let e = exe.trim().to_lowercase();
    let name = e.rsplit(['\\', '/']).next()?.to_string();
    (name.ends_with(".exe") && name.len() > 4).then_some(name)
}

#[tauri::command]
pub fn set_app_tag(state: State<'_, Shared>, exe: String, tag: Option<String>, confirmed: bool) -> CmdResult {
    let exe = normalize_exe(&exe).ok_or(ErrorCode::Invalid)?;
    state.store().set_rule_tag(KIND_EXE, &exe, tag.as_deref(), confirmed, now_ms())?;
    state.changed();
    Ok(())
}

#[tauri::command]
pub fn set_app_delay(state: State<'_, Shared>, exe: String, delay: Option<i64>, confirmed: bool) -> CmdResult {
    let exe = normalize_exe(&exe).ok_or(ErrorCode::Invalid)?;
    state.store().set_rule_delay(KIND_EXE, &exe, delay, confirmed, now_ms())?;
    state.changed();
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SitesView {
    domain_rules: Vec<Rule>,
    allow_urls: Vec<AllowEntry>,
}

#[tauri::command]
pub fn list_sites(state: State<'_, Shared>) -> SitesView {
    let store = state.store();
    SitesView { domain_rules: store.rules(KIND_DOMAIN), allow_urls: store.allow_entries() }
}

/// The UI normalizes the domain with the same code as the extension (normalizeDomainInput).
#[tauri::command]
pub fn set_site_tag(state: State<'_, Shared>, pattern: String, tag: Option<String>, confirmed: bool) -> CmdResult {
    let pattern = pattern.trim().to_lowercase();
    if pattern.is_empty() || pattern.contains(['/', ' ', ':']) {
        return Err(ErrorCode::Invalid.into());
    }
    state.store().set_rule_tag(KIND_DOMAIN, &pattern, tag.as_deref(), confirmed, now_ms())?;
    state.changed();
    Ok(())
}

#[tauri::command]
pub fn add_allow_url(state: State<'_, Shared>, entry: AllowEntry, confirmed: bool) -> CmdResult {
    state.store().add_allow_url(&entry, confirmed, now_ms())?;
    state.changed();
    Ok(())
}

#[tauri::command]
pub fn remove_allow_url(state: State<'_, Shared>, entry: AllowEntry) -> CmdResult {
    state.store().remove_allow_url(&entry, now_ms());
    state.changed();
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<'_, Shared>) -> Settings {
    state.store().settings()
}

#[tauri::command]
pub fn save_settings(state: State<'_, Shared>, settings: Settings, confirmed: bool) -> CmdResult {
    state.store().set_settings(&settings, confirmed, now_ms())?;
    state.changed();
    Ok(())
}

#[tauri::command]
pub fn set_protection(state: State<'_, Shared>, enabled: bool, confirmed: bool) -> CmdResult {
    state.store().set_protection(enabled, confirmed, now_ms())?;
    state.changed();
    Ok(())
}

#[tauri::command]
pub fn clear_log(state: State<'_, Shared>, confirmed: bool) -> CmdResult {
    state.store().clear_log(confirmed)?;
    state.changed();
    Ok(())
}

#[tauri::command]
pub fn set_autostart(state: State<'_, Shared>, enabled: bool, confirmed: bool) -> CmdResult {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = state.app.autolaunch();
    if !enabled {
        if state.store().study_status(now_ms()).active {
            return Err(ErrorCode::StudyLocked.into());
        }
        if !confirmed {
            return Err(ErrorCode::NeedsConfirm.into());
        }
        let _ = launcher.disable();
    } else {
        let _ = launcher.enable();
    }
    let _ = state.app.emit("state-changed", ());
    Ok(())
}

#[tauri::command]
pub fn register_host(state: State<'_, Shared>) -> Result<String, String> {
    nmhost::register(&state.data_dir).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn warning_current(state: State<'_, Shared>) -> Option<WarningContext> {
    guard::current_warning(&state)
}

#[tauri::command]
pub fn warning_decide(
    state: State<'_, Shared>,
    event_id: String,
    decision: String,
    allow_minutes: Option<i64>,
    activity: Option<String>,
    activity_minutes: Option<i64>,
) -> CmdResult {
    let decision = Decision::parse(&decision).ok_or(ErrorCode::Invalid)?;
    guard::decide(&state, &event_id, decision, allow_minutes, activity.as_deref(), activity_minutes)?;
    Ok(())
}

#[tauri::command]
pub fn toast_current(state: State<'_, Shared>) -> Option<Toast> {
    state.guard().toast.clone()
}

#[tauri::command]
pub fn toast_dismiss(state: State<'_, Shared>, open: Option<String>) {
    guard::hide_toast(&state, None);
    if let Some(route) = open {
        show_main(&state, Some(&route));
    }
}

pub fn show_main(state: &Shared, route: Option<&str>) {
    if let Some(w) = state.app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        if let Some(route) = route {
            let _ = w.emit_to("main", "navigate", route);
        }
    }
}

/// Quitting the agent switches desktop protection off, so it gets the same confirmation as turning protection off.
#[tauri::command]
pub fn quit_agent(state: State<'_, Shared>, confirmed: bool) -> CmdResult {
    if state.store().study_status(now_ms()).active {
        return Err(ErrorCode::StudyLocked.into());
    }
    if !confirmed {
        return Err(ErrorCode::NeedsConfirm.into());
    }
    guard::flush_usage(&state, now_ms());
    state.app.exit(0);
    Ok(())
}
