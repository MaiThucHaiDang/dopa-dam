import XCTest
@testable import DopaDamCore

final class RiskStateTests: XCTestCase {
    var s = AppState()

    override func setUp() { s = AppState() }

    // NOW is Monday 20:00, inside evening().
    private func evening(_ id: String = "w1") -> RiskWindow { RiskWindow(id: id, days: [1, 2, 3, 4, 5], start: "19:00", end: "22:00") }

    func testRaisesTheLevelByOneInsideAWindowAndFlagsTheEvent() {
        s.riskWindows = [evening()]
        let first = s.warn("a", NOW)
        XCTAssertEqual(first.level, 1)
        XCTAssertEqual(first.lockSeconds, 10)
        XCTAssertTrue(first.risk)
        XCTAssertEqual(first.riskLine, "Đây là khung giờ bạn hay mở giải trí nên thời gian chờ dài hơn một cấp.")
    }

    func testDoesNothingOutsideAWindow() {
        s.riskWindows = [evening()]
        let e = s.warn("a", NOW + 3 * HOUR) // 23:00
        XCTAssertEqual(e.level, 0)
        XCTAssertFalse(e.risk)
        XCTAssertNil(e.riskLine)
    }

    func testRaisesLevel0To1And1To2And2To3() {
        s.riskWindows = [evening()]
        XCTAssertEqual(s.warn("a", NOW).level, 1)
        XCTAssertEqual(s.warn("b", NOW + MIN).level, 2)
        XCTAssertEqual(s.warn("c", NOW + 2 * MIN).level, 2)
        let d = s.warn("d", NOW + 3 * MIN)
        XCTAssertEqual(d.level, 3)
        XCTAssertEqual(d.lockSeconds, 30)
        XCTAssertEqual(d.allowOptions, [5, 10])
        XCTAssertTrue(d.risk)
    }

    func testDoesNotFlagAWarningAlreadyAtLevel3() {
        s.riskWindows = [evening()]
        _ = s.startStudy(minutes: 25, label: nil, now: NOW - MIN)
        let e = s.warn("a", NOW)
        XCTAssertEqual(e.level, 3)
        XCTAssertFalse(e.risk)
    }

    func testAdditionsAreSavedAtOnceEvenDuringStudy() {
        XCTAssertTrue(isOk(s.setRiskWindows([evening()], confirmed: false, now: NOW, tz: TZ)))
        XCTAssertEqual(s.riskWindows, [evening()])
        _ = s.startStudy(minutes: 25, label: nil, now: NOW)
        var longer = evening()
        longer.end = "23:00"
        let more = [longer, RiskWindow(id: "w2", days: [6], start: "10:00", end: "12:00")]
        XCTAssertTrue(isOk(s.setRiskWindows(more, confirmed: false, now: NOW, tz: TZ)))
        XCTAssertEqual(s.riskWindows.count, 2)
    }

    func testAsksForConfirmationToRemoveOrShortenAWindow() {
        s.riskWindows = [evening()]
        XCTAssertEqual(failure(s.setRiskWindows([], confirmed: false, now: NOW, tz: TZ)), .needsConfirm)
        var shorter = evening()
        shorter.end = "21:00"
        XCTAssertEqual(failure(s.setRiskWindows([shorter], confirmed: false, now: NOW, tz: TZ)), .needsConfirm)
        XCTAssertEqual(s.riskWindows, [evening()])
        XCTAssertTrue(isOk(s.setRiskWindows([], confirmed: true, now: NOW, tz: TZ)))
        XCTAssertEqual(s.riskWindows, [])
    }

    func testConfirmationNamesTheWindowThatIsRemoved() {
        s.riskWindows = [evening()]
        let id = s.riskWindows[0].id
        let detail = s.confirmDetail(for: .removeRiskWindow(id: id))
        XCTAssertEqual(detail, Wording.riskRemovalConfirm(s.riskWindows[0]))
        XCTAssertTrue(detail?.hasPrefix("Gỡ khung giờ nguy cơ ") ?? false)
        XCTAssertNil(s.confirmDetail(for: .removeRiskWindow(id: "no-such-window")))
        XCTAssertNil(s.confirmDetail(for: .clearLog))
    }

    func testIsLockedDuringStudyEvenWhenConfirmed() {
        s.riskWindows = [evening()]
        _ = s.startStudy(minutes: 25, label: nil, now: NOW)
        XCTAssertEqual(failure(s.setRiskWindows([], confirmed: true, now: NOW, tz: TZ)), .studyLocked)
        XCTAssertEqual(failure(s.setRiskWindows([], confirmed: false, now: NOW, tz: TZ)), .studyLocked)
        XCTAssertEqual(s.riskWindows, [evening()])
    }

    func testRejectsInvalidWindowsAndMoreThan12() {
        XCTAssertEqual(failure(s.setRiskWindows([RiskWindow(id: "x", days: [], start: "19:00", end: "20:00")], confirmed: true, now: NOW, tz: TZ)), .invalid)
        XCTAssertEqual(failure(s.setRiskWindows([RiskWindow(id: "x", days: [1], start: "19:00", end: "19:00")], confirmed: true, now: NOW, tz: TZ)), .invalid)
        let many = (0..<13).map { RiskWindow(id: "w\($0)", days: [1], start: "10:00", end: "11:00") }
        XCTAssertEqual(failure(s.setRiskWindows(many, confirmed: true, now: NOW, tz: TZ)), .invalid)
        XCTAssertEqual(s.riskWindows, [])
        XCTAssertTrue(isOk(s.setRiskWindows(Array(many.prefix(12)), confirmed: true, now: NOW, tz: TZ)))
        XCTAssertEqual(s.riskWindows.count, 12)
    }

    func testCleansWindowsAndGivesNewOrRepeatedIdsTheirOwnId() {
        let input = [
            RiskWindow(id: "", days: [3, 1, 1], start: "7:05", end: "9:00"),
            RiskWindow(id: "", days: [2], start: "10:00", end: "11:00"),
            RiskWindow(id: "k", days: [4], start: "10:00", end: "11:00"),
            RiskWindow(id: "k", days: [5], start: "10:00", end: "11:00"),
        ]
        XCTAssertTrue(isOk(s.setRiskWindows(input, confirmed: false, now: NOW, tz: TZ)))
        XCTAssertEqual(s.riskWindows[0].days, [1, 3])
        XCTAssertEqual(s.riskWindows[0].start, "07:05")
        XCTAssertEqual(Set(s.riskWindows.map { $0.id }).count, 4)
        XCTAssertTrue(s.riskWindows.allSatisfy { !$0.id.isEmpty })
    }

    func testTheSuggestionFromTheHeatMapCanBeAddedAsAWindow() throws {
        for i in 0..<6 { s.warn("e\(i)", NOW + Int64(i)) } // Monday 20:00, six opens
        let heat = s.riskHeatmap(now: NOW + HOUR, tz: TZ, days: 14)
        let sug = try XCTUnwrap(suggestRiskWindow(cells: heat, existing: s.riskWindows))
        XCTAssertEqual(sug, RiskSuggestion(days: [1, 2, 3, 4, 5], start: "19:00", end: "21:00", opens: 6, enters: 0))
        XCTAssertTrue(isOk(s.setRiskWindows([sug.asWindow(id: "n")], confirmed: false, now: NOW, tz: TZ)))
        // The overlapping block 20:00-22:00 (it also holds all six opens) touches the new window: nothing is suggested.
        XCTAssertNil(suggestRiskWindow(cells: heat, existing: s.riskWindows))
        XCTAssertNil(s.riskSuggestion(now: NOW + HOUR, tz: TZ))
    }

    func testTheRiskCard() {
        let card0 = s.riskCard(now: NOW, tz: TZ)
        XCTAssertEqual(card0.cells.count, 7)
        XCTAssertTrue(card0.cells.allSatisfy { $0.count == 24 })
        XCTAssertNil(card0.suggestion)
        XCTAssertEqual(card0.suggestionText, "Chưa có khung giờ nào nổi bật.")
        XCTAssertEqual(card0.busiestOpens, 0)
        XCTAssertEqual(card0.rowLabels, ["T2", "T3", "T4", "T5", "T6", "T7", "CN"])
        XCTAssertTrue(card0.canAddWindow)
        XCTAssertFalse(card0.inRiskNow)
        for i in 0..<6 { s.warn("e\(i)", NOW + Int64(i)) }
        _ = s.decide(eventId: "e0", choice: .exit, now: NOW + 1000, tz: TZ)
        s.riskWindows = [RiskWindow(id: "w", days: [1, 2, 3, 4, 5], start: "22:00", end: "00:00")]
        let card = s.riskCard(now: NOW + HOUR, tz: TZ)
        XCTAssertEqual(card.busiestOpens, 6)
        let cell = card.cells[0][20]
        XCTAssertEqual(cell.opens, 6)
        XCTAssertEqual(cell.intensity, 1)
        XCTAssertEqual(cell.label, "Thứ 2, 20 giờ: 6 lần mở, 0 lần Vào")
        XCTAssertEqual(card.cells[0][19].intensity, 0)
        XCTAssertEqual(card.windows.first?.line, "22:00–24:00 · thứ 2 đến thứ 6 · thời gian chờ dài hơn một cấp")
        XCTAssertEqual(card.suggestionText, "Hay mở nhất: 19:00–21:00, thứ 2 đến thứ 6 (6 lần mở, 0 lần Vào).")
        XCTAssertTrue(card.inRiskNow == false)
        XCTAssertTrue(s.riskCard(now: NOW + 2 * HOUR, tz: TZ).inRiskNow)
    }

    func testWording() {
        XCTAssertEqual(Wording.riskDays([1, 2, 3, 4, 5]), "thứ 2 đến thứ 6")
        XCTAssertEqual(Wording.riskDays([6, 7]), "thứ 7 và Chủ nhật")
        XCTAssertEqual(Wording.riskDays([1, 2, 3, 4, 5, 6, 7]), "mỗi ngày")
        XCTAssertEqual(Wording.riskDays([1, 2, 3, 5, 6]), "thứ 2, thứ 3, thứ 4, thứ 6 và thứ 7")
        XCTAssertEqual(Wording.riskDays([2, 4, 6]), "thứ 3, thứ 5 và thứ 7")
        XCTAssertEqual(Wording.riskDays([7, 1]), "thứ 2 và Chủ nhật")
        XCTAssertEqual(Wording.riskDays([3]), "thứ 4")
        XCTAssertEqual(Wording.riskDays([5, 6, 7]), "thứ 6 đến Chủ nhật")
        XCTAssertEqual(Wording.riskDays([1, 1, 2, 9]), "thứ 2 và thứ 3")
        XCTAssertEqual(Wording.riskDays([]), "")
        XCTAssertEqual(Wording.riskRange(start: "22:00", end: "00:00"), "22:00–24:00")
        XCTAssertEqual(Wording.riskRange(start: "22:00", end: "01:00"), "22:00–01:00")
        XCTAssertEqual(Wording.riskSuggestionLine(RiskSuggestion(days: [1, 2, 3, 4, 5], start: "22:00", end: "00:00", opens: 17, enters: 9)),
                       "Hay mở nhất: 22:00–24:00, thứ 2 đến thứ 6 (17 lần mở, 9 lần Vào).")
        XCTAssertEqual(Wording.riskCellLabel(row: 1, hour: 22, cell: RiskCell(opens: 5, enters: 3)), "Thứ 3, 22 giờ: 5 lần mở, 3 lần Vào")
        XCTAssertEqual(Wording.riskCellLabel(row: 6, hour: 0, cell: RiskCell()), "Chủ nhật, 0 giờ: chưa có lần mở nào")
        XCTAssertEqual(Wording.errorNeedsConfirm, CoreError.needsConfirm.message)
        XCTAssertEqual(CoreError.locked.message, "Nút Vào vẫn đang bị khóa.")
        XCTAssertEqual(Wording.confirmCountdown(secondsLeft: 12), "Chờ 12 giây rồi mới gõ được câu xác nhận.")
        XCTAssertEqual(Wording.confirmCountdown(secondsLeft: 0), "Bây giờ có thể gõ câu xác nhận.")
        XCTAssertEqual(Wording.activityDoneNotificationTitle(minutes: 5, activity: "Hít đất"), "Xong 5 phút hít đất")
        XCTAssertEqual(formatClock(ms: 61_000), "1:01")
        XCTAssertEqual(formatClock(ms: 59_001), "1:00")
        XCTAssertEqual(formatClock(ms: -5), "0:00")
        XCTAssertEqual(minutesUntil(NOW + 20 * MIN + 1, now: NOW), 21)
    }
}
