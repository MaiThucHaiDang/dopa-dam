import Foundation

/// A study session: a manual one, or one occurrence of a weekly rule.
public struct Session: Codable, Equatable, Sendable {
    public var id: String
    public var start: Int64
    public var end: Int64
    public var label: String?

    public init(id: String, start: Int64, end: Int64, label: String?) {
        self.id = id
        self.start = start
        self.end = end
        self.label = label
    }
}

/// A weekly study window.
public struct StudyRule: Codable, Equatable, Sendable {
    public var id: String
    /// ISO weekdays: 1 = Monday ... 7 = Sunday.
    public var days: [Int]
    /// Local time "HH:MM". If end <= start the window runs past midnight.
    public var start: String
    public var end: String
    public var label: String?
    /// Local dates "YYYY-MM-DD" (keyed by the day the window starts) on which the rule is skipped.
    public var exceptions: [String]

    public init(id: String, days: [Int], start: String, end: String, label: String? = nil, exceptions: [String] = []) {
        self.id = id
        self.days = days
        self.start = start
        self.end = end
        self.label = label
        self.exceptions = exceptions
    }

    enum CodingKeys: String, CodingKey { case id, days, start, end, label, exceptions }

    /// `label` and `exceptions` may be missing (older data): they become nil and empty.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        days = try c.decode([Int].self, forKey: .days)
        start = try c.decode(String.self, forKey: .start)
        end = try c.decode(String.self, forKey: .end)
        label = c.tolerant(String.self, .label)
        exceptions = c.tolerant([String].self, .exceptions) ?? []
    }
}

public enum StudySource: String, Codable, Equatable, Sendable { case manual, taskflow, rule }

public struct StudyStatus: Codable, Equatable, Sendable {
    public var active: Bool
    public var source: StudySource?
    public var label: String?
    public var endsAt: Int64?

    public init(active: Bool, source: StudySource?, label: String?, endsAt: Int64?) {
        self.active = active
        self.source = source
        self.label = label
        self.endsAt = endsAt
    }

    public static let notStudying = StudyStatus(active: false, source: nil, label: nil, endsAt: nil)
}

public let defaultStudyLabels: [StudySource: String] = [
    .rule: "Khung giờ học", .manual: "Phiên học", .taskflow: "Phiên TaskFlow",
]

/// "HH:MM" or "H:MM" to minutes after midnight; nil when malformed. Surrounding spaces are ignored.
public func parseHm(_ value: String) -> Int? {
    let parts = value.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count == 2 else { return nil }
    let h = parts[0].utf8, m = parts[1].utf8
    guard (1...2).contains(h.count), m.count == 2 else { return nil }
    guard h.allSatisfy({ $0 >= 48 && $0 <= 57 }), m.allSatisfy({ $0 >= 48 && $0 <= 57 }) else { return nil }
    guard let hour = Int(parts[0]), let minute = Int(parts[1]), hour <= 23, minute <= 59 else { return nil }
    return hour * 60 + minute
}

/// Minutes after midnight written "HH:MM".
public func formatHm(_ minutes: Int) -> String { "\(pad2(minutes / 60)):\(pad2(minutes % 60))" }

/// Occurrences of a rule that start on the local day of `now` or the day before (overnight windows).
public func ruleOccurrences(_ rule: StudyRule, now: Int64, tzOffsetMinutes: Int) -> [Session] {
    guard let start = parseHm(rule.start), let end = parseHm(rule.end) else { return [] }
    let offsetMs = Int64(tzOffsetMinutes) * Ms.minute
    let todayLocal = floorDiv(now + offsetMs, Ms.day) * Ms.day
    var out: [Session] = []
    for shift in [-1, 0] as [Int64] {
        let dayLocal = todayLocal + shift * Ms.day
        let weekday = isoWeekday(ofDay: floorDiv(dayLocal, Ms.day))
        if !rule.days.contains(weekday) || rule.exceptions.contains(formatLocalDate(localMs: dayLocal)) { continue }
        let startLocal = dayLocal + Int64(start) * Ms.minute
        let endLocal = end > start ? dayLocal + Int64(end) * Ms.minute : dayLocal + Ms.day + Int64(end) * Ms.minute
        out.append(Session(id: rule.id, start: startLocal - offsetMs, end: endLocal - offsetMs, label: rule.label))
    }
    return out
}

private func pickActive(_ sessions: [Session], now: Int64) -> Session? {
    var best: Session?
    for s in sessions where s.start <= now && now < s.end {
        if best == nil || s.end > best!.end { best = s }
    }
    return best
}

/// Anything that can say "these are study sessions": manual sessions, the weekly rules, and later TaskFlow.
public protocol StudySessionSource {
    var kind: StudySource { get }
    func sessions(now: Int64, tzOffsetMinutes: Int) -> [Session]
}

public struct SessionListSource: StudySessionSource {
    public let kind: StudySource
    private let list: [Session]
    public init(kind: StudySource, sessions: [Session]) {
        self.kind = kind
        self.list = sessions
    }
    public func sessions(now: Int64, tzOffsetMinutes: Int) -> [Session] { list }
}

public struct RuleSource: StudySessionSource {
    public let kind: StudySource = .rule
    private let rules: [StudyRule]
    public init(rules: [StudyRule]) { self.rules = rules }
    public func sessions(now: Int64, tzOffsetMinutes: Int) -> [Session] {
        rules.flatMap { ruleOccurrences($0, now: now, tzOffsetMinutes: tzOffsetMinutes) }
    }
}

private let sourcePriority: [StudySource] = [.manual, .taskflow, .rule]

/// Studying when any source has a session running; the label comes from manual, then TaskFlow, then rules.
public func resolveSources(now: Int64, tzOffsetMinutes: Int, sources: [StudySessionSource]) -> StudyStatus {
    for kind in sourcePriority {
        let all = sources.filter { $0.kind == kind }.flatMap { $0.sessions(now: now, tzOffsetMinutes: tzOffsetMinutes) }
        if let session = pickActive(all, now: now) {
            let label = (session.label?.isEmpty == false) ? session.label! : defaultStudyLabels[kind]!
            return StudyStatus(active: true, source: kind, label: label, endsAt: session.end)
        }
    }
    return .notStudying
}

/// Combines study sources with priority manual > taskflow > rule.
public func resolveStudy(
    now: Int64, tzOffsetMinutes: Int, manual: [Session], rules: [StudyRule], external: [Session] = []
) -> StudyStatus {
    resolveSources(now: now, tzOffsetMinutes: tzOffsetMinutes, sources: [
        SessionListSource(kind: .manual, sessions: manual),
        SessionListSource(kind: .taskflow, sessions: external),
        RuleSource(rules: rules),
    ])
}

public struct RuleOccurrence: Codable, Equatable, Sendable {
    public var ruleId: String
    /// Local date the window started on: the exception that skips it.
    public var date: String
    public init(ruleId: String, date: String) {
        self.ruleId = ruleId
        self.date = date
    }
}

/// Rule windows running at `now`, in rule order. Ending study early adds these as exceptions.
public func activeRuleOccurrences(_ rules: [StudyRule], now: Int64, tzOffsetMinutes: Int) -> [RuleOccurrence] {
    let offsetMs = Int64(tzOffsetMinutes) * Ms.minute
    var out: [RuleOccurrence] = []
    for rule in rules {
        for s in ruleOccurrences(rule, now: now, tzOffsetMinutes: tzOffsetMinutes) where s.start <= now && now < s.end {
            out.append(RuleOccurrence(ruleId: rule.id, date: formatLocalDate(localMs: floorDiv(s.start + offsetMs, Ms.day) * Ms.day)))
        }
    }
    return out
}

/// Start and end in minutes after the start day's midnight; an end at or before the start is next day.
private func windowMinutes(_ rule: StudyRule) -> (Int, Int)? {
    guard let start = parseHm(rule.start), let end = parseHm(rule.end) else { return nil }
    return (start, end > start ? end : end + 24 * 60)
}

/// Editing a weekly rule. Weakens: removing it, dropping days, a shorter window, or skipping today or a
/// session that is running. Adding a rule, more days, a longer window or skipping a later date does not.
public func classifyStudyRuleChange(old: StudyRule?, new: StudyRule?, now: Int64, tzOffsetMinutes: Int) -> ChangeKind {
    guard let old = old else { return .ok }
    guard let next = new else { return .weaken }
    if old.days.contains(where: { !next.days.contains($0) }) { return .weaken }
    if let ow = windowMinutes(old) {
        guard let nw = windowMinutes(next) else { return .weaken }
        if nw.0 > ow.0 || nw.1 < ow.1 { return .weaken }
    }
    let offsetMs = Int64(tzOffsetMinutes) * Ms.minute
    var protected = Set<String>()
    protected.insert(formatLocalDate(localMs: floorDiv(now + offsetMs, Ms.day) * Ms.day))
    for o in activeRuleOccurrences([old], now: now, tzOffsetMinutes: tzOffsetMinutes) { protected.insert(o.date) }
    let added = next.exceptions.filter { !old.exceptions.contains($0) }
    return added.contains(where: { protected.contains($0) }) ? .weaken : .ok
}

public let studyLabelMax = 60
public let manualStudyMinutes = [25, 50, 90]

/// Cuts to `studyLabelMax` Unicode code points (as the agent does), never splitting a surrogate pair.
public func truncateStudyLabel(_ label: String) -> String {
    var view = String.UnicodeScalarView()
    view.append(contentsOf: label.unicodeScalars.prefix(studyLabelMax))
    return String(view)
}

func isDateString(_ s: String) -> Bool {
    let u = Array(s.utf8)
    guard u.count == 10, u[4] == 45, u[7] == 45 else { return false }
    return u.enumerated().allSatisfy { i, c in i == 4 || i == 7 || (c >= 48 && c <= 57) }
}

func cleanDays(_ days: [Int]) -> [Int] {
    Array(Set(days.filter { $0 >= 1 && $0 <= 7 })).sorted()
}

/// Cleans a rule typed by the user; nil when it cannot be a rule (no day, bad time, empty window).
public func normalizeStudyRule(_ rule: StudyRule) -> StudyRule? {
    let days = cleanDays(rule.days)
    guard !days.isEmpty, let start = parseHm(rule.start), let end = parseHm(rule.end), start != end else { return nil }
    let label = truncateStudyLabel((rule.label ?? "").trimmingCharacters(in: .whitespacesAndNewlines))
    let exceptions = Array(Set(rule.exceptions.filter(isDateString))).sorted()
    return StudyRule(id: rule.id, days: days, start: formatHm(start), end: formatHm(end),
                     label: label.isEmpty ? nil : label, exceptions: exceptions)
}

private let dayNames = ["", "T2", "T3", "T4", "T5", "T6", "T7", "CN"]

/// "T2–T6", "T2, T4, T6", "Mỗi ngày": three or more consecutive weekdays collapse into a range.
public func formatStudyDays(_ days: [Int]) -> String {
    let sorted = cleanDays(days)
    if sorted.count == 7 { return "Mỗi ngày" }
    var parts: [String] = []
    var i = 0
    while i < sorted.count {
        var j = i
        while j + 1 < sorted.count && sorted[j + 1] == sorted[j] + 1 { j += 1 }
        if j - i >= 2 {
            parts.append("\(dayNames[sorted[i]])–\(dayNames[sorted[j]])")
        } else {
            parts.append(sorted[i...j].map { dayNames[$0] }.joined(separator: ", "))
        }
        i = j + 1
    }
    return parts.joined(separator: ", ")
}
