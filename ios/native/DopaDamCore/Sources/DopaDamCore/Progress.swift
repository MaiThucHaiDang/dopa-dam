import Foundation

public enum ProgressVerdict: String, Codable, Equatable, Sendable {
    case better, worse, same
    case notEnoughData = "not-enough-data"
}

public struct WeekFigures: Codable, Equatable, Sendable {
    public var total: Int
    /// (exit + alternative) / total, or nil with no decided warnings.
    public var leaveRate: Double?
    /// Average seconds from the warning to Thoát, or nil with no Thoát.
    public var avgExitSeconds: Double?
    public var studyOpens: Int
}

public struct WeeklyProgress: Codable, Equatable, Sendable {
    public var thisWeek: WeekFigures
    public var lastWeek: WeekFigures
    /// Both weeks have at least `progressMinInterceptions` decided warnings.
    public var enough: Bool
    public var leaveRate: ProgressVerdict
    public var seconds: ProgressVerdict
    public var studyOpens: ProgressVerdict
}

public let progressMinInterceptions = 5
private let eps = 1e-9

private func weekFigures(_ events: [WarningEvent]) -> WeekFigures {
    var enter = 0, exit = 0, alternative = 0, studyOpens = 0, exitCount = 0
    var secondsSum = 0.0
    for e in events {
        // An open during study counts as soon as its warning is shown, decided or not (as the agent counts it).
        if e.studyLabel != nil { studyOpens += 1 }
        switch e.decision {
        case .enter: enter += 1
        case .alternative: alternative += 1
        case .exit:
            exit += 1
            if let decidedAt = e.decidedAt {
                secondsSum += Double(max(0, decidedAt - e.shownAt)) / 1000
                exitCount += 1
            }
        case nil: break
        }
    }
    let total = enter + exit + alternative
    return WeekFigures(
        total: total,
        leaveRate: total > 0 ? Double(exit + alternative) / Double(total) : nil,
        avgExitSeconds: exitCount > 0 ? secondsSum / Double(exitCount) : nil,
        studyOpens: studyOpens)
}

/// The last 7 days (ending today) against the 7 before, from the events kept on the device.
public func weeklyProgress(events: [WarningEvent], now: Int64, tzOffsetMinutes: Int) -> WeeklyProgress {
    var thisDays = Set<String>(), lastDays = Set<String>()
    for i in 0..<14 {
        let key = dayKey(now - Int64(i) * Ms.day, tzOffsetMinutes: tzOffsetMinutes)
        if i < 7 { thisDays.insert(key) } else { lastDays.insert(key) }
    }
    let thisWeek = weekFigures(events.filter { thisDays.contains(dayKey($0.shownAt, tzOffsetMinutes: tzOffsetMinutes)) })
    let lastWeek = weekFigures(events.filter { lastDays.contains(dayKey($0.shownAt, tzOffsetMinutes: tzOffsetMinutes)) })
    let enough = thisWeek.total >= progressMinInterceptions && lastWeek.total >= progressMinInterceptions
    if !enough {
        return WeeklyProgress(thisWeek: thisWeek, lastWeek: lastWeek, enough: false, leaveRate: .notEnoughData,
                              seconds: .notEnoughData, studyOpens: .notEnoughData)
    }
    var leaveRate = ProgressVerdict.same
    if let a = thisWeek.leaveRate, let b = lastWeek.leaveRate {
        let diff = a - b
        leaveRate = diff >= 0.05 - eps ? .better : (diff <= -(0.05 - eps) ? .worse : .same)
    }
    var seconds = ProgressVerdict.notEnoughData
    if let a = thisWeek.avgExitSeconds, let b = lastWeek.avgExitSeconds {
        let diff = a - b
        seconds = diff <= -(1 - eps) ? .better : (diff >= 1 - eps ? .worse : .same)
    }
    let studyOpens: ProgressVerdict =
        thisWeek.studyOpens < lastWeek.studyOpens ? .better : (thisWeek.studyOpens > lastWeek.studyOpens ? .worse : .same)
    return WeeklyProgress(thisWeek: thisWeek, lastWeek: lastWeek, enough: true, leaveRate: leaveRate, seconds: seconds,
                          studyOpens: studyOpens)
}

/// "67%", or "–" without data. Rounds half up like JavaScript's Math.round.
public func formatPercent(_ v: Double?) -> String {
    guard let v = v else { return "–" }
    return "\(Int((v * 100).rounded(.toNearestOrAwayFromZero)))%"
}

/// Vietnamese writes decimals with a comma: "2,5 giây" below 10 seconds, whole seconds from 10.
public func formatSeconds(_ v: Double?) -> String {
    guard let v = v else { return "–" }
    if v >= 10 { return "\(Int(v.rounded(.toNearestOrAwayFromZero))) giây" }
    // JavaScript's toFixed(1) picks the larger neighbour on an exact tie (0.25 -> 0.3); printf picks the even one.
    let isTie = v.truncatingRemainder(dividingBy: 0.25) == 0 && v.truncatingRemainder(dividingBy: 0.5) != 0
    let x = isTie ? (v * 10 + 0.5).rounded(.down) / 10 : v
    return String(format: "%.1f", x).replacingOccurrences(of: ".", with: ",") + " giây"
}

public struct ProgressRow: Equatable, Sendable {
    public var label: String
    /// This week's figure as text ("67%", "2,5 giây", "3 lần").
    public var now: String
    public var before: String
    /// The verdict sentence ("Tốt hơn tuần trước", "Chậm hơn tuần trước 2 giây", ...).
    public var text: String
    public var verdict: ProgressVerdict
    /// "Tuần này 67% · Tuần trước 50%".
    public var comparison: String
}

/// The weekly progress card: title, subtitle and the three rows with their exact sentences.
public struct ProgressCard: Equatable, Sendable {
    public var title: String
    public var subtitle: String
    public var rows: [ProgressRow]
    public var progress: WeeklyProgress
}

public func progressCard(_ p: WeeklyProgress) -> ProgressCard {
    // Changed seconds are stated as a plain difference, e.g. "Chậm hơn tuần trước 2 giây".
    var secondsText = Wording.verdict(p.seconds)
    if let a = p.thisWeek.avgExitSeconds, let b = p.lastWeek.avgExitSeconds, p.seconds != .same, p.seconds != .notEnoughData {
        let diff = Int(abs(a - b).rounded(.toNearestOrAwayFromZero))
        secondsText = "\(p.seconds == .better ? "Nhanh hơn" : "Chậm hơn") tuần trước \(diff) giây"
    }
    func row(_ label: String, _ now: String, _ before: String, _ text: String, _ verdict: ProgressVerdict) -> ProgressRow {
        ProgressRow(label: label, now: now, before: before, text: text, verdict: verdict,
                    comparison: Wording.progressCompare(now: now, before: before))
    }
    return ProgressCard(
        title: Wording.progressTitle, subtitle: Wording.progressSubtitle,
        rows: [
            row(Wording.progressLeaveRate, formatPercent(p.thisWeek.leaveRate), formatPercent(p.lastWeek.leaveRate),
                Wording.verdict(p.leaveRate), p.leaveRate),
            row(Wording.progressSeconds, formatSeconds(p.thisWeek.avgExitSeconds), formatSeconds(p.lastWeek.avgExitSeconds),
                secondsText, p.seconds),
            row(Wording.progressStudyOpens, "\(p.thisWeek.studyOpens) lần", "\(p.lastWeek.studyOpens) lần",
                Wording.verdict(p.studyOpens), p.studyOpens),
        ],
        progress: p)
}
