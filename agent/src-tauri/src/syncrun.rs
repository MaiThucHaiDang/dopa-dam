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

/// Keeps a sync round and an account change (sign-in, sign-out, deleting the server data) from
/// overlapping. A round that is half way holds this account's cursors, rows to push and the token:
/// letting `switch_account` or the wipe run in the middle would let it write account A's rows and
/// cursors into account B's data, or put rows back on a server that was just emptied.
///
/// A round never waits (a second one is simply refused, as before); an account change waits for
/// the round that is running, and a round cannot start while one is in progress.
pub struct SyncGate(tokio::sync::Mutex<()>);

impl SyncGate {
    pub const fn new() -> SyncGate {
        SyncGate(tokio::sync::Mutex::const_new(()))
    }

    /// For a sync round: `None` when a round or an account change is in progress.
    pub fn try_round(&self) -> Option<tokio::sync::MutexGuard<'_, ()>> {
        self.0.try_lock().ok()
    }

    /// For an account change: waits until the running round (if any) has finished.
    pub async fn account_change(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.0.lock().await
    }
}

impl Default for SyncGate {
    fn default() -> Self {
        Self::new()
    }
}

static SYNC_GATE: SyncGate = SyncGate::new();

/// Taken by the commands that change or delete the account's data, for the whole change.
pub async fn begin_account_change() -> tokio::sync::MutexGuard<'static, ()> {
    SYNC_GATE.account_change().await
}

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
    let fresh =
        api.refresh(&session.stored.refresh_token, now_ms()).await.map_err(|e| (e.to_string(), e.is_rejected()))?;
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
    let Some(_round) = SYNC_GATE.try_round() else { return Err("Đang đồng bộ.".into()) };
    // The account may have changed or gone while this round was waiting for the gate.
    if state.session().is_none() {
        return Err("Chưa đăng nhập.".into());
    }
    state.sync_info().syncing = true;
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
        // This round holds the gate itself: no waiting for it here.
        sign_out_locked(state);
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
pub async fn sign_in_with(state: &Shared, session: Session) -> Result<(), String> {
    let _change = begin_account_change().await;
    account::save(&session.stored)?;
    {
        state.store().switch_account(&session.stored.user_id);
    }
    state.set_session(Some(session));
    state.sync_info().last_error = None;
    state.sync_soon.store(true, Ordering::Relaxed);
    notify(state);
    Ok(())
}

/// Signs out once the running sync round (if any) has finished.
pub async fn sign_out(state: &Shared) {
    let _change = begin_account_change().await;
    sign_out_locked(state);
}

/// Signs out; the caller holds the gate (a sync round, or an account change in progress).
pub fn sign_out_locked(state: &Shared) {
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
                if let Err(e) = sign_in_with(&state, session).await {
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
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    #[tokio::test]
    async fn an_account_change_waits_for_the_running_round() {
        let gate = Arc::new(SyncGate::new());
        let round = gate.try_round().expect("no round yet");
        // No second round, and no second account change at the same time as a round.
        assert!(gate.try_round().is_none());
        let done = Arc::new(AtomicBool::new(false));
        let waiter = {
            let (gate, done) = (gate.clone(), done.clone());
            tokio::spawn(async move {
                let _change = gate.account_change().await;
                done.store(true, Ordering::SeqCst);
            })
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!done.load(Ordering::SeqCst), "the change must wait while the round runs");
        drop(round);
        tokio::time::timeout(Duration::from_secs(2), waiter).await.expect("change proceeds after the round").unwrap();
        assert!(done.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn no_round_starts_during_an_account_change() {
        let gate = SyncGate::new();
        let change = gate.account_change().await;
        assert!(gate.try_round().is_none());
        drop(change);
        assert!(gate.try_round().is_some());
    }

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
