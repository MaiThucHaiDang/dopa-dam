import XCTest
import AppIntents
import DopaDamCore
@testable import DopaDam

/// The two Shortcuts actions, called directly inside the app process (the tests are hosted by the app), on a
/// temporary state file so nothing of the real state is read or changed.
final class IntentTests: XCTestCase {
    private var directory: URL!

    override func setUp() {
        super.setUp()
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("dopadam-tests-\(UUID().uuidString)", isDirectory: true)
        StateAccess.useStateFile(at: directory.appendingPathComponent("state.json"))
        MainActor.assumeIsolated {
            AppModel.shared.finishWarning(goHome: false)
            AppModel.shared.errorMessage = nil
        }
    }

    override func tearDown() {
        StateAccess.useStateFile(at: nil)
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    // MARK: Helpers

    private func shouldAsk(_ app: String) async throws -> Bool? {
        var intent = ShouldAskIntent()
        intent.app = app
        let result = try await intent.perform()
        return result.value
    }

    /// Stores a warning shown `ageSeconds` ago and "Vào" for `minutes`, decided `decidedAgoSeconds` ago.
    private func allow(app: String, minutes: Int, shownAgoSeconds: Int64, decidedAgoSeconds: Int64) {
        let now = nowMs()
        let tz = deviceTzOffset(at: now)
        let stored: Bool? = StateAccess.update { (state: inout AppState) -> Bool in
            guard case .success(let context) = state.recordWarning(app: app, now: now - shownAgoSeconds * 1000, tz: tz) else { return false }
            if case .success = state.decide(eventId: context.eventId, choice: .enter(minutes: minutes), now: now - decidedAgoSeconds * 1000, tz: tz) {
                return true
            }
            return false
        }
        XCTAssertEqual(stored, true, "the test setup could not store the allow window")
    }

    // MARK: ShouldAskIntent

    func testShouldAskIsTrueForAFreshApp() async throws {
        let answer = try await shouldAsk("YouTube")
        XCTAssertEqual(answer, true)
    }

    func testShouldAskIsFalseWhileAnAllowWindowRuns() async throws {
        allow(app: "YouTube", minutes: 5, shownAgoSeconds: 30, decidedAgoSeconds: 10)
        let youtube = try await shouldAsk("YouTube")
        XCTAssertEqual(youtube, false)
        // Only that app is let through.
        let tiktok = try await shouldAsk("TikTok")
        XCTAssertEqual(tiktok, true)
    }

    func testShouldAskIsTrueAgainWhenTheAllowWindowHasEnded() async throws {
        // Decided 6 minutes ago for 5 minutes: over a minute ago.
        allow(app: "YouTube", minutes: 5, shownAgoSeconds: 7 * 60, decidedAgoSeconds: 6 * 60)
        let answer = try await shouldAsk("YouTube")
        XCTAssertEqual(answer, true)
    }

    func testShouldAskIsTrueForAnEmptyName() async throws {
        allow(app: "YouTube", minutes: 5, shownAgoSeconds: 30, decidedAgoSeconds: 10)
        let answer = try await shouldAsk("   ")
        XCTAssertEqual(answer, true)
    }

    func testShouldAskDoesNotOpenTheApp() {
        XCTAssertFalse(ShouldAskIntent.openAppWhenRun)
        XCTAssertTrue(ShowWarningIntent.openAppWhenRun)
    }

    // MARK: ShowWarningIntent

    @MainActor
    func testShowWarningRecordsTheWarningAndShowsItsScreen() async throws {
        var intent = ShowWarningIntent()
        intent.app = "TikTok"
        _ = try await intent.perform()

        let events = StateAccess.load().events
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events.first?.app, "TikTok")
        XCTAssertNil(events.first?.decision, "nobody has chosen yet")
        XCTAssertEqual(events.first?.lockSeconds, 5)
        XCTAssertEqual(AppModel.shared.flow?.context.app, "TikTok")
        XCTAssertEqual(AppModel.shared.flow?.context.headline, "Bạn mở TikTok để làm gì?")
        XCTAssertNil(AppModel.shared.errorMessage)
    }

    @MainActor
    func testASecondWarningWithinTheHourIsLevelOne() async throws {
        var intent = ShowWarningIntent()
        intent.app = "TikTok"
        _ = try await intent.perform()
        _ = try await intent.perform()

        let events = StateAccess.load().events
        XCTAssertEqual(events.count, 2)
        XCTAssertEqual(events.last?.n, 1)
        XCTAssertEqual(events.last?.level, 1)
        XCTAssertEqual(events.last?.lockSeconds, 10)
        XCTAssertEqual(AppModel.shared.flow?.context.metaLine, "Lần thứ 2 trong 60 phút qua · nút Vào khóa 10 giây")
    }

    @MainActor
    func testShowWarningWithAnEmptyNameRecordsNothingAndSaysSo() async throws {
        var intent = ShowWarningIntent()
        intent.app = "   "
        _ = try await intent.perform()

        XCTAssertTrue(StateAccess.load().events.isEmpty)
        XCTAssertNil(AppModel.shared.flow)
        XCTAssertNotNil(AppModel.shared.errorMessage)
    }
}
