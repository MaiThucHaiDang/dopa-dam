import Foundation
import DopaDamCore

/// The one state file (Application Support/DopaDam/state.json) shared by the app and its App Intents, which run
/// in the same process and container. Every read-modify-write goes through `update`, which holds a lock, so the
/// intents and the screens never overwrite each other.
enum StateAccess {
    static let defaultURL: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("DopaDam", isDirectory: true).appendingPathComponent("state.json")
    }()

    private static let lock = NSLock()
    /// Only read and written with `lock` held. Never reassigned outside DEBUG builds.
    private static var store = FileStateStore(url: defaultURL)

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

    #if DEBUG
    /// Tests only: use another state file (a temporary one), or the real one again with nil.
    static func useStateFile(at url: URL?) {
        lock.lock()
        defer { lock.unlock() }
        store = FileStateStore(url: url ?? defaultURL)
    }

    /// Tests only: deletes the state file in use, so the next load is a fresh state.
    static func eraseStateFile() {
        lock.lock()
        defer { lock.unlock() }
        try? FileManager.default.removeItem(at: store.url)
        try? FileManager.default.removeItem(atPath: store.url.path + ".bad")
    }
    #endif
}
