import Foundation
import DopaDamCore

/// The one state file (Application Support/DopaDam/state.json) shared by the app and its App Intents, which run
/// in the same process and container. Every read-modify-write goes through `update`, which holds a lock, so the
/// intents and the screens never overwrite each other.
enum StateAccess {
    static let url: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("DopaDam", isDirectory: true).appendingPathComponent("state.json")
    }()

    static let store = FileStateStore(url: url)

    private static let lock = NSLock()

    /// Loads the state, runs `body` on it and saves. Nil when the file could not be written.
    static func update<T>(_ body: (inout AppState) -> T) -> T? {
        lock.lock()
        defer { lock.unlock() }
        return try? store.update(body)
    }

    static func load() -> AppState {
        lock.lock()
        defer { lock.unlock() }
        return store.load()
    }
}
