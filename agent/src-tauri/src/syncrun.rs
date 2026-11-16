//! Runs sync inside the agent: restores the sign-in at start, syncs every 30 seconds (or a few
//! seconds after a local change), and finishes the Google sign-in when the browser returns.

use crate::account;
use crate::core::now_ms;
use crate::state::Shared;
use crate::sync::{self, DeviceInfo, Report, Session, SyncError};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::Emitter;

const SYNC_EVERY_MS: i64 = 30_000;

fn notify(state: &Shared) {
    let _ = state.app.emit("state-changed", ());
}

async fn restore(state: &Shared) {
    let (Some(api), Some(stored)) = (state.api.clone(), account::load()) else { return };
    match api.refresh(&stored.refresh_token, now_ms()).await {
        Ok(session) => {
            let _ = account::save(&session.stored);
            state.set_session(Some(session));
        }
        Err(e) => {
            // Keep the stored sign-in: the network may just be down. The next sync retries.
            state.sync_info().last_error = Some(e.to_string());
            state.set_session(Some(Session { access_token: String::new(), expires_at: 0, stored }));
        }
    }
    notify(state);
}

/// Err carries the message and whether the server rejected the refresh token (sign-in is dead).
async fn fresh_token(state: &Shared, force: bool) -> Result<String, (String, bool)> {
    let api = state.api.clone().ok_or_else(|| ("Chưa cấu hình server đồng bộ.".to_string(), false))?;
    let session = state.session().ok_or_else(|| ("Chưa đăng nhập.".to_string(), false))?;
    if !force && session.expires_at - now_ms() > 60_000 {
        return Ok(session.access_token);
    }
    let fresh = api
        .refresh(&session.stored.refresh_token, now_ms())
        .await
        .map_err(|e| (e.to_string(), e.is_rejected()))?;
    let _ = account::save(&fresh.stored);
    let token = fresh.access_token.clone();
    state.set_session(Some(fresh));
    Ok(token)
}

pub async fn run_sync(state: &Shared) -> Result<Report, String> {
    let api = state.api.clone().ok_or("Chưa cấu hình server đồng bộ.")?;
    if state.session().is_none() {
        return Err("Chưa đăng nhập.".into());
    }
    {
        let mut info = state.sync_info();
        if info.syncing {
            return Err("Đang đồng bộ.".into());
        }
        info.syncing = true;
    }
    notify(state);
    let device = DeviceInfo { name: crate::platform::device_name(), version: crate::state::AGENT_VERSION.into() };
    // Undecided events are never pushed: close the abandoned ones first (not the warning on screen).
    let keep = crate::guard::current_warning(state).map(|w| w.event_id);
    state.store().close_abandoned(now_ms(), keep.as_deref());
    let mut expired = false;
    let result = async {
        let token = fresh_token(state, false).await.map_err(|(m, rejected)| {
            expired |= rejected;
            m
        })?;
        match sync::sync_once(state.store_mutex(), &api, &token, &device, now_ms()).await {
            Err(SyncError::Unauthorized) => {
                let token = fresh_token(state, true).await.map_err(|(m, rejected)| {
                    expired |= rejected;
                    m
                })?;
                sync::sync_once(state.store_mutex(), &api, &token, &device, now_ms()).await.map_err(|e| {
                    if matches!(e, SyncError::Unauthorized) {
                        expired = true;
                    }
                    e.to_string()
                })
            }
            other => other.map_err(|e| e.to_string()),
        }
    }
    .await;
    {
        let mut info = state.sync_info();
        info.syncing = false;
        info.last_error = result.as_ref().err().cloned();
    }
    if expired {
        sign_out(state);
        state.sync_info().last_error = Some("Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.".into());
    }
    match &result {
        Ok(r) if r.changed > 0 => state.refreshed(),
        _ => notify(state),
    }
    result
}

pub fn spawn_loop(state: Shared) {
    tauri::async_runtime::spawn(async move {
        restore(&state).await;
        let mut last = 0i64;
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            if state.api.is_none() || state.session().is_none() {
                continue;
            }
            let now = now_ms();
            let soon = state.sync_soon.swap(false, Ordering::Relaxed);
            if !soon && now - last < SYNC_EVERY_MS {
                continue;
            }
            last = now;
            let _ = run_sync(&state).await;
        }
    });
}

/// Starts using a new session. Another account than last time gets this device's data uploaded fresh.
/// Fails (without signing in) when the sign-in cannot be kept for the next start.
pub fn sign_in_with(state: &Shared, session: Session) -> Result<(), String> {
    account::save(&session.stored)?;
    {
        let store = state.store();
        if store.kv_get("lastUserId").as_deref() != Some(session.stored.user_id.as_str()) {
            store.reset_cursors();
            store.kv_set("lastUserId", &session.stored.user_id);
        }
    }
    state.set_session(Some(session));
    state.sync_info().last_error = None;
    state.sync_soon.store(true, Ordering::Relaxed);
    notify(state);
    Ok(())
}

pub fn sign_out(state: &Shared) {
    account::clear();
    state.set_session(None);
    notify(state);
}

fn percent_decode(s: &str) -> String {
    fn hex(b: u8) -> Option<u8> {
        (b as char).to_digit(16).map(|d| d as u8)
    }
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => match (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                (Some(hi), Some(lo)) => {
                    out.push(hi * 16 + lo);
                    i += 3;
                    continue;
                }
                _ => out.push(b'%'),
            },
            b'+' => out.push(b' '),
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn query_param(url: &str, name: &str) -> Option<String> {
    let query = url.split_once('?')?.1.split('#').next()?;
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == name).then(|| percent_decode(v))
    })
}

/// dopadam://auth-callback?code=… from the browser after a Google sign-in.
pub fn handle_deep_link(state: &Shared, url: &str) {
    if !url.starts_with(sync::REDIRECT_URL) {
        return;
    }
    crate::commands::show_main(state, Some("/settings"));
    if let Some(err) = query_param(url, "error_description").or_else(|| query_param(url, "error")) {
        state.sync_info().last_error = Some(format!("Đăng nhập Google không thành công: {err}"));
        notify(state);
        return;
    }
    let (Some(code), Some(verifier), Some(api)) =
        (query_param(url, "code"), state.pkce.lock().unwrap_or_else(|e| e.into_inner()).take(), state.api.clone())
    else {
        return;
    };
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        match api.exchange_code(&code, &verifier, now_ms()).await {
            Ok(session) => {
                if let Err(e) = sign_in_with(&state, session) {
                    state.sync_info().last_error = Some(e);
                    notify(&state);
                }
            }
            Err(e) => {
                state.sync_info().last_error = Some(e);
                notify(&state);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_callback_url() {
        let url = "dopadam://auth-callback?code=abc%2D123&state=x";
        assert_eq!(query_param(url, "code").as_deref(), Some("abc-123"));
        assert_eq!(
            query_param("dopadam://auth-callback?error_description=Access+denied", "error_description").as_deref(),
            Some("Access denied")
        );
        assert_eq!(query_param("dopadam://auth-callback", "code"), None);
    }
}
