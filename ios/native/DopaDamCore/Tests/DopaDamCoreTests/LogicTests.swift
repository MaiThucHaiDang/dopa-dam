import XCTest
@testable import DopaDamCore

final class WarningTests: XCTestCase {
    var s = AppState()

    override func setUp() { s = AppState() }

    func testEscalatesWithTheNumberOfWarningsInTheLastHour() {
        XCTAssertEqual(s.warn("a", NOW).level, 0)
        XCTAssertEqual(s.warn("b", NOW + MIN).level, 1)
        XCTAssertEqual(s.warn("c", NOW + 2 * MIN).level, 1)
        let d = s.warn("d", NOW + 3 * MIN)
        XCTAssertEqual(d.level, 2)
        XCTAssertEqual(d.lockSeconds, 20)
        XCTAssertEqual(d.n, 3)
        XCTAssertEqual(d.countThisHour, 4)
        XCTAssertEqual(d.allowOptions, [5, 15, 30])
        // An hour after the first ones, the window has slid.
        XCTAssertEqual(s.warn("e", NOW + 3 * MIN + 61 * MIN).level, 0)
    }

    func testWarningsOfDifferentAppsCountTogether() {
        s.warn("a", NOW, app: "YouTube")
        XCTAssertEqual(s.warn("b", NOW + MIN, app: "TikTok").level, 1)
    }

    func testTheSameWarningScreenReloadedReturnsTheSameEvent() {
        let first = s.warn("a", NOW)
        let again = s.warn("a", NOW + 5000)
        XCTAssertEqual(again.eventId, first.eventId)
        XCTAssertEqual(again.shownAt, first.shownAt)
        XCTAssertEqual(s.events.count, 1)
    }

    func testAnEmptyAppNameIsInvalidAndNamesAreCleaned() {
        XCTAssertEqual(failure(s.recordWarning(app: "   ", now: NOW, tz: TZ)), .invalid)
        XCTAssertTrue(s.events.isEmpty)
        let c = s.warn("a", NOW, app: "  Facebook \n Lite ")
        XCTAssertEqual(c.app, "Facebook Lite")
        XCTAssertEqual(c.headline, "Bạn mở Facebook Lite để làm gì?")
        // Without an id a fresh one is made each time.
        let x = try! s.recordWarning(app: "YouTube", now: NOW + MIN, tz: TZ).get()
        let y = try! s.recordWarning(app: "YouTube", now: NOW + 2 * MIN, tz: TZ).get()
        XCTAssertNotEqual(x.eventId, y.eventId)
    }

    func testContextCarriesEverythingTheScreenShows() {
        let c = s.warn("a", NOW)
        XCTAssertEqual(c.level, 0)
        XCTAssertEqual(c.lockSeconds, 5)
        XCTAssertEqual(c.enterUnlocksAt, NOW + 5000)
        XCTAssertEqual(c.lockSecondsLeft(now: NOW + 1500), 4)
        XCTAssertEqual(c.lockSecondsLeft(now: NOW + 5000), 0)
        XCTAssertEqual(Wording.enterButton(lockedSecondsLeft: 4), "Vào (4)")
        XCTAssertEqual(Wording.enterButton(lockedSecondsLeft: 0), "Vào")
        XCTAssertEqual(c.metaLine, "Lần thứ 1 trong 60 phút qua · nút Vào khóa 5 giây")
        XCTAssertEqual(c.activities, ["Nhảy dây", "Hít đất", "Đọc sách"])
        XCTAssertEqual(c.activityMinutesRange, 2...10)
        XCTAssertNil(c.riskLine)
        XCTAssertNil(c.studyLine)
        XCTAssertEqual(c.budgetLine, "Hôm nay: 0 / 90 phút giải trí")
        XCTAssertNil(c.decision)
        s.settings.budgetMinutes = 0
        XCTAssertEqual(s.warningContext(eventId: "a", now: NOW, tz: TZ)?.budgetLine, "Hôm nay: 0 phút giải trí")
        XCTAssertNil(s.warningContext(eventId: "nope", now: NOW, tz: TZ))
    }

    func testGoesToLevel3OnceTheDailyBudgetIsUsedUp() throws {
        // The budget counts the minutes granted through "Vào".
        s.warn("a", NOW)
        XCTAssertTrue(isOk(s.decide(eventId: "a", choice: .enter(minutes: 30), now: NOW + 6000, tz: TZ)))
        s.warn("b", NOW + 10 * MIN)
        XCTAssertTrue(isOk(s.decide(eventId: "b", choice: .enter(minutes: 30), now: NOW + 10 * MIN + 11_000, tz: TZ)))
        XCTAssertFalse(s.budgetView(now: NOW + 20 * MIN, tz: TZ).over)
        s.warn("c", NOW + 20 * MIN)
        XCTAssertTrue(isOk(s.decide(eventId: "c", choice: .enter(minutes: 30), now: NOW + 20 * MIN + 11_000, tz: TZ)))
        let view = s.budgetView(now: NOW + 30 * MIN, tz: TZ)
        XCTAssertEqual(view.usedMinutes, 90)
        XCTAssertTrue(view.over)
        XCTAssertEqual(view.remainingMinutes, 0)
        let d = s.warn("d", NOW + 30 * MIN)
        XCTAssertEqual(d.level, 3)
        XCTAssertEqual(d.lockSeconds, 30)
        XCTAssertEqual(d.allowOptions, [5, 10])
        XCTAssertEqual(d.budgetLine, "Hôm nay: 90 / 90 phút giải trí")
        XCTAssertTrue(d.budget.over)
        // The next app day starts at 04:00: the budget is fresh.
        let nextDay = NOW + 9 * HOUR // 05:00 next day
        XCTAssertEqual(s.warn("e", nextDay).level, 0)
    }

    func testAMidnightWarningCountsForTheDayBefore() {
        s.grantedMinutes[dayKey(NOW, tzOffsetMinutes: TZ)] = 120
        // 02:00 the next morning is still the same app day.
        XCTAssertEqual(s.warn("a", NOW + 6 * HOUR).level, 3)
    }

    func testGoesToLevel3DuringStudyAndRemembersTheLabel() {
        s.manualStudy.append(Session(id: "m", start: NOW - MIN, end: NOW + 30 * MIN, label: "Ôn Hệ điều hành"))
        let c = s.warn("a", NOW)
        XCTAssertEqual(c.level, 3)
        XCTAssertEqual(s.event0.studyLabel, "Ôn Hệ điều hành")
        XCTAssertTrue(c.studyActive)
        XCTAssertEqual(c.studyLine, "Đang học: Ôn Hệ điều hành · còn 30 phút")
        XCTAssertEqual(c.studyEndsAt, NOW + 30 * MIN)
    }
}

final class DecisionTests: XCTestCase {
    var s = AppState()

    override func setUp() { s = AppState() }

    func testRefusesToEnterWhileTheButtonIsStillLocked() {
        s.warn("a", NOW)
        XCTAssertEqual(failure(s.decide(eventId: "a", choice: .enter(minutes: 5), now: NOW + 2000, tz: TZ)), .locked)
        XCTAssertNil(s.event0.decision)
        XCTAssertTrue(s.allowWindows.isEmpty)
        // A little jitter below the lock is tolerated (500 ms), as in the extension.
        XCTAssertTrue(isOk(s.decide(eventId: "a", choice: .enter(minutes: 5), now: NOW + 4600, tz: TZ)))
    }

    func testUnknownEvent() {
        XCTAssertEqual(failure(s.decide(eventId: "nope", choice: .exit, now: NOW, tz: TZ)), .notFound)
    }

    func testEnterOpensAnAllowWindowAndAddsGrantedMinutes() throws {
        s.warn("a", NOW)
        XCTAssertTrue(s.shouldAsk(app: "YouTube", now: NOW + 6000))
        let out = try s.decide(eventId: "a", choice: .enter(minutes: 15), now: NOW + 6000, tz: TZ).get()
        XCTAssertEqual(out.allowEndsAt, NOW + 6000 + 15 * MIN)
        XCTAssertEqual(out.grantedTodayMinutes, 15)
        XCTAssertEqual(s.allowWindows, [AllowWindow(app: "YouTube", expiresAt: NOW + 6000 + 15 * MIN)])
        XCTAssertEqual(s.grantedMinutes[dayKey(NOW, tzOffsetMinutes: TZ)], 15)
        XCTAssertEqual(s.event0.decision, .enter)
        XCTAssertEqual(s.event0.allowMinutes, 15)
        XCTAssertEqual(s.event0.decidedAt, NOW + 6000)
        XCTAssertEqual(s.warningContext(eventId: "a", now: NOW + 7000, tz: TZ)?.decision, .enter)
    }

    func testOnlyAcceptsTheAllowOptionsOfTheEventsLevel() {
        s.manualStudy.append(Session(id: "m", start: NOW - MIN, end: NOW + 30 * MIN, label: nil))
        s.warn("a", NOW)
        XCTAssertEqual(failure(s.decide(eventId: "a", choice: .enter(minutes: 15), now: NOW + 31_000, tz: TZ)), .invalid)
        XCTAssertTrue(s.allowWindows.isEmpty)
        XCTAssertTrue(isOk(s.decide(eventId: "a", choice: .enter(minutes: 10), now: NOW + 31_000, tz: TZ)))
    }

    func testValidatesTheAlternativeActivity() {
        s.warn("a", NOW)
        XCTAssertEqual(failure(s.decide(eventId: "a", choice: .alternative(activity: "Ngủ", minutes: 5), now: NOW, tz: TZ)), .invalid)
        XCTAssertEqual(failure(s.decide(eventId: "a", choice: .alternative(activity: "Hít đất", minutes: 11), now: NOW, tz: TZ)), .invalid)
        XCTAssertEqual(failure(s.decide(eventId: "a", choice: .alternative(activity: "Hít đất", minutes: 1), now: NOW, tz: TZ)), .invalid)
        let out = try? s.decide(eventId: "a", choice: .alternative(activity: "Hít đất", minutes: 3), now: NOW, tz: TZ).get()
        XCTAssertEqual(out?.activityEndsAt, NOW + 3 * MIN)
        XCTAssertEqual(s.event0.decision, .alternative)
        XCTAssertEqual(s.event0.activity, "Hít đất")
        XCTAssertEqual(s.event0.activityMinutes, 3)
        XCTAssertEqual(s.warningContext(eventId: "a", now: NOW + MIN, tz: TZ)?.activityEndsAt, NOW + 3 * MIN)
        // An alternative never opens an allow window or adds granted minutes.
        XCTAssertTrue(s.allowWindows.isEmpty)
        XCTAssertTrue(s.grantedMinutes.isEmpty)
    }

    func testExitIsImmediateAndADecisionIsNotMadeTwice() {
        s.warn("a", NOW)
        XCTAssertTrue(isOk(s.decide(eventId: "a", choice: .exit, now: NOW + 100, tz: TZ)))
        XCTAssertEqual(failure(s.decide(eventId: "a", choice: .enter(minutes: 5), now: NOW + 60_000, tz: TZ)), .alreadyDecided)
        // Repeating the same decision is harmless.
        XCTAssertTrue(isOk(s.decide(eventId: "a", choice: .exit, now: NOW + 70_000, tz: TZ)))
        XCTAssertEqual(s.event0.decidedAt, NOW + 100)
        XCTAssertFalse(s.autoExit(eventId: "a", now: NOW + 70_000))
    }

    func testRepeatingEnterDoesNotGrantTwice() {
        s.warn("a", NOW)
        _ = s.decide(eventId: "a", choice: .enter(minutes: 5), now: NOW + 6000, tz: TZ)
        _ = s.decide(eventId: "a", choice: .enter(minutes: 5), now: NOW + 9000, tz: TZ)
        XCTAssertEqual(s.grantedToday(now: NOW, tz: TZ), 5)
        XCTAssertEqual(s.allowWindows.count, 1)
    }

    func testAutoExitRecordsAClosedScreenAsLeaving() {
        s.warn("a", NOW)
        XCTAssertTrue(s.autoExit(eventId: "a", now: NOW + 3000))
        XCTAssertEqual(s.event0.decision, .exit)
        XCTAssertEqual(s.event0.decidedAt, NOW + 3000)
        XCTAssertFalse(s.autoExit(eventId: "missing", now: NOW))
    }

    func testPendingWarningsAndAbandonedOnes() {
        s.events.append(WarningEvent(id: "old", app: "YouTube", level: 0, lockSeconds: 5, risk: false, n: 0, shownAt: NOW))
        s.events.append(WarningEvent(id: "fresh", app: "YouTube", level: 0, lockSeconds: 5, risk: false, n: 0, shownAt: NOW + 13 * HOUR))
        s.events.append(WarningEvent(id: "done", app: "YouTube", level: 0, lockSeconds: 5, risk: false, n: 1, shownAt: NOW + 13 * HOUR + MIN))
        _ = s.decide(eventId: "done", choice: .exit, now: NOW + 13 * HOUR + MIN + 100, tz: TZ)
        let now = NOW + 13 * HOUR + 2 * MIN
        // The 13-hour-old warning is not offered for resuming.
        XCTAssertEqual(s.pendingWarnings(now: now, tz: TZ).map { $0.eventId }, ["fresh"])
        XCTAssertNil(s.events[0].decidedAt)
        XCTAssertNil(s.events[0].decision)
        XCTAssertEqual(s.closeAbandoned(now: now), ["old"])
        XCTAssertEqual(s.events[0].decision, .exit)
        XCTAssertNil(s.events[0].decidedAt)
        XCTAssertEqual(s.events[1].decision, nil)
        // Exactly 12 hours old counts as abandoned.
        XCTAssertEqual(s.closeAbandoned(now: NOW + 13 * HOUR + 12 * HOUR), ["fresh"])
    }

    func testShouldAskAndRecordWarningCloseAbandonedWarnings() {
        s.warn("old", NOW)
        _ = s.shouldAsk(app: "YouTube", now: NOW + 12 * HOUR)
        XCTAssertEqual(s.events[0].decision, .exit)
        XCTAssertNil(s.events[0].decidedAt)
        var t = AppState()
        t.warn("old", NOW)
        t.warn("new", NOW + 13 * HOUR)
        XCTAssertEqual(t.events[0].decision, .exit)
    }
}

final class AllowWindowTests: XCTestCase {
    var s = AppState()

    override func setUp() { s = AppState() }

    private func enter(_ id: String, _ at: Int64, app: String, minutes: Int) {
        s.warn(id, at, app: app)
        XCTAssertTrue(isOk(s.decide(eventId: id, choice: .enter(minutes: minutes), now: at + 60_000, tz: TZ)), id)
    }

    func testShouldAskIsFalseOnlyWhileTheWindowRuns() {
        XCTAssertTrue(s.shouldAsk(app: "YouTube", now: NOW))
        enter("a", NOW, app: "YouTube", minutes: 5)
        let end = NOW + MIN + 5 * MIN
        XCTAssertFalse(s.shouldAsk(app: "YouTube", now: NOW + 2 * MIN))
        XCTAssertFalse(s.shouldAsk(app: "YouTube", now: end - 1))
        XCTAssertEqual(s.allowWindows.count, 1)
        XCTAssertTrue(s.shouldAsk(app: "YouTube", now: end))
        // Expired windows are tidied away.
        XCTAssertTrue(s.allowWindows.isEmpty)
    }

    func testWindowsArePerApp() {
        enter("a", NOW, app: "YouTube", minutes: 5)
        XCTAssertFalse(s.shouldAsk(app: "YouTube", now: NOW + 2 * MIN))
        XCTAssertTrue(s.shouldAsk(app: "TikTok", now: NOW + 2 * MIN))
    }

    func testAppNamesMatchIgnoringCaseSpacingAndAccentComposition() {
        enter("a", NOW, app: "YouTube", minutes: 5)
        XCTAssertFalse(s.shouldAsk(app: " youtube ", now: NOW + 2 * MIN))
        XCTAssertFalse(s.shouldAsk(app: "YOUTUBE", now: NOW + 2 * MIN))
        XCTAssertTrue(s.shouldAsk(app: "You Tube", now: NOW + 2 * MIN))
        XCTAssertTrue(s.shouldAsk(app: "", now: NOW + 2 * MIN))
        enter("b", NOW + 10 * MIN, app: "Zalo Việt", minutes: 5)
        XCTAssertFalse(s.shouldAsk(app: "zalo vie\u{0323}\u{0302}t", now: NOW + 12 * MIN))
        XCTAssertEqual(s.appsSeen().count, 2)
    }

    func testANewEnterReplacesTheWindowOfTheSameApp() {
        enter("a", NOW, app: "YouTube", minutes: 5)
        enter("b", NOW + 2 * MIN, app: "youtube", minutes: 15)
        XCTAssertEqual(s.allowWindows.count, 1)
        XCTAssertEqual(s.allowWindowEnd(app: "YouTube", now: NOW + 3 * MIN), NOW + 3 * MIN + 15 * MIN)
        XCTAssertEqual(s.grantedToday(now: NOW, tz: TZ), 20)
    }

    func testWhenTheAllowWindowEndsAndWhenToNotify() {
        XCTAssertNil(s.allowWindowEnd(app: "YouTube", now: NOW))
        XCTAssertNil(s.allowNotifications(app: "YouTube", now: NOW))
        enter("a", NOW, app: "YouTube", minutes: 5)
        let end = NOW + 6 * MIN
        XCTAssertEqual(s.allowWindowEnd(app: "YouTube", now: NOW + 2 * MIN), end)
        XCTAssertNil(s.allowWindowEnd(app: "YouTube", now: end))
        XCTAssertEqual(s.allowNotifications(app: "YouTube", now: NOW + 2 * MIN), AllowNotifications(app: "YouTube", headsUpAt: end - MIN, endsAt: end))
        // Less than a minute left: no heads-up any more.
        XCTAssertNil(s.allowNotifications(app: "YouTube", now: end - 30_000)?.headsUpAt)
        XCTAssertEqual(s.activeAllowWindows(now: NOW + 2 * MIN).count, 1)
        XCTAssertEqual(s.activeAllowWindows(now: end).count, 0)
    }

    func testPruneKeeps30DaysAndDropsExpiredWindows() {
        s.warn("old", NOW - 31 * DAY)
        s.warn("new", NOW)
        s.grantedMinutes["2026-09-01"] = 10
        s.grantedMinutes[dayKey(NOW, tzOffsetMinutes: TZ)] = 5
        s.manualStudy = [Session(id: "x", start: NOW - 40 * DAY, end: NOW - 40 * DAY + HOUR, label: nil)]
        s.allowWindows = [AllowWindow(app: "A", expiresAt: NOW - 1), AllowWindow(app: "B", expiresAt: NOW + MIN)]
        s.prune(now: NOW, tz: TZ)
        XCTAssertEqual(s.events.map { $0.id }, ["new"])
        XCTAssertEqual(Array(s.grantedMinutes.keys), [dayKey(NOW, tzOffsetMinutes: TZ)])
        XCTAssertTrue(s.manualStudy.isEmpty)
        XCTAssertEqual(s.allowWindows.map { $0.app }, ["B"])
        // 29 days old stays.
        var t = AppState()
        t.warn("a", NOW - 29 * DAY)
        t.prune(now: NOW, tz: TZ)
        XCTAssertEqual(t.events.count, 1)
    }
}

final class SettingsAndStudyTests: XCTestCase {
    var s = AppState()
    let weekdayEvening = StudyRule(id: "", days: [1, 2, 3, 4, 5], start: "19:30", end: "22:00", label: "Giờ tự học")

    override func setUp() { s = AppState() }

    private func studying() { s.manualStudy.append(Session(id: "m", start: NOW - MIN, end: NOW + 30 * MIN, label: nil)) }

    func testAsksForConfirmationOnlyWhenFrictionGetsWeaker() {
        var n = s.settings
        n.lockSeconds = [5, 10, 25, 40]
        n.budgetMinutes = 60
        XCTAssertTrue(isOk(s.setSettings(n, confirmed: false, now: NOW, tz: TZ)))
        XCTAssertEqual(s.settings, n)
        var weaker = n
        weaker.lockSeconds = [5, 10, 20, 40]
        XCTAssertEqual(s.settingsChange(to: weaker), .weaken)
        XCTAssertEqual(failure(s.setSettings(weaker, confirmed: false, now: NOW, tz: TZ)), .needsConfirm)
        weaker = n
        weaker.budgetMinutes = 120
        XCTAssertEqual(failure(s.setSettings(weaker, confirmed: false, now: NOW, tz: TZ)), .needsConfirm)
        weaker.budgetMinutes = 0
        XCTAssertEqual(failure(s.setSettings(weaker, confirmed: false, now: NOW, tz: TZ)), .needsConfirm)
        XCTAssertTrue(isOk(s.setSettings(weaker, confirmed: true, now: NOW, tz: TZ)))
        XCTAssertEqual(s.settings.budgetMinutes, 0)
        // Turning a budget on (from off) is not weaker.
        var on = weaker
        on.budgetMinutes = 30
        XCTAssertEqual(s.settingsChange(to: on), .ok)
        XCTAssertTrue(isOk(s.setSettings(on, confirmed: false, now: NOW, tz: TZ)))
    }

    func testValidatesLikeTheAgent() {
        let ok = Settings()
        func with(_ f: (inout Settings) -> Void) -> Settings { var x = ok; f(&x); return x }
        for bad in [
            with { $0.lockSeconds = [5, 10, 25, -1] }, with { $0.lockSeconds = [5, 10, 25] }, with { $0.lockSeconds = [5, 10, 25, 301] },
            with { $0.budgetMinutes = -1 }, with { $0.budgetMinutes = 1441 },
            with { $0.allowOptionsNormal = [600] }, with { $0.allowOptionsNormal = [0, 5] }, with { $0.allowOptionsNormal = [1, 2, 3, 4, 5] },
            with { $0.allowOptionsNormal = [] }, with { $0.allowOptionsRestricted = [11] }, with { $0.allowOptionsRestricted = [] },
        ] {
            XCTAssertFalse(bad.isValid)
            XCTAssertEqual(failure(s.setSettings(bad, confirmed: true, now: NOW, tz: TZ)), .invalid)
        }
        XCTAssertEqual(s.settings, ok)
    }

    func testRaisingTheLongestAllowOptionWeakensAndShorteningDoesNot() {
        var longer = s.settings
        longer.allowOptionsNormal = [5, 15, 60]
        XCTAssertEqual(failure(s.setSettings(longer, confirmed: false, now: NOW, tz: TZ)), .needsConfirm)
        XCTAssertTrue(isOk(s.setSettings(longer, confirmed: true, now: NOW, tz: TZ)))
        var shorter = s.settings
        shorter.allowOptionsNormal = [5, 15]
        shorter.allowOptionsRestricted = [5]
        XCTAssertTrue(isOk(s.setSettings(shorter, confirmed: false, now: NOW, tz: TZ)))
        var longerRestricted = s.settings
        longerRestricted.allowOptionsRestricted = [5, 10]
        XCTAssertEqual(failure(s.setSettings(longerRestricted, confirmed: false, now: NOW, tz: TZ)), .needsConfirm)
        // The new options are what the next warning offers.
        XCTAssertEqual(s.warn("a", NOW).allowOptions, [5, 15])
    }

    func testSettingsAreLockedDuringStudyUnlessNothingChanges() {
        studying()
        var n = s.settings
        n.lockSeconds = [10, 10, 20, 30]
        XCTAssertEqual(failure(s.setSettings(n, confirmed: true, now: NOW, tz: TZ)), .studyLocked)
        XCTAssertEqual(failure(s.setSettings(n, confirmed: false, now: NOW, tz: TZ)), .studyLocked)
        XCTAssertTrue(isOk(s.setSettings(s.settings, confirmed: false, now: NOW, tz: TZ)))
        XCTAssertEqual(failure(s.setSettings(Settings(lockSeconds: [1], allowOptionsNormal: [5], allowOptionsRestricted: [5], budgetMinutes: 1), confirmed: true, now: NOW, tz: TZ)), .invalid)
    }

    func testClearLogNeedsConfirmationAndIsRefusedDuringStudy() {
        s.warn("a", NOW)
        s.grantedMinutes["2026-10-12"] = 10
        XCTAssertEqual(failure(s.clearLog(confirmed: false, now: NOW, tz: TZ)), .needsConfirm)
        XCTAssertTrue(isOk(s.clearLog(confirmed: true, now: NOW, tz: TZ)))
        XCTAssertTrue(s.events.isEmpty)
        XCTAssertTrue(s.grantedMinutes.isEmpty)
        s.warn("b", NOW)
        XCTAssertTrue(isOk(s.startStudy(minutes: 25, label: nil, now: NOW)))
        XCTAssertEqual(failure(s.clearLog(confirmed: true, now: NOW, tz: TZ)), .studyLocked)
        XCTAssertEqual(s.events.count, 1)
        XCTAssertTrue(isOk(s.clearLog(confirmed: true, now: NOW + 26 * MIN, tz: TZ)))
    }

    func testStartsAManualSessionAndEndsItEarlyOnlyWithConfirmation() throws {
        XCTAssertEqual(failure(s.startStudy(minutes: 4, label: nil, now: NOW)), .invalid)
        XCTAssertEqual(failure(s.startStudy(minutes: 481, label: nil, now: NOW)), .invalid)
        XCTAssertEqual(failure(s.stopStudy(confirmed: true, now: NOW, tz: TZ)), .invalid)
        XCTAssertTrue(isOk(s.startStudy(minutes: 5, label: nil, now: NOW - HOUR)))
        XCTAssertTrue(isOk(s.startStudy(minutes: 480, label: nil, now: NOW - 20 * HOUR)))
        s.manualStudy = []
        _ = try s.startStudy(minutes: 25, label: "  Ôn Hệ điều hành ", now: NOW).get()
        XCTAssertEqual(s.studyStatus(now: NOW + MIN, tz: TZ), StudyStatus(active: true, source: .manual, label: "Ôn Hệ điều hành", endsAt: NOW + 25 * MIN))
        XCTAssertEqual(failure(s.stopStudy(confirmed: false, now: NOW + 10 * MIN, tz: TZ)), .needsConfirm)
        XCTAssertTrue(isOk(s.stopStudy(confirmed: true, now: NOW + 10 * MIN, tz: TZ)))
        XCTAssertFalse(s.studyStatus(now: NOW + 10 * MIN, tz: TZ).active)
        XCTAssertEqual(s.manualStudy[0].end, NOW + 10 * MIN)
    }

    func testCutsStudyLabelsByCodePointsNotUTF16Units() throws {
        func label(_ n: Int) throws -> String? {
            s.manualStudy = []
            _ = try s.startStudy(minutes: 25, label: String(repeating: "a", count: n) + "😀", now: NOW).get()
            return s.manualStudy[0].label
        }
        XCTAssertEqual(try label(59), String(repeating: "a", count: 59) + "😀")
        XCTAssertEqual(try label(60), String(repeating: "a", count: 60))
        XCTAssertEqual(truncateStudyLabel("🇻🇳🇻🇳"), "🇻🇳🇻🇳") // 4 code points, under the limit
        let rule = StudyRule(id: "", days: [1], start: "08:00", end: "09:00", label: String(repeating: "a", count: 60) + "😀")
        XCTAssertEqual(normalizeStudyRule(rule)?.label, String(repeating: "a", count: 60))
    }

    func testWeeklyRulesWeakeningAndTheStudyLock() throws {
        var day = weekdayEvening
        day.days = [5, 1, 2, 3, 4]
        let rule = try s.setStudyRule(day, confirmed: false, now: NOW, tz: TZ).get()
        XCTAssertFalse(rule.id.isEmpty)
        XCTAssertEqual(rule.days, [1, 2, 3, 4, 5])
        XCTAssertEqual(s.studyStatus(now: NOW, tz: TZ).source, .rule)
        XCTAssertEqual(s.studyStatus(now: NOW, tz: TZ).label, "Giờ tự học")
        var shorter = rule
        shorter.end = "21:00"
        XCTAssertEqual(failure(s.setStudyRule(shorter, confirmed: true, now: NOW, tz: TZ)), .studyLocked)
        XCTAssertEqual(failure(s.deleteStudyRule(id: rule.id, confirmed: true, now: NOW, tz: TZ)), .studyLocked)
        var longer = rule
        longer.end = "22:30"
        XCTAssertTrue(isOk(s.setStudyRule(longer, confirmed: false, now: NOW, tz: TZ)))
        XCTAssertTrue(isOk(s.stopStudy(confirmed: true, now: NOW, tz: TZ)))
        XCTAssertEqual(s.studyRules[0].exceptions, ["2026-10-12"])
        XCTAssertFalse(s.studyStatus(now: NOW, tz: TZ).active)
        // Outside study: skipping a later day is free, deleting needs the confirmation.
        var skip = s.studyRules[0]
        skip.exceptions = ["2026-10-12", "2026-10-14"]
        XCTAssertTrue(isOk(s.setStudyRule(skip, confirmed: false, now: NOW, tz: TZ)))
        XCTAssertEqual(failure(s.deleteStudyRule(id: rule.id, confirmed: false, now: NOW, tz: TZ)), .needsConfirm)
        XCTAssertTrue(isOk(s.deleteStudyRule(id: rule.id, confirmed: true, now: NOW, tz: TZ)))
        XCTAssertTrue(s.studyRules.isEmpty)
        XCTAssertTrue(isOk(s.deleteStudyRule(id: "unknown", confirmed: false, now: NOW, tz: TZ)))
    }

    func testRefusesRulesThatCannotBeAWindow() {
        var r = weekdayEvening
        r.days = []
        XCTAssertEqual(failure(s.setStudyRule(r, confirmed: false, now: NOW, tz: TZ)), .invalid)
        r = weekdayEvening
        r.end = "19:30"
        XCTAssertEqual(failure(s.setStudyRule(r, confirmed: false, now: NOW, tz: TZ)), .invalid)
        r = weekdayEvening
        r.start = "25:00"
        XCTAssertEqual(failure(s.setStudyRule(r, confirmed: false, now: NOW, tz: TZ)), .invalid)
    }

    func testStudyHelpers() {
        XCTAssertEqual(formatStudyDays([1, 2, 3, 4, 5]), "T2–T6")
        XCTAssertEqual(formatStudyDays([1, 3, 5]), "T2, T4, T6")
        XCTAssertEqual(formatStudyDays([1, 2, 3, 4, 5, 6, 7]), "Mỗi ngày")
        XCTAssertEqual(shortDate("2026-10-14"), "14/10")
        XCTAssertEqual(parseHm("7:05"), 425)
        XCTAssertNil(parseHm("7:5"))
        XCTAssertNil(parseHm("24:00"))
        XCTAssertEqual(manualStudyMinutes, [25, 50, 90])
    }
}
