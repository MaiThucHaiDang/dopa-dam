import XCTest
@testable import DopaDamCore

final class AppLinksTests: XCTestCase {
    func testKnownAppsHaveTheirSchemes() {
        let expected: [String: String] = [
            "YouTube": "youtube://", "TikTok": "snssdk1233://", "Facebook": "fb://", "Instagram": "instagram://",
            "Messenger": "fb-messenger://", "X": "twitter://", "Twitter": "twitter://", "Reddit": "reddit://",
            "Netflix": "nflx://", "Zalo": "zalo://", "Threads": "barcelona://",
        ]
        for (name, url) in expected { XCTAssertEqual(AppLinks.urlString(for: name), url, name) }
    }

    func testSpellingDoesNotMatter() {
        XCTAssertEqual(AppLinks.urlString(for: "  youtube "), "youtube://")
        XCTAssertEqual(AppLinks.urlString(for: "YOUTUBE"), "youtube://")
        XCTAssertEqual(AppLinks.urlString(for: "Tik   Tok"), "snssdk1233://")
    }

    func testUnknownOrEmptyHasNoLink() {
        XCTAssertNil(AppLinks.urlString(for: "Liên Quân"))
        XCTAssertNil(AppLinks.urlString(for: "   "))
        XCTAssertNil(AppLinks.urlString(for: "YouTube Music"))
    }

    func testEveryKnownNameIsInTheTable() {
        for name in AppLinks.knownNames { XCTAssertNotNil(AppLinks.urlString(for: name), name) }
    }
}

final class NotificationTests: XCTestCase {
    func testAllowWindowGivesHeadsUpAndEnd() {
        var s = AppState()
        s.warn("a", NOW - 10_000)
        _ = s.decide(eventId: "a", choice: .enter(minutes: 5), now: NOW, tz: TZ)
        let n = s.allowNotifications(app: "youtube", now: NOW)!
        let specs = allowNotificationSpecs(n)
        XCTAssertEqual(specs.count, 2)
        XCTAssertEqual(specs[0].identifier, "dopadam.allow.headsup.youtube")
        XCTAssertEqual(specs[0].title, "Còn 1 phút")
        XCTAssertEqual(specs[0].fireAt, NOW + 4 * MIN)
        XCTAssertEqual(specs[1].identifier, "dopadam.allow.end.youtube")
        XCTAssertEqual(specs[1].title, "Hết thời gian")
        XCTAssertEqual(specs[1].fireAt, NOW + 5 * MIN)
        XCTAssertEqual(specs[1].body, Wording.allowEndedBody(app: "YouTube"))
        XCTAssertEqual(NotificationIds.allow(app: "YouTube"), [specs[0].identifier, specs[1].identifier])
    }

    func testShortWindowHasNoHeadsUp() {
        let n = AllowNotifications(app: "YouTube", headsUpAt: nil, endsAt: NOW + 30_000)
        let specs = allowNotificationSpecs(n)
        XCTAssertEqual(specs.map { $0.identifier }, ["dopadam.allow.end.youtube"])
    }

    func testActivityNotification() {
        var s = AppState()
        s.warn("a", NOW - 10_000)
        _ = s.decide(eventId: "a", choice: .alternative(activity: "Hít đất", minutes: 3), now: NOW, tz: TZ)
        let spec = activityNotificationSpec(event: s.events[0])!
        XCTAssertEqual(spec.identifier, "dopadam.activity.a")
        XCTAssertEqual(spec.title, "Xong 3 phút hít đất")
        XCTAssertEqual(spec.body, "Quay lại việc đang làm nhé.")
        XCTAssertEqual(spec.fireAt, NOW + 3 * MIN)
        XCTAssertNil(activityNotificationSpec(event: WarningEvent(id: "x", app: "A", level: 0, lockSeconds: 0, risk: false, n: 0, shownAt: NOW)))
    }

    func testDelayIsAtLeastOneSecond() {
        let spec = NotificationSpec(identifier: "i", title: "t", body: "b", fireAt: NOW + 90_000)
        XCTAssertEqual(spec.delaySeconds(now: NOW), 90)
        XCTAssertEqual(spec.delaySeconds(now: NOW + 100_000), 1)
    }

    func testPermissionText() {
        XCTAssertEqual(NotificationPermission.granted.text, "Thông báo đã bật.")
        XCTAssertNotEqual(NotificationPermission.denied.text, NotificationPermission.notAsked.text)
    }
}

final class WarningFlowTests: XCTestCase {
    var s = AppState()
    override func setUp() { s = AppState() }

    func flow(_ id: String = "a", at t: Int64 = NOW) -> WarningFlow { WarningFlow(context: s.warn(id, t)) }

    func testStartsOnTheQuestionWithTheCountdown() {
        let f = flow()
        XCTAssertEqual(f.phase, .question)
        XCTAssertTrue(f.isUndecided)
        XCTAssertEqual(f.enterButtonTitle(now: NOW + 1000), "Vào (4)")
        XCTAssertFalse(f.canEnter(now: NOW + 1000))
        XCTAssertTrue(f.canEnter(now: NOW + 5000))
        XCTAssertEqual(f.enterButtonTitle(now: NOW + 5000), "Vào")
    }

    func testEnterIsRefusedWhileLockedAndOpensTheMinutesWhenFree() {
        var f = flow()
        XCTAssertFalse(f.showMinutes(now: NOW + 2000))
        XCTAssertEqual(f.phase, .question)
        XCTAssertTrue(f.showMinutes(now: NOW + 5000))
        XCTAssertEqual(f.phase, .chooseMinutes)
        XCTAssertFalse(f.canEnter(now: NOW + 9000))
        f.back()
        XCTAssertEqual(f.phase, .question)
    }

    func testActivityFormClampsAndValidates() {
        var f = flow()
        f.showActivities()
        XCTAssertEqual(f.phase, .chooseActivity)
        XCTAssertEqual(f.activity, "Nhảy dây")
        XCTAssertEqual(f.activityMinutes, 5)
        f.select(activity: "Đọc sách")
        f.select(activity: "Không có")
        XCTAssertEqual(f.activity, "Đọc sách")
        f.setActivityMinutes(1)
        XCTAssertEqual(f.activityMinutes, 2)
        f.setActivityMinutes(99)
        XCTAssertEqual(f.activityMinutes, 10)
        f.setActivityMinutes(7)
        XCTAssertEqual(f.activityMinutesText, "Trong 7 phút")
        XCTAssertEqual(f.activityChoice, .alternative(activity: "Đọc sách", minutes: 7))
        XCTAssertTrue(isOk(s.decide(eventId: "a", choice: f.activityChoice, now: NOW + 3000, tz: TZ)))
    }

    func testBackFromQuestionDoesNothing() {
        var f = flow()
        f.back()
        XCTAssertEqual(f.phase, .question)
    }

    func testEnterDecisionMovesToAllowed() {
        var f = flow()
        _ = f.showMinutes(now: NOW + 6000)
        XCTAssertTrue(isOk(s.decide(eventId: "a", choice: .enter(minutes: 15), now: NOW + 6000, tz: TZ)))
        f.apply(context: s.warningContext(eventId: "a", now: NOW + 6000, tz: TZ)!)
        XCTAssertEqual(f.phase, .allowed(minutes: 15, endsAt: NOW + 6000 + 15 * MIN))
        XCTAssertEqual(f.allowedLine, "Đã cho vào 15 phút. Mở lại YouTube.")
        XCTAssertFalse(f.isUndecided)
    }

    func testExitDecisionMovesToExited() {
        var f = flow()
        _ = s.decide(eventId: "a", choice: .exit, now: NOW + 1000, tz: TZ)
        f.apply(context: s.warningContext(eventId: "a", now: NOW + 1000, tz: TZ)!)
        XCTAssertEqual(f.phase, .exited)
        XCTAssertNil(f.allowedLine)
    }

    func testActivityTimer() {
        var f = flow()
        f.showActivities()
        f.setActivityMinutes(3)
        _ = s.decide(eventId: "a", choice: f.activityChoice, now: NOW + 1000, tz: TZ)
        f.apply(context: s.warningContext(eventId: "a", now: NOW + 1000, tz: TZ)!)
        XCTAssertEqual(f.phase, .activity(name: "Nhảy dây", minutes: 3, endsAt: NOW + 1000 + 3 * MIN))
        XCTAssertEqual(f.activityClock(now: NOW + 1000), "3:00")
        XCTAssertEqual(f.activityClock(now: NOW + 1000 + 90_500), "1:30")
        XCTAssertFalse(f.activityFinished(now: NOW + 1000 + 3 * MIN - 1))
        XCTAssertTrue(f.activityFinished(now: NOW + 1000 + 3 * MIN))
        XCTAssertEqual(f.activityClock(now: NOW + 10 * MIN), "0:00")
    }

    func testResumedDecidedWarningStartsInItsResultPhase() {
        s.warn("a", NOW)
        _ = s.decide(eventId: "a", choice: .exit, now: NOW + 100, tz: TZ)
        XCTAssertEqual(WarningFlow(context: s.warningContext(eventId: "a", now: NOW + 200, tz: TZ)!).phase, .exited)
    }
}

final class ResumeTests: XCTestCase {
    func testResumesOnlyTheNewestYoungWarningAndClosesTheRest() {
        var s = AppState()
        s.warn("old", NOW)
        s.warn("mid", NOW + 5 * MIN)
        s.warn("new", NOW + 6 * MIN)
        let ctx = s.resumeWarning(now: NOW + 8 * MIN, tz: TZ)
        XCTAssertEqual(ctx?.eventId, "new")
        XCTAssertEqual(s.events.first { $0.id == "old" }?.decision, .exit)
        XCTAssertEqual(s.events.first { $0.id == "mid" }?.decision, .exit)
        XCTAssertNil(s.events.first { $0.id == "new" }?.decision)
    }

    func testAnOldWarningIsClosedNotResumed() {
        var s = AppState()
        s.warn("a", NOW)
        XCTAssertNil(s.resumeWarning(now: NOW + 11 * MIN, tz: TZ))
        XCTAssertEqual(s.events[0].decision, .exit)
        XCTAssertNil(s.resumeWarning(now: NOW + 12 * MIN, tz: TZ))
    }

    func testNothingPending() {
        var s = AppState()
        XCTAssertNil(s.resumeWarning(now: NOW, tz: TZ))
        s.warn("a", NOW)
        _ = s.decide(eventId: "a", choice: .exit, now: NOW + 1000, tz: TZ)
        XCTAssertNil(s.resumeWarning(now: NOW + 2000, tz: TZ))
    }
}

final class StateChangeTests: XCTestCase {
    func testWeakeningSettingsNeedsConfirmThenSucceeds() {
        var s = AppState()
        var weaker = Settings()
        weaker.lockSeconds = [1, 10, 20, 30]
        XCTAssertEqual(failure(s.apply(.settings(weaker), confirmed: false, now: NOW, tz: TZ)), .needsConfirm)
        XCTAssertEqual(s.settings.lockSeconds[0], 5)
        XCTAssertTrue(isOk(s.apply(.settings(weaker), confirmed: true, now: NOW, tz: TZ)))
        XCTAssertEqual(s.settings.lockSeconds[0], 1)
    }

    func testStrengtheningNeedsNoConfirm() {
        var s = AppState()
        var stronger = Settings()
        stronger.lockSeconds = [10, 20, 30, 60]
        XCTAssertTrue(isOk(s.apply(.settings(stronger), confirmed: false, now: NOW, tz: TZ)))
    }

    func testStudyIsLockedEvenWhenConfirmed() {
        var s = AppState()
        _ = s.startStudy(minutes: 25, label: "Ôn thi", now: NOW)
        var weaker = Settings()
        weaker.budgetMinutes = 0
        XCTAssertEqual(failure(s.apply(.settings(weaker), confirmed: true, now: NOW, tz: TZ)), .studyLocked)
        XCTAssertEqual(failure(s.apply(.clearLog, confirmed: true, now: NOW, tz: TZ)), .studyLocked)
        XCTAssertEqual(failure(s.apply(.stopStudy, confirmed: false, now: NOW, tz: TZ)), .needsConfirm)
        XCTAssertTrue(isOk(s.apply(.stopStudy, confirmed: true, now: NOW, tz: TZ)))
        XCTAssertFalse(s.studyStatus(now: NOW, tz: TZ).active)
    }

    func testStudyRuleAddAndDelete() {
        var s = AppState()
        let rule = StudyRuleForm(days: [3, 5], startMinutes: 20 * 60, endMinutes: 21 * 60, label: "Toán").rule()
        XCTAssertTrue(isOk(s.apply(.studyRule(rule), confirmed: false, now: NOW, tz: TZ)))
        XCTAssertEqual(s.studyRules.count, 1)
        XCTAssertEqual(s.studyRules[0].days, [3, 5])
        let id = s.studyRules[0].id
        XCTAssertFalse(id.isEmpty)
        XCTAssertEqual(failure(s.apply(.deleteStudyRule(id: id), confirmed: false, now: NOW, tz: TZ)), .needsConfirm)
        XCTAssertTrue(isOk(s.apply(.deleteStudyRule(id: id), confirmed: true, now: NOW, tz: TZ)))
        XCTAssertTrue(s.studyRules.isEmpty)
        XCTAssertEqual(failure(s.apply(.studyRule(StudyRule(id: "", days: [], start: "20:00", end: "21:00")), confirmed: false, now: NOW, tz: TZ)), .invalid)
    }

    func testRiskWindowAddThenRemoveNeedsConfirm() {
        var s = AppState()
        let w = RiskWindow(id: "", days: [1, 2, 3, 4, 5], start: "22:00", end: "00:00")
        XCTAssertTrue(isOk(s.apply(.addRiskWindow(w), confirmed: false, now: NOW, tz: TZ)))
        XCTAssertEqual(s.riskWindows.count, 1)
        let id = s.riskWindows[0].id
        XCTAssertFalse(id.isEmpty)
        XCTAssertEqual(failure(s.apply(.removeRiskWindow(id: id), confirmed: false, now: NOW, tz: TZ)), .needsConfirm)
        XCTAssertTrue(isOk(s.apply(.removeRiskWindow(id: id), confirmed: true, now: NOW, tz: TZ)))
        XCTAssertTrue(s.riskWindows.isEmpty)
    }

    func testClearLogNeedsConfirm() {
        var s = AppState()
        s.warn("a", NOW)
        XCTAssertEqual(failure(s.apply(.clearLog, confirmed: false, now: NOW, tz: TZ)), .needsConfirm)
        XCTAssertEqual(s.events.count, 1)
        XCTAssertTrue(isOk(s.apply(.clearLog, confirmed: true, now: NOW, tz: TZ)))
        XCTAssertTrue(s.events.isEmpty)
    }
}

final class ConfirmGateTests: XCTestCase {
    func testWaitsSixtySecondsThenNeedsThePhrase() {
        let g = ConfirmGate(startedAt: NOW)
        XCTAssertEqual(g.secondsLeft(now: NOW), 60)
        XCTAssertEqual(g.secondsLeft(now: NOW + 59_001), 1)
        XCTAssertEqual(g.secondsLeft(now: NOW + 60_000), 0)
        XCTAssertEqual(g.secondsLeft(now: NOW + 99_000), 0)
        XCTAssertFalse(g.canType(now: NOW + 59_999))
        XCTAssertTrue(g.canType(now: NOW + 60_000))
        XCTAssertFalse(g.canConfirm(input: confirmPhrase, now: NOW + 30_000))
        XCTAssertFalse(g.canConfirm(input: "tôi chọn", now: NOW + 61_000))
        XCTAssertTrue(g.canConfirm(input: "  Tôi chọn  giảm bảo vệ ", now: NOW + 61_000))
        XCTAssertEqual(g.countdownText(now: NOW + 50_000), "Chờ 10 giây rồi mới gõ được câu xác nhận.")
        XCTAssertEqual(g.countdownText(now: NOW + 61_000), "Bây giờ có thể gõ câu xác nhận.")
        XCTAssertEqual(ConfirmGate.hint, "Gõ chính xác: tôi chọn giảm bảo vệ")
    }
}

final class FormTests: XCTestCase {
    func testListParsing() {
        XCTAssertEqual(parseIntList("5, 15 30;45"), [5, 15, 30, 45])
        XCTAssertEqual(parseIntList(""), [])
        XCTAssertNil(parseIntList("5, abc"))
        XCTAssertNil(parseIntList("5.5"))
        XCTAssertEqual(formatIntList([5, 15, 30]), "5, 15, 30")
    }

    func testFormRoundTripsTheDefaults() {
        let form = SettingsForm(settings: Settings())
        XCTAssertEqual(form.lockSeconds, ["5", "10", "20", "30"])
        XCTAssertEqual(form.allowNormal, "5, 15, 30")
        XCTAssertEqual(form.allowRestricted, "5, 10")
        XCTAssertEqual(form.budget, "90")
        XCTAssertEqual(try? form.settings().get(), Settings())
    }

    func testFormValidation() {
        var f = SettingsForm(settings: Settings())
        f.lockSeconds[2] = "301"
        XCTAssertEqual(f.settings().failureValue, .lockSeconds(level: 2))
        f.lockSeconds[2] = "abc"
        XCTAssertEqual(f.settings().failureValue, .lockSeconds(level: 2))
        f.lockSeconds[2] = " 25 "
        XCTAssertEqual(try? f.settings().get().lockSeconds, [5, 10, 25, 30])
        f.allowNormal = "5, 10, 15, 20, 25"
        XCTAssertEqual(f.settings().failureValue, .normalOptions)
        f.allowNormal = ""
        XCTAssertEqual(f.settings().failureValue, .normalOptions)
        f.allowNormal = "121"
        XCTAssertEqual(f.settings().failureValue, .normalOptions)
        f.allowNormal = "30, 5, 5, 15"
        XCTAssertEqual(try? f.settings().get().allowOptionsNormal, [5, 15, 30])
        f.allowRestricted = "11"
        XCTAssertEqual(f.settings().failureValue, .restrictedOptions)
        f.allowRestricted = "10"
        f.budget = "-1"
        XCTAssertEqual(f.settings().failureValue, .budget)
        f.budget = "1441"
        XCTAssertEqual(f.settings().failureValue, .budget)
        f.budget = "0"
        XCTAssertEqual(try? f.settings().get().budgetMinutes, 0)
        XCTAssertTrue(SettingsFormError.budget.message.contains("1440"))
        XCTAssertEqual(try? f.settings().get().isValid, true)
    }

    func testStudyRuleForm() {
        var f = StudyRuleForm()
        XCTAssertNil(f.problem)
        XCTAssertEqual(f.rule().days, [1, 2, 3, 4, 5])
        XCTAssertEqual(f.rule().start, "20:00")
        XCTAssertEqual(f.rule().end, "22:00")
        f.startHour = 7
        f.startMinute = 30
        XCTAssertEqual(f.startMinutes, 7 * 60 + 30)
        f.endHour = 99
        XCTAssertEqual(f.endHour, 23)
        f.toggle(day: 6)
        XCTAssertEqual(f.days, [1, 2, 3, 4, 5, 6])
        f.toggle(day: 1)
        f.toggle(day: 9)
        XCTAssertEqual(f.days, [2, 3, 4, 5, 6])
        f.days = []
        XCTAssertEqual(f.problem, "Chọn ít nhất một ngày.")
        f.days = [1]
        f.endMinutes = f.startMinutes
        XCTAssertNotNil(f.problem)
        f.label = "Ôn thi"
        f.endMinutes = 8 * 60
        XCTAssertEqual(studyRuleLine(f.rule()), "T2 · 07:30–08:00 · Ôn thi")
        XCTAssertEqual(studyRuleLine(StudyRule(id: "x", days: [1, 2, 3, 4, 5], start: "22:00", end: "00:00")), "T2–T6 · 22:00–24:00")
    }
}

extension Result {
    var failureValue: Failure? {
        if case .failure(let e) = self { return e }
        return nil
    }
}

final class OverviewTests: XCTestCase {
    func testStudyPanel() {
        var s = AppState()
        XCTAssertEqual(s.studyPanel(now: NOW, tz: TZ).statusLine, "Chưa trong phiên học.")
        XCTAssertFalse(s.studyPanel(now: NOW, tz: TZ).canStop)
        XCTAssertEqual(s.studyPanel(now: NOW, tz: TZ).manualMinutes, [25, 50, 90])
        _ = s.startStudy(minutes: 50, label: "Ôn thi", now: NOW)
        let p = s.studyPanel(now: NOW + 10 * MIN, tz: TZ)
        XCTAssertTrue(p.active)
        XCTAssertTrue(p.canStop)
        XCTAssertEqual(p.statusLine, "Đang học: Ôn thi · còn 40 phút")
        _ = s.apply(.studyRule(StudyRule(id: "", days: [2, 3], start: "20:00", end: "21:30", label: "Toán")), confirmed: false, now: NOW, tz: TZ)
        XCTAssertEqual(s.studyPanel(now: NOW, tz: TZ).rules[0].line, "T3, T4 · 20:00–21:30 · Toán")
    }

    func testTodayItemsAndAppLines() {
        var s = AppState()
        s.warn("a", NOW, app: "YouTube")
        _ = s.decide(eventId: "a", choice: .exit, now: NOW + 1000, tz: TZ)
        s.warn("b", NOW + MIN, app: "youtube")
        let today = s.todaySummary(now: NOW + 2 * MIN, tz: TZ)
        let items = todayStatItems(today)
        XCTAssertEqual(items.map { $0.label }, ["Lần hỏi", "Thoát", "Vào", "Làm việc khác"])
        XCTAssertEqual(items.map { $0.value }, ["2", "1", "0", "0"])
        XCTAssertEqual(exitShareLine(today), "Tỉ lệ Thoát: 100%")
        let apps = s.appsSeen()
        XCTAssertEqual(apps.count, 1)
        XCTAssertEqual(appUsageLine(apps[0]), "2 lần · Thoát 1 · Vào 0 · Việc khác 0")
    }

    func testChartMax() {
        XCTAssertEqual(chartMax([]), 1)
        var s = AppState()
        XCTAssertEqual(chartMax(s.dayStats(days: 14, now: NOW, tz: TZ)), 1)
        s.warn("a", NOW)
        s.warn("b", NOW + 1000)
        s.warn("c", NOW + 2000)
        let stats = s.dayStats(days: 14, now: NOW + 3000, tz: TZ)
        XCTAssertEqual(stats.count, 14)
        XCTAssertEqual(chartMax(stats), 3)
    }

    func testGuideMentionsBothActionsAndEveryKnownAppHasALink() {
        let all = Guide.steps.map { $0.body }.joined(separator: "\n")
        XCTAssertTrue(all.contains(IntentTitles.shouldAsk))
        XCTAssertTrue(all.contains(IntentTitles.showWarning))
        XCTAssertEqual(Guide.steps.map { $0.id }, Array(1...Guide.steps.count))
        XCTAssertTrue(Guide.knownAppsLine.contains("YouTube"))
    }
}
