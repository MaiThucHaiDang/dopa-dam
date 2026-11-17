import AppIntents
import DopaDamCore

/// Shortcuts action 1. Answers "should DopaDam ask now?" for the app named in the automation, and does not
/// open DopaDam. It is true unless an allow window ("Vào") for that app is still running.
struct ShouldAskIntent: AppIntent {
    static var title: LocalizedStringResource = "DopaDam: có cần hỏi không"
    static var description = IntentDescription("Trả lời có hoặc không: có cần hiện màn hình hỏi cho ứng dụng này lúc này không.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Tên ứng dụng")
    var app: String

    func perform() async throws -> some IntentResult & ReturnsValue<Bool> {
        let name = app
        let t = nowMs()
        let answer = StateAccess.update { (state: inout AppState) -> Bool in
            state.shouldAsk(app: name, now: t)
        }
        return .result(value: answer ?? true)
    }
}

/// Shortcuts action 2. Opens DopaDam on the warning screen for the app named in the automation.
struct ShowWarningIntent: AppIntent {
    static var title: LocalizedStringResource = "DopaDam: mở màn hình hỏi"
    static var description = IntentDescription("Mở DopaDam và hỏi \"Bạn mở ... để làm gì?\" cho ứng dụng này.")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Tên ứng dụng")
    var app: String

    @MainActor
    func perform() async throws -> some IntentResult {
        AppModel.shared.presentWarning(app: app)
        return .result()
    }
}

/// Makes both actions appear in the Shortcuts app. The phrases are for Siri only and are not used by the
/// automation.
struct DopaDamShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ShouldAskIntent(),
            phrases: ["Should \(.applicationName) ask"],
            shortTitle: "Có cần hỏi không",
            systemImageName: "questionmark.circle")
        AppShortcut(
            intent: ShowWarningIntent(),
            phrases: ["Show \(.applicationName) warning"],
            shortTitle: "Mở màn hình hỏi",
            systemImageName: "hand.raised")
    }
}
