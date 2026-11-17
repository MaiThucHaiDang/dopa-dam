//! Pure decision rules, mirroring extension/src/background/logic.ts and the Android GuardLogic.

use crate::core::{
    allow_options_for, base_level, budget_status, compute_level, effective_delay, number_change_weakens, recent_count,
    study_rule_change_weakens, tag_change_weakens, NumberField, Settings, StudyRule, StudyStatus,
};
use crate::risk::{in_risk_window, normalize_risk_window, risk_windows_change_weakens, RiskWindow, MAX_RISK_WINDOWS};
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorCode {
    Invalid,
    NeedsConfirm,
    StudyLocked,
    UnknownEvent,
    AlreadyDecided,
    Locked,
}

impl ErrorCode {
    pub fn message(self) -> &'static str {
        match self {
            ErrorCode::Invalid => "Giá trị không hợp lệ.",
            ErrorCode::NeedsConfirm => "Thay đổi này làm yếu bảo vệ nên cần xác nhận.",
            ErrorCode::StudyLocked => "Đang trong phiên học nên không chỉnh được.",
            ErrorCode::UnknownEvent => "Không tìm thấy lần chặn này.",
            ErrorCode::AlreadyDecided => "Lần chặn này đã có quyết định.",
            ErrorCode::Locked => "Nút Vào vẫn đang bị khóa.",
        }
    }
}

pub const ACTIVITIES: [&str; 3] = ["Nhảy dây", "Hít đất", "Đọc sách"];
/// Grace for the lock check, to absorb timer jitter between the screen and the record.
pub const LOCK_TOLERANCE_MS: i64 = 500;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarningPlan {
    pub level: i64,
    pub lock_seconds: i64,
    pub allow_options: Vec<i64>,
    pub n: i64,
    pub study_label: Option<String>,
    /// The risk-hours raise applied: inside a risk window and the base level was below 3.
    pub risk: bool,
}

/// `tz` is the local offset in minutes, for the risk windows.
pub fn plan_warning(
    shown: &[i64],
    now: i64,
    tz: i64,
    study: &StudyStatus,
    used_minutes: f64,
    s: &Settings,
) -> WarningPlan {
    let n = recent_count(shown, now);
    let over = budget_status(used_minutes, s.budget_minutes).over;
    let in_risk = in_risk_window(&s.risk_windows, now, tz);
    let lvl = compute_level(n, study.active, over, s, in_risk);
    WarningPlan {
        level: lvl.level,
        lock_seconds: lvl.lock_seconds,
        allow_options: lvl.allow_options,
        n,
        study_label: if study.active { study.label.clone() } else { None },
        risk: in_risk && base_level(n, study.active, over) < 3,
    }
}

/// Did the raise apply to a warning that was already recorded (the same event asked for again)? The stored
/// event has its level, `n` and study label, so the base level is rebuilt from them; the budget is read now.
pub fn replay_risk(
    level: i64,
    n: i64,
    was_studying: bool,
    over_budget: bool,
    shown_at: i64,
    tz: i64,
    s: &Settings,
) -> bool {
    base_level(n, was_studying, over_budget) < 3
        && level == base_level(n, was_studying, over_budget) + 1
        && in_risk_window(&s.risk_windows, shown_at, tz)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Enter,
    Exit,
    Alternative,
}

impl Decision {
    pub fn id(self) -> &'static str {
        match self {
            Decision::Enter => "enter",
            Decision::Exit => "exit",
            Decision::Alternative => "alternative",
        }
    }

    pub fn parse(s: &str) -> Option<Decision> {
        match s {
            "enter" => Some(Decision::Enter),
            "exit" => Some(Decision::Exit),
            "alternative" => Some(Decision::Alternative),
            _ => None,
        }
    }
}

pub struct DecisionCheck<'a> {
    pub decision: Decision,
    pub existing: Option<&'a str>,
    pub shown_at: i64,
    pub lock_seconds: i64,
    pub level: i64,
    pub allow_minutes: Option<i64>,
    pub activity: Option<&'a str>,
    pub activity_minutes: Option<i64>,
}

pub fn check_decision(c: &DecisionCheck, s: &Settings, now: i64) -> Option<ErrorCode> {
    if let Some(existing) = c.existing {
        return if existing == c.decision.id() { None } else { Some(ErrorCode::AlreadyDecided) };
    }
    match c.decision {
        Decision::Enter => {
            if now - c.shown_at < c.lock_seconds * 1000 - LOCK_TOLERANCE_MS {
                Some(ErrorCode::Locked)
            } else if c.allow_minutes.is_none_or(|m| !allow_options_for(s, c.level).contains(&m)) {
                Some(ErrorCode::Invalid)
            } else {
                None
            }
        }
        Decision::Alternative => {
            let ok = c.activity.is_some_and(|a| ACTIVITIES.contains(&a))
                && c.activity_minutes.is_some_and(|m| (2..=10).contains(&m));
            if ok {
                None
            } else {
                Some(ErrorCode::Invalid)
            }
        }
        Decision::Exit => None,
    }
}

pub fn check_tag_change(
    old: Option<&str>,
    new: Option<&str>,
    confirmed: bool,
    study_active: bool,
) -> Option<ErrorCode> {
    if old == new {
        None
    } else if study_active {
        Some(ErrorCode::StudyLocked)
    } else if tag_change_weakens(old, new) && !confirmed {
        Some(ErrorCode::NeedsConfirm)
    } else {
        None
    }
}

pub fn check_app_delay(
    tag: &str,
    old: Option<i64>,
    new: Option<i64>,
    s: &Settings,
    confirmed: bool,
    study_active: bool,
) -> Option<ErrorCode> {
    if new.is_some_and(|d| !(0..=120).contains(&d)) {
        return Some(ErrorCode::Invalid);
    }
    if old == new {
        return None;
    }
    if study_active {
        return Some(ErrorCode::StudyLocked);
    }
    let before = effective_delay(old, tag, &s.tag_delays);
    let after = effective_delay(new, tag, &s.tag_delays);
    if number_change_weakens(NumberField::DelaySeconds, before, after) && !confirmed {
        Some(ErrorCode::NeedsConfirm)
    } else {
        None
    }
}

/// Replacing the list of risk windows (docs 2.5). Any bad entry or more than twelve windows is
/// invalid. A change that leaves some minute of the week uncovered that was covered is a weakening: locked during
/// study, otherwise it needs the confirmation. Adding or widening is saved at once.
pub fn check_risk_windows(
    old: &[RiskWindow],
    new: &[RiskWindow],
    confirmed: bool,
    study_active: bool,
) -> Option<ErrorCode> {
    if new.len() > MAX_RISK_WINDOWS || new.iter().any(|w| normalize_risk_window(w).is_none()) {
        return Some(ErrorCode::Invalid);
    }
    if !risk_windows_change_weakens(old, new) {
        return None;
    }
    if study_active {
        Some(ErrorCode::StudyLocked)
    } else if !confirmed {
        Some(ErrorCode::NeedsConfirm)
    } else {
        None
    }
}

/// One to four allow-window lengths in minutes, each from 1 to `max`.
fn valid_allow_options(options: &[i64], max: i64) -> bool {
    (1..=4).contains(&options.len()) && options.iter().all(|m| (1..=max).contains(m))
}

pub fn check_friction(old: &Settings, new: &Settings, confirmed: bool, study_active: bool) -> Option<ErrorCode> {
    let valid = new.lock_seconds.len() == 4
        && new.lock_seconds.iter().all(|s| (0..=300).contains(s))
        && (0..=1440).contains(&new.budget_minutes)
        && new.tag_delays.values().all(|d| (0..=120).contains(d))
        && valid_allow_options(&new.allow_options_normal, 120)
        && valid_allow_options(&new.allow_options_restricted, 10);
    if !valid {
        return Some(ErrorCode::Invalid);
    }
    if old == new {
        return None;
    }
    if study_active {
        return Some(ErrorCode::StudyLocked);
    }
    let lock_weakens =
        (0..4).any(|i| number_change_weakens(NumberField::LockSeconds, old.lock_seconds[i], new.lock_seconds[i]));
    let budget_weakens = number_change_weakens(NumberField::BudgetMinutes, old.budget_minutes, new.budget_minutes);
    let delay_weakens = old.tag_delays.keys().chain(new.tag_delays.keys()).any(|k| {
        number_change_weakens(
            NumberField::DelaySeconds,
            *old.tag_delays.get(k).unwrap_or(&0),
            *new.tag_delays.get(k).unwrap_or(&0),
        )
    });
    // A longer allow window is the weaker setting.
    let longest = |v: &[i64]| v.iter().copied().max().unwrap_or(0);
    let options_weaken = longest(&new.allow_options_normal) > longest(&old.allow_options_normal)
        || longest(&new.allow_options_restricted) > longest(&old.allow_options_restricted);
    if (lock_weakens || budget_weakens || delay_weakens || options_weaken) && !confirmed {
        Some(ErrorCode::NeedsConfirm)
    } else {
        None
    }
}

/// Adding or widening a weekly rule is always fine; anything that weakens it waits for the
/// confirmation, and is locked while studying (ending study early goes through `check_study_stop`).
pub fn check_study_rule_change(
    old: Option<&StudyRule>,
    new: Option<&StudyRule>,
    confirmed: bool,
    study_active: bool,
    now: i64,
    tz: i64,
) -> Option<ErrorCode> {
    if old == new || !study_rule_change_weakens(old, new, now, tz) {
        None
    } else if study_active {
        Some(ErrorCode::StudyLocked)
    } else if !confirmed {
        Some(ErrorCode::NeedsConfirm)
    } else {
        None
    }
}

/// Ending study before its time (FR14).
pub fn check_study_stop(study_active: bool, confirmed: bool) -> Option<ErrorCode> {
    if !study_active {
        Some(ErrorCode::Invalid)
    } else if !confirmed {
        Some(ErrorCode::NeedsConfirm)
    } else {
        None
    }
}

pub fn check_protection(current: bool, enabled: bool, confirmed: bool, study_active: bool) -> Option<ErrorCode> {
    if current == enabled || enabled {
        None
    } else if study_active {
        Some(ErrorCode::StudyLocked)
    } else if !confirmed {
        Some(ErrorCode::NeedsConfirm)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::StudyStatus;
    use std::collections::HashMap;

    const NOW: i64 = 1_791_810_000_000;
    const MIN: i64 = 60_000;
    const TZ: i64 = 420;

    fn studying() -> StudyStatus {
        StudyStatus {
            active: true,
            source: Some("manual".into()),
            label: Some("Ôn Hệ điều hành".into()),
            ends_at: Some(NOW + 30 * MIN),
        }
    }

    #[test]
    fn plan_escalates() {
        let s = Settings::default();
        assert_eq!(plan_warning(&[], NOW, TZ, &StudyStatus::none(), 0.0, &s).level, 0);
        assert_eq!(plan_warning(&[NOW - MIN], NOW, TZ, &StudyStatus::none(), 0.0, &s).level, 1);
        let p = plan_warning(&[NOW - 3 * MIN, NOW - 2 * MIN, NOW - MIN], NOW, TZ, &StudyStatus::none(), 0.0, &s);
        assert_eq!((p.level, p.lock_seconds, p.n), (2, 20, 3));
        let st = plan_warning(&[], NOW, TZ, &studying(), 0.0, &s);
        assert_eq!(
            (st.level, st.allow_options.clone(), st.study_label.as_deref()),
            (3, vec![5, 10], Some("Ôn Hệ điều hành"))
        );
        assert_eq!(plan_warning(&[], NOW, TZ, &StudyStatus::none(), 90.0, &s).level, 3);
    }

    fn enter(at: i64, minutes: Option<i64>, level: i64) -> Option<ErrorCode> {
        let c = DecisionCheck {
            decision: Decision::Enter,
            existing: None,
            shown_at: NOW,
            lock_seconds: 5,
            level,
            allow_minutes: minutes,
            activity: None,
            activity_minutes: None,
        };
        check_decision(&c, &Settings::default(), at)
    }

    #[test]
    fn enter_rules() {
        assert_eq!(enter(NOW + 2000, Some(5), 0), Some(ErrorCode::Locked));
        assert_eq!(enter(NOW + 4600, Some(5), 0), None);
        assert_eq!(enter(NOW + 6000, Some(7), 0), Some(ErrorCode::Invalid));
        assert_eq!(enter(NOW + 6000, Some(15), 3), Some(ErrorCode::Invalid));
        assert_eq!(enter(NOW + 6000, Some(10), 3), None);
        assert_eq!(enter(NOW + 6000, None, 0), Some(ErrorCode::Invalid));
    }

    #[test]
    fn alternative_and_repeats() {
        let s = Settings::default();
        let alt = |a: &'static str, m: i64| DecisionCheck {
            decision: Decision::Alternative,
            existing: None,
            shown_at: NOW,
            lock_seconds: 5,
            level: 0,
            allow_minutes: None,
            activity: Some(a),
            activity_minutes: Some(m),
        };
        assert_eq!(check_decision(&alt("Hít đất", 3), &s, NOW), None);
        assert_eq!(check_decision(&alt("Ngủ", 3), &s, NOW), Some(ErrorCode::Invalid));
        assert_eq!(check_decision(&alt("Hít đất", 11), &s, NOW), Some(ErrorCode::Invalid));
        let again = DecisionCheck { existing: Some("exit"), ..alt("Hít đất", 3) };
        assert_eq!(check_decision(&again, &s, NOW), Some(ErrorCode::AlreadyDecided));
    }

    #[test]
    fn options_rules() {
        let s = Settings::default();
        assert_eq!(check_tag_change(Some("entertainment"), Some("study"), false, false), Some(ErrorCode::NeedsConfirm));
        assert_eq!(check_tag_change(None, Some("game"), false, false), None);
        assert_eq!(check_tag_change(None, Some("game"), true, true), Some(ErrorCode::StudyLocked));
        assert_eq!(check_app_delay("game", None, Some(60), &s, false, false), Some(ErrorCode::NeedsConfirm));
        assert_eq!(check_app_delay("game", None, Some(10), &s, false, false), None);
        assert_eq!(check_app_delay("game", None, Some(500), &s, true, false), Some(ErrorCode::Invalid));
        let weaker = Settings { lock_seconds: vec![5, 5, 20, 30], ..s.clone() };
        assert_eq!(check_friction(&s, &weaker, false, false), Some(ErrorCode::NeedsConfirm));
        let stronger = Settings { budget_minutes: 60, ..s.clone() };
        assert_eq!(check_friction(&s, &stronger, false, false), None);
        let longer_delay = Settings { tag_delays: HashMap::from([("game".into(), 60)]), ..s.clone() };
        assert_eq!(check_friction(&s, &longer_delay, false, false), Some(ErrorCode::NeedsConfirm));
        assert_eq!(check_friction(&s, &stronger, true, true), Some(ErrorCode::StudyLocked));
        assert_eq!(check_protection(true, false, false, false), Some(ErrorCode::NeedsConfirm));
        assert_eq!(check_protection(false, true, false, true), None);
    }

    #[test]
    fn allow_options_are_validated_and_raising_the_longest_needs_confirmation() {
        let s = Settings::default();
        let with =
            |n: Vec<i64>, r: Vec<i64>| Settings { allow_options_normal: n, allow_options_restricted: r, ..s.clone() };
        for bad in [
            with(vec![600], vec![5]),
            with(vec![0, 5], vec![5]),
            with(vec![1, 2, 3, 4, 5], vec![5]),
            with(vec![5], vec![11]),
            with(vec![5], vec![]),
        ] {
            assert_eq!(check_friction(&s, &bad, true, false), Some(ErrorCode::Invalid));
        }
        let longer = with(vec![5, 15, 60], vec![5, 10]);
        assert_eq!(check_friction(&s, &longer, false, false), Some(ErrorCode::NeedsConfirm));
        assert_eq!(check_friction(&s, &longer, true, false), None);
        assert_eq!(check_friction(&s, &longer, true, true), Some(ErrorCode::StudyLocked));
        let shorter = with(vec![5, 15], vec![5]);
        assert_eq!(check_friction(&s, &shorter, false, false), None);
    }

    fn risk(id: &str, days: &[i64], start: &str, end: &str) -> RiskWindow {
        RiskWindow { id: id.into(), days: days.to_vec(), start: start.into(), end: end.into() }
    }

    #[test]
    fn plan_raises_the_level_in_a_risk_window_and_says_so() {
        // NOW is Monday 20:00 local (tz 420).
        let mut s = Settings { risk_windows: vec![risk("a", &[1], "19:00", "21:00")], ..Settings::default() };
        let p = plan_warning(&[], NOW, TZ, &StudyStatus::none(), 0.0, &s);
        assert_eq!((p.level, p.lock_seconds, p.risk), (1, 10, true));
        let p = plan_warning(&[NOW - MIN, NOW - 2 * MIN, NOW - 3 * MIN], NOW, TZ, &StudyStatus::none(), 0.0, &s);
        assert_eq!((p.level, p.lock_seconds, p.allow_options.clone(), p.risk), (3, 30, vec![5, 10], true));
        // Already level 3 by study or budget: nothing was raised, no line to show.
        let st = plan_warning(&[], NOW, TZ, &studying(), 0.0, &s);
        assert_eq!((st.level, st.risk), (3, false));
        assert!(!plan_warning(&[], NOW, TZ, &StudyStatus::none(), 90.0, &s).risk);
        // Outside the window, or no window: the plain level.
        let p = plan_warning(&[], NOW + 2 * 60 * MIN, TZ, &StudyStatus::none(), 0.0, &s);
        assert_eq!((p.level, p.risk), (0, false));
        s.risk_windows.clear();
        assert!(!plan_warning(&[], NOW, TZ, &StudyStatus::none(), 0.0, &s).risk);
    }

    #[test]
    fn replay_risk_rebuilds_the_flag_of_a_recorded_warning() {
        let s = Settings { risk_windows: vec![risk("a", &[1], "19:00", "21:00")], ..Settings::default() };
        assert!(replay_risk(1, 0, false, false, NOW, TZ, &s));
        assert!(replay_risk(3, 3, false, false, NOW, TZ, &s));
        assert!(!replay_risk(0, 0, false, false, NOW, TZ, &s), "level 0 was not raised");
        assert!(!replay_risk(3, 0, true, false, NOW, TZ, &s), "study gave level 3");
        assert!(!replay_risk(3, 0, false, true, NOW, TZ, &s), "budget gave level 3");
        assert!(!replay_risk(1, 0, false, false, NOW + 120 * MIN, TZ, &s), "shown outside the window");
    }

    #[test]
    fn risk_windows_changes_are_checked_like_the_other_weakenings() {
        let a = risk("a", &[1, 2, 3, 4, 5], "19:00", "21:00");
        let wider = risk("a", &[1, 2, 3, 4, 5], "18:00", "21:00");
        let b = risk("b", &[6, 7], "10:00", "12:00");
        // Adding and widening are saved at once, also during study.
        assert_eq!(check_risk_windows(&[], std::slice::from_ref(&a), false, false), None);
        assert_eq!(check_risk_windows(std::slice::from_ref(&a), std::slice::from_ref(&wider), false, true), None);
        assert_eq!(check_risk_windows(std::slice::from_ref(&a), &[a.clone(), b.clone()], false, true), None);
        // Removing or shortening weakens: study locks it, otherwise it needs the confirmation.
        assert_eq!(
            check_risk_windows(&[a.clone(), b.clone()], std::slice::from_ref(&a), false, false),
            Some(ErrorCode::NeedsConfirm)
        );
        assert_eq!(check_risk_windows(&[a.clone(), b.clone()], std::slice::from_ref(&a), true, false), None);
        assert_eq!(
            check_risk_windows(std::slice::from_ref(&wider), std::slice::from_ref(&a), true, true),
            Some(ErrorCode::StudyLocked)
        );
        assert_eq!(check_risk_windows(&[wider], std::slice::from_ref(&a), false, true), Some(ErrorCode::StudyLocked));
        // Bad lists are invalid whatever the flags are.
        let none = risk("n", &[], "19:00", "21:00");
        assert_eq!(check_risk_windows(&[], &[none], true, false), Some(ErrorCode::Invalid));
        let many: Vec<RiskWindow> = (0..13).map(|i| risk(&format!("w{i}"), &[1], "08:00", "09:00")).collect();
        assert_eq!(check_risk_windows(&[], &many, true, false), Some(ErrorCode::Invalid));
        assert_eq!(check_risk_windows(&[], &many[..12], true, false), None);
    }
}
