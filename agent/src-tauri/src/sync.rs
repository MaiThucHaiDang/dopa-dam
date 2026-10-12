//! Supabase client (GoTrue auth + PostgREST) and the sync loop for one signed-in user.
//! See docs/thiet-ke-ky-thuat.md, section 5.

use crate::db::Store;
use crate::syncstore::TABLES;
use base64::Engine;
use chrono::{DateTime, Duration as ChronoDuration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

const PAGE: usize = 1000;
/// Pull again a little before the cursor: rows committed late with an earlier stamp are not missed.
const CURSOR_OVERLAP_MIN: i64 = 5;
pub const REDIRECT_URL: &str = "dopadam://auth-callback";

#[derive(Clone, Debug)]
pub struct Config {
    pub url: String,
    pub anon_key: String,
}

/// Runtime environment first (tests), then the values compiled in from config.local.json.
pub fn config() -> Option<Config> {
    let pick = |name: &str, built: &str| {
        std::env::var(name).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| built.to_string())
    };
    let url = pick("DOPADAM_SUPABASE_URL", env!("DOPADAM_SUPABASE_URL")).trim_end_matches('/').to_string();
    let anon_key = pick("DOPADAM_SUPABASE_ANON_KEY", env!("DOPADAM_SUPABASE_ANON_KEY"));
    (!url.is_empty() && !anon_key.is_empty()).then_some(Config { url, anon_key })
}

/// What survives a restart: kept in Windows Credential Manager (small enough for its size limit).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Stored {
    pub refresh_token: String,
    pub user_id: String,
    pub email: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Session {
    pub access_token: String,
    pub expires_at: i64,
    pub stored: Stored,
}

#[derive(Debug)]
pub enum SyncError {
    Unauthorized,
    Other(String),
}

impl std::fmt::Display for SyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncError::Unauthorized => write!(f, "Phiên đăng nhập đã hết hạn, hãy đăng nhập lại."),
            SyncError::Other(m) => write!(f, "{m}"),
        }
    }
}

/// Turns GoTrue's English error messages into what the user sees.
pub fn friendly_auth_error(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("invalid login credentials") {
        "Sai email hoặc mật khẩu.".into()
    } else if lower.contains("email not confirmed") {
        "Email chưa được xác nhận. Mở thư xác nhận rồi đăng nhập lại.".into()
    } else if lower.contains("already registered") || lower.contains("already been registered") {
        "Email này đã có tài khoản. Hãy đăng nhập.".into()
    } else if lower.contains("password") && (lower.contains("at least") || lower.contains("short")) {
        "Mật khẩu cần ít nhất 6 ký tự.".into()
    } else if lower.contains("rate limit") {
        "Gửi email quá nhiều lần, thử lại sau ít phút.".into()
    } else if raw.is_empty() {
        "Không kết nối được tới server.".into()
    } else {
        raw.to_string()
    }
}

pub fn pkce_challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn new_verifier() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

pub struct Api {
    http: reqwest::Client,
    cfg: Config,
}

fn error_text(body: &Value) -> String {
    ["error_description", "msg", "message", "error"]
        .iter()
        .find_map(|k| body.get(*k).and_then(Value::as_str))
        .unwrap_or("")
        .to_string()
}

impl Api {
    pub fn new(cfg: Config) -> Api {
        let http = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build().expect("http client");
        Api { http, cfg }
    }

    fn session_from(body: &Value, now: i64) -> Option<Session> {
        let access_token = body.get("access_token")?.as_str()?.to_string();
        let refresh_token = body.get("refresh_token")?.as_str()?.to_string();
        let expires_in = body.get("expires_in").and_then(Value::as_i64).unwrap_or(3600);
        let user = body.get("user")?;
        Some(Session {
            access_token,
            expires_at: now + expires_in * 1000,
            stored: Stored {
                refresh_token,
                user_id: user.get("id")?.as_str()?.to_string(),
                email: user.get("email").and_then(Value::as_str).map(String::from),
            },
        })
    }

    async fn auth_post(&self, path: &str, body: Value) -> Result<Value, String> {
        let res = self
            .http
            .post(format!("{}/auth/v1/{path}", self.cfg.url))
            .header("apikey", &self.cfg.anon_key)
            .json(&body)
            .send()
            .await
            .map_err(|_| friendly_auth_error(""))?;
        let ok = res.status().is_success();
        let json: Value = res.json().await.unwrap_or(Value::Null);
        if ok {
            Ok(json)
        } else {
            Err(friendly_auth_error(&error_text(&json)))
        }
    }

    async fn token(&self, grant: &str, body: Value, now: i64) -> Result<Session, String> {
        let json = self.auth_post(&format!("token?grant_type={grant}"), body).await?;
        Self::session_from(&json, now).ok_or_else(|| "Server trả về phiên đăng nhập không hợp lệ.".into())
    }

    pub async fn sign_in(&self, email: &str, password: &str, now: i64) -> Result<Session, String> {
        self.token("password", json!({"email": email, "password": password}), now).await
    }

    /// Ok(None) means the account was created and waits for the confirmation email.
    pub async fn sign_up(&self, email: &str, password: &str, now: i64) -> Result<Option<Session>, String> {
        let json = self.auth_post("signup", json!({"email": email, "password": password})).await?;
        Ok(Self::session_from(&json, now))
    }

    pub async fn refresh(&self, refresh_token: &str, now: i64) -> Result<Session, String> {
        self.token("refresh_token", json!({"refresh_token": refresh_token}), now).await
    }

    pub async fn exchange_code(&self, code: &str, verifier: &str, now: i64) -> Result<Session, String> {
        self.token("pkce", json!({"auth_code": code, "code_verifier": verifier}), now).await
    }

    pub fn google_url(&self, challenge: &str) -> String {
        format!(
            "{}/auth/v1/authorize?provider=google&redirect_to={}&code_challenge={challenge}&code_challenge_method=s256",
            self.cfg.url,
            urlencode(REDIRECT_URL)
        )
    }

    fn rest(&self, method: reqwest::Method, path: &str, token: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{}/rest/v1/{path}", self.cfg.url))
            .header("apikey", &self.cfg.anon_key)
            .bearer_auth(token)
    }

    async fn check(res: reqwest::Response) -> Result<reqwest::Response, SyncError> {
        match res.status() {
            s if s.is_success() => Ok(res),
            reqwest::StatusCode::UNAUTHORIZED => Err(SyncError::Unauthorized),
            s => {
                let body: Value = res.json().await.unwrap_or(Value::Null);
                Err(SyncError::Other(format!("Server lỗi {}: {}", s.as_u16(), error_text(&body))))
            }
        }
    }

    pub async fn upsert(
        &self,
        table: &str,
        rows: &[Value],
        ignore_duplicates: bool,
        token: &str,
    ) -> Result<(), SyncError> {
        if rows.is_empty() {
            return Ok(());
        }
        let resolution = if ignore_duplicates { "ignore-duplicates" } else { "merge-duplicates" };
        let res = self
            .rest(reqwest::Method::POST, &format!("{table}?on_conflict=user_id,id"), token)
            .header("Prefer", format!("resolution={resolution},return=minimal"))
            .json(rows)
            .send()
            .await
            .map_err(|_| SyncError::Other("Không kết nối được tới server.".into()))?;
        Self::check(res).await.map(|_| ())
    }

    pub async fn pull(&self, table: &str, since: Option<&str>, token: &str) -> Result<Vec<Value>, SyncError> {
        let mut path = format!("{table}?select=*&order=server_updated_at.asc&limit={PAGE}");
        if let Some(since) = since {
            path.push_str(&format!("&server_updated_at=gt.{}", urlencode(since)));
        }
        let res = self
            .rest(reqwest::Method::GET, &path, token)
            .send()
            .await
            .map_err(|_| SyncError::Other("Không kết nối được tới server.".into()))?;
        let res = Self::check(res).await?;
        res.json::<Vec<Value>>().await.map_err(|e| SyncError::Other(e.to_string()))
    }

    pub async fn rpc(&self, name: &str, token: &str) -> Result<(), SyncError> {
        let res = self
            .rest(reqwest::Method::POST, &format!("rpc/{name}"), token)
            .json(&json!({}))
            .send()
            .await
            .map_err(|_| SyncError::Other("Không kết nối được tới server.".into()))?;
        Self::check(res).await.map(|_| ())
    }
}

pub fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}

fn format_ts(d: DateTime<Utc>) -> String {
    d.to_rfc3339_opts(SecondsFormat::Micros, true)
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub pushed: usize,
    pub pulled: usize,
    pub changed: usize,
}

pub struct DeviceInfo {
    pub name: String,
    pub version: String,
}

fn lock(store: &Mutex<Store>) -> std::sync::MutexGuard<'_, Store> {
    store.lock().unwrap_or_else(|e| e.into_inner())
}

/// One round: push local changes, record this device, pull everything newer than the cursors.
pub async fn sync_once(
    store: &Mutex<Store>,
    api: &Api,
    token: &str,
    device: &DeviceInfo,
    now: i64,
) -> Result<Report, SyncError> {
    let mut report = Report::default();
    let device_id = lock(store).device_id();
    for table in TABLES {
        let rows = lock(store).dirty_rows(table, &device_id, now);
        for chunk in rows.chunks(500) {
            api.upsert(table, chunk, table == "intercept_events", token).await?;
            lock(store).mark_clean(table, chunk);
            report.pushed += chunk.len();
        }
    }
    let me = json!({"id": device_id, "platform": "windows", "name": device.name, "version": device.version,
        "last_seen": now, "updated_at": now});
    api.upsert("devices", &[me], false, token).await?;

    for table in TABLES {
        let cursor = lock(store).cursor(table);
        let mut since =
            cursor.as_deref().and_then(parse_ts).map(|d| format_ts(d - ChronoDuration::minutes(CURSOR_OVERLAP_MIN)));
        loop {
            let rows = api.pull(table, since.as_deref(), token).await?;
            let mut newest = cursor.as_deref().and_then(parse_ts);
            {
                let s = lock(store);
                for row in &rows {
                    if s.apply_remote(table, row, &device_id) {
                        report.changed += 1;
                    }
                    if let Some(ts) = row.get("server_updated_at").and_then(Value::as_str).and_then(parse_ts) {
                        if newest.is_none_or(|n| ts > n) {
                            newest = Some(ts);
                        }
                    }
                }
                if let Some(n) = newest {
                    s.set_cursor(table, &format_ts(n));
                }
            }
            report.pulled += rows.len();
            if rows.len() < PAGE {
                break;
            }
            since = newest.map(format_ts);
        }
    }
    lock(store).kv_set("lastSync", &now.to_string());
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_rfc7636_example() {
        // Example from RFC 7636, appendix B.
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert_eq!(new_verifier().len(), 64);
    }

    #[test]
    fn url_encoding_and_timestamps() {
        assert_eq!(urlencode("dopadam://auth-callback"), "dopadam%3A%2F%2Fauth-callback");
        assert_eq!(urlencode("2026-10-12T05:00:00.123456Z"), "2026-10-12T05%3A00%3A00.123456Z");
        let t = parse_ts("2026-10-12T05:00:00.123456+00:00").unwrap();
        assert_eq!(format_ts(t), "2026-10-12T05:00:00.123456Z");
        assert_eq!(format_ts(t - ChronoDuration::minutes(5)), "2026-10-12T04:55:00.123456Z");
    }

    #[test]
    fn auth_errors_are_translated() {
        assert_eq!(friendly_auth_error("Invalid login credentials"), "Sai email hoặc mật khẩu.");
        assert_eq!(
            friendly_auth_error("Email not confirmed"),
            "Email chưa được xác nhận. Mở thư xác nhận rồi đăng nhập lại."
        );
        assert_eq!(friendly_auth_error("User already registered"), "Email này đã có tài khoản. Hãy đăng nhập.");
    }

    /// Full round trip against supabase/test/mock-server.mjs (real SQL + RLS in PGlite).
    /// Run with DOPADAM_MOCK_SUPABASE=http://127.0.0.1:<port> cargo test -- --ignored
    #[tokio::test]
    #[ignore]
    async fn round_trip_against_mock_supabase() {
        let url = std::env::var("DOPADAM_MOCK_SUPABASE").expect("DOPADAM_MOCK_SUPABASE");
        let api = Api::new(Config { url, anon_key: "anon".into() });
        let now = crate::core::now_ms();
        let email = format!("t{}@example.com", now);
        let session = match api.sign_up(&email, "secret123", now).await.unwrap() {
            Some(s) => s,
            None => api.sign_in(&email, "secret123", now).await.unwrap(),
        };
        let refreshed = api.refresh(&session.stored.refresh_token, now).await.unwrap();
        assert_eq!(refreshed.stored.user_id, session.stored.user_id);
        assert_eq!(api.sign_in(&email, "wrong-pass", now).await.unwrap_err(), "Sai email hoặc mật khẩu.");

        let device = DeviceInfo { name: "PC".into(), version: "0.1.0".into() };
        let pc = Mutex::new(Store::open_in_memory().unwrap());
        lock(&pc).ensure_defaults(now);
        lock(&pc).set_rule_tag("exe", "steam.exe", Some("game"), false, now).unwrap();
        lock(&pc).record_warning("ev1", "steam.exe", "game", now);
        lock(&pc).auto_exit("ev1", now + 1000);
        lock(&pc).add_usage("game", 600.0, now);
        let r = sync_once(&pc, &api, &session.access_token, &device, now + 2000).await.unwrap();
        assert!(r.pushed >= 6, "{r:?}");

        // A second device of the same user sees everything.
        let phone = Mutex::new(Store::open_in_memory().unwrap());
        let r2 = sync_once(&phone, &api, &session.access_token, &device, now + 3000).await.unwrap();
        assert!(r2.pulled >= 6, "{r2:?}");
        assert_eq!(lock(&phone).rule("exe", "steam.exe").unwrap().tag, "game");
        assert_eq!(lock(&phone).shown_since(now - 1000).len(), 1);
        assert!((lock(&phone).used_minutes(now) - 10.0).abs() < 1e-9);

        // Newest wins across devices.
        lock(&phone).set_rule_tag("exe", "steam.exe", Some("entertainment"), false, now + 4000).unwrap();
        sync_once(&phone, &api, &session.access_token, &device, now + 5000).await.unwrap();
        sync_once(&pc, &api, &session.access_token, &device, now + 6000).await.unwrap();
        assert_eq!(lock(&pc).rule("exe", "steam.exe").unwrap().tag, "entertainment");

        // Another user sees nothing of it.
        let other = api.sign_up(&format!("o{}@example.com", now), "secret123", now).await.unwrap().unwrap();
        assert!(api.pull("tag_rules", None, &other.access_token).await.unwrap().is_empty());

        api.rpc("delete_my_data", &session.access_token).await.unwrap();
        assert!(api.pull("tag_rules", None, &session.access_token).await.unwrap().is_empty());
        assert!(matches!(api.pull("tag_rules", None, "not-a-token").await, Err(SyncError::Unauthorized)));
    }
}
