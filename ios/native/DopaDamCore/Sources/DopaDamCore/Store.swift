import Foundation

/// How the last `load` went.
public enum LoadStatus: Equatable, Sendable {
    case loaded
    /// No file yet: a fresh default state was returned.
    case missing
    /// The file could not be read as a state: it was moved aside to `<name>.bad` and a fresh default state returned.
    case corrupt
}

/// Where the state lives. Implementations are safe to call from several threads. The core never keeps a
/// global instance: the app creates one store and passes it where needed.
public protocol StateStore: AnyObject {
    func load() -> AppState
    func loadWithStatus() -> (state: AppState, status: LoadStatus)
    func save(_ state: AppState) throws
}

extension StateStore {
    public func load() -> AppState { loadWithStatus().state }

    /// Loads, runs `body` on the state, and saves the result. Use it for one operation:
    /// `try store.update { $0.shouldAsk(app: "YouTube", now: now) }`.
    @discardableResult
    public func update<T>(_ body: (inout AppState) -> T) throws -> T {
        var state = load()
        let result = body(&state)
        try save(state)
        return result
    }
}

/// JSON file store. Writes are atomic (a crash never leaves half a file). A missing or corrupt file gives a
/// fresh default state; a corrupt file is kept aside with a `.bad` suffix instead of being overwritten.
public final class FileStateStore: StateStore, @unchecked Sendable {
    public let url: URL
    private let lock = NSLock()

    public init(url: URL) { self.url = url }

    public func loadWithStatus() -> (state: AppState, status: LoadStatus) {
        lock.lock()
        defer { lock.unlock() }
        let fm = FileManager.default
        guard fm.fileExists(atPath: url.path) else { return (AppState(), .missing) }
        if let data = try? Data(contentsOf: url), let state = try? AppState.decode(data) { return (state, .loaded) }
        let bad = URL(fileURLWithPath: url.path + ".bad")
        try? fm.removeItem(at: bad)
        try? fm.moveItem(at: url, to: bad)
        return (AppState(), .corrupt)
    }

    public func save(_ state: AppState) throws {
        lock.lock()
        defer { lock.unlock() }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try state.encoded().write(to: url, options: .atomic)
    }
}

/// Keeps the state in memory (tests, previews). Saving and loading go through JSON like the file store, so a
/// round trip is tested too.
public final class MemoryStateStore: StateStore, @unchecked Sendable {
    private var data: Data?
    private let lock = NSLock()

    public init(_ state: AppState? = nil) { data = try? state?.encoded() }

    public func loadWithStatus() -> (state: AppState, status: LoadStatus) {
        lock.lock()
        defer { lock.unlock() }
        guard let data = data else { return (AppState(), .missing) }
        if let state = try? AppState.decode(data) { return (state, .loaded) }
        self.data = nil
        return (AppState(), .corrupt)
    }

    public func save(_ state: AppState) throws {
        lock.lock()
        defer { lock.unlock() }
        data = try state.encoded()
    }

    /// Test helper: replace the stored bytes with anything.
    public func setRawData(_ raw: Data?) {
        lock.lock()
        data = raw
        lock.unlock()
    }
}
