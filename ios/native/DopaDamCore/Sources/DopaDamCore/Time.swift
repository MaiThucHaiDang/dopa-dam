import Foundation

/// Time constants in milliseconds. All timestamps in this package are milliseconds since 1970 (`Int64`).
public enum Ms {
    public static let minute: Int64 = 60_000
    public static let hour: Int64 = 3_600_000
    public static let day: Int64 = 86_400_000
}

@inline(__always) func floorDiv(_ a: Int64, _ b: Int64) -> Int64 {
    let q = a / b
    return (a % b != 0 && (a < 0) != (b < 0)) ? q - 1 : q
}

@inline(__always) func floorMod(_ a: Int64, _ b: Int64) -> Int64 {
    a - floorDiv(a, b) * b
}

func pad2(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }

/// Number of timestamps t with now - 1h < t <= now.
public func recentCount(_ timestamps: [Int64], now: Int64) -> Int {
    var count = 0
    for t in timestamps where t > now - Ms.hour && t <= now { count += 1 }
    return count
}

/// Civil date (proleptic Gregorian) of a day number counted from 1970-01-01.
func civilFromDays(_ days: Int64) -> (year: Int64, month: Int, day: Int) {
    let z = days + 719_468
    let era = floorDiv(z, 146_097)
    let doe = z - era * 146_097
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
    let y = yoe + era * 400
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    let mp = (5 * doy + 2) / 153
    let d = Int(doy - (153 * mp + 2) / 5 + 1)
    let m = Int(mp < 10 ? mp + 3 : mp - 9)
    return (m <= 2 ? y + 1 : y, m, d)
}

/// ISO weekday (1 = Monday ... 7 = Sunday) of a day number counted from 1970-01-01 (a Thursday).
func isoWeekday(ofDay days: Int64) -> Int {
    Int(floorMod(days + 3, 7)) + 1
}

/// YYYY-MM-DD of a "local ms" value (epoch ms already shifted by the time-zone offset).
public func formatLocalDate(localMs: Int64) -> String {
    let c = civilFromDays(floorDiv(localMs, Ms.day))
    var year = String(c.year)
    while year.count < 4 { year = "0" + year }
    return "\(year)-\(pad2(c.month))-\(pad2(c.day))"
}

/// The app's day starts at 04:00 local time, so staying up past midnight does not reset the budget.
/// `tzOffsetMinutes` is minutes east of UTC (Vietnam: 420).
public func dayKey(_ t: Int64, tzOffsetMinutes: Int) -> String {
    formatLocalDate(localMs: t + Int64(tzOffsetMinutes) * Ms.minute - 4 * Ms.hour)
}

/// Minutes east of UTC of the device's current time zone at instant `t` (a convenience for the UI layer;
/// the core itself always takes the offset explicitly).
public func currentTzOffsetMinutes(at t: Int64) -> Int {
    TimeZone.current.secondsFromGMT(for: Date(timeIntervalSince1970: Double(t) / 1000)) / 60
}

/// "2026-10-14" -> "14/10".
public func shortDate(_ date: String) -> String {
    let parts = date.split(separator: "-")
    guard parts.count == 3, let m = Int(parts[1]), let d = Int(parts[2]) else { return date }
    return "\(d)/\(m)"
}

/// "m:ss" of a duration, rounded up to whole seconds (the warning's timer).
public func formatClock(ms: Int64) -> String {
    let total = max(0, Int((Double(ms) / 1000).rounded(.up)))
    let s = total % 60
    return "\(total / 60):\(s < 10 ? "0" : "")\(s)"
}

/// "N phút" for a number of minutes.
public func formatMinutes(_ minutes: Int) -> String { "\(minutes) phút" }

/// Whole minutes from `now` until `at`, rounded up, never negative.
public func minutesUntil(_ at: Int64, now: Int64) -> Int {
    max(0, Int((Double(at - now) / 60_000).rounded(.up)))
}
