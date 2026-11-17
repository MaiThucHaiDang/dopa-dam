import Foundation

/// Today (the app day, 04:00 boundary) at a glance.
public struct TodaySummary: Equatable, Sendable {
    public var day: String
    /// Warnings shown today.
    public var warnings: Int
    public var exits: Int
    public var enters: Int
    public var alternatives: Int
    /// Shown but not decided.
    public var undecided: Int
    /// Thoát / decided warnings (exit + enter + alternative); nil when none is decided yet.
    public var exitShare: Double?
    /// "67%", or "–".
    public var exitShareText: String
    public var budget: BudgetView
    /// Minutes granted through "Vào" today.
    public var grantedMinutes: Int
    /// "Hôm nay: 12 / 90 phút giải trí".
    public var budgetLine: String
}

/// One day of the statistics chart.
public struct DayStat: Equatable, Sendable, Identifiable {
    public var id: String { day }
    /// "YYYY-MM-DD".
    public var day: String
    /// "14/10".
    public var label: String
    public var exit: Int
    public var enter: Int
    public var alternative: Int
    public var undecided: Int
    public var grantedMinutes: Int
    public var total: Int { exit + enter + alternative + undecided }
}

/// An app that has been warned about, with counts over the kept history.
public struct AppUsage: Equatable, Sendable, Identifiable {
    public var id: String { key }
    public var key: String
    /// The spelling of the most recent warning.
    public var name: String
    public var warnings: Int
    public var exits: Int
    public var enters: Int
    public var alternatives: Int
    public var lastShownAt: Int64
}

public struct RiskCellView: Equatable, Sendable {
    public var row: Int
    public var hour: Int
    public var opens: Int
    public var enters: Int
    /// 0 for an empty cell, 0.2 (a single visible shade) up to 1 for the busiest cell.
    public var intensity: Double
    /// "Thứ 3, 22 giờ: 5 lần mở, 3 lần Vào".
    public var label: String
}

public struct RiskWindowRow: Equatable, Sendable, Identifiable {
    public var id: String
    public var window: RiskWindow
    /// "22:00–24:00 · thứ 2 đến thứ 6 · thời gian chờ dài hơn một cấp".
    public var line: String
}

/// The "Giờ nguy cơ" card.
public struct RiskCard: Equatable, Sendable {
    public var subtitle: String
    public var rowLabels: [String]
    /// 7 rows (Monday first) of 24 hours.
    public var cells: [[RiskCellView]]
    public var busiestOpens: Int
    public var suggestion: RiskSuggestion?
    /// The suggestion sentence, or "Chưa có khung giờ nào nổi bật.".
    public var suggestionText: String
    public var windows: [RiskWindowRow]
    public var canAddWindow: Bool
    /// True now: a risk window is running.
    public var inRiskNow: Bool
    public var riskLine: String
}

/// When to notify about a running allow window.
public struct AllowNotifications: Equatable, Sendable {
    public var app: String
    /// "Còn 1 phút" at this instant; nil when less than a minute is left (or none).
    public var headsUpAt: Int64?
    public var endsAt: Int64
}

extension AppState {
    public func todaySummary(now: Int64, tz: Int) -> TodaySummary {
        let day = dayKey(now, tzOffsetMinutes: tz)
        var exits = 0, enters = 0, alternatives = 0, undecided = 0, warnings = 0
        for e in events where dayKey(e.shownAt, tzOffsetMinutes: tz) == day {
            warnings += 1
            switch e.decision {
            case .exit: exits += 1
            case .enter: enters += 1
            case .alternative: alternatives += 1
            case nil: undecided += 1
            }
        }
        let decided = exits + enters + alternatives
        let share: Double? = decided > 0 ? Double(exits) / Double(decided) : nil
        let budget = budgetView(now: now, tz: tz)
        return TodaySummary(
            day: day, warnings: warnings, exits: exits, enters: enters, alternatives: alternatives, undecided: undecided,
            exitShare: share, exitShareText: formatPercent(share), budget: budget, grantedMinutes: grantedMinutes[day] ?? 0,
            budgetLine: budget.line)
    }

    /// The weekly progress numbers (7 days against the 7 before).
    public func weeklyProgress(now: Int64, tz: Int) -> WeeklyProgress {
        DopaDamCore.weeklyProgress(events: events, now: now, tzOffsetMinutes: tz)
    }

    /// The weekly progress card with its exact sentences.
    public func weeklyProgressCard(now: Int64, tz: Int) -> ProgressCard {
        progressCard(weeklyProgress(now: now, tz: tz))
    }

    /// Per-day counts for the chart, oldest first, `days` days ending today; days with nothing count as zero.
    public func dayStats(days: Int = 14, now: Int64, tz: Int) -> [DayStat] {
        guard days > 0 else { return [] }
        var order: [String] = []
        var stats: [String: DayStat] = [:]
        for i in stride(from: days - 1, through: 0, by: -1) {
            let key = dayKey(now - Int64(i) * Ms.day, tzOffsetMinutes: tz)
            if stats[key] != nil { continue }
            order.append(key)
            stats[key] = DayStat(day: key, label: shortDate(key), exit: 0, enter: 0, alternative: 0, undecided: 0,
                                 grantedMinutes: grantedMinutes[key] ?? 0)
        }
        for e in events {
            let key = dayKey(e.shownAt, tzOffsetMinutes: tz)
            guard var s = stats[key] else { continue }
            switch e.decision {
            case .exit: s.exit += 1
            case .enter: s.enter += 1
            case .alternative: s.alternative += 1
            case nil: s.undecided += 1
            }
            stats[key] = s
        }
        return order.compactMap { stats[$0] }
    }

    /// Apps seen in the kept history, most warned first (ties: most recent, then name).
    public func appsSeen() -> [AppUsage] {
        var byKey: [String: AppUsage] = [:]
        for e in events {
            guard let key = AppName.key(e.app) else { continue }
            var u = byKey[key] ?? AppUsage(key: key, name: e.app, warnings: 0, exits: 0, enters: 0, alternatives: 0, lastShownAt: e.shownAt)
            u.warnings += 1
            switch e.decision {
            case .exit: u.exits += 1
            case .enter: u.enters += 1
            case .alternative: u.alternatives += 1
            case nil: break
            }
            if e.shownAt >= u.lastShownAt {
                u.lastShownAt = e.shownAt
                u.name = e.app
            }
            byKey[key] = u
        }
        return byKey.values.sorted {
            if $0.warnings != $1.warnings { return $0.warnings > $1.warnings }
            if $0.lastShownAt != $1.lastShownAt { return $0.lastShownAt > $1.lastShownAt }
            return $0.name < $1.name
        }
    }

    /// The "Giờ nguy cơ" card: heat map of the last 28 days, the suggestion, and the active windows.
    public func riskCard(now: Int64, tz: Int) -> RiskCard {
        let grid = riskHeatmap(now: now, tz: tz)
        let maxOpens = grid.reduce(0) { $1.reduce($0) { max($0, $1.opens) } }
        let cells: [[RiskCellView]] = grid.enumerated().map { r, row in
            row.enumerated().map { h, c in
                let intensity = c.opens <= 0 || maxOpens <= 0 ? 0 : 0.2 + 0.8 * min(1, Double(c.opens) / Double(maxOpens))
                return RiskCellView(row: r, hour: h, opens: c.opens, enters: c.enters, intensity: intensity,
                                    label: Wording.riskCellLabel(row: r, hour: h, cell: c))
            }
        }
        let suggestion = suggestRiskWindow(cells: grid, existing: riskWindows)
        return RiskCard(
            subtitle: Wording.riskSubtitle, rowLabels: Wording.riskRowLabels, cells: cells, busiestOpens: maxOpens,
            suggestion: suggestion, suggestionText: suggestion.map(Wording.riskSuggestionLine) ?? Wording.riskNoSuggestion,
            windows: riskWindows.map { RiskWindowRow(id: $0.id, window: $0, line: Wording.riskWindowLine($0)) },
            canAddWindow: riskWindows.count < maxRiskWindows, inRiskNow: inRiskWindow(riskWindows, now: now, tzOffsetMinutes: tz),
            riskLine: Wording.riskLine)
    }

    /// When to schedule "còn 1 phút" and "hết thời gian" for the running allow window of `app`.
    public func allowNotifications(app: String, now: Int64) -> AllowNotifications? {
        guard let end = allowWindowEnd(app: app, now: now) else { return nil }
        let name = allowWindows.first { AppName.key($0.app) == AppName.key(app) }?.app ?? app
        let headsUp = end - Ms.minute
        return AllowNotifications(app: name, headsUpAt: headsUp > now ? headsUp : nil, endsAt: end)
    }
}
