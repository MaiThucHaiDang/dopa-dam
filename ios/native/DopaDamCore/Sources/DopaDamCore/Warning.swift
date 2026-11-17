import Foundation

/// The budget as the warning screen shows it: minutes granted through "Vào" today against the daily budget.
public struct BudgetView: Equatable, Sendable {
    public var usedMinutes: Double
    /// 0 means the budget is turned off.
    public var budgetMinutes: Int
    /// nil when the budget is off.
    public var remainingMinutes: Double?
    public var over: Bool
    public var enabled: Bool { budgetMinutes > 0 }
    /// "Hôm nay: 12 / 90 phút giải trí" (without the budget part when it is off).
    public var line: String { Wording.budgetLine(usedMinutes: usedMinutes, budgetMinutes: budgetMinutes) }
}

/// Everything the warning screen shows and decides on, computed once by the core.
public struct WarningContext: Equatable, Sendable, Identifiable {
    public var id: String { eventId }
    public var eventId: String
    /// The app name as typed in the automation.
    public var app: String
    public var level: Int
    public var lockSeconds: Int
    /// Minutes the user may pick after "Vào" (the restricted list at level 3).
    public var allowOptions: [Int]
    /// Warnings in the previous hour, not counting this one.
    public var n: Int
    /// "Lần thứ N trong 60 phút qua": n + 1.
    public var countThisHour: Int
    public var shownAt: Int64
    /// "Vào" is locked until this instant (shownAt + lockSeconds). Count down to it only while the screen is visible.
    public var enterUnlocksAt: Int64
    /// The level was raised by a risk window: show `Wording.riskLine`.
    public var risk: Bool
    public var studyActive: Bool
    public var studyLabel: String?
    public var studyEndsAt: Int64?
    public var budget: BudgetView
    /// Activities for "Làm việc khác".
    public var activities: [String]
    public var activityMinutesRange: ClosedRange<Int>
    public var activityDefaultMinutes: Int
    /// nil while the warning is waiting for a choice.
    public var decision: Decision?
    public var decidedAt: Int64?
    public var allowMinutes: Int?
    public var activity: String?
    public var activityMinutes: Int?
    /// When the chosen activity ends (decidedAt + minutes), if the decision was "alternative".
    public var activityEndsAt: Int64?

    // Ready-made sentences.
    /// "Bạn mở YouTube để làm gì?"
    public var headline: String
    public var subtitle: String { Wording.subtitle }
    /// "Lần thứ 2 trong 60 phút qua · nút Vào khóa 10 giây"
    public var metaLine: String
    /// The risk sentence when `risk`, else nil.
    public var riskLine: String?
    /// "Hôm nay: 12 / 90 phút giải trí".
    public var budgetLine: String
    /// "Đang học: Ôn thi · còn 20 phút" while studying, else nil.
    public var studyLine: String?

    /// Milliseconds "Vào" stays locked at `now` (0 when unlocked).
    public func lockRemainingMs(now: Int64) -> Int64 { max(0, enterUnlocksAt - now) }
    /// Whole seconds left on "Vào" (rounded up), for "Vào (12)".
    public func lockSecondsLeft(now: Int64) -> Int { Int((Double(lockRemainingMs(now: now)) / 1000).rounded(.up)) }
}

/// What a decision changed.
public struct DecisionOutcome: Equatable, Sendable {
    public var event: WarningEvent
    /// "Vào": when the allow window ends. Schedule "còn 1 phút" at `- 60 s` and "hết thời gian" at this instant.
    public var allowEndsAt: Int64?
    /// "Làm việc khác": when the activity timer ends.
    public var activityEndsAt: Int64?
    /// "Vào": total minutes granted today after this decision.
    public var grantedTodayMinutes: Int?
}

/// The user's choice on the warning screen.
public enum Choice: Equatable, Sendable {
    case exit
    /// One of `WarningContext.allowOptions`, after the lock has run out.
    case enter(minutes: Int)
    /// One of `activityNames`, with minutes inside `activityMinutesRange`.
    case alternative(activity: String, minutes: Int)
}
