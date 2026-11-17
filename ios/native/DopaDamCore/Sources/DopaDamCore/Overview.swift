import Foundation

public struct StatItem: Equatable, Sendable, Identifiable {
    public var id: String { label }
    public var label: String
    public var value: String
}

public struct StudyRuleRow: Equatable, Sendable, Identifiable {
    public var id: String
    public var line: String
}

/// The study status and its lists, for the "Tổng quan" and "Học" tabs.
public struct StudyPanel: Equatable, Sendable {
    public var active: Bool
    /// "Đang học: Ôn thi · còn 20 phút" or "Chưa trong phiên học."
    public var statusLine: String
    /// "Kết thúc sớm" makes sense (it still needs the confirmation).
    public var canStop: Bool
    /// 25, 50, 90.
    public var manualMinutes: [Int]
    public var rules: [StudyRuleRow]
}

public enum OverviewText {
    public static let notStudying = "Chưa trong phiên học."
    public static let noApps = "Chưa có app nào hiện màn hình hỏi. Tạo lệnh tự động theo tab Hướng dẫn."
    public static let noRules = "Chưa có khung giờ học hằng tuần."
    public static let noWindows = "Chưa có khung giờ nguy cơ nào."
    public static func minuteButton(_ minutes: Int) -> String { "\(minutes) phút" }
}

extension AppState {
    public func studyPanel(now: Int64, tz: Int) -> StudyPanel {
        let status = studyStatus(now: now, tz: tz)
        let line: String
        if status.active {
            if let end = status.endsAt {
                line = Wording.studyLine(label: status.label ?? "Học", minutesLeft: minutesUntil(end, now: now))
            } else {
                line = "Đang học: \(status.label ?? "Học")"
            }
        } else {
            line = OverviewText.notStudying
        }
        return StudyPanel(
            active: status.active, statusLine: line, canStop: status.active, manualMinutes: manualStudyMinutes,
            rules: studyRules.map { StudyRuleRow(id: $0.id, line: studyRuleLine($0)) })
    }
}

/// The four counts of today's card.
public func todayStatItems(_ s: TodaySummary) -> [StatItem] {
    [
        StatItem(label: "Lần hỏi", value: String(s.warnings)),
        StatItem(label: "Thoát", value: String(s.exits)),
        StatItem(label: "Vào", value: String(s.enters)),
        StatItem(label: "Làm việc khác", value: String(s.alternatives)),
    ]
}

/// "Thoát" share line of today's card: "Tỉ lệ Thoát: 67%".
public func exitShareLine(_ s: TodaySummary) -> String { "Tỉ lệ Thoát: \(s.exitShareText)" }

/// "5 lần · Thoát 3 · Vào 1 · Việc khác 1".
public func appUsageLine(_ u: AppUsage) -> String {
    "\(u.warnings) lần · Thoát \(u.exits) · Vào \(u.enters) · Việc khác \(u.alternatives)"
}

/// The tallest bar of the 14-day chart (at least 1, so dividing by it is always safe).
public func chartMax(_ stats: [DayStat]) -> Int { max(1, stats.map { $0.total }.max() ?? 0) }

public enum ChartText {
    public static let title = "14 ngày gần nhất"
    public static let exit = "Thoát"
    public static let enter = "Vào"
    public static let alternative = "Làm việc khác"
    public static let undecided = "Chưa chọn"
}
