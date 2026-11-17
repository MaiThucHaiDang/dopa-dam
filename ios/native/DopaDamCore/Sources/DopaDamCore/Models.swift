import Foundation

/// Why an operation was refused. `message` is the sentence the other clients show for the same code.
public enum CoreError: Error, Equatable, Sendable {
    /// The change weakens protection: ask for the confirmation (60 s wait + typed phrase), then call again with `confirmed: true`.
    case needsConfirm
    /// A study session is running, so this change is locked (even when confirmed).
    case studyLocked
    /// A value is out of range or malformed.
    case invalid
    /// "Vào" is still locked by the countdown.
    case locked
    /// No warning with that id.
    case notFound
    /// The warning already has a different decision.
    case alreadyDecided

    public var message: String {
        switch self {
        case .needsConfirm: return Wording.errorNeedsConfirm
        case .studyLocked: return Wording.errorStudyLocked
        case .invalid: return Wording.errorInvalid
        case .locked: return Wording.errorLocked
        case .notFound: return Wording.errorNotFound
        case .alreadyDecided: return Wording.errorAlreadyDecided
        }
    }
}

public enum Decision: String, Codable, Equatable, Sendable { case enter, exit, alternative }

/// The three activities offered by "Làm việc khác", and their allowed length in minutes (as on the other clients).
public let activityNames = ["Nhảy dây", "Hít đất", "Đọc sách"]
public let activityMinutesRange = 2...10
public let activityDefaultMinutes = 5

/// App names are what the user typed in the Shortcuts automation. Two spellings that differ only in case,
/// accents composition or spacing are the same app.
public enum AppName {
    public static let maxLength = 100

    /// The name to display: trimmed, runs of white space collapsed to one space, cut to `maxLength` code points.
    /// Nil when nothing is left.
    public static func clean(_ raw: String) -> String? {
        let words = raw.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
        var view = String.UnicodeScalarView()
        view.append(contentsOf: words.unicodeScalars.prefix(maxLength))
        let name = String(view)
        return name.isEmpty ? nil : name
    }

    /// The key two spellings of one app share; nil for an empty name.
    public static func key(_ raw: String) -> String? {
        clean(raw)?.precomposedStringWithCanonicalMapping.lowercased()
    }
}

/// One warning shown to the user, and what they decided.
public struct WarningEvent: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    /// The app name as typed in the automation (trimmed).
    public var app: String
    public var level: Int
    public var lockSeconds: Int
    /// The level was raised by one because the warning came inside a risk window.
    public var risk: Bool
    /// Warnings shown in the previous hour, not counting this one.
    public var n: Int
    public var shownAt: Int64
    /// The study label when the warning came during study, else nil.
    public var studyLabel: String?
    public var decision: Decision?
    /// nil while undecided, and for an abandoned warning that was closed as exit.
    public var decidedAt: Int64?
    public var allowMinutes: Int?
    public var activity: String?
    public var activityMinutes: Int?

    public init(
        id: String, app: String, level: Int, lockSeconds: Int, risk: Bool, n: Int, shownAt: Int64, studyLabel: String? = nil,
        decision: Decision? = nil, decidedAt: Int64? = nil, allowMinutes: Int? = nil, activity: String? = nil, activityMinutes: Int? = nil
    ) {
        self.id = id
        self.app = app
        self.level = level
        self.lockSeconds = lockSeconds
        self.risk = risk
        self.n = n
        self.shownAt = shownAt
        self.studyLabel = studyLabel
        self.decision = decision
        self.decidedAt = decidedAt
        self.allowMinutes = allowMinutes
        self.activity = activity
        self.activityMinutes = activityMinutes
    }

    enum CodingKeys: String, CodingKey {
        case id, app, level, lockSeconds, risk, n, shownAt, studyLabel, decision, decidedAt, allowMinutes, activity, activityMinutes
    }

    /// Tolerant: only `id`, `app` and `shownAt` are required; anything else malformed becomes its default.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        app = try c.decode(String.self, forKey: .app)
        shownAt = try c.decode(Int64.self, forKey: .shownAt)
        let lvl = c.tolerant(Int.self, .level) ?? 0
        level = (0...3).contains(lvl) ? lvl : 0
        lockSeconds = max(0, c.tolerant(Int.self, .lockSeconds) ?? 0)
        risk = c.tolerant(Bool.self, .risk) ?? false
        n = max(0, c.tolerant(Int.self, .n) ?? 0)
        studyLabel = c.tolerant(String.self, .studyLabel)
        decision = c.tolerant(Decision.self, .decision)
        decidedAt = c.tolerant(Int64.self, .decidedAt)
        allowMinutes = c.tolerant(Int.self, .allowMinutes)
        activity = c.tolerant(String.self, .activity)
        activityMinutes = c.tolerant(Int.self, .activityMinutes)
    }

    var riskEvent: RiskEvent { RiskEvent(shownAt: shownAt, decision: decision) }
}

/// "Vào" opened this app until `expiresAt`: `shouldAsk` says no meanwhile.
public struct AllowWindow: Codable, Equatable, Sendable {
    public var app: String
    public var expiresAt: Int64
    public init(app: String, expiresAt: Int64) {
        self.app = app
        self.expiresAt = expiresAt
    }
}

public struct Settings: Codable, Equatable, Sendable {
    /// Seconds "Vào" stays locked, by level 0...3 (exactly 4 values, each 0...300).
    public var lockSeconds: [Int]
    /// Minutes the user may pick at levels 0...2 (1 to 4 values, each 1...120).
    public var allowOptionsNormal: [Int]
    /// Minutes the user may pick at level 3 (1 to 4 values, each 1...10).
    public var allowOptionsRestricted: [Int]
    /// Daily budget in minutes granted through "Vào"; 0 turns it off (0...1440).
    public var budgetMinutes: Int

    public init(
        lockSeconds: [Int] = [5, 10, 20, 30], allowOptionsNormal: [Int] = [5, 15, 30],
        allowOptionsRestricted: [Int] = [5, 10], budgetMinutes: Int = 90
    ) {
        self.lockSeconds = lockSeconds
        self.allowOptionsNormal = allowOptionsNormal
        self.allowOptionsRestricted = allowOptionsRestricted
        self.budgetMinutes = budgetMinutes
    }

    public var friction: FrictionSettings {
        FrictionSettings(lockSeconds: lockSeconds, allowOptionsNormal: allowOptionsNormal, allowOptionsRestricted: allowOptionsRestricted)
    }

    static func validLock(_ v: [Int]) -> Bool { v.count == 4 && v.allSatisfy { (0...300).contains($0) } }
    static func validOptions(_ v: [Int], max: Int) -> Bool { (1...4).contains(v.count) && v.allSatisfy { (1...max).contains($0) } }
    static func validBudget(_ v: Int) -> Bool { (0...1440).contains(v) }

    /// Same checks as the agent's `check_friction`.
    public var isValid: Bool {
        Settings.validLock(lockSeconds) && Settings.validBudget(budgetMinutes)
            && Settings.validOptions(allowOptionsNormal, max: 120) && Settings.validOptions(allowOptionsRestricted, max: 10)
    }

    enum CodingKeys: String, CodingKey { case lockSeconds, allowOptionsNormal, allowOptionsRestricted, budgetMinutes }

    /// Tolerant: each malformed or out-of-range field falls back to its default.
    public init(from decoder: Decoder) throws {
        self.init()
        guard let c = try? decoder.container(keyedBy: CodingKeys.self) else { return }
        if let v = c.tolerant([Int].self, .lockSeconds), Settings.validLock(v) { lockSeconds = v }
        if let v = c.tolerant([Int].self, .allowOptionsNormal), Settings.validOptions(v, max: 120) { allowOptionsNormal = v }
        if let v = c.tolerant([Int].self, .allowOptionsRestricted), Settings.validOptions(v, max: 10) { allowOptionsRestricted = v }
        if let v = c.tolerant(Int.self, .budgetMinutes), Settings.validBudget(v) { budgetMinutes = v }
    }
}

/// Everything the app remembers. Persist it with a `StateStore`; every operation is a method on this value.
public struct AppState: Codable, Equatable, Sendable {
    public static let currentSchema = 1
    public static let retentionDays = 30
    public static let maxEvents = 5000
    /// A warning nobody decided in this long is closed as Thoát (same as the agent and Android).
    public static let abandonedAfterMs: Int64 = 12 * Ms.hour

    public var schema: Int
    public var settings: Settings
    public var riskWindows: [RiskWindow]
    public var events: [WarningEvent]
    public var allowWindows: [AllowWindow]
    public var manualStudy: [Session]
    public var studyRules: [StudyRule]
    /// Day key ("YYYY-MM-DD", 04:00 boundary) -> minutes granted through "Vào" that day.
    public var grantedMinutes: [String: Int]

    public init(
        settings: Settings = Settings(), riskWindows: [RiskWindow] = [], events: [WarningEvent] = [],
        allowWindows: [AllowWindow] = [], manualStudy: [Session] = [], studyRules: [StudyRule] = [],
        grantedMinutes: [String: Int] = [:]
    ) {
        self.schema = AppState.currentSchema
        self.settings = settings
        self.riskWindows = riskWindows
        self.events = events
        self.allowWindows = allowWindows
        self.manualStudy = manualStudy
        self.studyRules = studyRules
        self.grantedMinutes = grantedMinutes
    }

    enum CodingKeys: String, CodingKey {
        case schema, settings, riskWindows, events, allowWindows, manualStudy, studyRules, grantedMinutes
    }

    /// Tolerant: a missing or malformed part becomes its default and malformed list elements are dropped, so a
    /// file written by an older or damaged build still opens. Throws only when the value is not a JSON object.
    public init(from decoder: Decoder) throws {
        self.init()
        let c = try decoder.container(keyedBy: CodingKeys.self)
        settings = c.tolerant(Settings.self, .settings) ?? Settings()
        riskWindows = Array(c.lossyArray(RiskWindow.self, .riskWindows).compactMap(normalizeRiskWindow).prefix(maxRiskWindows))
        events = c.lossyArray(WarningEvent.self, .events)
        allowWindows = c.lossyArray(AllowWindow.self, .allowWindows)
        manualStudy = c.lossyArray(Session.self, .manualStudy)
        studyRules = c.lossyArray(StudyRule.self, .studyRules).compactMap(normalizeStudyRule)
        if let g = c.tolerant([String: Int].self, .grantedMinutes) {
            grantedMinutes = g.filter { isDateString($0.key) && $0.value >= 0 }
        }
    }

    /// Decodes stored JSON; throws when it is not an object.
    public static func decode(_ data: Data) throws -> AppState {
        try JSONDecoder().decode(AppState.self, from: data)
    }

    /// Stable JSON (sorted keys).
    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }
}

// MARK: - Tolerant decoding helpers

private struct Lossy<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: Decoder) throws { value = try? T(from: decoder) }
}

extension KeyedDecodingContainer {
    /// The value, or nil when absent, null or of the wrong type.
    func tolerant<T: Decodable>(_ type: T.Type, _ key: Key) -> T? {
        (try? decodeIfPresent(type, forKey: key)) ?? nil
    }

    /// The elements that decode; the others are dropped. Empty when the key is missing or not an array.
    func lossyArray<T: Decodable>(_ type: T.Type, _ key: Key) -> [T] {
        guard let items = tolerant([Lossy<T>].self, key) else { return [] }
        return items.compactMap { $0.value }
    }
}
