import XCTest
@testable import DopaDamCore

let TZ = 420
let NOW: Int64 = 1_791_810_000_000 // 2026-10-12 20:00 +07:00, a Monday
let MIN: Int64 = 60_000
let HOUR: Int64 = 3_600_000
let DAY: Int64 = 86_400_000

func failure<T>(_ r: Result<T, CoreError>) -> CoreError? {
    if case .failure(let e) = r { return e }
    return nil
}

func isOk<T>(_ r: Result<T, CoreError>) -> Bool {
    if case .success = r { return true }
    return false
}

extension AppState {
    /// Test shorthand: records a warning for YouTube (or `app`) with a fixed id and returns the context.
    @discardableResult
    mutating func warn(_ id: String, _ now: Int64, app: String = "YouTube", file: StaticString = #filePath, line: UInt = #line) -> WarningContext {
        switch recordWarning(app: app, now: now, tz: TZ, id: id) {
        case .success(let c): return c
        case .failure(let e):
            XCTFail("recordWarning failed: \(e)", file: file, line: line)
            fatalError()
        }
    }

    var event0: WarningEvent { events[0] }
}
