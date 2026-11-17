//! Risk hours (docs/thiet-ke-ky-thuat.md, 2.5): weekly windows in which the friction level goes up by one,
//! the heat map of the warnings, the window suggestion and the weaken/ok classification. Port of
//! extension/src/core/risk.ts; the shared vectors in shared/test-vectors/risk.json pin both.

use crate::core::{iso_weekday, parse_hm, DAY_MS, HOUR_MS, MINUTE_MS};
use serde::{Deserialize, Serialize};

pub const MAX_RISK_WINDOWS: usize = 12;
/// A suggested block needs at least this many warnings.
pub const RISK_MIN_OPENS: i64 = 6;
/// Length of a suggested block, in hours.
pub const RISK_BLOCK_HOURS: i64 = 2;
/// The heat map looks at this many days back.
pub const HEATMAP_DAYS: i64 = 28;

static WEEKDAYS: [i64; 5] = [1, 2, 3, 4, 5];
static WEEKEND: [i64; 2] = [6, 7];
const WEEK_MINUTES: usize = 7 * 1440;

/// A weekly window in which the friction level is raised by one.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RiskWindow {
    pub id: String,
    /// ISO weekdays: 1 = Monday ... 7 = Sunday.
    pub days: Vec<i64>,
    /// Local time "HH:MM". If end <= start the window runs past midnight.
    pub start: String,
    pub end: String,
}

fn hm(m: i64) -> String {
    format!("{:02}:{:02}", m / 60, m % 60)
}

/// Cleans a window typed by the user: days deduplicated, sorted and limited to 1..7; times written
/// "HH:MM". None when it cannot be a window (no day, bad time, start == end). The id is kept.
pub fn normalize_risk_window(window: &RiskWindow) -> Option<RiskWindow> {
    let mut days: Vec<i64> = window.days.iter().copied().filter(|d| (1..=7).contains(d)).collect();
    days.sort_unstable();
    days.dedup();
    let (start, end) = (parse_hm(&window.start)?, parse_hm(&window.end)?);
    if days.is_empty() || start == end {
        return None;
    }
    Some(RiskWindow { id: window.id.clone(), days, start: hm(start), end: hm(end) })
}

/// Normalises a list: bad entries dropped, at most MAX_RISK_WINDOWS kept.
pub fn normalize_risk_windows(windows: &[RiskWindow]) -> Vec<RiskWindow> {
    windows.iter().filter_map(normalize_risk_window).take(MAX_RISK_WINDOWS).collect()
}

/// Valid window as days, start minute and end minute; the end is after the start (next day when it wraps).
struct Valid {
    days: Vec<i64>,
    start: i64,
    end: i64,
}

fn valid_windows(windows: &[RiskWindow]) -> Vec<Valid> {
    windows
        .iter()
        .filter_map(normalize_risk_window)
        .map(|n| {
            // normalize_risk_window wrote both times, so they parse.
            let start = parse_hm(&n.start).unwrap_or(0);
            let end = parse_hm(&n.end).unwrap_or(0);
            Valid { days: n.days, start, end: if end > start { end } else { end + 1440 } }
        })
        .collect()
}

/// ISO weekday (1 = Monday) and minute of the local day of a "local ms" value.
fn local_parts(local_ms: i64) -> (i64, i64) {
    let day = local_ms.div_euclid(DAY_MS);
    (iso_weekday(day), (local_ms - day * DAY_MS) / MINUTE_MS)
}

/// True when `now` is inside an occurrence of at least one window: start counted, end not counted; a window
/// that starts on a listed day and runs past midnight still counts after midnight. Invalid windows are ignored.
pub fn in_risk_window(windows: &[RiskWindow], now: i64, tz_offset_minutes: i64) -> bool {
    let (weekday, minute) = local_parts(now + tz_offset_minutes * MINUTE_MS);
    let yesterday = if weekday == 1 { 7 } else { weekday - 1 };
    valid_windows(windows).iter().any(|w| {
        (w.days.contains(&weekday) && w.start <= minute && minute < w.end)
            // Yesterday's occurrence, seen after midnight.
            || (w.days.contains(&yesterday) && w.end > 1440 && minute + 1440 < w.end)
    })
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct RiskCell {
    pub opens: i64,
    pub enters: i64,
}

/// 7 rows (0 = Monday ... 6 = Sunday) of 24 columns (local hour 0..23).
pub type RiskHeatmap = Vec<Vec<RiskCell>>;

pub fn empty_heatmap() -> RiskHeatmap {
    vec![vec![RiskCell::default(); 24]; 7]
}

/// The part of an event the heat map needs.
#[derive(Clone, Copy, Debug)]
pub struct RiskEvent {
    pub shown_at: i64,
    /// The warning was decided "enter".
    pub enter: bool,
}

/// Warnings with now - days * 24h <= shown_at <= now (both ends counted), by local weekday and hour of
/// `shown_at` (the 04:00 day boundary is not used). `opens` counts every warning, `enters` those decided "enter".
pub fn risk_heatmap(events: &[RiskEvent], now: i64, tz_offset_minutes: i64, days: i64) -> RiskHeatmap {
    let mut grid = empty_heatmap();
    let from = now - days * DAY_MS;
    for e in events {
        if e.shown_at < from || e.shown_at > now {
            continue;
        }
        let local = e.shown_at + tz_offset_minutes * MINUTE_MS;
        let day = local.div_euclid(DAY_MS);
        let row = (iso_weekday(day) - 1) as usize;
        let hour = ((local - day * DAY_MS) / HOUR_MS) as usize;
        let cell = &mut grid[row][hour];
        cell.opens += 1;
        if e.enter {
            cell.enters += 1;
        }
    }
    grid
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RiskSuggestion {
    pub days: Vec<i64>,
    pub start: String,
    pub end: String,
    pub opens: i64,
    pub enters: i64,
}

/// Which minutes of the week (0 = Monday 00:00) the windows cover; a window running past Sunday wraps to Monday.
fn week_coverage(windows: &[RiskWindow]) -> Vec<bool> {
    let mut covered = vec![false; WEEK_MINUTES];
    for w in valid_windows(windows) {
        for d in &w.days {
            for m in w.start..w.end {
                covered[(((d - 1) * 1440 + m) as usize) % WEEK_MINUTES] = true;
            }
        }
    }
    covered
}

/// Does any minute of hours h .. h + RISK_BLOCK_HOURS - 1, on any day of the group, lie in the coverage?
fn block_touched(covered: &[bool], group: &[i64], h: i64) -> bool {
    group.iter().any(|&d| (h * 60..(h + RISK_BLOCK_HOURS) * 60).any(|m| covered[((d - 1) * 1440 + m) as usize]))
}

/// The two-hour block (a group of days, starting hour h, hours h and h+1) with the highest opens per day of the
/// group, among blocks with at least RISK_MIN_OPENS warnings that do not touch any existing window (no minute of
/// the block, on any day of the group, is covered). Ties: higher enters per day, then weekdays before weekend, then the smaller h. Integer comparisons only.
/// `cells` is a 7 x 24 grid as from `risk_heatmap`; missing cells count as zero.
pub fn suggest_risk_window(cells: &[Vec<RiskCell>], existing: &[RiskWindow]) -> Option<RiskSuggestion> {
    let covered = week_coverage(existing);
    let cell =
        |d: i64, x: i64| cells.get((d - 1) as usize).and_then(|r| r.get(x as usize)).copied().unwrap_or_default();
    let mut best: Option<(&[i64], i64, i64, i64)> = None;
    for group in [&WEEKDAYS[..], &WEEKEND[..]] {
        for h in 0..=(24 - RISK_BLOCK_HOURS) {
            let (mut opens, mut enters) = (0, 0);
            for &d in group {
                for x in h..h + RISK_BLOCK_HOURS {
                    let c = cell(d, x);
                    opens += c.opens;
                    enters += c.enters;
                }
            }
            if opens < RISK_MIN_OPENS {
                continue;
            }
            if block_touched(&covered, group, h) {
                continue;
            }
            // Per-day comparison by cross-multiplication: a / group.len() > b / best.len().
            if let Some((bg, _, bo, be)) = best {
                let (l, r) = (group.len() as i64, bg.len() as i64);
                let by_opens = opens * r - bo * l;
                let by_enters = enters * r - be * l;
                // Group order (weekdays first) and h order follow from the loop order: only strictly better replaces.
                if by_opens < 0 || (by_opens == 0 && by_enters <= 0) {
                    continue;
                }
            }
            best = Some((group, h, opens, enters));
        }
    }
    best.map(|(group, h, opens, enters)| RiskSuggestion {
        days: group.to_vec(),
        start: hm(h * 60),
        end: hm(((h + RISK_BLOCK_HOURS) % 24) * 60),
        opens,
        enters,
    })
}

/// True ("weaken") when some minute of the week was covered by the old list and is not covered by the new
/// one (a window removed, fewer days, shorter); false ("ok") otherwise (a window added, longer, split).
pub fn risk_windows_change_weakens(old: &[RiskWindow], new: &[RiskWindow]) -> bool {
    let (a, b) = (week_coverage(old), week_coverage(new));
    a.iter().zip(&b).any(|(was, is)| *was && !*is)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn load() -> Value {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../shared/test-vectors/risk.json");
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn window(v: &Value) -> RiskWindow {
        RiskWindow {
            id: v["id"].as_str().unwrap().into(),
            days: v["days"].as_array().unwrap().iter().map(|d| d.as_i64().unwrap()).collect(),
            start: v["start"].as_str().unwrap().into(),
            end: v["end"].as_str().unwrap().into(),
        }
    }

    fn windows(v: &Value) -> Vec<RiskWindow> {
        v.as_array().unwrap().iter().map(window).collect()
    }

    /// The sparse list of non-zero cells as a full grid.
    fn grid(v: &Value) -> RiskHeatmap {
        let mut g = empty_heatmap();
        for c in v.as_array().unwrap() {
            g[c["row"].as_u64().unwrap() as usize][c["hour"].as_u64().unwrap() as usize] =
                RiskCell { opens: c["opens"].as_i64().unwrap(), enters: c["enters"].as_i64().unwrap() };
        }
        g
    }

    fn sparse(g: &RiskHeatmap) -> Vec<Value> {
        let mut out = vec![];
        for (row, cells) in g.iter().enumerate() {
            for (hour, c) in cells.iter().enumerate() {
                if c.opens > 0 || c.enters > 0 {
                    out.push(serde_json::json!({"row": row, "hour": hour, "opens": c.opens, "enters": c.enters}));
                }
            }
        }
        out
    }

    /// Every case of a group runs; an empty or missing group fails instead of passing silently.
    fn cases(v: &Value, group: &str, at_least: usize) -> Vec<Value> {
        let list = v[group].as_array().unwrap_or_else(|| panic!("group {group} missing")).clone();
        assert!(list.len() >= at_least, "group {group} has only {} cases", list.len());
        list
    }

    #[test]
    fn constants_match_the_vectors() {
        let c = &load()["constants"];
        assert_eq!(c["maxWindows"].as_u64().unwrap() as usize, MAX_RISK_WINDOWS);
        assert_eq!(c["minOpens"].as_i64().unwrap(), RISK_MIN_OPENS);
        assert_eq!(c["blockHours"].as_i64().unwrap(), RISK_BLOCK_HOURS);
    }

    #[test]
    fn in_risk_window_vectors() {
        let v = load();
        for c in cases(&v, "inRiskWindow", 40) {
            let i = &c["input"];
            let got = in_risk_window(
                &windows(&i["windows"]),
                i["now"].as_i64().unwrap(),
                i["tzOffsetMinutes"].as_i64().unwrap(),
            );
            assert_eq!(got, c["expected"].as_bool().unwrap(), "{}", c["name"]);
        }
    }

    #[test]
    fn heatmap_vectors() {
        let v = load();
        for c in cases(&v, "heatmap", 15) {
            let i = &c["input"];
            let events: Vec<RiskEvent> = i["events"]
                .as_array()
                .unwrap()
                .iter()
                .map(|e| RiskEvent {
                    shown_at: e["shownAt"].as_i64().unwrap(),
                    enter: e["decision"].as_str() == Some("enter"),
                })
                .collect();
            let got = risk_heatmap(
                &events,
                i["now"].as_i64().unwrap(),
                i["tzOffsetMinutes"].as_i64().unwrap(),
                i["days"].as_i64().unwrap(),
            );
            assert_eq!(sparse(&got), c["expected"].as_array().unwrap().clone(), "{}", c["name"]);
        }
    }

    #[test]
    fn suggest_vectors() {
        let v = load();
        for c in cases(&v, "suggest", 70) {
            let i = &c["input"];
            let got = suggest_risk_window(&grid(&i["cells"]), &windows(&i["windows"]));
            let e = &c["expected"];
            let expected = (!e.is_null()).then(|| RiskSuggestion {
                days: e["days"].as_array().unwrap().iter().map(|d| d.as_i64().unwrap()).collect(),
                start: e["start"].as_str().unwrap().into(),
                end: e["end"].as_str().unwrap().into(),
                opens: e["opens"].as_i64().unwrap(),
                enters: e["enters"].as_i64().unwrap(),
            });
            assert_eq!(got, expected, "{}", c["name"]);
        }
    }

    #[test]
    fn classify_vectors() {
        let v = load();
        for c in cases(&v, "classify", 40) {
            let i = &c["input"];
            let weakens = risk_windows_change_weakens(&windows(&i["old"]), &windows(&i["new"]));
            assert_eq!(weakens, c["expected"] == "weaken", "{}", c["name"]);
        }
    }

    #[test]
    fn normalize_vectors() {
        let v = load();
        for c in cases(&v, "normalize", 20) {
            let got = normalize_risk_window(&window(&c["input"]));
            let e = &c["expected"];
            assert_eq!(got, (!e.is_null()).then(|| window(e)), "{}", c["name"]);
        }
    }

    #[test]
    fn normalize_list_drops_bad_entries_and_caps_the_count() {
        let ok =
            |i: usize| RiskWindow { id: format!("w{i}"), days: vec![1], start: "08:00".into(), end: "09:00".into() };
        let bad = RiskWindow { id: "bad".into(), days: vec![], start: "08:00".into(), end: "09:00".into() };
        let mut list = vec![bad];
        list.extend((0..15).map(ok));
        let n = normalize_risk_windows(&list);
        assert_eq!(n.len(), MAX_RISK_WINDOWS);
        assert_eq!(n[0].id, "w0");
    }
}
