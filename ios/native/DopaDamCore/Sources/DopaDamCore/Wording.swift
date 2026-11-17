import Foundation

/// Every Vietnamese sentence the clients share, copied from the extension and the agent, so that the views
/// have no wording of their own for them. Strings that depend on data are functions.
public enum Wording {
    // MARK: Errors (extension/src/shared/messages.ts ERROR_TEXT)
    public static let errorInvalid = "Giá trị không hợp lệ."
    public static let errorNeedsConfirm = "Thay đổi này làm yếu bảo vệ nên cần xác nhận."
    public static let errorStudyLocked = "Đang trong phiên học nên không chỉnh được."
    public static let errorNotFound = "Không tìm thấy lần chặn này."
    public static let errorAlreadyDecided = "Lần chặn này đã có quyết định."
    public static let errorLocked = "Nút Vào vẫn đang bị khóa."
    public static let errorTitle = "Chưa làm được"

    // MARK: Warning screen (extension/src/pages/warning.html, warning.ts)
    public static func headline(app: String) -> String { "Bạn mở \(app) để làm gì?" }
    public static let subtitle = "Dành vài giây trả lời câu hỏi này trong đầu."
    public static let exitButton = "Thoát"
    public static let enterButton = "Vào"
    /// "Vào (12)" while locked, "Vào" once unlocked.
    public static func enterButton(lockedSecondsLeft seconds: Int) -> String { seconds > 0 ? "Vào (\(seconds))" : "Vào" }
    public static let alternativeLink = "Làm việc khác thay vì vào"
    public static let allowQuestion = "Vào trong bao lâu?"
    public static let alternativeHeadline = "Làm gì thay vào đó?"
    public static let activityMinutesPrefix = "Trong"
    public static let activityMinutesSuffix = "phút"
    public static let startActivityButton = "Bắt đầu"
    public static let backButton = "Quay lại"
    public static let riskLine = "Đây là khung giờ bạn hay mở giải trí nên thời gian chờ dài hơn một cấp."
    public static func metaLine(countThisHour: Int, lockSeconds: Int) -> String {
        "Lần thứ \(countThisHour) trong 60 phút qua · nút Vào khóa \(lockSeconds) giây"
    }
    public static func budgetLine(usedMinutes: Double, budgetMinutes: Int) -> String {
        let used = Int(usedMinutes.rounded(.toNearestOrAwayFromZero))
        return budgetMinutes > 0 ? "Hôm nay: \(used) / \(budgetMinutes) phút giải trí" : "Hôm nay: \(used) phút giải trí"
    }
    public static func studyLine(label: String, minutesLeft: Int) -> String { "Đang học: \(label) · còn \(minutesLeft) phút" }
    public static let exitedTitle = "Đã thoát"
    public static let exitedBody = "Làm tốt lắm."
    public static let restTitle = "Đang nghỉ"
    public static let activityDoneTitle = "Xong rồi!"
    public static let activityDoneBody = "Quay lại việc đang làm nhé."
    public static let activityTimerNote = "Hết giờ DopaDam sẽ nhắc."

    // MARK: Notifications (the Android notifier's wording)
    public static let headsUpTitle = "Còn 1 phút"
    public static func headsUpBody(app: String) -> String {
        "Khoảng được phép cho \(app) sắp hết. Hết giờ sẽ hiện lại màn hình cảnh báo."
    }
    public static let allowEndedTitle = "Hết thời gian"
    public static func allowEndedBody(app: String) -> String { "Khoảng được phép cho \(app) đã hết. Mở lại app sẽ hiện màn hình cảnh báo." }
    public static func activityDoneNotificationTitle(minutes: Int, activity: String) -> String {
        "Xong \(minutes) phút \(activity.lowercased())"
    }
    public static func activityDoneNotificationBody(studyLabel: String?) -> String {
        if let label = studyLabel, !label.isEmpty { return "Quay lại \"\(label)\" nhé." }
        return "Quay lại việc đang làm nhé."
    }

    // MARK: Confirmation dialog (extension/src/pages/confirm.ts)
    public static let confirmTitle = "Thay đổi này làm yếu bảo vệ"
    public static let confirmTypeLabel = "Câu xác nhận"
    public static let confirmTypeHint = "Gõ chính xác: "
    public static let confirmOk = "Xác nhận"
    public static let confirmCancel = "Giữ nguyên bảo vệ"
    public static func confirmCountdown(secondsLeft: Int) -> String {
        secondsLeft > 0 ? "Chờ \(secondsLeft) giây rồi mới gõ được câu xác nhận." : "Bây giờ có thể gõ câu xác nhận."
    }

    // MARK: Risk hours (extension/src/shared/riskText.ts, agent/ui/src/risk.ts)
    public static let riskNoSuggestion = "Chưa có khung giờ nào nổi bật."
    public static let riskSubtitle = "4 tuần gần nhất. Ô càng đậm, bạn càng hay mở giải trí vào giờ đó."
    public static let riskRowLabels = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]
    public static let riskRaiseSuffix = "thời gian chờ dài hơn một cấp"

    /// "thứ 2" ... "thứ 7", "Chủ nhật" for ISO weekday 1...7.
    public static func dayName(_ day: Int) -> String { day == 7 ? "Chủ nhật" : "thứ \(day + 1)" }
    /// The same with a capital letter: "Thứ 3", "Chủ nhật".
    public static func dayNameCapital(_ day: Int) -> String {
        let name = dayName(day)
        return name.prefix(1).uppercased() + name.dropFirst()
    }

    /// "thứ 2 đến thứ 6", "thứ 7 và Chủ nhật", "mỗi ngày"; a run of three or more consecutive days is "A đến B",
    /// anything else is a list: "thứ 2, thứ 4 và thứ 6". Same wording as extension/src/shared/riskText.ts.
    public static func riskDays(_ days: [Int]) -> String {
        let sorted = cleanDays(days)
        if sorted.isEmpty { return "" }
        if sorted.count == 7 { return "mỗi ngày" }
        if sorted.count >= 3 && sorted[sorted.count - 1] - sorted[0] == sorted.count - 1 {
            return "\(dayName(sorted[0])) đến \(dayName(sorted[sorted.count - 1]))"
        }
        let names = sorted.map(dayName)
        if names.count == 1 { return names[0] }
        return "\(names.dropLast().joined(separator: ", ")) và \(names[names.count - 1])"
    }

    /// An end of "00:00" reads as "24:00".
    public static func clockEnd(_ end: String) -> String { end == "00:00" ? "24:00" : end }
    /// "22:00–24:00".
    public static func riskRange(start: String, end: String) -> String { "\(start)–\(clockEnd(end))" }
    /// "22:00–24:00 · thứ 2 đến thứ 6 · thời gian chờ dài hơn một cấp".
    public static func riskWindowLine(_ w: RiskWindow) -> String {
        "\(riskRange(start: w.start, end: w.end)) · \(riskDays(w.days)) · \(riskRaiseSuffix)"
    }
    /// "Hay mở nhất: 22:00–24:00, thứ 2 đến thứ 6 (17 lần mở, 9 lần Vào)."
    public static func riskSuggestionLine(_ s: RiskSuggestion) -> String {
        "Hay mở nhất: \(riskRange(start: s.start, end: s.end)), \(riskDays(s.days)) (\(s.opens) lần mở, \(s.enters) lần Vào)."
    }
    /// "Thứ 3, 22 giờ: 5 lần mở, 3 lần Vào"; an empty hour says so plainly. `row` 0 = Monday.
    public static func riskCellLabel(row: Int, hour: Int, cell: RiskCell) -> String {
        let where_ = "\(dayNameCapital(row + 1)), \(hour) giờ"
        return cell.opens > 0 ? "\(where_): \(cell.opens) lần mở, \(cell.enters) lần Vào" : "\(where_): chưa có lần mở nào"
    }

    // MARK: Weekly progress (agent/ui/src/main/StatsPage.tsx)
    public static let progressTitle = "Tiến bộ tuần này"
    public static let progressSubtitle = "7 ngày gần nhất so với 7 ngày trước đó."
    public static let progressThisWeek = "Tuần này"
    public static let progressLastWeek = "Tuần trước"
    public static let progressLeaveRate = "Tỉ lệ rời đi"
    public static let progressSeconds = "Số giây đến lúc Thoát"
    public static let progressStudyOpens = "Mở giải trí trong giờ học"
    public static func verdict(_ v: ProgressVerdict) -> String {
        switch v {
        case .better: return "Tốt hơn tuần trước"
        case .worse: return "Chưa tốt bằng tuần trước"
        case .same: return "Gần như tuần trước"
        case .notEnoughData: return "Cần ít nhất \(progressMinInterceptions) lần bị chặn mỗi tuần để so sánh"
        }
    }
    /// "Tuần này 67% · Tuần trước 50%".
    public static func progressCompare(now: String, before: String) -> String { "Tuần này \(now) · Tuần trước \(before)" }
}
