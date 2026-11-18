import Foundation

/// An edit the user can ask for in the app. Each goes through the same core call; the ones that weaken
/// protection answer `.needsConfirm` first and are run again with `confirmed: true` after the confirmation.
public enum StateChange: Equatable, Sendable {
    case settings(Settings)
    case stopStudy
    /// Add (empty id) or change a weekly study rule.
    case studyRule(StudyRule)
    case deleteStudyRule(id: String)
    case addRiskWindow(RiskWindow)
    case removeRiskWindow(id: String)
    case clearLog
}

extension AppState {
    /// The sentence the confirmation sheet shows under its title for `change`; nil when the title says enough.
    /// Removing a risk window says which window and what is lost.
    public func confirmDetail(for change: StateChange) -> String? {
        if case .removeRiskWindow(let id) = change, let window = riskWindows.first(where: { $0.id == id }) {
            return Wording.riskRemovalConfirm(window)
        }
        return nil
    }

    public mutating func apply(_ change: StateChange, confirmed: Bool, now: Int64, tz: Int) -> Result<Void, CoreError> {
        switch change {
        case .settings(let s):
            return setSettings(s, confirmed: confirmed, now: now, tz: tz)
        case .stopStudy:
            return stopStudy(confirmed: confirmed, now: now, tz: tz)
        case .studyRule(let rule):
            return setStudyRule(rule, confirmed: confirmed, now: now, tz: tz).map { _ in () }
        case .deleteStudyRule(let id):
            return deleteStudyRule(id: id, confirmed: confirmed, now: now, tz: tz)
        case .addRiskWindow(let window):
            return setRiskWindows(riskWindows + [window], confirmed: confirmed, now: now, tz: tz).map { _ in () }
        case .removeRiskWindow(let id):
            return setRiskWindows(riskWindows.filter { $0.id != id }, confirmed: confirmed, now: now, tz: tz).map { _ in () }
        case .clearLog:
            return clearLog(confirmed: confirmed, now: now, tz: tz)
        }
    }
}

/// The 60-second wait of the confirmation. Pure: the sheet shows `countdownText` and enables the field and the
/// button from `canType` / `canConfirm`.
public struct ConfirmGate: Equatable, Sendable {
    public var startedAt: Int64

    public init(startedAt: Int64) { self.startedAt = startedAt }

    public func secondsLeft(now: Int64) -> Int {
        let remaining = startedAt + Int64(confirmWaitSeconds) * 1000 - now
        return remaining <= 0 ? 0 : Int((Double(remaining) / 1000).rounded(.up))
    }

    public func canType(now: Int64) -> Bool { secondsLeft(now: now) == 0 }

    /// The wait is over and the typed text is the phrase.
    public func canConfirm(input: String, now: Int64) -> Bool { canType(now: now) && isConfirmPhrase(input) }

    public func countdownText(now: Int64) -> String { Wording.confirmCountdown(secondsLeft: secondsLeft(now: now)) }

    /// "Gõ chính xác: tôi chọn giảm bảo vệ".
    public static var hint: String { Wording.confirmTypeHint + confirmPhrase }
}
