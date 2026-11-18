import XCTest
import UIKit

/// Shared helpers for the UI tests: launching the app with the DEBUG launch arguments, screenshots that are kept
/// in the result bundle, waiting, and typing into text fields.
class UITestCase: XCTestCase {
    let app = XCUIApplication()
    private var shotCount = 0

    /// Screenshot name -> the name the exporter shows: "01 first-warning".
    func shot(_ name: String) {
        shotCount += 1
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = String(format: "%02d %@", shotCount, name)
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func note(_ name: String, _ text: String) {
        let attachment = XCTAttachment(string: text)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    override func tearDown() {
        // The last picture, and the element tree when the test failed: the two things needed to see why.
        if app.state == .runningForeground {
            shot("end of test")
        }
        if let run = testRun, !run.hasSucceeded, app.state != .notRunning {
            note("element tree", app.debugDescription)
        }
        super.tearDown()
    }

    /// Starts the app from nothing with the given DEBUG arguments, in Vietnamese.
    func launch(_ arguments: [String]) {
        app.terminate()
        app.launchArguments = ["-AppleLanguages", "(vi)", "-AppleLocale", "vi_VN"] + arguments
        app.launch()
    }

    // MARK: Elements

    func button(_ id: String) -> XCUIElement { app.buttons[id] }
    func text(_ id: String) -> XCUIElement { app.staticTexts[id] }

    func staticText(beginningWith prefix: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    func staticText(containing part: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", part)).firstMatch
    }

    func openTab(_ title: String, file: StaticString = #filePath, line: UInt = #line) {
        let tab = app.tabBars.buttons[title]
        XCTAssertTrue(tab.waitForExistence(timeout: 10), "tab \(title) is missing", file: file, line: line)
        tab.tap()
    }

    // MARK: Waiting

    func waitForEnabled(_ element: XCUIElement, _ enabled: Bool, timeout: TimeInterval,
                        file: StaticString = #filePath, line: UInt = #line) {
        let predicate = NSPredicate(format: "isEnabled == %@", NSNumber(value: enabled))
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        let outcome = XCTWaiter().wait(for: [expectation], timeout: timeout)
        XCTAssertEqual(outcome, .completed, "\(element) did not become \(enabled ? "enabled" : "disabled") in \(timeout) s",
                       file: file, line: line)
    }

    func waitForLabel(_ element: XCUIElement, _ label: String, timeout: TimeInterval,
                      file: StaticString = #filePath, line: UInt = #line) {
        let predicate = NSPredicate(format: "label == %@", label)
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        let outcome = XCTWaiter().wait(for: [expectation], timeout: timeout)
        XCTAssertEqual(outcome, .completed, "label is \"\(element.label)\", expected \"\(label)\"", file: file, line: line)
    }

    func expectGone(_ element: XCUIElement, timeout: TimeInterval = 5, file: StaticString = #filePath, line: UInt = #line) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        XCTAssertEqual(XCTWaiter().wait(for: [expectation], timeout: timeout), .completed, "\(element) is still there",
                       file: file, line: line)
    }

    // MARK: Scrolling

    /// Taps `element`, scrolling the page up first until it can be hit (the pages are scroll views).
    func tapScrolling(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), "\(element) is missing", file: file, line: line)
        var swipes = 0
        while !element.isHittable && swipes < 8 {
            app.swipeUp()
            swipes += 1
        }
        XCTAssertTrue(element.isHittable, "\(element) cannot be reached by scrolling", file: file, line: line)
        element.tap()
    }

    func scrollToTop() {
        for _ in 0..<4 { app.swipeDown() }
    }

    // MARK: Typing

    /// Replaces the text of `field` with `digits` (ASCII only), with the on-screen number pad or keyboard.
    func replaceText(of field: XCUIElement, with newText: String, file: StaticString = #filePath, line: UInt = #line) {
        field.tap()
        let current = (field.value as? String) ?? ""
        let deletes = String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 3)
        field.typeText(deletes)
        field.typeText(newText)
    }
}
