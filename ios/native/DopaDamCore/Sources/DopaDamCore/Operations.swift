import Foundation

/// Grace for the lock check, to absorb timer jitter between the screen and the core.
private let lockToleranceMs: Int64 = 500

extension AppState {
    // MARK: - Study and budget views

    /// The study status now: a manual session or a weekly rule.
    public func studyStatus(now: Int64, tz: Int) -> StudyStatus {
        resolveStudy(now: now, tzOffsetMinutes: tz, manual: manualStudy, rules: studyRules, external: [])
    }

    /// Minutes granted through "Vào" on the app day of `now`.
    public func grantedToday(now: Int64, tz: Int) -> Int { grantedMinutes[dayKey(now, tzOffsetMinutes: tz)] ?? 0 }

    public func budgetView(now: Int64, tz: Int) -> BudgetView {
        let used = Double(grantedToday(now: now, tz: tz))
        let status = budgetStatus(usedMinutes: used, budgetMinutes: Double(settings.budgetMinutes))
        return BudgetView(usedMinutes: used, budgetMinutes: settings.budgetMinutes, remainingMinutes: status.remainingMinutes, over: status.over)
    }

    public func allowOptions(forLevel level: Int) -> [Int] {
        level == 3 ? settings.allowOptionsRestricted : settings.allowOptionsNormal
    }

    private func studyIsLocked(now: Int64, tz: Int) -> Bool { studyStatus(now: now, tz: tz).active }

    // MARK: - Should I ask?

    /// What the Shortcuts action "should I ask?" calls with the app's name. False while an allow window for that
    /// app is running; true otherwise (also for an empty name). Removes expired windows and closes warnings
    /// nobody decided for 12 hours.
    public mutating func shouldAsk(app: String, now: Int64) -> Bool {
        allowWindows.removeAll { $0.expiresAt <= now }
        _ = closeAbandoned(now: now)
        guard let key = AppName.key(app) else { return true }
        return !allowWindows.contains { AppName.key($0.app) == key }
    }

    /// When the running allow window of `app` ends, nil when there is none. Does not change the state.
    public func allowWindowEnd(app: String, now: Int64) -> Int64? {
        guard let key = AppName.key(app) else { return nil }
        return allowWindows.filter { AppName.key($0.app) == key && $0.expiresAt > now }.map { $0.expiresAt }.max()
    }

    /// The running allow windows, soonest to end first.
    public func activeAllowWindows(now: Int64) -> [AllowWindow] {
        allowWindows.filter { $0.expiresAt > now }.sorted { $0.expiresAt < $1.expiresAt }
    }

    // MARK: - Warnings

    /// Records that a warning is being shown for `app` and returns what the screen shows. Passing the id of an
    /// existing warning (a reload of the same screen) returns that warning without counting it twice; without
    /// an id a fresh one is made.
    public mutating func recordWarning(app: String, now: Int64, tz: Int, id: String? = nil) -> Result<WarningContext, CoreError> {
        guard let name = AppName.clean(app) else { return .failure(.invalid) }
        _ = closeAbandoned(now: now)
        let eventId = id ?? UUID().uuidString
        if events.contains(where: { $0.id == eventId }) {
            return warningContext(eventId: eventId, now: now, tz: tz).map { .success($0) } ?? .failure(.notFound)
        }
        let n = recentCount(events.map { $0.shownAt }, now: now)
        let study = studyStatus(now: now, tz: tz)
        let budget = budgetView(now: now, tz: tz)
        let inRisk = inRiskWindow(riskWindows, now: now, tzOffsetMinutes: tz)
        let level = computeLevel(n: n, inStudy: study.active, overBudget: budget.over, settings: settings.friction, inRisk: inRisk)
        // The raise applied only when the level is higher than without the window (it never goes past 3).
        let plain = computeLevel(n: n, inStudy: study.active, overBudget: budget.over, settings: settings.friction)
        events.append(WarningEvent(
            id: eventId, app: name, level: level.level, lockSeconds: level.lockSeconds, risk: level.level > plain.level, n: n,
            shownAt: now, studyLabel: study.active ? study.label : nil))
        if events.count > AppState.maxEvents { events.removeFirst(events.count - AppState.maxEvents) }
        return warningContext(eventId: eventId, now: now, tz: tz).map { .success($0) } ?? .failure(.notFound)
    }

    /// The screen's data for a stored warning, with the budget and study status as of `now` (use it to resume a
    /// warning after the app was backgrounded). Nil for an unknown id.
    public func warningContext(eventId: String, now: Int64, tz: Int) -> WarningContext? {
        guard let e = events.first(where: { $0.id == eventId }) else { return nil }
        let study = studyStatus(now: now, tz: tz)
        let budget = budgetView(now: now, tz: tz)
        let activityEnds: Int64? = (e.decision == .alternative && e.decidedAt != nil && e.activityMinutes != nil)
            ? e.decidedAt! + Int64(e.activityMinutes!) * Ms.minute : nil
        return WarningContext(
            eventId: e.id, app: e.app, level: e.level, lockSeconds: e.lockSeconds, allowOptions: allowOptions(forLevel: e.level),
            n: e.n, countThisHour: e.n + 1, shownAt: e.shownAt, enterUnlocksAt: e.shownAt + Int64(e.lockSeconds) * 1000,
            risk: e.risk, studyActive: study.active, studyLabel: study.active ? study.label : nil,
            studyEndsAt: study.active ? study.endsAt : nil, budget: budget, activities: activityNames,
            activityMinutesRange: activityMinutesRange, activityDefaultMinutes: activityDefaultMinutes,
            decision: e.decision, decidedAt: e.decidedAt, allowMinutes: e.allowMinutes, activity: e.activity,
            activityMinutes: e.activityMinutes, activityEndsAt: activityEnds,
            headline: Wording.headline(app: e.app),
            metaLine: Wording.metaLine(countThisHour: e.n + 1, lockSeconds: e.lockSeconds),
            riskLine: e.risk ? Wording.riskLine : nil, budgetLine: budget.line,
            studyLine: study.active && study.endsAt != nil
                ? Wording.studyLine(label: study.label ?? "", minutesLeft: minutesUntil(study.endsAt!, now: now)) : nil)
    }

    /// Applies the user's choice. Same checks as the extension: an early "Vào" is `.locked`; the minutes must be
    /// one of the options of that warning's level; an activity must be one of `activityNames` for 2...10 minutes.
    /// Repeating the decision already made succeeds with no change; a different one is `.alreadyDecided`.
    /// "Vào" opens the allow window for the app and adds the minutes to today's granted total.
    public mutating func decide(eventId: String, choice: Choice, now: Int64, tz: Int) -> Result<DecisionOutcome, CoreError> {
        guard let index = events.firstIndex(where: { $0.id == eventId }) else { return .failure(.notFound) }
        let event = events[index]
        let wanted: Decision
        switch choice {
        case .exit: wanted = .exit
        case .enter: wanted = .enter
        case .alternative: wanted = .alternative
        }
        if let existing = event.decision {
            return existing == wanted ? .success(outcome(for: event, now: now, tz: tz)) : .failure(.alreadyDecided)
        }
        switch choice {
        case .exit:
            break
        case .enter(let minutes):
            if now - event.shownAt < Int64(event.lockSeconds) * 1000 - lockToleranceMs { return .failure(.locked) }
            guard allowOptions(forLevel: event.level).contains(minutes) else { return .failure(.invalid) }
            allowWindows.removeAll { AppName.key($0.app) == AppName.key(event.app) }
            allowWindows.append(AllowWindow(app: event.app, expiresAt: now + Int64(minutes) * Ms.minute))
            grantedMinutes[dayKey(now, tzOffsetMinutes: tz), default: 0] += minutes
            events[index].allowMinutes = minutes
        case .alternative(let activity, let minutes):
            guard activityNames.contains(activity), activityMinutesRange.contains(minutes) else { return .failure(.invalid) }
            events[index].activity = activity
            events[index].activityMinutes = minutes
        }
        events[index].decision = wanted
        events[index].decidedAt = now
        return .success(outcome(for: events[index], now: now, tz: tz))
    }

    private func outcome(for e: WarningEvent, now: Int64, tz: Int) -> DecisionOutcome {
        var allowEnds: Int64?
        var activityEnds: Int64?
        var granted: Int?
        if e.decision == .enter, let at = e.decidedAt, let minutes = e.allowMinutes {
            allowEnds = at + Int64(minutes) * Ms.minute
            granted = grantedToday(now: now, tz: tz)
        }
        if e.decision == .alternative, let at = e.decidedAt, let minutes = e.activityMinutes {
            activityEnds = at + Int64(minutes) * Ms.minute
        }
        return DecisionOutcome(event: e, allowEndsAt: allowEnds, activityEndsAt: activityEnds, grantedTodayMinutes: granted)
    }

    /// A warning left without a choice (the screen was closed) counts as leaving, decided at `now`.
    /// False when the warning is unknown or already decided.
    @discardableResult
    public mutating func autoExit(eventId: String, now: Int64) -> Bool {
        guard let index = events.firstIndex(where: { $0.id == eventId }), events[index].decision == nil else { return false }
        events[index].decision = .exit
        events[index].decidedAt = now
        return true
    }

    /// Warnings still waiting for a choice and not older than 12 hours, newest first. The app can resume the
    /// first one (`warningContext`) or close it with `autoExit`.
    public func pendingWarnings(now: Int64, tz: Int) -> [WarningContext] {
        events.filter { $0.decision == nil && $0.shownAt > now - AppState.abandonedAfterMs && $0.shownAt <= now }
            .sorted { $0.shownAt > $1.shownAt }
            .compactMap { warningContext(eventId: $0.id, now: now, tz: tz) }
    }

    /// Closes undecided warnings older than 12 hours as Thoát with no decision time (as the other clients do, so
    /// they can be synced). Returns their ids. Called by `shouldAsk`, `recordWarning` and `prune` already.
    @discardableResult
    public mutating func closeAbandoned(now: Int64) -> [String] {
        var closed: [String] = []
        for i in events.indices where events[i].decision == nil && events[i].shownAt <= now - AppState.abandonedAfterMs {
            events[i].decision = .exit
            events[i].decidedAt = nil
            closed.append(events[i].id)
        }
        return closed
    }

    // MARK: - Study

    /// A manual study session from now (5 to 480 minutes). Starting one while studying only adds time.
    public mutating func startStudy(minutes: Int, label: String?, now: Int64) -> Result<Session, CoreError> {
        guard (5...480).contains(minutes) else { return .failure(.invalid) }
        let clean = truncateStudyLabel((label ?? "").trimmingCharacters(in: .whitespacesAndNewlines))
        let session = Session(id: UUID().uuidString, start: now, end: now + Int64(minutes) * Ms.minute, label: clean.isEmpty ? nil : clean)
        manualStudy.append(session)
        return .success(session)
    }

    /// Ends study now: running manual sessions end, running rule windows get an exception for their day.
    /// `.invalid` when not studying; needs the confirmation.
    public mutating func stopStudy(confirmed: Bool, now: Int64, tz: Int) -> Result<Void, CoreError> {
        if !studyStatus(now: now, tz: tz).active { return .failure(.invalid) }
        if !confirmed { return .failure(.needsConfirm) }
        manualStudy = manualStudy.map { s in
            var t = s
            if s.start <= now && now < s.end { t.end = now }
            return t
        }
        for occurrence in activeRuleOccurrences(studyRules, now: now, tzOffsetMinutes: tz) {
            if let i = studyRules.firstIndex(where: { $0.id == occurrence.ruleId }), !studyRules[i].exceptions.contains(occurrence.date) {
                studyRules[i].exceptions = (studyRules[i].exceptions + [occurrence.date]).sorted()
            }
        }
        return .success(())
    }

    /// Adds (empty id) or changes a weekly rule. Weakening needs the confirmation and is locked while studying.
    public mutating func setStudyRule(_ input: StudyRule, confirmed: Bool, now: Int64, tz: Int) -> Result<StudyRule, CoreError> {
        guard var rule = normalizeStudyRule(input) else { return .failure(.invalid) }
        if rule.id.isEmpty { rule.id = UUID().uuidString }
        let index = studyRules.firstIndex(where: { $0.id == rule.id })
        let old = index.map { studyRules[$0] }
        if classifyStudyRuleChange(old: old, new: rule, now: now, tzOffsetMinutes: tz) == .weaken {
            if studyIsLocked(now: now, tz: tz) { return .failure(.studyLocked) }
            if !confirmed { return .failure(.needsConfirm) }
        }
        if let i = index { studyRules[i] = rule } else { studyRules.append(rule) }
        return .success(rule)
    }

    /// Deleting an unknown id succeeds without change.
    public mutating func deleteStudyRule(id: String, confirmed: Bool, now: Int64, tz: Int) -> Result<Void, CoreError> {
        guard let old = studyRules.first(where: { $0.id == id }) else { return .success(()) }
        if classifyStudyRuleChange(old: old, new: nil, now: now, tzOffsetMinutes: tz) == .weaken {
            if studyIsLocked(now: now, tz: tz) { return .failure(.studyLocked) }
            if !confirmed { return .failure(.needsConfirm) }
        }
        studyRules.removeAll { $0.id == id }
        return .success(())
    }

    // MARK: - Settings

    /// Replaces the friction numbers and the budget. Validated like the agent's `check_friction`; locked during
    /// study; a weakening (shorter lock, bigger or no budget, a longer longest option) needs `confirmed`.
    public mutating func setSettings(_ new: Settings, confirmed: Bool, now: Int64, tz: Int) -> Result<Void, CoreError> {
        guard new.isValid else { return .failure(.invalid) }
        if new == settings { return .success(()) }
        if studyIsLocked(now: now, tz: tz) { return .failure(.studyLocked) }
        if settingsChange(to: new) == .weaken && !confirmed { return .failure(.needsConfirm) }
        settings = new
        return .success(())
    }

    /// Whether changing the settings to `new` would weaken protection (so the UI can show the confirmation first).
    public func settingsChange(to new: Settings) -> ChangeKind {
        let old = settings
        let lockWeakens = zip(old.lockSeconds, new.lockSeconds).contains { classifyNumberChange(field: .lockSeconds, old: $0, new: $1) == .weaken }
        let budgetWeakens = classifyNumberChange(field: .budgetMinutes, old: old.budgetMinutes, new: new.budgetMinutes) == .weaken
        // A longer allow window is the weaker setting.
        let longest = { (v: [Int]) in v.max() ?? 0 }
        let optionsWeaken = longest(new.allowOptionsNormal) > longest(old.allowOptionsNormal)
            || longest(new.allowOptionsRestricted) > longest(old.allowOptionsRestricted)
        return lockWeakens || budgetWeakens || optionsWeaken ? .weaken : .ok
    }

    // MARK: - Risk hours

    /// Replaces the list of risk windows. Every window must be valid and there are at most 12. A change that
    /// weakens protection is locked during study, then needs the confirmation. New or repeated ids get fresh ones.
    public mutating func setRiskWindows(_ windows: [RiskWindow], confirmed: Bool, now: Int64, tz: Int) -> Result<[RiskWindow], CoreError> {
        if windows.count > maxRiskWindows { return .failure(.invalid) }
        var next: [RiskWindow] = []
        for w in windows {
            guard var clean = normalizeRiskWindow(w) else { return .failure(.invalid) }
            if clean.id.isEmpty || next.contains(where: { $0.id == clean.id }) { clean.id = UUID().uuidString }
            next.append(clean)
        }
        if classifyRiskWindowsChange(old: riskWindows, new: next) == .weaken {
            if studyIsLocked(now: now, tz: tz) { return .failure(.studyLocked) }
            if !confirmed { return .failure(.needsConfirm) }
        }
        riskWindows = next
        return .success(next)
    }

    /// The heat map of the last `days` days (default 28), 7 rows (Monday first) of 24 hours.
    public func riskHeatmap(now: Int64, tz: Int, days: Int = 28) -> RiskHeatmap {
        DopaDamCore.riskHeatmap(events: events.map { $0.riskEvent }, now: now, tzOffsetMinutes: tz, days: days)
    }

    /// The busiest two-hour block that no window covers yet, from the last 28 days.
    public func riskSuggestion(now: Int64, tz: Int) -> RiskSuggestion? {
        suggestRiskWindow(cells: riskHeatmap(now: now, tz: tz), existing: riskWindows)
    }

    // MARK: - Log

    /// Clears the warnings and the granted minutes (so recent opens and today's budget go back to zero): refused
    /// during study even when confirmed, and needs the confirmation.
    public mutating func clearLog(confirmed: Bool, now: Int64, tz: Int) -> Result<Void, CoreError> {
        if studyIsLocked(now: now, tz: tz) { return .failure(.studyLocked) }
        if !confirmed { return .failure(.needsConfirm) }
        events = []
        grantedMinutes = [:]
        return .success(())
    }

    /// Keeps 30 days: older warnings, granted-minute days and study sessions go; expired allow windows go;
    /// warnings undecided for 12 hours are closed.
    public mutating func prune(now: Int64, tz: Int) {
        let cutoff = now - Int64(AppState.retentionDays) * Ms.day
        _ = closeAbandoned(now: now)
        events.removeAll { $0.shownAt < cutoff }
        let cutoffDay = dayKey(cutoff, tzOffsetMinutes: tz)
        grantedMinutes = grantedMinutes.filter { $0.key >= cutoffDay }
        manualStudy.removeAll { $0.end < cutoff }
        allowWindows.removeAll { $0.expiresAt <= now }
    }
}
