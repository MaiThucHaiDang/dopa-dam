import XCTest
import UIKit

/// Cài đặt, and the confirmation that guards a weaker setting (check list step 8).
final class SettingsTests: UITestCase {
    private let phrase = "tôi chọn giảm bảo vệ"

    func testLoweringALockTimeNeedsTheWaitAndThePhraseThenIsSaved() {
        launch(["-dopadam-reset"])
        openTab("Cài đặt")

        let level0 = app.textFields["settings.lock.0"]
        XCTAssertTrue(level0.waitForExistence(timeout: 5))
        XCTAssertEqual(level0.value as? String, "5")
        shot("settings, defaults")

        replaceText(of: level0, with: "3")
        XCTAssertEqual(level0.value as? String, "3")
        shot("settings, level 0 lowered to 3 s")
        tapScrolling(button("settings.save"))

        // The confirmation sheet.
        XCTAssertTrue(text("Thay đổi này làm yếu bảo vệ").waitForExistence(timeout: 5))
        let ok = button("confirm.ok")
        let field = app.textFields["confirm.field"]
        XCTAssertTrue(ok.exists)
        XCTAssertFalse(ok.isEnabled, "Xác nhận is locked at the start")
        XCTAssertFalse(field.isEnabled, "the field is locked during the wait")
        XCTAssertTrue(text("confirm.countdown").label.hasPrefix("Chờ "), "countdown reads \"\(text("confirm.countdown").label)\"")
        XCTAssertTrue(button("confirm.cancel").exists)
        shot("confirmation, waiting 60 s")

        // Stays locked for the 60 seconds; the countdown text changes at the end.
        let ready = "Bây giờ có thể gõ câu xác nhận."
        waitForLabel(text("confirm.countdown"), ready, timeout: 75)
        XCTAssertTrue(field.isEnabled)
        XCTAssertFalse(ok.isEnabled, "Xác nhận stays locked until the phrase is typed")
        shot("confirmation, wait over, phrase not typed")

        let how = enterPhrase(into: field, ok: ok)
        note("how the phrase was typed", how)
        XCTAssertTrue(ok.isEnabled, "Xác nhận must enable with the phrase typed (\(how))")
        shot("confirmation, phrase typed via \(how)")
        ok.tap()
        expectGone(text("Thay đổi này làm yếu bảo vệ"))
        XCTAssertFalse(app.alerts.firstMatch.exists)
        XCTAssertFalse(text("error.message").exists)
        shot("settings after the confirmed change")

        // Saved: a fresh launch shows 3.
        launch([])
        openTab("Cài đặt")
        let again = app.textFields["settings.lock.0"]
        XCTAssertTrue(again.waitForExistence(timeout: 5))
        XCTAssertEqual(again.value as? String, "3")
    }

    func testRaisingALockTimeSavesWithoutConfirmation() {
        launch(["-dopadam-reset"])
        openTab("Cài đặt")
        let level0 = app.textFields["settings.lock.0"]
        XCTAssertTrue(level0.waitForExistence(timeout: 5))
        replaceText(of: level0, with: "8")
        tapScrolling(button("settings.save"))
        XCTAssertFalse(text("Thay đổi này làm yếu bảo vệ").waitForExistence(timeout: 3), "raising protection needs no confirmation")
        XCTAssertFalse(text("error.message").exists)

        launch([])
        openTab("Cài đặt")
        let again = app.textFields["settings.lock.0"]
        XCTAssertTrue(again.waitForExistence(timeout: 5))
        XCTAssertEqual(again.value as? String, "8")
    }

    func testWeakeningWhileStudyingIsRefusedWithAVisibleMessage() {
        launch(["-dopadam-reset"])
        openTab("Học")
        let start = button("study.start.25")
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        start.tap()

        openTab("Cài đặt")
        let level0 = app.textFields["settings.lock.0"]
        XCTAssertTrue(level0.waitForExistence(timeout: 5))
        replaceText(of: level0, with: "3")
        tapScrolling(button("settings.save"))

        let message = text("error.message")
        XCTAssertTrue(message.waitForExistence(timeout: 5), "the error must be visible")
        XCTAssertEqual(message.label, "Đang trong phiên học nên không chỉnh được.")
        XCTAssertEqual(text("error.title").label, "Chưa làm được")
        XCTAssertFalse(text("Thay đổi này làm yếu bảo vệ").exists, "no confirmation sheet during study")
        shot("error banner during study")
        button("error.dismiss").tap()
        expectGone(message)
    }

    // MARK: Typing the phrase

    /// Types the Vietnamese phrase and says how. First `typeText`; when the button stays disabled, the pasteboard
    /// (long press on the field, then the "Dán" / "Paste" item and the system's "Allow Paste" prompt).
    private func enterPhrase(into field: XCUIElement, ok: XCUIElement) -> String {
        field.tap()
        field.typeText(phrase)
        if waitEnabled(ok, seconds: 2) { return "typeText" }

        // Clear whatever arrived and paste instead.
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: phrase.count + 3))
        UIPasteboard.general.string = phrase
        field.press(forDuration: 1.2)
        shot("edit menu on the confirmation field")
        for title in ["Dán", "Paste"] {
            let item = app.menuItems[title]
            if item.waitForExistence(timeout: 2) {
                item.tap()
                break
            }
        }
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for title in ["Cho phép dán", "Allow Paste"] {
            let allow = springboard.buttons[title]
            if allow.waitForExistence(timeout: 3) {
                shot("system paste prompt")
                allow.tap()
                break
            }
        }
        return waitEnabled(ok, seconds: 3) ? "pasteboard" : "neither typeText nor pasteboard worked"
    }

    private func waitEnabled(_ element: XCUIElement, seconds: TimeInterval) -> Bool {
        let predicate = NSPredicate(format: "isEnabled == true")
        return XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: element)], timeout: seconds) == .completed
    }
}
