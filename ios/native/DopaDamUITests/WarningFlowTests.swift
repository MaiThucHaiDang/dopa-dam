import XCTest

/// The warning screen, as the check list in HUONG-DAN.md describes it (steps 1 to 4 and 7). The apps are named
/// "DemoApp" (an app DopaDam has no URL scheme for, so "Vào" cannot leave the app on the simulator).
final class WarningFlowTests: UITestCase {
    private let demo = "DemoApp"

    // MARK: 1. First warning

    func testFirstWarningAsksAndKeepsVaoLockedDuringTheCountdown() {
        launch(["-dopadam-reset", "-dopadam-warn", demo])

        let headline = text("warning.headline")
        XCTAssertTrue(headline.waitForExistence(timeout: 10))
        XCTAssertEqual(headline.label, "Bạn mở DemoApp để làm gì?")
        XCTAssertEqual(text("warning.meta").label, "Lần thứ 1 trong 60 phút qua · nút Vào khóa 5 giây")
        XCTAssertTrue(button("warning.exit").exists)
        XCTAssertTrue(button("warning.alternative").exists)

        let enter = button("warning.enter")
        XCTAssertTrue(enter.exists)
        XCTAssertFalse(enter.isEnabled, "Vào must be locked during the countdown")
        XCTAssertTrue(enter.label.hasPrefix("Vào ("), "the button shows the seconds left, not \"\(enter.label)\"")
        shot("first warning, Vào locked")

        waitForEnabled(enter, true, timeout: 10)
        XCTAssertEqual(enter.label, "Vào")
        shot("first warning, countdown over")
    }

    // MARK: 2. Thoát

    func testExitRecordsTheChoiceAndLeavesTheScreen() {
        launch(["-dopadam-reset", "-dopadam-warn", demo])
        XCTAssertTrue(text("warning.headline").waitForExistence(timeout: 10))

        button("warning.exit").tap()
        shot("right after Thoát")

        // The app steps aside to the Home screen (or, if iOS refuses, shows the "Đã thoát" screen).
        let left = app.wait(for: .runningBackground, timeout: 8) || app.state != .runningForeground
        if !left {
            XCTAssertTrue(text("Đã thoát").exists, "neither the Home screen nor the exit screen is showing")
            note("home", "goHome did not move the app to the background; the exit screen stayed")
        }
        shot("after Thoát: Home screen or exit screen")

        if app.state != .runningForeground { app.activate() }
        // Back in the app the tabs show (an answered warning is not shown again), and the history has the choice.
        XCTAssertTrue(app.tabBars.buttons["Tổng quan"].waitForExistence(timeout: 10))
        XCTAssertFalse(text("warning.headline").exists)
        XCTAssertTrue(staticText(beginningWith: "1 lần · Thoát 1 · Vào 0").waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts[demo].exists)
        shot("overview after Thoát: 1 lần, Thoát 1")
    }

    // MARK: 3 and 4. Second warning, then Vào

    func testSecondWarningIsLevelOneAndVaoLeadsToMinutesAndTheAllowedScreen() {
        launch(["-dopadam-reset", "-dopadam-warn", demo])
        XCTAssertTrue(button("warning.exit").waitForExistence(timeout: 10))
        button("warning.exit").tap()
        _ = app.wait(for: .runningBackground, timeout: 8)

        // Open the app again straight away: the second warning inside 60 minutes.
        launch(["-dopadam-warn", demo])
        XCTAssertTrue(text("warning.headline").waitForExistence(timeout: 10))
        XCTAssertEqual(text("warning.meta").label, "Lần thứ 2 trong 60 phút qua · nút Vào khóa 10 giây")
        let enter = button("warning.enter")
        XCTAssertFalse(enter.isEnabled)
        XCTAssertTrue(enter.label.hasPrefix("Vào ("))
        shot("second warning, lock 10 s")

        waitForEnabled(enter, true, timeout: 15)
        enter.tap()

        XCTAssertTrue(text("Vào trong bao lâu?").waitForExistence(timeout: 5))
        for minutes in [5, 15, 30] {
            XCTAssertTrue(button("warning.minutes.\(minutes)").exists, "missing the \(minutes) phút option")
        }
        shot("minutes after Vào")

        button("warning.minutes.5").tap()
        let allowed = text("warning.allowed")
        XCTAssertTrue(allowed.waitForExistence(timeout: 5))
        XCTAssertEqual(allowed.label, "Đã cho vào 5 phút. Mở lại DemoApp.")
        XCTAssertTrue(button("Về màn hình chính").exists)
        shot("allowed screen")

        // The 5 minutes are counted in today's budget.
        launch([])
        XCTAssertTrue(staticText(beginningWith: "Hôm nay: 5 / 90 phút giải trí").waitForExistence(timeout: 10))
        XCTAssertTrue(staticText(beginningWith: "2 lần · Thoát 1 · Vào 1").exists)
        shot("overview after Vào: 5 phút in the budget")
    }

    // MARK: Làm việc khác

    func testAlternativeActivityRunsATimer() {
        launch(["-dopadam-reset", "-dopadam-warn", demo])
        let alternative = button("warning.alternative")
        XCTAssertTrue(alternative.waitForExistence(timeout: 10))
        alternative.tap()

        XCTAssertTrue(text("Làm gì thay vào đó?").waitForExistence(timeout: 5))
        for name in ["Nhảy dây", "Hít đất", "Đọc sách"] {
            XCTAssertTrue(button("warning.activity.\(name)").exists, "missing the activity \(name)")
        }
        shot("activity picker")

        button("warning.activity.Hít đất").tap()
        XCTAssertTrue(app.staticTexts["Trong 5 phút"].exists || app.steppers["Trong 5 phút"].exists,
                      "the stepper reads \"Trong 5 phút\"")
        button("warning.start-activity").tap()

        XCTAssertTrue(text("Đang nghỉ").waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Hít đất"].exists)
        let clock = text("warning.clock")
        XCTAssertTrue(clock.waitForExistence(timeout: 5))
        let first = clock.label
        XCTAssertTrue(first == "5:00" || first.hasPrefix("4:5"), "the clock starts near 5:00, not \(first)")
        shot("activity timer")

        // It counts down.
        let counting = NSPredicate(format: "label != %@", first)
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: counting, object: clock)], timeout: 5), .completed)
        shot("activity timer, a few seconds later")

        button("warning.done").tap()
        XCTAssertTrue(app.tabBars.buttons["Tổng quan"].waitForExistence(timeout: 5))
        XCTAssertTrue(staticText(beginningWith: "1 lần · Thoát 0 · Vào 0 · Việc khác 1").waitForExistence(timeout: 5))
        shot("overview after Làm việc khác")
    }

    // MARK: 7. Study mode

    func testStudySessionMakesTheWarningLockThirtySecondsWithShortOptionsOnly() {
        launch(["-dopadam-reset"])
        openTab("Học")
        let start = button("study.start.25")
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        XCTAssertTrue(text("study.status").label.hasPrefix("Chưa trong phiên học"))
        shot("study tab before")
        start.tap()
        let status = text("study.status")
        XCTAssertTrue(NSPredicate(format: "label BEGINSWITH 'Đang học'").evaluate(with: status), "status is \"\(status.label)\"")
        XCTAssertTrue(status.label.contains("25 phút") || status.label.contains("24 phút"), "status is \"\(status.label)\"")
        shot("study session running")

        // Then an entertainment app opens.
        launch(["-dopadam-warn", demo])
        XCTAssertTrue(text("warning.headline").waitForExistence(timeout: 10))
        XCTAssertEqual(text("warning.meta").label, "Lần thứ 1 trong 60 phút qua · nút Vào khóa 30 giây")
        XCTAssertTrue(staticText(beginningWith: "Đang học").exists, "the warning mentions the study session")
        let enter = button("warning.enter")
        XCTAssertFalse(enter.isEnabled)
        XCTAssertTrue(enter.label.hasPrefix("Vào ("))
        shot("warning during study, lock 30 s")

        waitForEnabled(enter, true, timeout: 40)
        enter.tap()
        XCTAssertTrue(text("Vào trong bao lâu?").waitForExistence(timeout: 5))
        XCTAssertTrue(button("warning.minutes.5").exists)
        XCTAssertTrue(button("warning.minutes.10").exists)
        XCTAssertFalse(button("warning.minutes.15").exists, "15 phút is not offered during study")
        XCTAssertFalse(button("warning.minutes.30").exists, "30 phút is not offered during study")
        shot("only 5 and 10 phút during study")
    }
}
