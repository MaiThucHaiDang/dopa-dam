import XCTest

/// Thống kê with a seeded history (`-dopadam-seed stats`): progress, the risk-hours card and the 14-day chart.
final class StatsTests: UITestCase {
    func testRiskCardSuggestsAWindowThatCanBeAddedAndRemovedOnlyAfterConfirmation() {
        launch(["-dopadam-reset", "-dopadam-seed", "stats"])
        openTab("Thống kê")

        let suggestion = text("stats.risk.suggestion")
        XCTAssertTrue(suggestion.waitForExistence(timeout: 10))
        XCTAssertTrue(suggestion.label.hasPrefix("Hay mở nhất: 22:00–24:00, thứ 2 đến thứ 6"), "suggestion reads \"\(suggestion.label)\"")
        XCTAssertTrue(app.staticTexts["Tiến bộ tuần này"].exists)
        XCTAssertFalse(staticText(beginningWith: "Cần ít nhất").exists, "four weeks of history is enough to compare")
        shot("statistics, top: progress")

        // Bring the risk card into view.
        for _ in 0..<3 where !button("stats.risk.add").isHittable { app.swipeUp() }
        shot("risk hours card with the suggestion")
        XCTAssertTrue(app.staticTexts["Chưa có khung giờ nguy cơ nào."].exists, "no window yet")

        tapScrolling(button("stats.risk.add"))
        let row = text("stats.risk.window")
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertTrue(row.label.hasPrefix("22:00–24:00 · thứ 2 đến thứ 6"), "window row reads \"\(row.label)\"")
        XCTAssertFalse(suggestion.label.contains("22:00"), "a covered block is not suggested again: \(suggestion.label)")
        XCTAssertFalse(text("Thay đổi này làm yếu bảo vệ").exists, "adding a window is not weaker, no confirmation")
        shot("risk window added")

        // Removing it weakens protection: it asks first.
        tapScrolling(button("stats.risk.remove"))
        XCTAssertTrue(text("Thay đổi này làm yếu bảo vệ").waitForExistence(timeout: 5))
        XCTAssertFalse(button("confirm.ok").isEnabled)
        shot("Gỡ asks for confirmation")
        button("confirm.cancel").tap()
        expectGone(text("Thay đổi này làm yếu bảo vệ"))
        XCTAssertTrue(row.exists, "Giữ nguyên bảo vệ keeps the window")
    }

    func testChartAndProgressCardsHaveData() {
        launch(["-dopadam-reset", "-dopadam-seed", "stats"])
        openTab("Thống kê")
        XCTAssertTrue(text("stats.risk.suggestion").waitForExistence(timeout: 10))
        for _ in 0..<4 where !app.staticTexts["14 ngày gần nhất"].isHittable { app.swipeUp() }
        XCTAssertTrue(app.staticTexts["14 ngày gần nhất"].exists)
        XCTAssertTrue(app.staticTexts["Làm việc khác"].exists, "the chart legend")
        shot("14-day chart")

        // The overview of the same history.
        openTab("Tổng quan")
        XCTAssertTrue(app.staticTexts["App đã hỏi"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["YouTube"].exists)
        shot("overview with history")
    }
}
