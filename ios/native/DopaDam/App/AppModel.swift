import Foundation
import Observation
import DopaDamCore

enum AppTab: Hashable {
    case overview, study, stats, settings, guide
}

/// The one observable model of the app. It owns the screen state (tab, warning, confirmation, error) and goes
/// through `StateAccess` for every change of the stored state, so the rules all live in DopaDamCore.
@MainActor
@Observable
final class AppModel {
    static let shared = AppModel()

    /// The stored state as of the last reload or change.
    private(set) var state: AppState = StateAccess.load()
    /// The warning screen, or nil when the tabs show.
    private(set) var flow: WarningFlow?
    var selectedTab: AppTab = .overview
    /// The change waiting for the confirmation sheet.
    private(set) var pendingChange: StateChange?
    private(set) var confirmGate: ConfirmGate?
    /// A message for the alert, in Vietnamese.
    var errorMessage: String?
    private(set) var permission: NotificationPermission = .notAsked

    private init() {}

    private var now: Int64 { nowMs() }
    private var tz: Int { deviceTzOffset(at: nowMs()) }

    // MARK: State

    /// Runs one core operation on the stored state and refreshes `state`.
    @discardableResult
    private func mutate<T>(_ body: (inout AppState) -> T) -> T? {
        let result = StateAccess.update(body)
        state = StateAccess.load()
        return result
    }

    /// Called when the app becomes active: reads the file again (the intents may have changed it), tidies old
    /// data, and shows an undecided warning that is still fresh.
    func sceneDidBecomeActive() {
        let t = now
        let zone = deviceTzOffset(at: t)
        let result: WarningContext?? = mutate { (s: inout AppState) -> WarningContext? in
            s.prune(now: t, tz: zone)
            return s.resumeWarning(now: t, tz: zone)
        }
        let resumed: WarningContext? = result ?? nil
        if flow == nil, let context = resumed {
            flow = WarningFlow(context: context)
        }
        Task { self.permission = await Notifier.permission() }
    }

    /// Called when the app goes to the background: a question nobody answered counts as Thoát, and the warning
    /// screen is put away so the tabs show next time.
    func sceneDidEnterBackground() {
        guard let current = flow else { return }
        if current.isUndecided {
            let t = now
            mutate { $0.autoExit(eventId: current.context.eventId, now: t) }
        }
        flow = nil
    }

    // MARK: Warning

    /// `ShowWarningIntent`: records the warning for `app` and shows its screen.
    func presentWarning(app: String) {
        let t = now
        let zone = deviceTzOffset(at: t)
        if let current = flow, current.isUndecided {
            mutate { $0.autoExit(eventId: current.context.eventId, now: t) }
        }
        let outcome = mutate { $0.recordWarning(app: app, now: t, tz: zone) }
        switch outcome {
        case .some(.success(let context)):
            flow = WarningFlow(context: context)
        case .some(.failure(let error)):
            flow = nil
            errorMessage = error.message
        case .none:
            flow = nil
            errorMessage = AppWording.errorSaving
        }
    }

    private func refreshFlow() {
        guard var current = flow else { return }
        if let context = state.warningContext(eventId: current.context.eventId, now: now, tz: tz) {
            current.apply(context: context)
            flow = current
        }
    }

    /// "Thoát": the decision is stored, then the app steps aside to the Home screen.
    func exitWarning() {
        guard let current = flow else { return }
        let t = now
        let zone = deviceTzOffset(at: t)
        let result = mutate { $0.decide(eventId: current.context.eventId, choice: .exit, now: t, tz: zone) }
        if handle(result) {
            refreshFlow()
            SystemActions.goHome()
        }
    }

    /// "Vào" pressed: the minute options (nothing happens while the countdown runs).
    func openEnterChoices() {
        guard var current = flow else { return }
        if current.showMinutes(now: now) { flow = current }
    }

    func openAlternative() {
        guard var current = flow else { return }
        current.showActivities()
        flow = current
    }

    func backInWarning() {
        guard var current = flow else { return }
        current.back()
        flow = current
    }

    func selectActivity(_ name: String) {
        guard var current = flow else { return }
        current.select(activity: name)
        flow = current
    }

    func setActivityMinutes(_ minutes: Int) {
        guard var current = flow else { return }
        current.setActivityMinutes(minutes)
        flow = current
    }

    /// Minutes picked after "Vào": stores the decision, schedules the two notifications, opens the app.
    func enter(minutes: Int) {
        guard let current = flow else { return }
        let t = now
        let zone = deviceTzOffset(at: t)
        let app = current.context.app
        let result = mutate { $0.decide(eventId: current.context.eventId, choice: .enter(minutes: minutes), now: t, tz: zone) }
        guard handle(result) else { return }
        refreshFlow()
        let notifications = state.allowNotifications(app: app, now: t)
        Notifier.cancel(identifiers: NotificationIds.allow(app: app))
        if let notifications = notifications {
            Notifier.schedule(allowNotificationSpecs(notifications), now: t)
        }
        if let link = AppLinks.urlString(for: app) {
            SystemActions.open(urlString: link)
        }
    }

    /// "Bắt đầu" on the activity picker: stores the decision and schedules the end-of-activity notification.
    func startActivity() {
        guard let current = flow else { return }
        let t = now
        let zone = deviceTzOffset(at: t)
        let result = mutate { $0.decide(eventId: current.context.eventId, choice: current.activityChoice, now: t, tz: zone) }
        guard handle(result) else { return }
        refreshFlow()
        if case .some(.success(let outcome)) = result, let spec = activityNotificationSpec(event: outcome.event) {
            Notifier.cancel(identifiers: [spec.identifier])
            Notifier.schedule([spec], now: t)
        }
    }

    /// "Về màn hình chính" and "Xong": puts the warning screen away; `goHome` also leaves the app.
    func finishWarning(goHome: Bool) {
        if let current = flow, case .activity = current.phase {
            Notifier.cancel(identifiers: [NotificationIds.activity(eventId: current.context.eventId)])
        }
        flow = nil
        if goHome { SystemActions.goHome() }
    }

    /// True when the decision went through; otherwise shows why.
    private func handle(_ result: Result<DecisionOutcome, CoreError>?) -> Bool {
        switch result {
        case .some(.success):
            return true
        case .some(.failure(let error)):
            errorMessage = error.message
            refreshFlow()
            return false
        case .none:
            errorMessage = AppWording.errorSaving
            return false
        }
    }

    // MARK: Changes and the confirmation

    /// Tries a change without confirmation. When it weakens protection the confirmation sheet opens; the
    /// change runs again with `confirmed: true` from `confirmPendingChange`.
    func request(_ change: StateChange) {
        run(change, confirmed: false)
    }

    private func run(_ change: StateChange, confirmed: Bool) {
        let t = now
        let zone = deviceTzOffset(at: t)
        let result = mutate { $0.apply(change, confirmed: confirmed, now: t, tz: zone) }
        switch result {
        case .some(.success):
            pendingChange = nil
            confirmGate = nil
        case .some(.failure(.needsConfirm)):
            if confirmed {
                errorMessage = CoreError.needsConfirm.message
                pendingChange = nil
                confirmGate = nil
            } else {
                pendingChange = change
                confirmGate = ConfirmGate(startedAt: t)
            }
        case .some(.failure(let error)):
            pendingChange = nil
            confirmGate = nil
            errorMessage = error.message
        case .none:
            pendingChange = nil
            confirmGate = nil
            errorMessage = AppWording.errorSaving
        }
    }

    /// "Xác nhận" in the sheet (the sheet only enables it after the wait and the typed phrase).
    func confirmPendingChange(typed: String) {
        guard let change = pendingChange, let gate = confirmGate, gate.canConfirm(input: typed, now: now) else { return }
        run(change, confirmed: true)
    }

    /// "Giữ nguyên bảo vệ".
    func cancelPendingChange() {
        pendingChange = nil
        confirmGate = nil
    }

    // MARK: Study

    func startStudy(minutes: Int, label: String) {
        let t = now
        let result = mutate { $0.startStudy(minutes: minutes, label: label, now: t) }
        switch result {
        case .some(.failure(let error)): errorMessage = error.message
        case .none: errorMessage = AppWording.errorSaving
        default: break
        }
    }

    // MARK: Notifications

    func requestNotificationPermission() {
        Task { self.permission = await Notifier.requestPermission() }
    }
}
