//! The local side of sync: which rows to push, and how pulled rows are merged.
//! Rules: configuration tables are "newest updated_at wins"; events are append only; usage rows
//! belong to one device, so a device never overwrites its own usage with a pulled copy.

use crate::db::Store;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

pub const TABLES: [&str; 6] =
    ["tag_rules", "settings", "study_rules", "study_sessions", "usage_daily", "intercept_events"];

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
    pub fn dirty_rows(&self, table: &str, device_id: &str, _now: i64) -> Vec<Value> {
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
                     FROM intercept_events WHERE dirty = 1 AND device_id = ?1 AND decision IS NOT NULL",
                )
                .and_then(|mut st| {
                    st.query_map(params![device_id], |r| {
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

    /// `updated_at` and the dirty flag of the local row, if there is one.
    fn local_state(&self, table: &str, id: &str) -> Option<(i64, bool)> {
        self.conn()
            .query_row(&format!("SELECT updated_at, dirty FROM {table} WHERE id = ?1"), [id], |r| {
                Ok((r.get(0)?, r.get::<_, i64>(1)? != 0))
            })
            .optional()
            .ok()
            .flatten()
    }

    /// All synced columns of a local row (and its dirty flag) as one string, to tell whether a merge changed it.
    fn row_signature(&self, table: &str, id: &str) -> Option<String> {
        let columns = match table {
            "tag_rules" => "kind, pattern, tag, delay_seconds, updated_at, deleted, dirty",
            "settings" => "json, updated_at, dirty",
            "study_rules" => "days, start, \"end\", label, exceptions, updated_at, deleted, dirty",
            "study_sessions" => "source, start, \"end\", label, external_id, updated_at, deleted, dirty",
            "usage_daily" => "day, device_id, tag, seconds, updated_at, dirty",
            _ => return None,
        };
        self.conn()
            .query_row(&format!("SELECT json_array({columns}) FROM {table} WHERE id = ?1"), [id], |r| r.get(0))
            .optional()
            .ok()
            .flatten()
    }

    /// Merges one pulled row. Returns true when the local data changed.
    ///
    /// The remote row wins when its `updated_at` is greater than the local one, or equal while the
    /// local row is not dirty (the server keeps the later push on a tie, so a clean local row is the
    /// one that lost). A dirty local row with an equal stamp stays and is pushed. Pulling the same row
    /// again (the cursor is read with `>=`) writes the same values and reports no change.
    pub fn apply_remote(&self, table: &str, row: &Value, my_device: &str) -> bool {
        let Some(id) = s(row, "id") else { return false };
        let updated = i(row, "updated_at").unwrap_or(0);
        if table == "usage_daily" && s(row, "device_id").as_deref() == Some(my_device) {
            return false;
        }
        // Events are append only and have no updated_at: the insert below ignores a known id.
        let local = if table == "intercept_events" { None } else { self.local_state(table, &id) };
        let wins = local.is_none_or(|(at, dirty)| updated > at || (updated == at && !dirty));
        if !wins {
            return false;
        }
        let tie = local.is_some_and(|(at, _)| at == updated);
        let before = if tie { self.row_signature(table, &id) } else { None };
        let c = self.conn();
        let result = match table {
            "tag_rules" => c.execute(
                "INSERT OR REPLACE INTO tag_rules(id, kind, pattern, tag, delay_seconds, updated_at, deleted, dirty)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
                params![id, s(row, "kind"), s(row, "pattern"), s(row, "tag"), i(row, "delay_seconds"), updated, b(row, "deleted")],
            ),
            "settings" => c.execute(
                "INSERT OR REPLACE INTO settings(id, json, updated_at, dirty) VALUES(?1, ?2, ?3, 0)",
                params![id, row.get("json").map(Value::to_string).unwrap_or_else(|| "{}".into()), updated],
            ),
            "study_rules" => c.execute(
                "INSERT OR REPLACE INTO study_rules(id, days, start, \"end\", label, exceptions, updated_at, deleted, dirty)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
                params![id, s(row, "days"), s(row, "start"), s(row, "end"), s(row, "label"), s(row, "exceptions").unwrap_or_default(), updated, b(row, "deleted")],
            ),
            "study_sessions" => c.execute(
                "INSERT OR REPLACE INTO study_sessions(id, source, start, \"end\", label, external_id, updated_at, deleted, dirty)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
                params![id, s(row, "source"), i(row, "start"), i(row, "end"), s(row, "label"), s(row, "external_id"), updated, b(row, "deleted")],
            ),
            "usage_daily" => c.execute(
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
        if tie {
            return result.is_ok() && self.row_signature(table, &id) != before;
        }
        result.is_ok_and(|n| n > 0)
    }

    pub fn cursor(&self, table: &str) -> Option<String> {
        self.kv_get(&format!("cursor:{table}"))
    }

    pub fn set_cursor(&self, table: &str, value: &str) {
        self.kv_set(&format!("cursor:{table}"), value);
    }

    /// After the server data was deleted: forget cursors and clean flags, and the account this
    /// device last synced with, so the next sign-in (even the same account) uploads everything.
    pub fn reset_sync_state(&self) {
        self.reset_cursors();
        self.kv_delete("lastUserId");
    }

    /// Called at sign-in. When the account differs from the last one synced here, forgets the old
    /// account's data that came from other devices (their usage and events would otherwise count in
    /// the new account's budget and recent-open count) and prepares this device's data for upload.
    /// This device's own rows, settings, tags and study rules stay. Returns true when it was a switch.
    pub fn switch_account(&self, user_id: &str) -> bool {
        if self.kv_get("lastUserId").as_deref() == Some(user_id) {
            return false;
        }
        let me = self.device_id();
        let _ = self.conn().execute("DELETE FROM usage_daily WHERE device_id != ?1", [&me]);
        let _ = self.conn().execute("DELETE FROM intercept_events WHERE device_id != ?1", [&me]);
        self.reset_cursors();
        self.kv_set("lastUserId", user_id);
        true
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
    fn on_an_equal_stamp_a_clean_local_row_takes_the_remote_one_and_a_dirty_one_stays() {
        let s = Store::open_in_memory().unwrap();
        let remote = json!({"id": "exe:a.exe", "kind": "exe", "pattern": "a.exe", "tag": "work", "updated_at": NOW, "deleted": false});
        // Dirty (waiting to be pushed): stays, and is still pushed.
        s.set_rule_tag(KIND_EXE, "a.exe", Some("game"), false, NOW).unwrap();
        assert!(!s.apply_remote("tag_rules", &remote, "dev"));
        assert_eq!(s.rule(KIND_EXE, "a.exe").unwrap().tag, "game");
        assert_eq!(s.dirty_rows("tag_rules", "dev", NOW).len(), 1);
        // Clean (already pushed, the server kept the other device's later push): the remote row wins.
        let rows = s.dirty_rows("tag_rules", "dev", NOW);
        s.mark_clean("tag_rules", &rows);
        assert!(s.apply_remote("tag_rules", &remote, "dev"));
        assert_eq!(s.rule(KIND_EXE, "a.exe").unwrap().tag, "work");
        assert!(s.dirty_rows("tag_rules", "dev", NOW).is_empty());
        // The same row again is not a change.
        assert!(!s.apply_remote("tag_rules", &remote, "dev"));
    }

    #[test]
    fn applying_a_pulled_row_twice_is_harmless_for_every_table() {
        let s = Store::open_in_memory().unwrap();
        let rows = [
            ("tag_rules", json!({"id": "exe:a.exe", "kind": "exe", "pattern": "a.exe", "tag": "work", "delay_seconds": 5, "updated_at": NOW, "deleted": false})),
            ("settings", json!({"id": "settings", "json": {"budgetMinutes": 45, "x": [1, 2]}, "updated_at": NOW})),
            ("study_rules", json!({"id": "r1", "days": "1,2", "start": "08:00", "end": "09:00", "label": "L", "exceptions": "", "updated_at": NOW, "deleted": false})),
            ("study_sessions", json!({"id": "s1", "source": "manual", "start": NOW, "end": NOW + 1000, "label": null, "external_id": null, "updated_at": NOW, "deleted": false})),
            ("usage_daily", json!({"id": "d|phone|game", "day": "2026-10-12", "device_id": "phone", "tag": "game", "seconds": 61.5, "updated_at": NOW})),
            ("intercept_events", json!({"id": "e1", "device_id": "phone", "object": "o", "tag": "game", "level": 1, "lock_seconds": 5, "n": 2,
                "shown_at": NOW, "decision": "enter", "decided_at": NOW + 1, "allow_minutes": 5, "activity": null, "activity_minutes": null})),
        ];
        for (table, row) in &rows {
            assert!(s.apply_remote(table, row, "pc"), "{table}: first apply");
            assert!(!s.apply_remote(table, row, "pc"), "{table}: second apply must change nothing");
            assert!(s.dirty_rows(table, "pc", NOW).is_empty(), "{table}: nothing to push");
        }
        // Same for the dirty-bit side: a clean local row at the same stamp is not touched either.
        assert_eq!(s.rule(KIND_EXE, "a.exe").unwrap().tag, "work");
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
    fn switching_account_drops_other_devices_usage_and_events_but_keeps_ours() {
        let s = Store::open_in_memory().unwrap();
        s.ensure_defaults(NOW);
        let me = s.device_id();
        let day = crate::core::day_key(NOW, crate::core::local_tz_offset(NOW));
        s.add_usage("entertainment", 600.0, NOW);
        s.record_warning("mine", "x.exe", "game", NOW);
        s.auto_exit("mine", NOW + 1000);
        s.set_rule_tag(KIND_EXE, "steam.exe", Some("game"), false, NOW).unwrap();
        let phone = json!({"id": "d|phone|entertainment", "day": day, "device_id": "phone", "tag": "entertainment",
            "seconds": 1800.0, "updated_at": NOW});
        let event = json!({"id": "e1", "device_id": "phone", "object": "tiktok", "tag": "entertainment", "level": 0,
            "lock_seconds": 5, "n": 0, "shown_at": NOW - 60_000, "decision": "exit", "decided_at": NOW - 50_000});
        // First sign-in of an account, then the other device's data arrives; signing in again as the
        // same account drops nothing.
        assert!(s.switch_account("u1"));
        assert!(s.apply_remote("usage_daily", &phone, &me));
        assert!(s.apply_remote("intercept_events", &event, &me));
        assert!((s.used_minutes(NOW) - 40.0).abs() < 1e-9);
        assert_eq!(s.shown_since(NOW - 3_600_000).len(), 2);
        assert!(!s.switch_account("u1"));
        assert!((s.used_minutes(NOW) - 40.0).abs() < 1e-9);
        assert_eq!(s.kv_get("lastUserId").as_deref(), Some("u1"));

        // Another account: only this device's own rows remain, and they go up to the new account.
        assert!(s.switch_account("u2"));
        assert!((s.used_minutes(NOW) - 10.0).abs() < 1e-9);
        assert_eq!(s.shown_since(NOW - 3_600_000), vec![NOW]);
        assert_eq!(s.rule(KIND_EXE, "steam.exe").unwrap().tag, "game");
        assert_eq!(s.dirty_rows("usage_daily", &me, NOW).len(), 1);
        assert_eq!(s.dirty_rows("intercept_events", &me, NOW).len(), 1);
        assert_eq!(s.kv_get("lastUserId").as_deref(), Some("u2"));
    }

    #[test]
    fn only_decided_events_are_pushed() {
        let s = Store::open_in_memory().unwrap();
        let dev = s.device_id();
        s.record_warning("a", "x.exe", "game", NOW);
        // The server's events are append-only: an undecided one would stay undecided there for ever.
        assert!(s.dirty_rows("intercept_events", &dev, NOW + 1000).is_empty());
        assert!(s.dirty_rows("intercept_events", &dev, NOW + 11 * 60_000).is_empty());
        s.auto_exit("a", NOW + 2000);
        let rows = s.dirty_rows("intercept_events", &dev, NOW + 3000);
        assert_eq!(rows[0]["decision"], "exit");
        s.mark_clean("intercept_events", &rows);
        assert!(s.dirty_rows("intercept_events", &dev, NOW + 3000).is_empty());
    }

    #[test]
    fn a_warning_left_open_for_an_hour_can_still_be_entered() {
        let s = Store::open_in_memory().unwrap();
        s.record_warning("a", "x.exe", "game", NOW);
        s.close_abandoned(NOW + 60 * 60_000, None);
        assert!(s.decide("a", crate::logic::Decision::Enter, Some(5), None, None, NOW + 60 * 60_000).is_ok());
    }

    #[test]
    fn deleting_server_data_makes_the_next_sign_in_upload_everything() {
        let s = Store::open_in_memory().unwrap();
        s.set_rule_tag(KIND_EXE, "steam.exe", Some("game"), false, NOW).unwrap();
        let rows = s.dirty_rows("tag_rules", "dev", NOW);
        s.mark_clean("tag_rules", &rows);
        s.kv_set("cursor:tag_rules", "2026-01-01");
        s.kv_set("lastUserId", "u1");
        s.reset_sync_state();
        assert_eq!(s.kv_get("cursor:tag_rules"), None);
        assert_eq!(s.kv_get("lastUserId"), None);
        assert_eq!(s.dirty_rows("tag_rules", "dev", NOW).len(), 1);
    }

    #[test]
    fn abandoned_events_are_closed_before_they_are_pushed_except_the_one_on_screen() {
        let s = Store::open_in_memory().unwrap();
        let dev = s.device_id();
        s.record_warning("old", "x.exe", "game", NOW);
        s.record_warning("shown", "y.exe", "game", NOW);
        s.record_warning("fresh", "z.exe", "game", NOW + 11 * 3_600_000);
        let later = NOW + 12 * 3_600_000 + 1;
        s.close_abandoned(later, Some("shown"));
        let rows = s.dirty_rows("intercept_events", &dev, later);
        let ids: Vec<&str> = rows.iter().filter_map(|r| r["id"].as_str()).collect();
        assert_eq!(ids, vec!["old"]);
        // The warning on screen can still be decided afterwards.
        assert!(s.decide("shown", crate::logic::Decision::Exit, None, None, None, later).is_ok());
        // Pruning does the same.
        s.record_warning("shown2", "y.exe", "game", NOW);
        s.prune(later + 1, Some("shown2"));
        assert!(s.decide("shown2", crate::logic::Decision::Exit, None, None, None, later + 2).is_ok());
    }
}
