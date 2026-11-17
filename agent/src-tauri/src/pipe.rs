//! Local server for the extension (relayed by the agent's executable in host mode): a named pipe on
//! Windows, a Unix socket on Linux. One JSON object per line. On Linux the GNOME Shell companion
//! is one more client. See docs/thiet-ke-ky-thuat.md, section 3, for the messages.

use crate::core::{match_domain, now_ms, Settings, StudyRule};
use crate::db::{AllowEntry, KIND_DOMAIN};
use crate::logic::{Decision, ErrorCode, ACTIVITIES};
#[cfg(windows)]
use crate::nmhost::PIPE_NAME;
use crate::state::{budget_view, Shared, AGENT_VERSION, PROTOCOL};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
#[cfg(windows)]
use tokio::net::windows::named_pipe::ServerOptions;

/// Pause before retrying after an accept error, so a persistent failure cannot busy-loop.
const RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(200);

#[cfg(windows)]
pub async fn serve(state: Shared) {
    let mut server = match ServerOptions::new().first_pipe_instance(true).create(PIPE_NAME) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("DopaDam: cannot create {PIPE_NAME}: {e}");
            return;
        }
    };
    loop {
        if let Err(e) = server.connect().await {
            // This instance may be unusable now: replace it, and pause so a persistent failure cannot spin.
            eprintln!("DopaDam: pipe connect failed: {e}");
            server = fresh_instance(true).await;
            continue;
        }
        let connected = server;
        server = fresh_instance(false).await;
        tokio::spawn(handle_client(state.clone(), connected));
    }
}

/// A new pipe instance for the next client; retries every 200 ms until one can be created.
/// `pause_first` is for the error path; after a successful accept the next instance is made at once,
/// so a second client does not find the pipe missing.
#[cfg(windows)]
async fn fresh_instance(pause_first: bool) -> tokio::net::windows::named_pipe::NamedPipeServer {
    if pause_first {
        tokio::time::sleep(RETRY_DELAY).await;
    }
    loop {
        match ServerOptions::new().create(PIPE_NAME) {
            Ok(s) => return s,
            Err(e) => eprintln!("DopaDam: pipe instance failed: {e}"),
        }
        tokio::time::sleep(RETRY_DELAY).await;
    }
}

/// Set once this process has bound the socket, so only the owner removes the file on exit.
#[cfg(unix)]
static SOCKET_BOUND: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Removes the socket file on a clean exit (a crash leaves it; `bind_socket` cleans that up).
/// Does nothing when this process never bound it, e.g. a second instance that gave way to the first.
pub fn remove_socket() {
    #[cfg(unix)]
    if SOCKET_BOUND.load(std::sync::atomic::Ordering::SeqCst) {
        let _ = std::fs::remove_file(crate::nmhost::socket_path());
    }
}

/// Binds the socket. A file left by a crashed run is removed, but only when nothing listens on it.
#[cfg(unix)]
fn bind_socket(path: &std::path::Path) -> std::io::Result<tokio::net::UnixListener> {
    use std::os::unix::fs::PermissionsExt;
    if path.exists() {
        if std::os::unix::net::UnixStream::connect(path).is_ok() {
            return Err(std::io::Error::new(std::io::ErrorKind::AddrInUse, "another DopaDam is listening"));
        }
        std::fs::remove_file(path)?;
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let listener = tokio::net::UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

#[cfg(unix)]
pub async fn serve(state: Shared) {
    let path = crate::nmhost::socket_path();
    let listener = match bind_socket(&path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("DopaDam: cannot listen on {}: {e}", path.display());
            return;
        }
    };
    SOCKET_BOUND.store(true, std::sync::atomic::Ordering::SeqCst);
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                tokio::spawn(handle_client(state.clone(), stream));
            }
            Err(e) => {
                eprintln!("DopaDam: accept failed: {e}");
                tokio::time::sleep(RETRY_DELAY).await;
            }
        }
    }
}

async fn handle_client<S>(state: Shared, pipe: S)
where
    S: AsyncRead + AsyncWrite + Send + 'static,
{
    let (read, mut write) = tokio::io::split(pipe);
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let id = state.add_client(tx);
    let writer = tokio::spawn(async move {
        while let Some(line) = rx.recv().await {
            if write.write_all(format!("{line}\n").as_bytes()).await.is_err() {
                break;
            }
        }
    });
    let mut lines = BufReader::new(read).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        if let Some(reply) = handle_message(&state, id, &msg) {
            state.send_to(id, reply.to_string());
        }
    }
    #[cfg(target_os = "linux")]
    crate::linux::shell_gone(id);
    state.remove_client(id);
    writer.abort();
}

fn result(request_id: &Value, outcome: Result<(), ErrorCode>) -> Value {
    match outcome {
        Ok(()) => json!({"type": "result", "requestId": request_id, "ok": true}),
        Err(e) => json!({"type": "result", "requestId": request_id, "ok": false, "error": e}),
    }
}

fn str_field<'a>(msg: &'a Value, key: &str) -> Option<&'a str> {
    msg.get(key).and_then(Value::as_str)
}

/// Whether a client may send this message yet: extension messages need a compatible `hello`,
/// the shell's `focus` and `idle` need `shell_hello` first.
fn message_allowed(kind: &str, compatible: bool, shell: bool) -> bool {
    match kind {
        "hello" | "shell_hello" | "ping" => true,
        "focus" | "idle" => shell,
        _ => compatible,
    }
}

/// Handles one message from an extension; returns the direct reply, if any.
pub fn handle_message(state: &Shared, client: u64, msg: &Value) -> Option<Value> {
    let now = now_ms();
    let request_id = msg.get("requestId").cloned().unwrap_or(Value::Null);
    if let Some(c) = state.clients.lock().unwrap_or_else(|e| e.into_inner()).get_mut(&client) {
        c.last_seen = now;
    }
    let kind = str_field(msg, "type")?;
    let (compatible, shell) = state
        .clients
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&client)
        .map_or((false, false), |c| (c.compatible, c.shell));
    if !message_allowed(kind, compatible, shell) {
        // Nothing happens; a caller waiting for an answer gets an error.
        return (!request_id.is_null()).then(|| result(&request_id, Err(ErrorCode::Invalid)));
    }
    match kind {
        "hello" => {
            let protocol = msg.get("protocol").and_then(Value::as_i64).unwrap_or(0);
            let compatible = protocol == PROTOCOL;
            if let Some(c) = state.clients.lock().unwrap_or_else(|e| e.into_inner()).get_mut(&client) {
                c.compatible = compatible;
                c.profile_id = str_field(msg, "profileId").map(String::from);
                c.ext_version = str_field(msg, "extVersion").map(String::from);
            }
            state.send_to(client, json!({"type": "welcome", "protocol": PROTOCOL, "agentVersion": AGENT_VERSION, "compatible": compatible}).to_string());
            if compatible {
                state.send_to(client, state.config_message());
            }
            let _ = tauri::Emitter::emit(&state.app, "state-changed", ());
            None
        }
        "ping" => None,
        #[cfg(target_os = "linux")]
        "shell_hello" | "focus" | "idle" => {
            handle_shell(state, client, msg);
            None
        }
        "warning_request" => Some(warning_request(state, msg, &request_id, now)),
        "decision" => {
            let outcome = decision(state, msg, now);
            if outcome.is_ok() {
                state.changed();
            }
            Some(result(&request_id, outcome))
        }
        "usage" => {
            usage(state, msg, now);
            None
        }
        "set_domain_rule" => {
            let pattern = str_field(msg, "pattern").unwrap_or("").to_lowercase();
            let tag = str_field(msg, "tag");
            let confirmed = msg.get("confirmed").and_then(Value::as_bool).unwrap_or(false);
            let outcome = state.store().set_rule_tag(KIND_DOMAIN, &pattern, tag, confirmed, now);
            if outcome.is_ok() {
                state.changed();
            }
            Some(result(&request_id, outcome))
        }
        "add_allow_url" => {
            let confirmed = msg.get("confirmed").and_then(Value::as_bool).unwrap_or(false);
            let outcome = match msg.get("entry").cloned().and_then(|e| serde_json::from_value::<AllowEntry>(e).ok()) {
                Some(entry) => state.store().add_allow_url(&entry, confirmed, now),
                None => Err(ErrorCode::Invalid),
            };
            if outcome.is_ok() {
                state.changed();
            }
            Some(result(&request_id, outcome))
        }
        "remove_allow_url" => {
            let outcome = match msg.get("entry").cloned().and_then(|e| serde_json::from_value::<AllowEntry>(e).ok()) {
                Some(entry) => {
                    state.store().remove_allow_url(&entry, now);
                    Ok(())
                }
                None => Err(ErrorCode::Invalid),
            };
            state.changed();
            Some(result(&request_id, outcome))
        }
        "set_friction" => {
            let confirmed = msg.get("confirmed").and_then(Value::as_bool).unwrap_or(false);
            let outcome = {
                let store = state.store();
                let mut s: Settings = store.settings();
                let lock: Option<Vec<i64>> = msg
                    .get("lockSeconds")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(Value::as_i64).collect());
                match (lock, msg.get("budgetMinutes").and_then(Value::as_i64)) {
                    (Some(lock), Some(budget)) => {
                        s.lock_seconds = lock;
                        s.budget_minutes = budget;
                        store.set_settings(&s, confirmed, now)
                    }
                    _ => Err(ErrorCode::Invalid),
                }
            };
            if outcome.is_ok() {
                state.changed();
            }
            Some(result(&request_id, outcome))
        }
        "set_protection" => {
            let enabled = msg.get("enabled").and_then(Value::as_bool).unwrap_or(true);
            let confirmed = msg.get("confirmed").and_then(Value::as_bool).unwrap_or(false);
            let outcome = state.store().set_protection(enabled, confirmed, now);
            if outcome.is_ok() {
                state.changed();
            }
            Some(result(&request_id, outcome))
        }
        "start_study" => {
            let minutes = msg.get("minutes").and_then(Value::as_i64).unwrap_or(0);
            let outcome = state.store().start_study(minutes, str_field(msg, "label"), now).map(|_| ());
            if outcome.is_ok() {
                state.changed();
            }
            Some(result(&request_id, outcome))
        }
        "stop_study" => {
            let confirmed = msg.get("confirmed").and_then(Value::as_bool).unwrap_or(false);
            let outcome = state.store().stop_study(confirmed, now);
            if outcome.is_ok() {
                state.changed();
            }
            Some(result(&request_id, outcome))
        }
        "set_study_rule" => {
            let confirmed = msg.get("confirmed").and_then(Value::as_bool).unwrap_or(false);
            let outcome = match msg.get("rule").cloned().and_then(|r| serde_json::from_value::<StudyRule>(r).ok()) {
                Some(rule) => state.store().set_study_rule(&rule, confirmed, now).map(|_| ()),
                None => Err(ErrorCode::Invalid),
            };
            if outcome.is_ok() {
                state.changed();
            }
            Some(result(&request_id, outcome))
        }
        "delete_study_rule" => {
            let confirmed = msg.get("confirmed").and_then(Value::as_bool).unwrap_or(false);
            let outcome = state.store().delete_study_rule(str_field(msg, "id").unwrap_or(""), confirmed, now);
            if outcome.is_ok() {
                state.changed();
            }
            Some(result(&request_id, outcome))
        }
        "clear_log" => {
            let confirmed = msg.get("confirmed").and_then(Value::as_bool).unwrap_or(false);
            let outcome = state.store().clear_log(confirmed, now);
            if outcome.is_ok() {
                state.changed();
            }
            Some(result(&request_id, outcome))
        }
        _ => (!request_id.is_null()).then(|| result(&request_id, Err(ErrorCode::Invalid))),
    }
}

/// The GNOME Shell companion: its messages feed the foreground tracking, not the extension logic.
#[cfg(target_os = "linux")]
fn handle_shell(state: &Shared, client: u64, msg: &Value) {
    use crate::linux::{apply_shell_event, parse_shell_event, shell_connected, ShellEvent, SHELL_PROTOCOL};
    let Some(event) = parse_shell_event(msg) else { return };
    if let ShellEvent::Hello { protocol, .. } = event {
        // From now on this client is not an extension: it is not counted and gets no config broadcasts.
        let tx = {
            let mut clients = state.clients.lock().unwrap_or_else(|e| e.into_inner());
            clients.get_mut(&client).map(|c| {
                c.shell = true;
                c.tx.clone()
            })
        };
        if let (Some(tx), true) = (tx, protocol == SHELL_PROTOCOL) {
            shell_connected(client, tx);
        }
        let _ = tauri::Emitter::emit(&state.app, "state-changed", ());
        return;
    }
    let is_shell = state.clients.lock().unwrap_or_else(|e| e.into_inner()).get(&client).is_some_and(|c| c.shell);
    if is_shell {
        apply_shell_event(client, event);
    }
}

fn warning_request(state: &Shared, msg: &Value, request_id: &Value, now: i64) -> Value {
    let object = str_field(msg, "object").unwrap_or("").to_lowercase();
    let url = str_field(msg, "url").unwrap_or("");
    let event_id = str_field(msg, "eventId").map(String::from).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let store = state.store();
    let rules: Vec<(String, String)> = store.rules(KIND_DOMAIN).into_iter().map(|r| (r.pattern, r.tag)).collect();
    let tag = rules.iter().find(|(p, _)| *p == object).map(|(_, t)| t.clone());
    let allowed_link = store.allow_entries().iter().any(|e| e.matches(url));
    let in_window = store.allow_windows().iter().any(|w| w.object == object && w.expires_at > now);
    let blocked = crate::core::is_blocked_tag(tag.as_deref());
    if !store.protection_enabled() || !blocked || allowed_link || in_window {
        return json!({"type": "warning_context", "requestId": request_id, "skip": true});
    }
    let (event, plan) = store.record_warning(&event_id, &object, tag.as_deref().unwrap_or("entertainment"), now);
    let budget = budget_view(&store, now);
    let study = store.study_status(now);
    drop(store);
    state.changed();
    json!({
        "type": "warning_context",
        "requestId": request_id,
        "skip": false,
        "eventId": event.id,
        "level": plan.level,
        "lockSeconds": plan.lock_seconds,
        "allowOptions": plan.allow_options,
        "n": plan.n,
        "shownAt": event.shown_at,
        "decision": event.decision,
        "budget": budget,
        "study": study,
        "activities": ACTIVITIES,
        // Optional: the risk-hours raise applied (older extensions ignore it).
        "risk": plan.risk,
    })
}

fn decision(state: &Shared, msg: &Value, now: i64) -> Result<(), ErrorCode> {
    let id = str_field(msg, "eventId").ok_or(ErrorCode::Invalid)?;
    let decision = str_field(msg, "decision").and_then(Decision::parse).ok_or(ErrorCode::Invalid)?;
    state
        .store()
        .decide(
            id,
            decision,
            msg.get("allowMinutes").and_then(Value::as_i64),
            str_field(msg, "activity"),
            msg.get("activityMinutes").and_then(Value::as_i64),
            now,
        )
        .map(|_| ())
}

/// Time on a website reported by the extension, attributed to the site's tag (allowed links count as study).
fn usage(state: &Shared, msg: &Value, now: i64) {
    let Some(seconds) = msg.get("seconds").and_then(Value::as_f64).filter(|s| *s > 0.0 && *s <= 180.0) else { return };
    let url = str_field(msg, "url").unwrap_or("");
    let host = str_field(msg, "domain").unwrap_or("");
    let store = state.store();
    let tag = if store.allow_entries().iter().any(|e| e.matches(url)) {
        Some("study".to_string())
    } else {
        let rules: Vec<(String, String)> = store.rules(KIND_DOMAIN).into_iter().map(|r| (r.pattern, r.tag)).collect();
        match_domain(host, &rules).map(|(_, t)| t.clone())
    };
    if let Some(tag) = tag.filter(|t| t != "ignore") {
        store.add_usage(&tag, seconds, now);
    }
}

#[cfg(test)]
mod gate_tests {
    use super::message_allowed;

    #[test]
    fn nothing_but_hello_is_accepted_before_hello() {
        for kind in ["decision", "set_domain_rule", "add_allow_url", "set_friction", "usage", "warning_request"] {
            assert!(!message_allowed(kind, false, false), "{kind}");
            assert!(message_allowed(kind, true, false), "{kind}");
        }
        assert!(message_allowed("hello", false, false));
        assert!(message_allowed("shell_hello", false, false));
        assert!(!message_allowed("focus", false, false));
        assert!(!message_allowed("idle", true, false));
        assert!(message_allowed("focus", false, true));
        // A shell is not an extension.
        assert!(!message_allowed("decision", false, true));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn scratch() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("dopadam-pipe-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn the_socket_is_private_and_a_stale_file_is_replaced() {
        let dir = scratch();
        let path = dir.join("dopadam-agent.sock");
        // A crashed run leaves the file behind with nobody listening.
        drop(std::os::unix::net::UnixListener::bind(&path).unwrap());
        assert!(path.exists());
        let listener = bind_socket(&path).expect("stale socket is removed");
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        // While it listens, a second agent must not take it over.
        let err = bind_socket(&path).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::AddrInUse);
        assert!(path.exists());
        drop(listener);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn the_socket_folder_is_created_when_missing() {
        let dir = scratch();
        let path = dir.join("nested").join("dopadam-agent.sock");
        assert!(bind_socket(&path).is_ok());
        let _ = std::fs::remove_dir_all(dir);
    }
}
