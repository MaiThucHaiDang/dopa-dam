//! Commands called by the agent's windows (main, warning, toast).

use crate::core::{
    effective_delay, format_local_date, local_tz_offset, now_ms, Settings, StudyRule, StudyStatus, DAY_MS, MINUTE_MS,
};
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
    message: String,
}

impl From<ErrorCode> for CmdError {
    fn from(code: ErrorCode) -> Self {
        CmdError { code, message: code.message().to_string() }
    }
}

impl From<String> for CmdError {
    fn from(message: String) -> Self {
        CmdError { code: ErrorCode::Invalid, message }
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyView {
    status: StudyStatus,
    rules: Vec<StudyRule>,
    /// Today's local date ("YYYY-MM-DD"), for the "skip a day" picker.
    today: String,
}

#[tauri::command]
pub fn get_study(state: State<'_, Shared>) -> StudyView {
    let now = now_ms();
    let store = state.store();
    let local = now + local_tz_offset(now) * MINUTE_MS;
    StudyView {
        status: store.study_status(now),
        rules: store.study_rules(),
        today: format_local_date(local.div_euclid(DAY_MS) * DAY_MS),
    }
}

#[tauri::command]
pub fn start_study(state: State<'_, Shared>, minutes: i64, label: Option<String>) -> CmdResult {
    state.store().start_study(minutes, label.as_deref(), now_ms())?;
    state.changed();
    Ok(())
}

#[tauri::command]
pub fn stop_study(state: State<'_, Shared>, confirmed: bool) -> CmdResult {
    state.store().stop_study(confirmed, now_ms())?;
    state.changed();
    Ok(())
}

#[tauri::command]
pub fn set_study_rule(state: State<'_, Shared>, rule: StudyRule, confirmed: bool) -> CmdResult {
    state.store().set_study_rule(&rule, confirmed, now_ms())?;
    state.changed();
    Ok(())
}

#[tauri::command]
pub fn delete_study_rule(state: State<'_, Shared>, id: String, confirmed: bool) -> CmdResult {
    state.store().delete_study_rule(&id, confirmed, now_ms())?;
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

// ---- Account and sync -------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    configured: bool,
    signed_in: bool,
    email: Option<String>,
    last_sync: Option<i64>,
    syncing: bool,
    last_error: Option<String>,
}

#[tauri::command]
pub fn account_status(state: State<'_, Shared>) -> AccountStatus {
    let session = state.session();
    let info = state.sync_info().clone();
    AccountStatus {
        configured: state.api.is_some(),
        signed_in: session.is_some(),
        email: session.and_then(|s| s.stored.email),
        last_sync: state.store().kv_get("lastSync").and_then(|v| v.parse().ok()),
        syncing: info.syncing,
        last_error: info.last_error,
    }
}

fn api(state: &Shared) -> Result<std::sync::Arc<crate::sync::Api>, String> {
    state.api.clone().ok_or_else(|| "Chưa cấu hình server đồng bộ (xem README, mục Supabase).".to_string())
}

fn check_credentials(email: &str, password: &str) -> Result<(), String> {
    if !email.contains('@') || email.trim().len() < 5 {
        return Err("Email không hợp lệ.".into());
    }
    if password.chars().count() < 6 {
        return Err("Mật khẩu cần ít nhất 6 ký tự.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn account_sign_in(state: State<'_, Shared>, email: String, password: String) -> Result<(), String> {
    check_credentials(&email, &password)?;
    let session = api(&state)?.sign_in(email.trim(), &password, now_ms()).await?;
    crate::syncrun::sign_in_with(&state, session);
    Ok(())
}

/// "signed-in" when the account is usable at once, "confirm-email" when Supabase sent a confirmation email.
#[tauri::command]
pub async fn account_sign_up(state: State<'_, Shared>, email: String, password: String) -> Result<String, String> {
    check_credentials(&email, &password)?;
    match api(&state)?.sign_up(email.trim(), &password, now_ms()).await? {
        Some(session) => {
            crate::syncrun::sign_in_with(&state, session);
            Ok("signed-in".into())
        }
        None => Ok("confirm-email".into()),
    }
}

#[tauri::command]
pub fn account_google(state: State<'_, Shared>) -> Result<(), String> {
    let api = api(&state)?;
    let verifier = crate::sync::new_verifier();
    let url = api.google_url(&crate::sync::pkce_challenge(&verifier));
    *state.pkce.lock().unwrap_or_else(|e| e.into_inner()) = Some(verifier);
    crate::win::open_url(&url);
    Ok(())
}

#[tauri::command]
pub fn account_sign_out(state: State<'_, Shared>) {
    crate::syncrun::sign_out(&state);
}

#[tauri::command]
pub async fn sync_now(state: State<'_, Shared>) -> Result<crate::sync::Report, String> {
    crate::syncrun::run_sync(&state).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRow {
    platform: String,
    name: String,
    version: String,
    last_seen: i64,
    this_device: bool,
}

#[tauri::command]
pub async fn account_devices(state: State<'_, Shared>) -> Result<Vec<DeviceRow>, String> {
    let api = api(&state)?;
    let token = state.session().map(|s| s.access_token).ok_or("Chưa đăng nhập.")?;
    let me = state.store().device_id();
    let rows = api.pull("devices", None, &token).await.map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| DeviceRow {
            platform: r["platform"].as_str().unwrap_or("").into(),
            name: r["name"].as_str().unwrap_or("").into(),
            version: r["version"].as_str().unwrap_or("").into(),
            last_seen: r["last_seen"].as_i64().unwrap_or(0),
            this_device: r["id"].as_str() == Some(me.as_str()),
        })
        .collect())
}

/// Deletes the account's data on the server and the log on this computer, then signs out.
#[tauri::command]
pub async fn delete_server_data(state: State<'_, Shared>, confirmed: bool) -> CmdResult {
    if !confirmed {
        return Err(ErrorCode::NeedsConfirm.into());
    }
    let api = api(&state)?;
    let token = state.session().map(|s| s.access_token).ok_or_else(|| "Chưa đăng nhập.".to_string())?;
    api.rpc("delete_my_data", &token).await.map_err(|e| e.to_string())?;
    state.store().clear_log(true)?;
    crate::syncrun::sign_out(&state);
    state.refreshed();
    Ok(())
}

#[tauri::command]
pub fn get_stats(state: State<'_, Shared>, days: Option<i64>) -> Vec<crate::db::DayStat> {
    state.store().stats(now_ms(), days.unwrap_or(28).clamp(1, 30))
}
