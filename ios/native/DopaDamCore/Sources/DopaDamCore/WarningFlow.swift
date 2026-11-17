import Foundation

/// Sentences of the iPhone app that the other clients do not have.
public enum AppWording {
    public static let homeButton = "Về màn hình chính"
    public static let doneButton = "Xong"
    public static func allowedLine(app: String, minutes: Int) -> String { "Đã cho vào \(minutes) phút. Mở lại \(app)." }
    public static func activityRunning(name: String) -> String { "\(name) · còn lại" }
    public static let errorSaving = "Không lưu được. Thử lại nhé."
}

/// Where the warning screen is.
public enum WarningPhase: Equatable, Sendable {
    /// Thoát / Vào / Làm việc khác.
    case question
    /// After "Vào": pick how long.
    case chooseMinutes
    /// After "Làm việc khác": pick the activity and its length.
    case chooseActivity
    /// "Vào" was decided; the allow window ends at `endsAt`.
    case allowed(minutes: Int, endsAt: Int64)
    /// Thoát was decided.
    case exited
    /// The activity timer runs until `endsAt`.
    case activity(name: String, minutes: Int, endsAt: Int64)
}

/// The state of one warning screen: the core's context plus the phase and the activity form. Pure value, so
/// every transition is tested without a screen. The model keeps `context` fresh with `apply(context:)` after
/// each decision.
public struct WarningFlow: Equatable, Sendable {
    public private(set) var context: WarningContext
    public private(set) var phase: WarningPhase
    public private(set) var activity: String
    public private(set) var activityMinutes: Int

    public init(context: WarningContext) {
        self.context = context
        self.activity = context.activities.first ?? ""
        self.activityMinutes = context.activityDefaultMinutes
        self.phase = WarningFlow.phase(for: context)
    }

    static func phase(for ctx: WarningContext) -> WarningPhase {
        switch ctx.decision {
        case nil:
            return .question
        case .exit?:
            return .exited
        case .enter?:
            let minutes = ctx.allowMinutes ?? 0
            return .allowed(minutes: minutes, endsAt: (ctx.decidedAt ?? ctx.shownAt) + Int64(minutes) * Ms.minute)
        case .alternative?:
            return .activity(name: ctx.activity ?? "", minutes: ctx.activityMinutes ?? 0, endsAt: ctx.activityEndsAt ?? 0)
        }
    }

    /// True when the user has not chosen yet (leaving the screen then counts as Thoát).
    public var isUndecided: Bool { context.decision == nil }

    /// Takes the stored context after a decision (or a reload); a decision moves the phase on.
    public mutating func apply(context newContext: WarningContext) {
        context = newContext
        if newContext.decision != nil { phase = WarningFlow.phase(for: newContext) }
    }

    // MARK: Question

    public func enterButtonTitle(now: Int64) -> String { Wording.enterButton(lockedSecondsLeft: context.lockSecondsLeft(now: now)) }

    /// "Vào" can be pressed: the question is showing and the countdown is over.
    public func canEnter(now: Int64) -> Bool { phase == .question && context.lockSecondsLeft(now: now) == 0 }

    /// "Vào" pressed: show the minute options. False (no change) while locked.
    @discardableResult
    public mutating func showMinutes(now: Int64) -> Bool {
        guard canEnter(now: now) else { return false }
        phase = .chooseMinutes
        return true
    }

    public mutating func showActivities() {
        if phase == .question { phase = .chooseActivity }
    }

    /// "Quay lại" from the minute or activity pickers.
    public mutating func back() {
        if phase == .chooseMinutes || phase == .chooseActivity { phase = .question }
    }

    // MARK: Activity form

    public mutating func select(activity name: String) {
        if context.activities.contains(name) { activity = name }
    }

    /// Clamped to the allowed range.
    public mutating func setActivityMinutes(_ minutes: Int) {
        let range = context.activityMinutesRange
        activityMinutes = min(max(minutes, range.lowerBound), range.upperBound)
    }

    /// "Trong 5 phút".
    public var activityMinutesText: String {
        "\(Wording.activityMinutesPrefix) \(activityMinutes) \(Wording.activityMinutesSuffix)"
    }

    public var activityChoice: Choice { .alternative(activity: activity, minutes: activityMinutes) }

    // MARK: Results

    /// "Đã cho vào 15 phút. Mở lại YouTube." in the `allowed` phase.
    public var allowedLine: String? {
        if case .allowed(let minutes, _) = phase { return AppWording.allowedLine(app: context.app, minutes: minutes) }
        return nil
    }

    /// Time left on the activity timer as "m:ss"; nil outside the activity phase.
    public func activityClock(now: Int64) -> String? {
        if case .activity(_, _, let endsAt) = phase { return formatClock(ms: max(0, endsAt - now)) }
        return nil
    }

    public func activityFinished(now: Int64) -> Bool {
        if case .activity(_, _, let endsAt) = phase { return now >= endsAt }
        return false
    }
}

extension AppState {
    /// A warning left undecided that is younger than this is shown again when the app opens.
    public static let resumeWindowMs: Int64 = 10 * Ms.minute

    /// What to show when the app opens: the newest undecided warning younger than 10 minutes (its countdown
    /// goes on from the time it was first shown). Every other undecided warning is closed as Thoát, so an old
    /// question never comes back.
    public mutating func resumeWarning(now: Int64, tz: Int) -> WarningContext? {
        var resumed: WarningContext?
        for ctx in pendingWarnings(now: now, tz: tz) {
            if resumed == nil && now - ctx.shownAt < AppState.resumeWindowMs {
                resumed = ctx
            } else {
                autoExit(eventId: ctx.eventId, now: now)
            }
        }
        return resumed
    }
}
