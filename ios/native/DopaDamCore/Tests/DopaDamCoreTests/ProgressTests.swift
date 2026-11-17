import XCTest
@testable import DopaDamCore

final class ProgressTests: XCTestCase {
    let now: Int64 = 1_794_830_400_000 // 2026-11-16 12:00 UTC
    let tz = 0
    var seq = 0

    private func ev(_ daysAgo: Int64, _ decision: Decision?, studyLabel: String? = nil, decidedAfterMs: Int64? = 3000) -> WarningEvent {
        seq += 1
        let shownAt = now - daysAgo * DAY
        return WarningEvent(id: "e\(seq)", app: "YouTube", level: 1, lockSeconds: 10, risk: false, n: 0, shownAt: shownAt, studyLabel: studyLabel,
                            decision: decision, decidedAt: decision == nil ? nil : shownAt + (decidedAfterMs ?? 0))
    }

    private func many(_ n: Int, _ daysAgo: Int64, _ decision: Decision?, studyLabel: String? = nil, decidedAfterMs: Int64? = 3000) -> [WarningEvent] {
        (0..<n).map { _ in ev(daysAgo, decision, studyLabel: studyLabel, decidedAfterMs: decidedAfterMs) }
    }

    private func run(_ events: [WarningEvent]) -> WeeklyProgress { weeklyProgress(events: events, now: now, tzOffsetMinutes: tz) }

    func testComparesFullWeeksAndLeavesUndecidedEventsOut() {
        let p = run(many(3, 1, .exit) + many(1, 2, .enter) + [ev(0, nil)] + many(2, 8, .exit) + many(2, 9, .enter))
        XCTAssertEqual(p.thisWeek.total, 4)
        XCTAssertFalse(p.enough)
        XCTAssertEqual(p.leaveRate, .notEnoughData)
        let q = run(many(4, 1, .exit) + many(1, 2, .enter) + many(2, 8, .exit) + many(3, 9, .enter))
        XCTAssertEqual(q.thisWeek.leaveRate!, 0.8, accuracy: 1e-9)
        XCTAssertEqual(q.lastWeek.leaveRate!, 0.4, accuracy: 1e-9)
        XCTAssertEqual([q.leaveRate, q.seconds, q.studyOpens], [.better, .same, .same])
    }

    func testNotEnoughDataWhenAWeekIsEmptyOrUnder5() {
        XCTAssertFalse(run(many(9, 1, .exit)).enough)
        XCTAssertFalse(run(many(5, 1, .exit) + many(4, 9, .exit)).enough)
        XCTAssertTrue(run(many(5, 1, .exit) + many(5, 9, .exit)).enough)
    }

    func testLeaveRateBoundaryIs5Points() {
        let last = many(10, 9, .exit) + many(10, 9, .enter)
        XCTAssertEqual(run(many(11, 1, .exit) + many(9, 1, .enter) + last).leaveRate, .better)
        XCTAssertEqual(run(many(10, 1, .exit) + many(9, 1, .enter) + last).leaveRate, .same)
        XCTAssertEqual(run(many(9, 1, .exit) + many(11, 1, .enter) + last).leaveRate, .worse)
    }

    func testSecondsBoundaryIs1Second() {
        func at(_ s: Int64, _ d: Int64) -> [WarningEvent] { many(5, d, .exit, decidedAfterMs: s) }
        XCTAssertEqual(run(at(2000, 1) + at(3000, 9)).seconds, .better)
        XCTAssertEqual(run(at(2500, 1) + at(3000, 9)).seconds, .same)
        XCTAssertEqual(run(at(4000, 1) + at(3000, 9)).seconds, .worse)
        XCTAssertEqual(run(many(5, 1, .enter) + at(3000, 9)).seconds, .notEnoughData)
        // An abandoned warning closed as exit has no decision time and adds no seconds.
        let abandoned = many(5, 1, .exit, decidedAfterMs: nil).map { e -> WarningEvent in var x = e; x.decidedAt = nil; return x }
        XCTAssertNil(run(abandoned + at(3000, 9)).thisWeek.avgExitSeconds)
        XCTAssertEqual(run(abandoned + at(3000, 9)).seconds, .notEnoughData)
    }

    func testStudyOpensLowerBetterHigherWorseEqualSame() {
        func s(_ n: Int, _ d: Int64) -> [WarningEvent] { many(n, d, .exit, studyLabel: "Ôn") }
        func rest(_ d: Int64) -> [WarningEvent] { many(5, d, .exit) }
        XCTAssertEqual(run(s(1, 1) + rest(2) + s(2, 9) + rest(10)).studyOpens, .better)
        XCTAssertEqual(run(s(3, 1) + rest(2) + s(2, 9) + rest(10)).studyOpens, .worse)
        XCTAssertEqual(run(s(2, 1) + rest(2) + s(2, 9) + rest(10)).studyOpens, .same)
        // An open during study counts when shown, decided or not.
        XCTAssertEqual(run(many(2, 1, nil, studyLabel: "Ôn") + rest(2) + rest(9)).thisWeek.studyOpens, 2)
        XCTAssertEqual(run(rest(0) + rest(13) + many(5, 14, .enter)).lastWeek.total, 5)
    }

    func testSentencesAndNumberFormats() {
        XCTAssertEqual(formatPercent(nil), "–")
        XCTAssertEqual(formatPercent(2.0 / 3.0), "67%")
        XCTAssertEqual(formatPercent(0.125), "13%") // half up, like Math.round
        XCTAssertEqual(formatSeconds(nil), "–")
        XCTAssertEqual(formatSeconds(2.5), "2,5 giây")
        XCTAssertEqual(formatSeconds(0.25), "0,3 giây") // toFixed(1) rounds an exact tie up
        XCTAssertEqual(formatSeconds(9.96), "10,0 giây")
        XCTAssertEqual(formatSeconds(12.4), "12 giây")
        XCTAssertEqual(formatSeconds(12.5), "13 giây")

        // Not enough data.
        let none = progressCard(run([]))
        XCTAssertEqual(none.title, "Tiến bộ tuần này")
        XCTAssertEqual(none.subtitle, "7 ngày gần nhất so với 7 ngày trước đó.")
        XCTAssertEqual(none.rows.map { $0.label }, ["Tỉ lệ rời đi", "Số giây đến lúc Thoát", "Mở giải trí trong giờ học"])
        XCTAssertEqual(none.rows[0].text, "Cần ít nhất 5 lần bị chặn mỗi tuần để so sánh")
        XCTAssertEqual(none.rows[0].comparison, "Tuần này – · Tuần trước –")
        XCTAssertEqual(none.rows[2].now, "0 lần")

        // Faster and better by 2 seconds; leave rate 100% against 50%; study opens 0 against 1.
        func at(_ s: Int64, _ d: Int64) -> [WarningEvent] { many(5, d, .exit, decidedAfterMs: s) }
        let better = progressCard(run(at(1000, 1) + at(3000, 9) + many(5, 9, .enter) + many(1, 9, .exit, studyLabel: "Ôn")))
        XCTAssertEqual(better.rows[0].now, "100%")
        XCTAssertEqual(better.rows[0].before, "55%")
        XCTAssertEqual(better.rows[0].text, "Tốt hơn tuần trước")
        XCTAssertEqual(better.rows[1].now, "1,0 giây")
        XCTAssertEqual(better.rows[1].text, "Nhanh hơn tuần trước 2 giây")
        XCTAssertEqual(better.rows[2].text, "Tốt hơn tuần trước")
        XCTAssertEqual(better.rows[2].comparison, "Tuần này 0 lần · Tuần trước 1 lần")
        let worse = progressCard(run(at(5000, 1) + many(10, 1, .enter) + at(3000, 9) + many(5, 9, .enter)))
        XCTAssertEqual(worse.rows[1].text, "Chậm hơn tuần trước 2 giây")
        XCTAssertEqual(worse.rows[0].text, "Chưa tốt bằng tuần trước")
        XCTAssertEqual(Wording.verdict(.same), "Gần như tuần trước")
    }

    func testStateReadModelsUseTheAppDay() {
        var s = AppState()
        s.events = many(5, 1, .exit) + many(5, 9, .exit)
        let card = s.weeklyProgressCard(now: now, tz: tz)
        XCTAssertTrue(card.progress.enough)
        XCTAssertEqual(card.rows[0].text, "Gần như tuần trước")
    }
}

final class ReadModelTests: XCTestCase {
    var s = AppState()

    override func setUp() { s = AppState() }

    func testTodaySummary() {
        s.warn("a", NOW)
        s.warn("b", NOW + 10 * MIN)
        s.warn("c", NOW + 20 * MIN, app: "TikTok")
        s.warn("d", NOW + 30 * MIN)
        s.warn("yesterday", NOW - DAY)
        _ = s.decide(eventId: "a", choice: .exit, now: NOW + 1000, tz: TZ)
        _ = s.decide(eventId: "b", choice: .enter(minutes: 15), now: NOW + 10 * MIN + 12_000, tz: TZ)
        _ = s.decide(eventId: "c", choice: .exit, now: NOW + 20 * MIN + 1000, tz: TZ)
        let t = s.todaySummary(now: NOW + 40 * MIN, tz: TZ)
        XCTAssertEqual(t.day, "2026-10-12")
        XCTAssertEqual(t.warnings, 4)
        XCTAssertEqual(t.exits, 2)
        XCTAssertEqual(t.enters, 1)
        XCTAssertEqual(t.undecided, 1)
        XCTAssertEqual(t.exitShare!, 2.0 / 3.0, accuracy: 1e-9)
        XCTAssertEqual(t.exitShareText, "67%")
        XCTAssertEqual(t.grantedMinutes, 15)
        XCTAssertEqual(t.budget.remainingMinutes, 75)
        XCTAssertEqual(t.budgetLine, "Hôm nay: 15 / 90 phút giải trí")
        XCTAssertNil(AppState().todaySummary(now: NOW, tz: TZ).exitShare)
        XCTAssertEqual(AppState().todaySummary(now: NOW, tz: TZ).exitShareText, "–")
    }

    func testDayStats() {
        s.warn("a", NOW)
        s.warn("b", NOW - DAY)
        s.warn("c", NOW - DAY)
        _ = s.decide(eventId: "b", choice: .exit, now: NOW - DAY + 1000, tz: TZ)
        s.grantedMinutes["2026-10-11"] = 30
        let stats = s.dayStats(days: 3, now: NOW, tz: TZ)
        XCTAssertEqual(stats.map { $0.day }, ["2026-10-10", "2026-10-11", "2026-10-12"])
        XCTAssertEqual(stats.map { $0.label }, ["10/10", "11/10", "12/10"])
        XCTAssertEqual(stats[0].total, 0)
        XCTAssertEqual(stats[1].exit, 1)
        XCTAssertEqual(stats[1].undecided, 1)
        XCTAssertEqual(stats[1].grantedMinutes, 30)
        XCTAssertEqual(stats[2].undecided, 1)
        XCTAssertEqual(s.dayStats(days: 28, now: NOW, tz: TZ).count, 28)
        XCTAssertTrue(s.dayStats(days: 0, now: NOW, tz: TZ).isEmpty)
    }

    func testAppsSeen() {
        s.warn("a", NOW, app: "YouTube")
        s.warn("b", NOW + MIN, app: "tiktok")
        s.warn("c", NOW + 2 * MIN, app: "TikTok")
        s.warn("d", NOW + 3 * MIN, app: "Zalo")
        _ = s.decide(eventId: "b", choice: .exit, now: NOW + MIN + 500, tz: TZ)
        let apps = s.appsSeen()
        XCTAssertEqual(apps.map { $0.name }, ["TikTok", "Zalo", "YouTube"])
        XCTAssertEqual(apps[0].warnings, 2)
        XCTAssertEqual(apps[0].exits, 1)
        XCTAssertEqual(apps[0].lastShownAt, NOW + 2 * MIN)
    }
}
