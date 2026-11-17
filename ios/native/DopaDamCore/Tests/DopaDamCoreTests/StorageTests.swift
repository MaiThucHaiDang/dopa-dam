import XCTest
@testable import DopaDamCore

final class DecodingTests: XCTestCase {
    private func decode(_ json: String) throws -> AppState { try AppState.decode(Data(json.utf8)) }

    func testRoundTripKeepsEverything() throws {
        var s = AppState()
        s.warn("a", NOW)
        _ = s.decide(eventId: "a", choice: .enter(minutes: 5), now: NOW + 6000, tz: TZ)
        _ = s.startStudy(minutes: 25, label: "Ôn", now: NOW)
        _ = s.setStudyRule(StudyRule(id: "r", days: [1, 2], start: "08:00", end: "09:00", label: nil), confirmed: false, now: NOW, tz: TZ)
        _ = s.setRiskWindows([RiskWindow(id: "w", days: [1], start: "10:00", end: "11:00")], confirmed: false, now: NOW, tz: TZ)
        s.settings.budgetMinutes = 45
        XCTAssertEqual(try AppState.decode(s.encoded()), s)
    }

    func testEmptyObjectIsTheDefaultState() throws {
        XCTAssertEqual(try decode("{}"), AppState())
        XCTAssertEqual(try decode("{}").schema, 1)
    }

    func testNotAnObjectThrows() {
        XCTAssertThrowsError(try decode("[1,2]"))
        XCTAssertThrowsError(try decode("nonsense"))
        XCTAssertThrowsError(try decode(""))
    }

    func testFillsDefaultsAndDropsMalformedParts() throws {
        let s = try decode("""
        {
          "settings": { "lockSeconds": [1, 2], "allowOptionsNormal": [10, 20], "allowOptionsRestricted": [], "budgetMinutes": "lots" },
          "riskWindows": [
            { "id": "a", "days": [5, 1, 1, 9], "start": "7:05", "end": "9:00" },
            { "id": "b", "days": [], "start": "07:00", "end": "08:00" },
            { "id": "c", "days": [1], "start": "07:00", "end": "07:00" },
            null,
            { "id": "d", "days": [2], "start": 7 }
          ],
          "events": [
            { "id": "e1", "app": "YouTube", "shownAt": 1791810000000, "level": 2, "lockSeconds": 20, "n": 3, "decision": "enter", "decidedAt": 1791810006000, "allowMinutes": 15, "extra": true },
            { "id": "e2", "app": "TikTok", "shownAt": 1791810000001, "level": 9, "decision": "teleport", "n": "x" },
            { "app": "NoId", "shownAt": 1 },
            { "id": "e3", "app": "Bad" },
            "junk"
          ],
          "allowWindows": [ { "app": "YouTube", "expiresAt": 5 }, { "app": 3 } ],
          "manualStudy": [ { "id": "m", "start": 1, "end": 2, "label": null }, { "id": "bad" } ],
          "studyRules": [ { "id": "r", "days": [1], "start": "08:00", "end": "09:00" }, { "id": "r2", "days": [], "start": "08:00", "end": "09:00" } ],
          "grantedMinutes": { "2026-10-12": 30, "yesterday": 5, "2026-10-11": -1 },
          "somethingNew": [1, 2, 3]
        }
        """)
        XCTAssertEqual(s.settings.lockSeconds, [5, 10, 20, 30])
        XCTAssertEqual(s.settings.allowOptionsNormal, [10, 20])
        XCTAssertEqual(s.settings.allowOptionsRestricted, [5, 10])
        XCTAssertEqual(s.settings.budgetMinutes, 90)
        XCTAssertEqual(s.riskWindows, [RiskWindow(id: "a", days: [1, 5], start: "07:05", end: "09:00")])
        XCTAssertEqual(s.events.map { $0.id }, ["e1", "e2"])
        XCTAssertEqual(s.events[0].decision, .enter)
        XCTAssertEqual(s.events[0].allowMinutes, 15)
        XCTAssertEqual(s.events[1].level, 0)
        XCTAssertNil(s.events[1].decision)
        XCTAssertEqual(s.events[1].n, 0)
        XCTAssertEqual(s.allowWindows, [AllowWindow(app: "YouTube", expiresAt: 5)])
        XCTAssertEqual(s.manualStudy, [Session(id: "m", start: 1, end: 2, label: nil)])
        XCTAssertEqual(s.studyRules.map { $0.id }, ["r"])
        XCTAssertEqual(s.grantedMinutes, ["2026-10-12": 30])
    }

    func testWrongTypesForWholeSectionsGiveDefaults() throws {
        let s = try decode(#"{"settings": 5, "riskWindows": "nope", "events": {"a": 1}, "allowWindows": 3, "manualStudy": null, "grantedMinutes": [1]}"#)
        XCTAssertEqual(s, AppState())
    }

    func testAtMost12RiskWindowsAreKept() throws {
        let one = #"{"id":"w","days":[1],"start":"07:05","end":"08:00"}"#
        let json = "{\"riskWindows\":[" + Array(repeating: one, count: 15).joined(separator: ",") + "]}"
        XCTAssertEqual(try decode(json).riskWindows.count, maxRiskWindows)
    }
}

final class StoreTests: XCTestCase {
    var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("dopadam-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func testMissingFileGivesAFreshStateAndSavingCreatesFoldersAndRoundTrips() throws {
        let url = dir.appendingPathComponent("a/b/state.json")
        let store = FileStateStore(url: url)
        let first = store.loadWithStatus()
        XCTAssertEqual(first.status, .missing)
        XCTAssertEqual(first.state, AppState())
        var s = AppState()
        s.warn("a", NOW)
        s.settings.budgetMinutes = 30
        try store.save(s)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        let again = FileStateStore(url: url).loadWithStatus()
        XCTAssertEqual(again.status, .loaded)
        XCTAssertEqual(again.state, s)
        // No temporary files are left behind by the atomic write.
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: url.deletingLastPathComponent().path), ["state.json"])
    }

    func testCorruptFileIsKeptAsideAndAFreshStateReturned() throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("state.json")
        try Data("{ not json".utf8).write(to: url)
        let store = FileStateStore(url: url)
        let r = store.loadWithStatus()
        XCTAssertEqual(r.status, .corrupt)
        XCTAssertEqual(r.state, AppState())
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
        XCTAssertEqual(try String(contentsOf: URL(fileURLWithPath: url.path + ".bad"), encoding: .utf8), "{ not json")
        XCTAssertEqual(store.loadWithStatus().status, .missing)
        // A second corrupt file replaces the first .bad.
        try Data("[]".utf8).write(to: url)
        XCTAssertEqual(store.loadWithStatus().status, .corrupt)
        XCTAssertEqual(try String(contentsOf: URL(fileURLWithPath: url.path + ".bad"), encoding: .utf8), "[]")
    }

    func testUpdateLoadsAppliesAndSaves() throws {
        let store = FileStateStore(url: dir.appendingPathComponent("state.json"))
        let context = try store.update { state -> WarningContext in
            try! state.recordWarning(app: "YouTube", now: NOW, tz: TZ, id: "a").get()
        }
        XCTAssertEqual(context.eventId, "a")
        let asked = try store.update { $0.shouldAsk(app: "YouTube", now: NOW) }
        XCTAssertTrue(asked)
        try store.update { _ = $0.decide(eventId: "a", choice: .enter(minutes: 5), now: NOW + 6000, tz: TZ) }
        XCTAssertFalse(try store.update { $0.shouldAsk(app: "YouTube", now: NOW + 7000) })
        XCTAssertEqual(store.load().events.count, 1)
    }

    func testMemoryStoreRoundTripsThroughJSON() throws {
        let store = MemoryStateStore()
        XCTAssertEqual(store.loadWithStatus().status, .missing)
        var s = AppState()
        s.warn("a", NOW)
        try store.save(s)
        XCTAssertEqual(store.loadWithStatus().status, .loaded)
        XCTAssertEqual(store.load(), s)
        store.setRawData(Data("garbage".utf8))
        XCTAssertEqual(store.loadWithStatus().status, .corrupt)
        XCTAssertEqual(store.loadWithStatus().status, .missing)
        XCTAssertEqual(MemoryStateStore(s).load(), s)
    }

    func testTimeHelpers() {
        XCTAssertEqual(formatLocalDate(localMs: 0), "1970-01-01")
        XCTAssertEqual(formatLocalDate(localMs: -1), "1969-12-31")
        XCTAssertEqual(formatLocalDate(localMs: 951_782_400_000), "2000-02-29")
        XCTAssertEqual(isoWeekday(ofDay: 0), 4) // Thursday
        XCTAssertEqual(isoWeekday(ofDay: -1), 3)
        XCTAssertEqual(isoWeekday(ofDay: floorDiv(NOW + 7 * HOUR, DAY)), 1) // Monday
        let offset = currentTzOffsetMinutes(at: NOW)
        XCTAssertTrue((-12 * 60...14 * 60).contains(offset))
    }
}
