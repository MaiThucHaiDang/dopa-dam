#if DEBUG
import Foundation
import DopaDamCore

/// Launch arguments for the UI tests and for looking at the app by hand on the simulator. This whole file exists
/// only in Debug builds; the Release build (the .ipa) has no trace of it (CI checks the binary).
///
///   -dopadam-reset            start from an empty state file
///   -dopadam-seed stats       fill the history through the core's own operations (see `seedHistory`)
///   -dopadam-warn <App>       show the warning for <App>, exactly as the "mở màn hình hỏi" action does
///
/// The three run in that order, before the first screen is made.
enum DebugLaunch {
    private static func value(of name: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
        return arguments[index + 1]
    }

    @MainActor
    static func run() {
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-dopadam-reset") {
            StateAccess.eraseStateFile()
        }
        if let scenario = value(of: "-dopadam-seed") {
            switch scenario {
            case "stats": seedHistory()
            default: break
            }
        }
        if let app = value(of: "-dopadam-warn") {
            AppModel.shared.presentWarning(app: app)
        }
    }

    /// Four weeks of warnings, made with `recordWarning` and `decide` at times in the past:
    /// - every weekday evening 22:05, 22:35 and 23:10: Thoát, Vào 5 phút, Làm việc khác (a clear risk block);
    /// - every weekday 08:00: Thoát; every weekend day 14:00: Vào 5 phút;
    /// - today, an hour and a half and two hours ago: Thoát and Vào.
    /// The newest event is far enough back (over 60 minutes) that the next warning is still the first of its hour.
    @MainActor
    private static func seedHistory() {
        let now = nowMs()
        let tz = deviceTzOffset(at: now)
        let day = Int64(24 * 60 * 60 * 1000)
        let localNow = now + Int64(tz) * 60_000
        let todayStart = (localNow / day) * day - Int64(tz) * 60_000
        var plan: [(at: Int64, choice: Choice)] = []
        for back in stride(from: 27, through: 1, by: -1) {
            let start = todayStart - Int64(back) * day
            let weekday = isoWeekday(of: start, tz: tz)
            func at(_ hour: Int, _ minute: Int) -> Int64 { start + Int64(hour * 60 + minute) * 60_000 }
            if weekday <= 5 {
                plan.append((at(8, 0), .exit))
                plan.append((at(22, 5), .exit))
                plan.append((at(22, 35), .enter(minutes: 5)))
                plan.append((at(23, 10), .alternative(activity: "Hít đất", minutes: 5)))
            } else {
                plan.append((at(14, 0), .enter(minutes: 5)))
            }
        }
        plan.append((now - 120 * 60_000, .exit))
        plan.append((now - 90 * 60_000, .enter(minutes: 5)))
        plan.sort { $0.at < $1.at }
        let apps = ["YouTube", "TikTok", "Facebook"]
        _ = StateAccess.update { (state: inout AppState) -> Void in
            for (index, step) in plan.enumerated() {
                let app = apps[index % apps.count]
                guard case .success(let context) = state.recordWarning(app: app, now: step.at, tz: tz) else { continue }
                // A minute after the warning: past every lock time, so "Vào" is allowed.
                _ = state.decide(eventId: context.eventId, choice: step.choice, now: step.at + 60_000, tz: tz)
            }
            // The allow windows the seed opened are long over; drop them so the real first warning stays level 0.
            state.allowWindows.removeAll()
        }
    }

    /// 1 = Monday ... 7 = Sunday, for the local day that starts at `start` (UTC milliseconds).
    private static func isoWeekday(of start: Int64, tz: Int) -> Int {
        let localDays = (start + Int64(tz) * 60_000) / (24 * 60 * 60 * 1000)
        // Day 0 (1970-01-01) was a Thursday (ISO 4).
        return Int((localDays + 3) % 7) + 1
    }
}
#endif
