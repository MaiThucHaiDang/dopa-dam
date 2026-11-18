import XCTest

/// Every tab renders its content (also run on the smallest iPhone by CI).
final class TabsTests: UITestCase {
    func testEveryTabRenders() {
        launch(["-dopadam-reset", "-dopadam-seed", "stats"])
        let tabs: [(tab: String, marker: String, name: String)] = [
            ("Tổng quan", "Hôm nay", "overview"),
            ("Học", "Phiên học", "study"),
            ("Thống kê", "Giờ nguy cơ", "statistics"),
            ("Cài đặt", "Thời gian chờ nút Vào", "settings"),
            ("Hướng dẫn", "Thông báo", "guide"),
        ]
        for item in tabs {
            openTab(item.tab)
            let marker = app.staticTexts[item.marker]
            // The marker may be below the first screen: look for it while scrolling.
            var swipes = 0
            while !marker.exists && swipes < 8 { app.swipeUp(); swipes += 1 }
            XCTAssertTrue(marker.exists, "\(item.tab): \"\(item.marker)\" is not on the page")
            scrollToTop()
            shot("tab \(item.name), top")
            app.swipeUp()
            shot("tab \(item.name), scrolled")
        }
    }

    func testWarningScreensFitTheScreen() {
        launch(["-dopadam-reset", "-dopadam-warn", "Một ứng dụng có tên khá dài để thử xuống dòng"])
        XCTAssertTrue(text("warning.headline").waitForExistence(timeout: 10))
        XCTAssertTrue(button("warning.exit").isHittable)
        // The page scrolls, so the other two only have to exist; whether they fit is written down.
        XCTAssertTrue(button("warning.alternative").exists)
        XCTAssertTrue(button("warning.enter").exists)
        note("choices on screen", "Thoát \(button("warning.exit").isHittable), Làm việc khác \(button("warning.alternative").isHittable), Vào \(button("warning.enter").isHittable)")
        shot("warning with a long app name")
    }

    func testNotificationPermissionButtonAsksTheSystem() {
        launch(["-dopadam-reset"])
        openTab("Hướng dẫn")
        let request = button("Bật thông báo")
        tapScrolling(request)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 10), "the system permission prompt did not appear")
        shot("system notification prompt")
        // "Allow" is the second button ("Cho phép" / "Allow").
        alert.buttons.element(boundBy: alert.buttons.count - 1).tap()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 5))
        XCTAssertTrue(app.staticTexts["Thông báo đã bật."].waitForExistence(timeout: 5))
        shot("guide after allowing notifications")
    }
}
