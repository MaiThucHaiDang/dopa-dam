//! Named pipe server for the extension (relayed by dopadam.exe in host mode). One JSON object per line.
//! See docs/thiet-ke-ky-thuat.md, section 3, for the messages.

use crate::core::{match_domain, now_ms, Settings, StudyRule};
use crate::db::{AllowEntry, KIND_DOMAIN};
use crate::logic::{Decision, ErrorCode, ACTIVITIES};
use crate::nmhost::PIPE_NAME;
use crate::state::{budget_view, Shared, AGENT_VERSION, PROTOCOL};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};

pub async fn serve(state: Shared) {
    let mut server = match ServerOptions::new().first_pipe_instance(true).create(PIPE_NAME) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("DopaDam: cannot create {PIPE_NAME}: {e}");
            return;
        }
    };
    loop {
        if server.connect().await.is_err() {
            continue;
        }
        let connected = server;
        server = match ServerOptions::new().create(PIPE_NAME) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("DopaDam: pipe instance failed: {e}");
                return;
            }
        };
        tokio::spawn(handle_client(state.clone(), connected));
    }
}

async fn handle_client(state: Shared, pipe: NamedPipeServer) {
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

/// Handles one message from an extension; returns the direct reply, if any.
pub fn handle_message(state: &Shared, client: u64, msg: &Value) -> Option<Value> {
    let now = now_ms();
    let request_id = msg.get("requestId").cloned().unwrap_or(Value::Null);
    if let Some(c) = state.clients.lock().unwrap_or_else(|e| e.into_inner()).get_mut(&client) {
        c.last_seen = now;
    }
    match str_field(msg, "type")? {
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
            let outcome = state.store().clear_log(confirmed);
            if outcome.is_ok() {
                state.changed();
            }
            Some(result(&request_id, outcome))
        }
        _ => (!request_id.is_null()).then(|| result(&request_id, Err(ErrorCode::Invalid))),
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
