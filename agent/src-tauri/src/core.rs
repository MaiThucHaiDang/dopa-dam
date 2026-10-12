//! Rust port of the shared core logic. Must give the same results as shared/test-vectors.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const MINUTE_MS: i64 = 60_000;
pub const HOUR_MS: i64 = 3_600_000;
pub const DAY_MS: i64 = 86_400_000;
pub const MAX_DELAY_SECONDS: i64 = 120;

pub const TAGS: [&str; 7] = ["entertainment", "game", "work", "study", "communication", "utility", "ignore"];

pub fn is_tag(value: &str) -> bool {
    TAGS.contains(&value)
}

/// Entertainment and game trigger the warning; game only differs by its default delay.
pub fn is_blocked_tag(tag: Option<&str>) -> bool {
    matches!(tag, Some("entertainment") | Some("game"))
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub lock_seconds: Vec<i64>,
    pub allow_options_normal: Vec<i64>,
    pub allow_options_restricted: Vec<i64>,
    pub budget_minutes: i64,
    pub tag_delays: HashMap<String, i64>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            lock_seconds: vec![5, 10, 20, 30],
            allow_options_normal: vec![5, 15, 30],
            allow_options_restricted: vec![5, 10],
            budget_minutes: 90,
            tag_delays: HashMap::from([("game".to_string(), 30)]),
        }
    }
}

impl Settings {
    /// Parses stored/synced JSON; anything missing or malformed falls back to the defaults.
    pub fn from_json(json: &str) -> Settings {
        let d = Settings::default();
        let v: serde_json::Value = match serde_json::from_str(json) {
            Ok(v) => v,
            Err(_) => return d,
        };
        let ints = |key: &str, len: Option<usize>| -> Option<Vec<i64>> {
            let arr = v.get(key)?.as_array()?;
            let list: Option<Vec<i64>> = arr.iter().map(|x| x.as_i64()).collect();
            let list = list?;
            if list.is_empty() || len.is_some_and(|l| l != list.len()) {
                None
            } else {
                Some(list)
            }
        };
        let delays = v
            .get("tagDelays")
            .and_then(|d| d.as_object())
            .map(|o| o.iter().filter_map(|(k, x)| x.as_i64().map(|n| (k.clone(), n))).collect::<HashMap<_, _>>());
        Settings {
            lock_seconds: ints("lockSeconds", Some(4)).unwrap_or(d.lock_seconds),
            allow_options_normal: ints("allowOptionsNormal", None).unwrap_or(d.allow_options_normal),
            allow_options_restricted: ints("allowOptionsRestricted", None).unwrap_or(d.allow_options_restricted),
            budget_minutes: v.get("budgetMinutes").and_then(|x| x.as_i64()).unwrap_or(d.budget_minutes),
            tag_delays: delays.unwrap_or(d.tag_delays),
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("settings serialize")
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelResult {
    pub level: i64,
    pub lock_seconds: i64,
    pub allow_options: Vec<i64>,
}

/// Friction level from warnings in the previous hour, study mode and the daily budget.
pub fn compute_level(n: i64, in_study: bool, over_budget: bool, s: &Settings) -> LevelResult {
    let level = if in_study || over_budget {
        3
    } else if n <= 0 {
        0
    } else if n <= 2 {
        1
    } else {
        2
    };
    let options = if level == 3 { &s.allow_options_restricted } else { &s.allow_options_normal };
    LevelResult { level, lock_seconds: s.lock_seconds[level as usize], allow_options: options.clone() }
}

pub fn allow_options_for(s: &Settings, level: i64) -> &[i64] {
    if level == 3 {
        &s.allow_options_restricted
    } else {
        &s.allow_options_normal
    }
}

/// Number of timestamps t with now - 1h < t <= now.
pub fn recent_count(timestamps: &[i64], now: i64) -> i64 {
    timestamps.iter().filter(|&&t| t > now - HOUR_MS && t <= now).count() as i64
}

/// YYYY-MM-DD of a "local ms" value (epoch ms already shifted by the timezone offset).
pub fn format_local_date(local_ms: i64) -> String {
    let days = local_ms.div_euclid(DAY_MS);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Days since 1970-01-01 to (year, month, day) in the proleptic Gregorian calendar.
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// ISO weekday (1 = Monday) of a local day number.
fn iso_weekday(days: i64) -> i64 {
    (days + 3).rem_euclid(7) + 1
}

/// The app's day starts at 04:00 local time so staying up past midnight does not reset the budget.
pub fn day_key(t: i64, tz_offset_minutes: i64) -> String {
    format_local_date(t + tz_offset_minutes * MINUTE_MS - 4 * HOUR_MS)
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Minutes east of UTC for the local timezone at instant t (Vietnam: 420).
pub fn local_tz_offset(t: i64) -> i64 {
    use chrono::{Local, Offset, TimeZone};
    match Local.timestamp_millis_opt(t) {
        chrono::LocalResult::Single(dt) | chrono::LocalResult::Ambiguous(dt, _) => {
            (dt.offset().fix().local_minus_utc() / 60) as i64
        }
        chrono::LocalResult::None => 0,
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetStatus {
    pub over: bool,
    pub remaining_minutes: Option<f64>,
}

/// A budget <= 0 means the daily budget is turned off.
pub fn budget_status(used_minutes: f64, budget_minutes: i64) -> BudgetStatus {
    if budget_minutes <= 0 {
        return BudgetStatus { over: false, remaining_minutes: None };
    }
    let b = budget_minutes as f64;
    BudgetStatus { over: used_minutes >= b, remaining_minutes: Some((b - used_minutes).max(0.0)) }
}

/// Per-app delay (even 0) overrides the tag default; result is clamped to 0..120 seconds.
pub fn effective_delay(app_delay: Option<i64>, tag: &str, tag_delays: &HashMap<String, i64>) -> i64 {
    app_delay.or_else(|| tag_delays.get(tag).copied()).unwrap_or(0).clamp(0, MAX_DELAY_SECONDS)
}

// ---- Domains -----------------------------------------------------------------

pub fn host_matches(host: &str, pattern: &str) -> bool {
    host == pattern
        || (host.len() > pattern.len()
            && host.ends_with(pattern)
            && host.as_bytes()[host.len() - pattern.len() - 1] == b'.')
}

/// The most specific (longest) pattern matching the host.
pub fn match_domain<'a, T>(host: &str, rules: &'a [(String, T)]) -> Option<&'a (String, T)> {
    let h = host.trim().trim_end_matches('.').to_lowercase();
    rules.iter().filter(|(p, _)| host_matches(&h, p)).max_by_key(|(p, _)| p.len())
}

// ---- Friction ------------------------------------------------------------------

pub const CONFIRM_PHRASE: &str = "tôi chọn giảm bảo vệ";

pub fn tag_change_weakens(old: Option<&str>, new: Option<&str>) -> bool {
    (is_blocked_tag(old) && !is_blocked_tag(new)) || (old == Some("entertainment") && new == Some("game"))
}

#[derive(Clone, Copy, Debug)]
pub enum NumberField {
    LockSeconds,
    BudgetMinutes,
    DelaySeconds,
}

pub fn number_change_weakens(field: NumberField, old: i64, new: i64) -> bool {
    match field {
        NumberField::LockSeconds => new < old,
        NumberField::BudgetMinutes => old > 0 && (new <= 0 || new > old),
        NumberField::DelaySeconds => new > old,
    }
}

// ---- Study -------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub start: i64,
    pub end: i64,
    pub label: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StudyRule {
    pub id: String,
    pub days: Vec<i64>,
    pub start: String,
    pub end: String,
    pub label: Option<String>,
    pub exceptions: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyStatus {
    pub active: bool,
    pub source: Option<String>,
    pub label: Option<String>,
    pub ends_at: Option<i64>,
}

impl StudyStatus {
    pub fn none() -> Self {
        StudyStatus { active: false, source: None, label: None, ends_at: None }
    }
}

pub fn parse_hm(value: &str) -> Option<i64> {
    let (h, m) = value.trim().split_once(':')?;
    if h.is_empty() || h.len() > 2 || m.len() != 2 || !h.chars().chain(m.chars()).all(|c| c.is_ascii_digit()) {
        return None;
    }
    let (h, m): (i64, i64) = (h.parse().ok()?, m.parse().ok()?);
    if h > 23 || m > 59 {
        return None;
    }
    Some(h * 60 + m)
}

/// Occurrences of a rule that start on the local day of `now` or the day before (overnight windows).
pub fn rule_occurrences(rule: &StudyRule, now: i64, tz: i64) -> Vec<Session> {
    let (Some(start), Some(end)) = (parse_hm(&rule.start), parse_hm(&rule.end)) else {
        return vec![];
    };
    let offset = tz * MINUTE_MS;
    let today = (now + offset).div_euclid(DAY_MS);
    let mut out = vec![];
    for day in [today - 1, today] {
        let day_local = day * DAY_MS;
        if !rule.days.contains(&iso_weekday(day)) || rule.exceptions.contains(&format_local_date(day_local)) {
            continue;
        }
        let s = day_local + start * MINUTE_MS;
        let e = if end > start { day_local + end * MINUTE_MS } else { day_local + DAY_MS + end * MINUTE_MS };
        out.push(Session { id: rule.id.clone(), start: s - offset, end: e - offset, label: rule.label.clone() });
    }
    out
}

fn pick_active(sessions: &[Session], now: i64) -> Option<&Session> {
    let mut best: Option<&Session> = None;
    for s in sessions {
        if s.start <= now && now < s.end && best.is_none_or(|b| s.end > b.end) {
            best = Some(s);
        }
    }
    best
}

/// Combines study sources with priority manual > taskflow > rule.
pub fn resolve_study(now: i64, tz: i64, manual: &[Session], rules: &[StudyRule], external: &[Session]) -> StudyStatus {
    let occurrences: Vec<Session> = rules.iter().flat_map(|r| rule_occurrences(r, now, tz)).collect();
    let candidates = [
        ("manual", "Phiên học", pick_active(manual, now)),
        ("taskflow", "Phiên TaskFlow", pick_active(external, now)),
        ("rule", "Khung giờ học", pick_active(&occurrences, now)),
    ];
    for (source, default_label, session) in candidates {
        if let Some(s) = session {
            let label = s.label.clone().filter(|l| !l.is_empty()).unwrap_or_else(|| default_label.to_string());
            return StudyStatus { active: true, source: Some(source.into()), label: Some(label), ends_at: Some(s.end) };
        }
    }
    StudyStatus::none()
}

// ---- Warning delay -------------------------------------------------------------

/// Tracks how long each program has been in front during its current "open" (FR10). An open
/// ends when the process exits; switching away pauses the count. Once a warning has been shown
/// for an open, coming back shows it again at once.
#[derive(Default)]
pub struct OpenTracker {
    states: HashMap<u32, OpenState>,
}

struct OpenState {
    accumulated_ms: i64,
    entered_at: Option<i64>,
    warned: bool,
}

impl OpenTracker {
    pub fn enter(&mut self, pid: u32, now: i64) {
        let st = self.states.entry(pid).or_insert(OpenState { accumulated_ms: 0, entered_at: None, warned: false });
        if st.entered_at.is_none() {
            st.entered_at = Some(now);
        }
    }

    pub fn leave(&mut self, pid: u32, now: i64) {
        if let Some(st) = self.states.get_mut(&pid) {
            if let Some(at) = st.entered_at.take() {
                st.accumulated_ms += now - at;
            }
        }
    }

    pub fn forget(&mut self, pid: u32) {
        self.states.remove(&pid);
    }

    pub fn known_pids(&self) -> Vec<u32> {
        self.states.keys().copied().collect()
    }

    pub fn mark_warned(&mut self, pid: u32) {
        if let Some(st) = self.states.get_mut(&pid) {
            st.warned = true;
        }
    }

    pub fn is_due(&self, pid: u32, now: i64, delay_ms: i64) -> bool {
        match self.states.get(&pid) {
            None => false,
            Some(st) => st.warned || st.accumulated_ms + st.entered_at.map_or(0, |at| now - at) >= delay_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn load(name: &str) -> Value {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../shared/test-vectors").join(name);
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn ints(v: &Value) -> Vec<i64> {
        v.as_array().unwrap().iter().map(|x| x.as_i64().unwrap()).collect()
    }

    fn strings(v: &Value) -> Vec<String> {
        v.as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect()
    }

    fn opt_str(v: &Value) -> Option<String> {
        v.as_str().map(String::from)
    }

    fn settings_of(v: &Value) -> Settings {
        Settings {
            lock_seconds: ints(&v["lockSeconds"]),
            allow_options_normal: ints(&v["allowOptionsNormal"]),
            allow_options_restricted: ints(&v["allowOptionsRestricted"]),
            ..Settings::default()
        }
    }

    #[test]
    fn level_vectors() {
        let v = load("level.json");
        for c in v["cases"].as_array().unwrap() {
            let s = settings_of(if c.get("settings").is_some() { &c["settings"] } else { &v["defaultSettings"] });
            let i = &c["input"];
            let r = compute_level(
                i["n"].as_i64().unwrap(),
                i["inStudy"].as_bool().unwrap(),
                i["overBudget"].as_bool().unwrap(),
                &s,
            );
            let e = &c["expected"];
            let expected = LevelResult {
                level: e["level"].as_i64().unwrap(),
                lock_seconds: e["lockSeconds"].as_i64().unwrap(),
                allow_options: ints(&e["allowOptions"]),
            };
            assert_eq!(r, expected, "{}", c["name"]);
        }
    }

    #[test]
    fn recent_count_vectors() {
        for c in load("recent-count.json")["cases"].as_array().unwrap() {
            assert_eq!(
                recent_count(&ints(&c["timestamps"]), c["now"].as_i64().unwrap()),
                c["expected"].as_i64().unwrap(),
                "{}",
                c["name"]
            );
        }
    }

    #[test]
    fn day_key_vectors() {
        for c in load("day-key.json")["cases"].as_array().unwrap() {
            assert_eq!(
                day_key(c["t"].as_i64().unwrap(), c["tzOffsetMinutes"].as_i64().unwrap()),
                c["expected"].as_str().unwrap(),
                "{}",
                c["name"]
            );
        }
    }

    #[test]
    fn budget_vectors() {
        for c in load("budget.json")["cases"].as_array().unwrap() {
            let e = &c["expected"];
            let expected =
                BudgetStatus { over: e["over"].as_bool().unwrap(), remaining_minutes: e["remainingMinutes"].as_f64() };
            assert_eq!(
                budget_status(c["usedMinutes"].as_f64().unwrap(), c["budgetMinutes"].as_i64().unwrap()),
                expected,
                "{}",
                c["name"]
            );
        }
    }

    #[test]
    fn delay_vectors() {
        for c in load("delay.json")["cases"].as_array().unwrap() {
            let delays: HashMap<String, i64> =
                c["tagDelays"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_i64().unwrap())).collect();
            assert_eq!(
                effective_delay(c["appDelaySeconds"].as_i64(), c["tag"].as_str().unwrap(), &delays),
                c["expected"].as_i64().unwrap(),
                "{}",
                c["name"]
            );
        }
    }

    #[test]
    fn domain_vectors() {
        let v = load("domain.json");
        let rules: Vec<(String, String)> = v["rules"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| (r["pattern"].as_str().unwrap().to_string(), r["tag"].as_str().unwrap().to_string()))
            .collect();
        for c in v["cases"].as_array().unwrap() {
            let got = match_domain(c["host"].as_str().unwrap(), &rules).map(|(_, t)| t.clone());
            assert_eq!(got, opt_str(&c["expected"]), "{}", c["host"]);
        }
    }

    #[test]
    fn friction_vectors() {
        let v = load("friction.json");
        for c in v["tagCases"].as_array().unwrap() {
            let weakens = tag_change_weakens(c["old"].as_str(), c["new"].as_str());
            assert_eq!(weakens, c["expected"] == "weaken", "{} -> {}", c["old"], c["new"]);
        }
        for c in v["numberCases"].as_array().unwrap() {
            let field = match c["field"].as_str().unwrap() {
                "lockSeconds" => NumberField::LockSeconds,
                "budgetMinutes" => NumberField::BudgetMinutes,
                _ => NumberField::DelaySeconds,
            };
            let weakens = number_change_weakens(field, c["old"].as_i64().unwrap(), c["new"].as_i64().unwrap());
            assert_eq!(weakens, c["expected"] == "weaken", "{} {} -> {}", c["field"], c["old"], c["new"]);
        }
    }

    #[test]
    fn study_vectors() {
        let v = load("study.json");
        let rule = |k: &str| {
            let r = &v["rules"][k];
            StudyRule {
                id: r["id"].as_str().unwrap().into(),
                days: ints(&r["days"]),
                start: r["start"].as_str().unwrap().into(),
                end: r["end"].as_str().unwrap().into(),
                label: opt_str(&r["label"]),
                exceptions: strings(&r["exceptions"]),
            }
        };
        let session = |k: &str| {
            let s = &v["sessions"][k];
            Session {
                id: s["id"].as_str().unwrap().into(),
                start: s["start"].as_i64().unwrap(),
                end: s["end"].as_i64().unwrap(),
                label: opt_str(&s["label"]),
            }
        };
        for c in v["cases"].as_array().unwrap() {
            let manual: Vec<Session> = strings(&c["manual"]).iter().map(|k| session(k)).collect();
            let external: Vec<Session> = strings(&c["external"]).iter().map(|k| session(k)).collect();
            let rules: Vec<StudyRule> = strings(&c["rules"]).iter().map(|k| rule(k)).collect();
            let got = resolve_study(
                c["now"].as_i64().unwrap(),
                c["tzOffsetMinutes"].as_i64().unwrap(),
                &manual,
                &rules,
                &external,
            );
            let e = &c["expected"];
            let expected = StudyStatus {
                active: e["active"].as_bool().unwrap(),
                source: opt_str(&e["source"]),
                label: opt_str(&e["label"]),
                ends_at: e["endsAt"].as_i64(),
            };
            assert_eq!(got, expected, "{}", c["name"]);
        }
    }

    #[test]
    fn settings_json_round_trip_and_repair() {
        let s = Settings { budget_minutes: 120, ..Settings::default() };
        assert_eq!(Settings::from_json(&s.to_json()), s);
        assert_eq!(Settings::from_json("nope"), Settings::default());
        assert_eq!(Settings::from_json(r#"{"lockSeconds":[1,2]}"#).lock_seconds, vec![5, 10, 20, 30]);
    }

    #[test]
    fn open_tracker_counts_only_in_front() {
        let mut t = OpenTracker::default();
        t.enter(7, 0);
        assert!(!t.is_due(7, 20_000, 30_000));
        t.leave(7, 20_000);
        t.enter(7, 140_000);
        assert!(!t.is_due(7, 145_000, 30_000));
        assert!(t.is_due(7, 150_000, 30_000));
        t.mark_warned(7);
        t.leave(7, 151_000);
        t.enter(7, 200_000);
        assert!(t.is_due(7, 200_000, 30_000));
        t.forget(7);
        assert!(!t.is_due(7, 200_000, 0));
    }

    #[test]
    fn civil_dates() {
        assert_eq!(format_local_date(0), "1970-01-01");
        assert_eq!(format_local_date(-DAY_MS), "1969-12-31");
        assert_eq!(format_local_date(951_782_400_000), "2000-02-29");
        assert_eq!(iso_weekday(0), 4); // 1970-01-01 was a Thursday
    }
}
