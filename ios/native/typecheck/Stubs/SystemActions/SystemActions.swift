import Foundation

/// Stand-in for Support/SystemActions.swift, which uses `#selector` (Objective-C runtime, absent on Linux).
/// Keep the two static functions identical to the real file; the real file is checked separately by run.sh with
/// the selector expression replaced.
enum SystemActions {
    @MainActor
    static func goHome() {}

    @MainActor
    static func open(urlString: String) {}
}
