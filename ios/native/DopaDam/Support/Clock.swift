import Foundation
import DopaDamCore

/// The only places the app reads the clock; the core always takes the time as an argument.
func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

func nowMs(of date: Date) -> Int64 { Int64(date.timeIntervalSince1970 * 1000) }

func deviceTzOffset(at now: Int64) -> Int { currentTzOffsetMinutes(at: now) }
