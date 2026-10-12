//! Local SQLite store (%APPDATA%\DopaDam\dopadam.db) and the operations on it.
//! Every row that syncs carries updated_at and a dirty flag; deletions are soft (deleted = 1).

use crate::core::{day_key, local_tz_offset, resolve_study, Session, Settings, StudyRule, StudyStatus, DAY_MS};
use crate::logic::{
    check_app_delay, check_decision, check_friction, check_protection, check_tag_change, plan_warning, Decision,
    DecisionCheck, ErrorCode, WarningPlan,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const RETENTION_DAYS: i64 = 30;
pub const KIND_EXE: &str = "exe";
pub const KIND_DOMAIN: &str = "domain";
pub const KIND_ALLOW_URL: &str = "allow_url";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    pub kind: String,
    pub pattern: String,
    pub tag: String,
    pub delay_seconds: Option<i64>,
    pub updated_at: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub device_id: String,
    pub object: String,
    pub tag: String,
    pub level: i64,
    pub lock_seconds: i64,
    pub n: i64,
    pub shown_at: i64,
    pub study_label: Option<String>,
    pub decision: Option<String>,
    pub decided_at: Option<i64>,
    pub allow_minutes: Option<i64>,
    pub activity: Option<String>,
    pub activity_minutes: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowWindow {
    pub object: String,
    pub expires_at: i64,
    pub heads_up_sent: bool,
}

/// A link that is allowed on an otherwise blocked site (same shape as the extension's AllowEntry).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AllowEntry {
    Video { id: String },
    Playlist { id: String },
    Prefix { value: String },
}

impl AllowEntry {
    pub fn to_pattern(&self) -> String {
        match self {
            AllowEntry::Video { id } => format!("video:{id}"),
            AllowEntry::Playlist { id } => format!("playlist:{id}"),
            AllowEntry::Prefix { value } => format!("prefix:{value}"),
        }
    }

    pub fn from_pattern(p: &str) -> Option<AllowEntry> {
        let (kind, rest) = p.split_once(':')?;
        if rest.is_empty() {
            return None;
        }
        match kind {
            "video" => Some(AllowEntry::Video { id: rest.into() }),
            "playlist" => Some(AllowEntry::Playlist { id: rest.into() }),
            "prefix" => Some(AllowEntry::Prefix { value: rest.into() }),
            _ => None,
        }
    }

    /// Mirrors isAllowedUrl in extension/src/core/allowUrl.ts for the URLs the extension reports.
    pub fn matches(&self, url: &str) -> bool {
        let Some(rest) = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")) else {
            return false;
        };
        let rest = rest.split('#').next().unwrap_or("");
        let (authority, path_query) = match rest.find(['/', '?']) {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, ""),
        };
        let host = authority.split(':').next().unwrap_or("").to_lowercase();
        let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
        let (path, query) = match path_query.split_once('?') {
            Some((p, q)) => (p, Some(q)),
            None => (path_query, None),
        };
        let param = |name: &str| {
            query.and_then(|q| {
                q.split('&').find_map(|kv| kv.split_once('=').filter(|(k, _)| *k == name).map(|(_, v)| v))
            })
        };
        let youtube = host == "youtube.com" || host.ends_with(".youtube.com") || host == "youtu.be";
        match self {
            AllowEntry::Video { id } if youtube => {
                let video = if host == "youtu.be" {
                    path.trim_start_matches('/').split('/').next().filter(|s| !s.is_empty())
                } else if path == "/watch" {
                    param("v")
                } else {
                    None
                };
                video == Some(id.as_str())
            }
            AllowEntry::Playlist { id } if youtube => {
                let list_page = host == "youtu.be" || path == "/watch" || path == "/playlist";
                list_page && param("list") == Some(id.as_str())
            }
            AllowEntry::Prefix { value } if !youtube => {
                let full = format!(
                    "{host}{}{}",
                    path.trim_end_matches('/'),
                    query.map(|q| format!("?{q}")).unwrap_or_default()
                );
                full == *value
                    || (full.starts_with(value.as_str())
                        && matches!(full.as_bytes().get(value.len()), Some(b'/' | b'?' | b'#')))
            }
            _ => false,
        }
    }
}

pub fn rule_id(kind: &str, pattern: &str) -> String {
    format!("{kind}:{pattern}")
}

pub struct Store {
    conn: Connection,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tag_rules (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, pattern TEXT NOT NULL, tag TEXT NOT NULL, delay_seconds INTEGER,
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 1,
  UNIQUE(kind, pattern));
CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL, dirty INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS intercept_events (
  id TEXT PRIMARY KEY, device_id TEXT NOT NULL, object TEXT NOT NULL, tag TEXT NOT NULL, level INTEGER NOT NULL,
  lock_seconds INTEGER NOT NULL, n INTEGER NOT NULL, shown_at INTEGER NOT NULL, study_label TEXT, decision TEXT,
  decided_at INTEGER, allow_minutes INTEGER, activity TEXT, activity_minutes INTEGER, dirty INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS idx_events_shown ON intercept_events(shown_at);
CREATE TABLE IF NOT EXISTS usage_daily (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, device_id TEXT NOT NULL, tag TEXT NOT NULL, seconds REAL NOT NULL,
  updated_at INTEGER NOT NULL, dirty INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS idx_usage_day ON usage_daily(day);
CREATE TABLE IF NOT EXISTS allow_windows (object TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, heads_up_sent INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS study_rules (
  id TEXT PRIMARY KEY, days TEXT NOT NULL, start TEXT NOT NULL, "end" TEXT NOT NULL, label TEXT, exceptions TEXT NOT NULL,
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS study_sessions (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, start INTEGER NOT NULL, "end" INTEGER NOT NULL, label TEXT, external_id TEXT,
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS seen_apps (exe TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT, first_seen INTEGER NOT NULL, source TEXT NOT NULL);
"#;

pub const DEFAULT_DOMAINS: [&str; 3] = ["youtube.com", "facebook.com", "tiktok.com"];

type Res<T> = Result<T, ErrorCode>;

fn event_from_row(r: &rusqlite::Row) -> rusqlite::Result<Event> {
    Ok(Event {
        id: r.get("id")?,
        device_id: r.get("device_id")?,
        object: r.get("object")?,
        tag: r.get("tag")?,
        level: r.get("level")?,
        lock_seconds: r.get("lock_seconds")?,
        n: r.get("n")?,
        shown_at: r.get("shown_at")?,
        study_label: r.get("study_label")?,
        decision: r.get("decision")?,
        decided_at: r.get("decided_at")?,
        allow_minutes: r.get("allow_minutes")?,
        activity: r.get("activity")?,
        activity_minutes: r.get("activity_minutes")?,
    })
}

fn rule_from_row(r: &rusqlite::Row) -> rusqlite::Result<Rule> {
    Ok(Rule {
        id: r.get("id")?,
        kind: r.get("kind")?,
        pattern: r.get("pattern")?,
        tag: r.get("tag")?,
        delay_seconds: r.get("delay_seconds")?,
        updated_at: r.get("updated_at")?,
    })
}

impl Store {
    pub fn open(path: &Path) -> rusqlite::Result<Store> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> rusqlite::Result<Store> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> rusqlite::Result<Store> {
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Store { conn })
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    // ---- Key/value ---------------------------------------------------------------

    pub fn kv_get(&self, key: &str) -> Option<String> {
        self.conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).optional().ok().flatten()
    }

    pub fn kv_set(&self, key: &str, value: &str) {
        let _ = self.conn.execute(
            "INSERT INTO kv(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
        );
    }

    pub fn kv_delete(&self, key: &str) {
        let _ = self.conn.execute("DELETE FROM kv WHERE key = ?1", [key]);
    }

    pub fn device_id(&self) -> String {
        if let Some(id) = self.kv_get("deviceId") {
            return id;
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.kv_set("deviceId", &id);
        id
    }

    /// Protection is per device: turning it off on the computer does not affect the phone.
    pub fn protection_enabled(&self) -> bool {
        self.kv_get("protectionEnabled").as_deref() != Some("0")
    }

    // ---- Settings ------------------------------------------------------------------

    pub fn settings(&self) -> Settings {
        let json: Option<String> = self
            .conn
            .query_row("SELECT json FROM settings WHERE id = 'settings'", [], |r| r.get(0))
            .optional()
            .ok()
            .flatten();
        json.map(|j| Settings::from_json(&j)).unwrap_or_default()
    }

    fn write_settings(&self, s: &Settings, now: i64) {
        let _ = self.conn.execute(
            "INSERT INTO settings(id, json, updated_at, dirty) VALUES('settings', ?1, ?2, 1)
             ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, dirty = 1",
            params![s.to_json(), now],
        );
    }

    // ---- Rules -----------------------------------------------------------------------

    pub fn rules(&self, kind: &str) -> Vec<Rule> {
        let mut stmt = self
            .conn
            .prepare("SELECT * FROM tag_rules WHERE kind = ?1 AND deleted = 0 ORDER BY pattern")
            .expect("rules query");
        stmt.query_map([kind], rule_from_row).map(|rows| rows.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    pub fn rule(&self, kind: &str, pattern: &str) -> Option<Rule> {
        self.conn
            .query_row("SELECT * FROM tag_rules WHERE id = ?1 AND deleted = 0", [rule_id(kind, pattern)], rule_from_row)
            .optional()
            .ok()
            .flatten()
    }

    fn write_rule(&self, kind: &str, pattern: &str, tag: Option<&str>, delay: Option<i64>, now: i64) {
        let id = rule_id(kind, pattern);
        match tag {
            Some(tag) => {
                let _ = self.conn.execute(
                    "INSERT INTO tag_rules(id, kind, pattern, tag, delay_seconds, updated_at, deleted, dirty)
                     VALUES(?1, ?2, ?3, ?4, ?5, ?6, 0, 1)
                     ON CONFLICT(id) DO UPDATE SET tag = excluded.tag, delay_seconds = excluded.delay_seconds,
                       updated_at = excluded.updated_at, deleted = 0, dirty = 1",
                    params![id, kind, pattern, tag, delay, now],
                );
            }
            None => {
                let _ = self.conn.execute(
                    "UPDATE tag_rules SET deleted = 1, updated_at = ?2, dirty = 1 WHERE id = ?1",
                    params![id, now],
                );
            }
        }
    }

    /// First run: Edge is handled by the extension, and the same three sites as the extension are blocked.
    pub fn ensure_defaults(&self, now: i64) {
        if self.kv_get("defaultsApplied").is_some() {
            return;
        }
        self.write_rule(KIND_EXE, "msedge.exe", Some("ignore"), None, now);
        for d in DEFAULT_DOMAINS {
            self.write_rule(KIND_DOMAIN, d, Some("entertainment"), None, now);
        }
        self.kv_set("defaultsApplied", "1");
    }

    pub fn allow_entries(&self) -> Vec<AllowEntry> {
        self.rules(KIND_ALLOW_URL).iter().filter_map(|r| AllowEntry::from_pattern(&r.pattern)).collect()
    }

    // ---- Study -----------------------------------------------------------------------

    pub fn study_rules(&self) -> Vec<StudyRule> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, days, start, \"end\", label, exceptions FROM study_rules WHERE deleted = 0")
            .expect("study rules");
        stmt.query_map([], |r| {
            let days: String = r.get(1)?;
            let exceptions: String = r.get(5)?;
            Ok(StudyRule {
                id: r.get(0)?,
                days: days.split(',').filter_map(|d| d.trim().parse().ok()).collect(),
                start: r.get(2)?,
                end: r.get(3)?,
                label: r.get(4)?,
                exceptions: exceptions.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
            })
        })
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
    }

    pub fn sessions(&self, source: &str, ending_after: i64) -> Vec<Session> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, start, \"end\", label FROM study_sessions WHERE deleted = 0 AND source = ?1 AND \"end\" > ?2")
            .expect("sessions");
        stmt.query_map(params![source, ending_after], |r| {
            Ok(Session { id: r.get(0)?, start: r.get(1)?, end: r.get(2)?, label: r.get(3)? })
        })
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
    }

    pub fn study_status(&self, now: i64) -> StudyStatus {
        let since = now - DAY_MS;
        resolve_study(
            now,
            local_tz_offset(now),
            &self.sessions("manual", since),
            &self.study_rules(),
            &self.sessions("taskflow", since),
        )
    }

    // ---- Usage and budget -------------------------------------------------------------

    pub fn add_usage(&self, tag: &str, seconds: f64, now: i64) {
        if seconds <= 0.0 {
            return;
        }
        let day = day_key(now, local_tz_offset(now));
        let device = self.device_id();
        let id = format!("{day}|{device}|{tag}");
        let _ = self.conn.execute(
            "INSERT INTO usage_daily(id, day, device_id, tag, seconds, updated_at, dirty) VALUES(?1, ?2, ?3, ?4, ?5, ?6, 1)
             ON CONFLICT(id) DO UPDATE SET seconds = seconds + excluded.seconds, updated_at = excluded.updated_at, dirty = 1",
            params![id, day, device, tag, seconds, now],
        );
    }

    /// Entertainment + game minutes today, across every device that synced its usage.
    pub fn used_minutes(&self, now: i64) -> f64 {
        let day = day_key(now, local_tz_offset(now));
        let secs: f64 = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(seconds), 0) FROM usage_daily WHERE day = ?1 AND tag IN ('entertainment', 'game')",
                [day],
                |r| r.get(0),
            )
            .unwrap_or(0.0);
        secs / 60.0
    }

    // ---- Warnings ---------------------------------------------------------------------

    pub fn shown_since(&self, since: i64) -> Vec<i64> {
        let mut stmt = self.conn.prepare("SELECT shown_at FROM intercept_events WHERE shown_at > ?1").expect("shown");
        stmt.query_map([since], |r| r.get(0)).map(|rows| rows.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    pub fn event(&self, id: &str) -> Option<Event> {
        self.conn
            .query_row("SELECT * FROM intercept_events WHERE id = ?1", [id], event_from_row)
            .optional()
            .ok()
            .flatten()
    }

    pub fn events_since(&self, since: i64) -> Vec<Event> {
        let mut stmt =
            self.conn.prepare("SELECT * FROM intercept_events WHERE shown_at >= ?1 ORDER BY shown_at").expect("events");
        stmt.query_map([since], event_from_row).map(|rows| rows.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    /// Records a warning being shown and returns the plan (level, lock, options) it was shown with.
    pub fn record_warning(&self, id: &str, object: &str, tag: &str, now: i64) -> (Event, WarningPlan) {
        if let Some(existing) = self.event(id) {
            let s = self.settings();
            let plan = WarningPlan {
                level: existing.level,
                lock_seconds: existing.lock_seconds,
                allow_options: crate::core::allow_options_for(&s, existing.level).to_vec(),
                n: existing.n,
                study_label: existing.study_label.clone(),
            };
            return (existing, plan);
        }
        let plan = plan_warning(
            &self.shown_since(now - DAY_MS),
            now,
            &self.study_status(now),
            self.used_minutes(now),
            &self.settings(),
        );
        let event = Event {
            id: id.to_string(),
            device_id: self.device_id(),
            object: object.to_string(),
            tag: tag.to_string(),
            level: plan.level,
            lock_seconds: plan.lock_seconds,
            n: plan.n,
            shown_at: now,
            study_label: plan.study_label.clone(),
            decision: None,
            decided_at: None,
            allow_minutes: None,
            activity: None,
            activity_minutes: None,
        };
        let _ = self.conn.execute(
            "INSERT INTO intercept_events(id, device_id, object, tag, level, lock_seconds, n, shown_at, study_label, dirty)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1)",
            params![event.id, event.device_id, event.object, event.tag, event.level, event.lock_seconds, event.n, event.shown_at, event.study_label],
        );
        (event, plan)
    }

    pub fn decide(
        &self,
        id: &str,
        decision: Decision,
        allow_minutes: Option<i64>,
        activity: Option<&str>,
        activity_minutes: Option<i64>,
        now: i64,
    ) -> Res<Event> {
        let event = self.event(id).ok_or(ErrorCode::UnknownEvent)?;
        let check = DecisionCheck {
            decision,
            existing: event.decision.as_deref(),
            shown_at: event.shown_at,
            lock_seconds: event.lock_seconds,
            level: event.level,
            allow_minutes,
            activity,
            activity_minutes,
        };
        if let Some(e) = check_decision(&check, &self.settings(), now) {
            return Err(e);
        }
        if event.decision.is_some() {
            return Ok(event);
        }
        let (allow, act, act_min) = match decision {
            Decision::Enter => (allow_minutes, None, None),
            Decision::Alternative => (None, activity, activity_minutes),
            Decision::Exit => (None, None, None),
        };
        let _ = self.conn.execute(
            "UPDATE intercept_events SET decision = ?2, decided_at = ?3, allow_minutes = ?4, activity = ?5, activity_minutes = ?6, dirty = 1
             WHERE id = ?1",
            params![id, decision.id(), now, allow, act, act_min],
        );
        if let (Decision::Enter, Some(m)) = (decision, allow_minutes) {
            self.set_allow_window(&event.object, now + m * 60_000);
        }
        Ok(self.event(id).expect("event just updated"))
    }

    /// A warning that disappears without a decision counts as leaving.
    pub fn auto_exit(&self, id: &str, now: i64) {
        let _ = self.conn.execute(
            "UPDATE intercept_events SET decision = 'exit', decided_at = ?2, dirty = 1 WHERE id = ?1 AND decision IS NULL",
            params![id, now],
        );
    }

    pub fn today_counts(&self, now: i64) -> (i64, i64) {
        let tz = local_tz_offset(now);
        let today = day_key(now, tz);
        let events = self.events_since(now - DAY_MS);
        let todays: Vec<&Event> = events.iter().filter(|e| day_key(e.shown_at, tz) == today).collect();
        (todays.len() as i64, todays.iter().filter(|e| e.decision.as_deref() == Some("exit")).count() as i64)
    }

    // ---- Allow windows ------------------------------------------------------------------

    pub fn allow_windows(&self) -> Vec<AllowWindow> {
        let mut stmt =
            self.conn.prepare("SELECT object, expires_at, heads_up_sent FROM allow_windows").expect("windows");
        stmt.query_map([], |r| {
            Ok(AllowWindow { object: r.get(0)?, expires_at: r.get(1)?, heads_up_sent: r.get::<_, i64>(2)? != 0 })
        })
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
    }

    pub fn set_allow_window(&self, object: &str, expires_at: i64) {
        let _ = self.conn.execute(
            "INSERT INTO allow_windows(object, expires_at, heads_up_sent) VALUES(?1, ?2, 0)
             ON CONFLICT(object) DO UPDATE SET expires_at = excluded.expires_at, heads_up_sent = 0",
            params![object, expires_at],
        );
    }

    pub fn mark_heads_up(&self, object: &str) {
        let _ = self.conn.execute("UPDATE allow_windows SET heads_up_sent = 1 WHERE object = ?1", [object]);
    }

    pub fn remove_allow_window(&self, object: &str) {
        let _ = self.conn.execute("DELETE FROM allow_windows WHERE object = ?1", [object]);
    }

    // ---- Seen apps --------------------------------------------------------------------

    pub fn note_app(&self, exe: &str, name: &str, path: Option<&str>, source: &str, now: i64) -> bool {
        self.conn
            .execute(
                "INSERT INTO seen_apps(exe, name, path, first_seen, source) VALUES(?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(exe) DO NOTHING",
                params![exe, name, path, now, source],
            )
            .map(|n| n > 0)
            .unwrap_or(false)
    }

    pub fn seen_apps(&self) -> Vec<(String, String, Option<String>)> {
        let mut stmt =
            self.conn.prepare("SELECT exe, name, path FROM seen_apps ORDER BY name COLLATE NOCASE").expect("apps");
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default()
    }

    // ---- Options with friction checks -------------------------------------------------

    pub fn set_rule_tag(&self, kind: &str, pattern: &str, tag: Option<&str>, confirmed: bool, now: i64) -> Res<()> {
        if tag.is_some_and(|t| !crate::core::is_tag(t)) || pattern.is_empty() {
            return Err(ErrorCode::Invalid);
        }
        let existing = self.rule(kind, pattern);
        let old = existing.as_ref().map(|r| r.tag.as_str());
        if let Some(e) = check_tag_change(old, tag, confirmed, self.study_status(now).active) {
            return Err(e);
        }
        if old != tag {
            self.write_rule(kind, pattern, tag, existing.and_then(|r| r.delay_seconds), now);
        }
        Ok(())
    }

    pub fn set_rule_delay(&self, kind: &str, pattern: &str, delay: Option<i64>, confirmed: bool, now: i64) -> Res<()> {
        let rule = self.rule(kind, pattern).ok_or(ErrorCode::Invalid)?;
        if let Some(e) = check_app_delay(
            &rule.tag,
            rule.delay_seconds,
            delay,
            &self.settings(),
            confirmed,
            self.study_status(now).active,
        ) {
            return Err(e);
        }
        if rule.delay_seconds != delay {
            self.write_rule(kind, pattern, Some(&rule.tag), delay, now);
        }
        Ok(())
    }

    pub fn set_settings(&self, new: &Settings, confirmed: bool, now: i64) -> Res<()> {
        let old = self.settings();
        if let Some(e) = check_friction(&old, new, confirmed, self.study_status(now).active) {
            return Err(e);
        }
        if old != *new {
            self.write_settings(new, now);
        }
        Ok(())
    }

    pub fn set_protection(&self, enabled: bool, confirmed: bool, now: i64) -> Res<()> {
        if let Some(e) = check_protection(self.protection_enabled(), enabled, confirmed, self.study_status(now).active)
        {
            return Err(e);
        }
        self.kv_set("protectionEnabled", if enabled { "1" } else { "0" });
        Ok(())
    }

    /// Adding an allowed link always needs confirmation, but is permitted during study.
    pub fn add_allow_url(&self, entry: &AllowEntry, confirmed: bool, now: i64) -> Res<()> {
        let pattern = entry.to_pattern();
        if self.rule(KIND_ALLOW_URL, &pattern).is_some() {
            return Ok(());
        }
        if !confirmed {
            return Err(ErrorCode::NeedsConfirm);
        }
        self.write_rule(KIND_ALLOW_URL, &pattern, Some("study"), None, now);
        Ok(())
    }

    pub fn remove_allow_url(&self, entry: &AllowEntry, now: i64) {
        self.write_rule(KIND_ALLOW_URL, &entry.to_pattern(), None, None, now);
    }

    pub fn clear_log(&self, confirmed: bool) -> Res<()> {
        if !confirmed {
            return Err(ErrorCode::NeedsConfirm);
        }
        let _ = self.conn.execute_batch("DELETE FROM intercept_events; DELETE FROM usage_daily;");
        Ok(())
    }

    pub fn prune(&self, now: i64) {
        let cutoff = now - RETENTION_DAYS * DAY_MS;
        let cutoff_day = day_key(cutoff, local_tz_offset(now));
        let _ = self.conn.execute(
            "UPDATE intercept_events SET decision = 'exit', decided_at = ?1, dirty = 1 WHERE decision IS NULL AND shown_at < ?2",
            params![now, now - 10 * 60_000],
        );
        let _ = self.conn.execute("DELETE FROM intercept_events WHERE shown_at < ?1", [cutoff]);
        let _ = self.conn.execute("DELETE FROM usage_daily WHERE day < ?1", [cutoff_day]);
        let _ = self.conn.execute("DELETE FROM allow_windows WHERE expires_at < ?1", [now - DAY_MS]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_791_810_000_000;
    const MIN: i64 = 60_000;

    fn store() -> Store {
        let s = Store::open_in_memory().unwrap();
        s.ensure_defaults(NOW - DAY_MS);
        s
    }

    #[test]
    fn defaults_and_rules() {
        let s = store();
        assert_eq!(s.rule(KIND_EXE, "msedge.exe").unwrap().tag, "ignore");
        assert_eq!(s.rules(KIND_DOMAIN).len(), 3);
        assert_eq!(s.set_rule_tag(KIND_DOMAIN, "youtube.com", Some("study"), false, NOW), Err(ErrorCode::NeedsConfirm));
        assert_eq!(s.set_rule_tag(KIND_DOMAIN, "youtube.com", None, true, NOW), Ok(()));
        assert!(s.rule(KIND_DOMAIN, "youtube.com").is_none());
        assert_eq!(s.set_rule_tag(KIND_EXE, "steam.exe", Some("game"), false, NOW), Ok(()));
        assert_eq!(s.set_rule_delay(KIND_EXE, "steam.exe", Some(60), false, NOW), Err(ErrorCode::NeedsConfirm));
        assert_eq!(s.set_rule_delay(KIND_EXE, "steam.exe", Some(10), false, NOW), Ok(()));
        assert_eq!(s.rule(KIND_EXE, "steam.exe").unwrap().delay_seconds, Some(10));
        assert_eq!(s.set_rule_tag(KIND_EXE, "steam.exe", Some("bogus"), true, NOW), Err(ErrorCode::Invalid));
    }

    #[test]
    fn warnings_escalate_and_decisions_apply() {
        let s = store();
        let (e1, p1) = s.record_warning("a", "steam.exe", "game", NOW);
        assert_eq!((p1.level, e1.lock_seconds), (0, 5));
        let (_, p2) = s.record_warning("b", "steam.exe", "game", NOW + MIN);
        assert_eq!(p2.level, 1);
        // Re-recording the same id returns the same event.
        let (again, _) = s.record_warning("a", "steam.exe", "game", NOW + 2 * MIN);
        assert_eq!(again.shown_at, NOW);
        assert_eq!(s.decide("a", Decision::Enter, Some(5), None, None, NOW + 1000), Err(ErrorCode::Locked));
        assert!(s.decide("a", Decision::Enter, Some(15), None, None, NOW + 6000).is_ok());
        let w = s.allow_windows();
        assert_eq!(
            w,
            vec![AllowWindow { object: "steam.exe".into(), expires_at: NOW + 6000 + 15 * MIN, heads_up_sent: false }]
        );
        assert_eq!(s.decide("a", Decision::Exit, None, None, None, NOW + 7000), Err(ErrorCode::AlreadyDecided));
        s.auto_exit("b", NOW + 70_000);
        assert_eq!(s.event("b").unwrap().decision.as_deref(), Some("exit"));
        assert_eq!(s.today_counts(NOW + 80_000), (2, 1));
        assert_eq!(s.decide("zzz", Decision::Exit, None, None, None, NOW), Err(ErrorCode::UnknownEvent));
    }

    #[test]
    fn budget_and_study_raise_the_level() {
        let s = store();
        s.add_usage("entertainment", 60.0 * 60.0, NOW);
        s.add_usage("game", 30.0 * 60.0, NOW);
        assert!((s.used_minutes(NOW) - 90.0).abs() < 1e-9);
        assert_eq!(s.record_warning("a", "x.exe", "entertainment", NOW).1.level, 3);

        let t = store();
        t.conn()
            .execute(
                "INSERT INTO study_sessions(id, source, start, \"end\", label, updated_at) VALUES('m', 'manual', ?1, ?2, 'Ôn bài', ?1)",
                params![NOW - MIN, NOW + 30 * MIN],
            )
            .unwrap();
        let st = t.study_status(NOW);
        assert!(st.active);
        assert_eq!(st.label.as_deref(), Some("Ôn bài"));
        assert_eq!(t.set_rule_tag(KIND_EXE, "a.exe", Some("game"), true, NOW), Err(ErrorCode::StudyLocked));
        // Adding an allowed link still works during study (with confirmation).
        let link = AllowEntry::Video { id: "abc".into() };
        assert_eq!(t.add_allow_url(&link, false, NOW), Err(ErrorCode::NeedsConfirm));
        assert_eq!(t.add_allow_url(&link, true, NOW), Ok(()));
        assert_eq!(t.allow_entries(), vec![link]);
    }

    #[test]
    fn allow_entry_matching_mirrors_the_extension() {
        let v = AllowEntry::Video { id: "abc123".into() };
        let p = AllowEntry::Playlist { id: "PL1".into() };
        let f = AllowEntry::Prefix { value: "facebook.com/groups/lophoc".into() };
        assert!(v.matches("https://www.youtube.com/watch?v=abc123&t=1"));
        assert!(v.matches("https://youtu.be/abc123"));
        assert!(!v.matches("https://www.youtube.com/watch?v=abc1234"));
        assert!(!v.matches("https://www.youtube.com/shorts/abc123"));
        assert!(p.matches("https://www.youtube.com/watch?v=x&list=PL1"));
        assert!(!p.matches("https://www.youtube.com/results?list=PL1"));
        assert!(f.matches("https://www.facebook.com/groups/lophoc/posts/1"));
        assert!(f.matches("https://www.facebook.com/groups/lophoc"));
        assert!(!f.matches("https://www.facebook.com/groups/lophoc2"));
        assert_eq!(AllowEntry::from_pattern(&f.to_pattern()), Some(f));
        assert_eq!(serde_json::to_string(&v).unwrap(), r#"{"kind":"video","id":"abc123"}"#);
    }

    #[test]
    fn settings_and_protection() {
        let s = store();
        let mut weaker = s.settings();
        weaker.budget_minutes = 120;
        assert_eq!(s.set_settings(&weaker, false, NOW), Err(ErrorCode::NeedsConfirm));
        assert_eq!(s.set_settings(&weaker, true, NOW), Ok(()));
        assert_eq!(s.settings().budget_minutes, 120);
        assert_eq!(s.set_protection(false, false, NOW), Err(ErrorCode::NeedsConfirm));
        assert_eq!(s.set_protection(false, true, NOW), Ok(()));
        assert!(!s.protection_enabled());
        assert_eq!(s.clear_log(true), Ok(()));
    }
}
