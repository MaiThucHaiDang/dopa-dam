//! The local side of sync: which rows to push, and how pulled rows are merged.
//! Rules: configuration tables are "newest updated_at wins"; events are append only; usage rows
//! belong to one device, so a device never overwrites its own usage with a pulled copy.

use crate::db::Store;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

pub const TABLES: [&str; 6] =
    ["tag_rules", "settings", "study_rules", "study_sessions", "usage_daily", "intercept_events"];

/// Undecided events are pushed once decided, or after this long (they are closed as Thoát by then).
const UNDECIDED_PUSH_AFTER_MS: i64 = 10 * 60_000;

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(String::from)
}

fn i(v: &Value, k: &str) -> Option<i64> {
    v.get(k).and_then(Value::as_i64)
}

fn b(v: &Value, k: &str) -> bool {
    v.get(k).and_then(Value::as_bool).unwrap_or(false)
}

impl Store {
    /// Rows changed on this device that the server does not have yet, as Supabase JSON.
    pub fn dirty_rows(&self, table: &str, device_id: &str, now: i64) -> Vec<Value> {
        let c = self.conn();
        let rows: rusqlite::Result<Vec<Value>> = match table {
            "tag_rules" => c
                .prepare("SELECT id, kind, pattern, tag, delay_seconds, updated_at, deleted FROM tag_rules WHERE dirty = 1")
                .and_then(|mut st| {
                    st.query_map([], |r| {
                        Ok(json!({"id": r.get::<_, String>(0)?, "kind": r.get::<_, String>(1)?, "pattern": r.get::<_, String>(2)?,
                            "tag": r.get::<_, String>(3)?, "delay_seconds": r.get::<_, Option<i64>>(4)?, "updated_at": r.get::<_, i64>(5)?,
                            "deleted": r.get::<_, i64>(6)? != 0}))
                    })?
                    .collect()
                }),
            "settings" => c.prepare("SELECT id, json, updated_at FROM settings WHERE dirty = 1").and_then(|mut st| {
                st.query_map([], |r| {
                    let text: String = r.get(1)?;
                    Ok(json!({"id": r.get::<_, String>(0)?, "json": serde_json::from_str::<Value>(&text).unwrap_or(json!({})),
                        "updated_at": r.get::<_, i64>(2)?}))
                })?
                .collect()
            }),
            "study_rules" => c
                .prepare("SELECT id, days, start, \"end\", label, exceptions, updated_at, deleted FROM study_rules WHERE dirty = 1")
                .and_then(|mut st| {
                    st.query_map([], |r| {
                        Ok(json!({"id": r.get::<_, String>(0)?, "days": r.get::<_, String>(1)?, "start": r.get::<_, String>(2)?,
                            "end": r.get::<_, String>(3)?, "label": r.get::<_, Option<String>>(4)?, "exceptions": r.get::<_, String>(5)?,
                            "updated_at": r.get::<_, i64>(6)?, "deleted": r.get::<_, i64>(7)? != 0}))
                    })?
                    .collect()
                }),
            "study_sessions" => c
                .prepare("SELECT id, source, start, \"end\", label, external_id, updated_at, deleted FROM study_sessions WHERE dirty = 1")
                .and_then(|mut st| {
                    st.query_map([], |r| {
                        Ok(json!({"id": r.get::<_, String>(0)?, "source": r.get::<_, String>(1)?, "start": r.get::<_, i64>(2)?,
                            "end": r.get::<_, i64>(3)?, "label": r.get::<_, Option<String>>(4)?, "external_id": r.get::<_, Option<String>>(5)?,
                            "updated_at": r.get::<_, i64>(6)?, "deleted": r.get::<_, i64>(7)? != 0}))
                    })?
                    .collect()
                }),
            "usage_daily" => c
                .prepare("SELECT id, day, device_id, tag, seconds, updated_at FROM usage_daily WHERE dirty = 1 AND device_id = ?1")
                .and_then(|mut st| {
                    st.query_map([device_id], |r| {
                        Ok(json!({"id": r.get::<_, String>(0)?, "day": r.get::<_, String>(1)?, "device_id": r.get::<_, String>(2)?,
                            "tag": r.get::<_, String>(3)?, "seconds": r.get::<_, f64>(4)?, "updated_at": r.get::<_, i64>(5)?}))
                    })?
                    .collect()
                }),
            "intercept_events" => c
                .prepare(
                    "SELECT id, device_id, object, tag, level, lock_seconds, n, shown_at, study_label, decision, decided_at,
                            allow_minutes, activity, activity_minutes
                     FROM intercept_events WHERE dirty = 1 AND device_id = ?1 AND (decision IS NOT NULL OR shown_at < ?2)",
                )
                .and_then(|mut st| {
                    st.query_map(params![device_id, now - UNDECIDED_PUSH_AFTER_MS], |r| {
                        Ok(json!({"id": r.get::<_, String>(0)?, "device_id": r.get::<_, String>(1)?, "object": r.get::<_, String>(2)?,
                            "tag": r.get::<_, String>(3)?, "level": r.get::<_, i64>(4)?, "lock_seconds": r.get::<_, i64>(5)?,
                            "n": r.get::<_, i64>(6)?, "shown_at": r.get::<_, i64>(7)?, "study_label": r.get::<_, Option<String>>(8)?,
                            "decision": r.get::<_, Option<String>>(9)?, "decided_at": r.get::<_, Option<i64>>(10)?,
                            "allow_minutes": r.get::<_, Option<i64>>(11)?, "activity": r.get::<_, Option<String>>(12)?,
                            "activity_minutes": r.get::<_, Option<i64>>(13)?}))
                    })?
                    .collect()
                }),
            _ => Ok(vec![]),
        };
        rows.unwrap_or_default()
    }

    /// Marks pushed rows clean, unless they changed again while the push was in flight.
    pub fn mark_clean(&self, table: &str, rows: &[Value]) {
        for row in rows {
            let id = s(row, "id").unwrap_or_default();
            let _ = match table {
                "intercept_events" => self.conn().execute(
                    "UPDATE intercept_events SET dirty = 0 WHERE id = ?1 AND decision IS ?2",
                    params![id, s(row, "decision")],
                ),
                "tag_rules" | "settings" | "study_rules" | "study_sessions" | "usage_daily" => self.conn().execute(
                    &format!("UPDATE {table} SET dirty = 0 WHERE id = ?1 AND updated_at = ?2"),
                    params![id, i(row, "updated_at").unwrap_or(0)],
                ),
                _ => Ok(0),
            };
        }
    }

    fn local_updated_at(&self, table: &str, id: &str) -> Option<i64> {
        self.conn()
            .query_row(&format!("SELECT updated_at FROM {table} WHERE id = ?1"), [id], |r| r.get(0))
            .optional()
            .ok()
            .flatten()
    }

    /// Merges one pulled row. Returns true when the local data changed.
    pub fn apply_remote(&self, table: &str, row: &Value, my_device: &str) -> bool {
        let Some(id) = s(row, "id") else { return false };
        let updated = i(row, "updated_at").unwrap_or(0);
        let newer = || self.local_updated_at(table, &id).is_none_or(|local| updated > local);
        let c = self.conn();
        let result = match table {
            "tag_rules" if newer() => c.execute(
                "INSERT OR REPLACE INTO tag_rules(id, kind, pattern, tag, delay_seconds, updated_at, deleted, dirty)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
                params![id, s(row, "kind"), s(row, "pattern"), s(row, "tag"), i(row, "delay_seconds"), updated, b(row, "deleted")],
            ),
            "settings" if newer() => c.execute(
                "INSERT OR REPLACE INTO settings(id, json, updated_at, dirty) VALUES(?1, ?2, ?3, 0)",
                params![id, row.get("json").map(Value::to_string).unwrap_or_else(|| "{}".into()), updated],
            ),
            "study_rules" if newer() => c.execute(
                "INSERT OR REPLACE INTO study_rules(id, days, start, \"end\", label, exceptions, updated_at, deleted, dirty)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
                params![id, s(row, "days"), s(row, "start"), s(row, "end"), s(row, "label"), s(row, "exceptions").unwrap_or_default(), updated, b(row, "deleted")],
            ),
            "study_sessions" if newer() => c.execute(
                "INSERT OR REPLACE INTO study_sessions(id, source, start, \"end\", label, external_id, updated_at, deleted, dirty)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
                params![id, s(row, "source"), i(row, "start"), i(row, "end"), s(row, "label"), s(row, "external_id"), updated, b(row, "deleted")],
            ),
            "usage_daily" if s(row, "device_id").as_deref() != Some(my_device) && newer() => c.execute(
                "INSERT OR REPLACE INTO usage_daily(id, day, device_id, tag, seconds, updated_at, dirty) VALUES(?1, ?2, ?3, ?4, ?5, ?6, 0)",
                params![id, s(row, "day"), s(row, "device_id"), s(row, "tag"), row.get("seconds").and_then(Value::as_f64).unwrap_or(0.0), updated],
            ),
            "intercept_events" => c.execute(
                "INSERT OR IGNORE INTO intercept_events(id, device_id, object, tag, level, lock_seconds, n, shown_at, study_label,
                   decision, decided_at, allow_minutes, activity, activity_minutes, dirty)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 0)",
                params![id, s(row, "device_id"), s(row, "object"), s(row, "tag"), i(row, "level"), i(row, "lock_seconds"), i(row, "n"),
                    i(row, "shown_at"), s(row, "study_label"), s(row, "decision"), i(row, "decided_at"), i(row, "allow_minutes"),
                    s(row, "activity"), i(row, "activity_minutes")],
            ),
            _ => Ok(0),
        };
        result.is_ok_and(|n| n > 0)
    }

    pub fn cursor(&self, table: &str) -> Option<String> {
        self.kv_get(&format!("cursor:{table}"))
    }

    pub fn set_cursor(&self, table: &str, value: &str) {
        self.kv_set(&format!("cursor:{table}"), value);
    }

    /// After signing out or deleting server data, pull everything again next time.
    pub fn reset_cursors(&self) {
        for t in TABLES {
            self.kv_delete(&format!("cursor:{t}"));
        }
        // Rows must be pushed again to the (possibly new or emptied) account.
        let _ = self.conn().execute_batch(
            "UPDATE tag_rules SET dirty = 1; UPDATE settings SET dirty = 1; UPDATE study_rules SET dirty = 1;
             UPDATE study_sessions SET dirty = 1; UPDATE usage_daily SET dirty = 1; UPDATE intercept_events SET dirty = 1;",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Store, KIND_EXE};

    const NOW: i64 = 1_791_810_000_000;

    #[test]
    fn pushes_dirty_rows_and_marks_them_clean() {
        let s = Store::open_in_memory().unwrap();
        s.set_rule_tag(KIND_EXE, "steam.exe", Some("game"), false, NOW).unwrap();
        let rows = s.dirty_rows("tag_rules", "dev", NOW);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], "exe:steam.exe");
        assert_eq!(rows[0]["deleted"], false);
        s.mark_clean("tag_rules", &rows);
        assert!(s.dirty_rows("tag_rules", "dev", NOW).is_empty());
    }

    #[test]
    fn a_change_during_the_push_stays_dirty() {
        let s = Store::open_in_memory().unwrap();
        s.set_rule_tag(KIND_EXE, "a.exe", Some("game"), false, NOW).unwrap();
        let rows = s.dirty_rows("tag_rules", "dev", NOW);
        s.set_rule_tag(KIND_EXE, "a.exe", Some("entertainment"), false, NOW + 5).unwrap();
        s.mark_clean("tag_rules", &rows);
        assert_eq!(s.dirty_rows("tag_rules", "dev", NOW)[0]["tag"], "entertainment");
    }

    #[test]
    fn newest_wins_on_pull() {
        let s = Store::open_in_memory().unwrap();
        s.set_rule_tag(KIND_EXE, "a.exe", Some("game"), false, NOW).unwrap();
        let older = json!({"id": "exe:a.exe", "kind": "exe", "pattern": "a.exe", "tag": "work", "updated_at": NOW - 1, "deleted": false});
        assert!(!s.apply_remote("tag_rules", &older, "dev"));
        assert_eq!(s.rule(KIND_EXE, "a.exe").unwrap().tag, "game");
        let newer = json!({"id": "exe:a.exe", "kind": "exe", "pattern": "a.exe", "tag": "work", "updated_at": NOW + 1, "deleted": false});
        assert!(s.apply_remote("tag_rules", &newer, "dev"));
        assert_eq!(s.rule(KIND_EXE, "a.exe").unwrap().tag, "work");
        let deleted = json!({"id": "exe:a.exe", "kind": "exe", "pattern": "a.exe", "tag": "work", "updated_at": NOW + 2, "deleted": true});
        assert!(s.apply_remote("tag_rules", &deleted, "dev"));
        assert!(s.rule(KIND_EXE, "a.exe").is_none());
    }

    #[test]
    fn usage_and_events_from_other_devices_count_here() {
        let s = Store::open_in_memory().unwrap();
        let phone = json!({"id": "d|phone|entertainment", "day": crate::core::day_key(NOW, crate::core::local_tz_offset(NOW)),
            "device_id": "phone", "tag": "entertainment", "seconds": 1800.0, "updated_at": NOW});
        assert!(s.apply_remote("usage_daily", &phone, "pc"));
        assert!((s.used_minutes(NOW) - 30.0).abs() < 1e-9);
        // Our own usage is never replaced by a pulled copy.
        let mine = json!({"id": "x|pc|game", "day": "2026-10-12", "device_id": "pc", "tag": "game", "seconds": 1.0, "updated_at": NOW});
        assert!(!s.apply_remote("usage_daily", &mine, "pc"));
        let event = json!({"id": "e1", "device_id": "phone", "object": "com.zhiliaoapp.musically", "tag": "entertainment", "level": 0,
            "lock_seconds": 5, "n": 0, "shown_at": NOW - 60_000, "decision": "exit", "decided_at": NOW - 50_000});
        assert!(s.apply_remote("intercept_events", &event, "pc"));
        assert!(!s.apply_remote("intercept_events", &event, "pc"));
        assert_eq!(s.shown_since(NOW - 3_600_000), vec![NOW - 60_000]);
        // Pulled rows are not pushed back.
        assert!(s.dirty_rows("intercept_events", "pc", NOW).is_empty());
    }

    #[test]
    fn only_decided_or_old_events_are_pushed() {
        let s = Store::open_in_memory().unwrap();
        let dev = s.device_id();
        s.record_warning("a", "x.exe", "game", NOW);
        assert!(s.dirty_rows("intercept_events", &dev, NOW + 1000).is_empty());
        assert_eq!(s.dirty_rows("intercept_events", &dev, NOW + 11 * 60_000).len(), 1);
        s.auto_exit("a", NOW + 2000);
        let rows = s.dirty_rows("intercept_events", &dev, NOW + 3000);
        assert_eq!(rows[0]["decision"], "exit");
        s.mark_clean("intercept_events", &rows);
        assert!(s.dirty_rows("intercept_events", &dev, NOW + 3000).is_empty());
    }
}
