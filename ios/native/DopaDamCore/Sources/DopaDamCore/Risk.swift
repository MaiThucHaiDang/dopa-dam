import Foundation

/// A weekly window in which the friction level is raised by one (docs/thiet-ke-ky-thuat.md, 2.5).
public struct RiskWindow: Codable, Equatable, Sendable {
    public var id: String
    /// ISO weekdays: 1 = Monday ... 7 = Sunday.
    public var days: [Int]
    /// Local time "HH:MM". If end <= start the window runs past midnight.
    public var start: String
    public var end: String

    public init(id: String, days: [Int], start: String, end: String) {
        self.id = id
        self.days = days
        self.start = start
        self.end = end
    }
}

public let maxRiskWindows = 12
/// A suggested block needs at least this many warnings.
public let riskMinOpens = 6
/// Length of a suggested block, in hours.
public let riskBlockHours = 2

private let weekdays = [1, 2, 3, 4, 5]
private let weekend = [6, 7]
private let weekMinutes = 7 * 1440

/// Cleans a window typed by the user: days deduplicated, sorted and limited to 1...7; times written "HH:MM".
/// Nil when it cannot be a window (no day, bad time, start == end). The id is kept as given.
public func normalizeRiskWindow(_ window: RiskWindow) -> RiskWindow? {
    let days = cleanDays(window.days)
    guard !days.isEmpty, let start = parseHm(window.start), let end = parseHm(window.end), start != end else { return nil }
    return RiskWindow(id: window.id, days: days, start: formatHm(start), end: formatHm(end))
}

private struct ValidWindow {
    var days: [Int]
    var start: Int
    var end: Int
}

/// Valid windows only; the end is after the start (next day when it wraps).
private func validWindows(_ windows: [RiskWindow]) -> [ValidWindow] {
    var out: [ValidWindow] = []
    for w in windows {
        guard let n = normalizeRiskWindow(w), let start = parseHm(n.start), let end = parseHm(n.end) else { continue }
        out.append(ValidWindow(days: n.days, start: start, end: end > start ? end : end + 1440))
    }
    return out
}

/// ISO weekday (1 = Monday) of a "local ms" value, and the minute of that local day.
private func localParts(_ localMs: Int64) -> (weekday: Int, minute: Int) {
    let days = floorDiv(localMs, Ms.day)
    return (isoWeekday(ofDay: days), Int(floorDiv(localMs - days * Ms.day, Ms.minute)))
}

/// True when `now` is inside an occurrence of at least one window: start counted, end not counted; a window
/// that starts on a listed day and runs past midnight still counts after midnight. Invalid windows are ignored.
public func inRiskWindow(_ windows: [RiskWindow], now: Int64, tzOffsetMinutes: Int) -> Bool {
    let (weekday, minute) = localParts(now + Int64(tzOffsetMinutes) * Ms.minute)
    let yesterday = weekday == 1 ? 7 : weekday - 1
    for w in validWindows(windows) {
        if w.days.contains(weekday) && w.start <= minute && minute < w.end { return true }
        if w.days.contains(yesterday) && w.end > 1440 && minute + 1440 < w.end { return true }
    }
    return false
}

public struct RiskCell: Codable, Equatable, Sendable {
    public var opens: Int
    public var enters: Int
    public init(opens: Int = 0, enters: Int = 0) {
        self.opens = opens
        self.enters = enters
    }
}

/// 7 rows (0 = Monday ... 6 = Sunday) of 24 columns (local hour 0...23).
public typealias RiskHeatmap = [[RiskCell]]

/// The part of an event the heat map needs.
public struct RiskEvent: Codable, Equatable, Sendable {
    public var shownAt: Int64
    public var decision: Decision?
    public init(shownAt: Int64, decision: Decision?) {
        self.shownAt = shownAt
        self.decision = decision
    }

    enum CodingKeys: String, CodingKey { case shownAt, decision }

    /// An unknown decision text (for example "Enter") is simply not "enter".
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        shownAt = try c.decode(Int64.self, forKey: .shownAt)
        decision = c.tolerant(Decision.self, .decision)
    }
}

public func emptyHeatmap() -> RiskHeatmap {
    Array(repeating: Array(repeating: RiskCell(), count: 24), count: 7)
}

/// Warnings with now - days * 24h <= shownAt <= now (both ends counted), by local weekday and hour of
/// `shownAt` (the 04:00 day boundary is not used). `opens` counts every warning, `enters` those decided "enter".
public func riskHeatmap(events: [RiskEvent], now: Int64, tzOffsetMinutes: Int, days: Int) -> RiskHeatmap {
    var grid = emptyHeatmap()
    let from = now - Int64(days) * Ms.day
    for e in events where e.shownAt >= from && e.shownAt <= now {
        let local = e.shownAt + Int64(tzOffsetMinutes) * Ms.minute
        let dayNumber = floorDiv(local, Ms.day)
        let row = isoWeekday(ofDay: dayNumber) - 1
        let hour = Int(floorDiv(local - dayNumber * Ms.day, Ms.hour))
        grid[row][hour].opens += 1
        if e.decision == .enter { grid[row][hour].enters += 1 }
    }
    return grid
}

public struct RiskSuggestion: Codable, Equatable, Sendable {
    public var days: [Int]
    public var start: String
    public var end: String
    public var opens: Int
    public var enters: Int
    public init(days: [Int], start: String, end: String, opens: Int, enters: Int) {
        self.days = days
        self.start = start
        self.end = end
        self.opens = opens
        self.enters = enters
    }

    /// The window that adopting the suggestion adds (give it any id; the state assigns a fresh one if empty).
    public func asWindow(id: String = "") -> RiskWindow { RiskWindow(id: id, days: days, start: start, end: end) }
}

/// Is local hour `hour` of weekday `day` entirely inside one existing window? Either a window listing `day`
/// (end already moved 24 h later when it runs past midnight), or one listing the day before that runs past
/// midnight far enough. A window made of two adjacent windows does not count as one.
private func hourCovered(_ windows: [ValidWindow], day: Int, hour: Int) -> Bool {
    let prev = day == 1 ? 7 : day - 1
    let from = hour * 60
    let to = from + 60
    return windows.contains { w in
        (w.days.contains(day) && w.start <= from && to <= w.end) || (w.days.contains(prev) && w.end > 1440 && to <= w.end - 1440)
    }
}

/// The two-hour block (a group of days, starting hour h, hours h and h+1) with the highest opens per day of the
/// group, among blocks with at least `riskMinOpens` warnings that no existing window already covers. Ties:
/// higher enters per day, then weekdays before weekend, then the smaller h. Integer comparisons only.
/// `cells` is a 7 x 24 grid as from `riskHeatmap`; missing cells count as zero.
public func suggestRiskWindow(cells: RiskHeatmap, existing: [RiskWindow]) -> RiskSuggestion? {
    let windows = validWindows(existing)
    func cell(_ d: Int, _ x: Int) -> RiskCell {
        guard d - 1 >= 0, d - 1 < cells.count, x >= 0, x < cells[d - 1].count else { return RiskCell() }
        return cells[d - 1][x]
    }
    var best: (days: [Int], h: Int, opens: Int, enters: Int)?
    for group in [weekdays, weekend] {
        for h in 0...(24 - riskBlockHours) {
            var opens = 0, enters = 0
            for d in group {
                for x in h..<(h + riskBlockHours) {
                    opens += cell(d, x).opens
                    enters += cell(d, x).enters
                }
            }
            if opens < riskMinOpens { continue }
            var covered = true
            for d in group {
                for x in h..<(h + riskBlockHours) where !hourCovered(windows, day: d, hour: x) { covered = false }
            }
            if covered { continue }
            if let b = best {
                let l = group.count, r = b.days.count
                let byOpens = opens * r - b.opens * l
                let byEnters = enters * r - b.enters * l
                if byOpens < 0 || (byOpens == 0 && byEnters <= 0) { continue }
            }
            best = (group, h, opens, enters)
        }
    }
    guard let b = best else { return nil }
    return RiskSuggestion(days: b.days, start: formatHm(b.h * 60), end: formatHm(((b.h + riskBlockHours) % 24) * 60),
                          opens: b.opens, enters: b.enters)
}

/// Which minutes of the week (0 = Monday 00:00) the windows cover; a window running past Sunday wraps to Monday.
private func weekCoverage(_ windows: [RiskWindow]) -> [Bool] {
    var covered = [Bool](repeating: false, count: weekMinutes)
    for w in validWindows(windows) {
        for d in w.days {
            for m in w.start..<w.end { covered[((d - 1) * 1440 + m) % weekMinutes] = true }
        }
    }
    return covered
}

/// `.weaken` when some minute of the week was covered by the old list and is not covered by the new one
/// (a window removed, fewer days, shorter); otherwise `.ok` (a window added, longer, split, reordered).
public func classifyRiskWindowsChange(old: [RiskWindow], new: [RiskWindow]) -> ChangeKind {
    let a = weekCoverage(old)
    let b = weekCoverage(new)
    for m in 0..<weekMinutes where a[m] && !b[m] { return .weaken }
    return .ok
}
