// Stub of the parts of AppIntents the DopaDam app touches (iOS 17 SDK shapes).
// On Apple platforms `import AppIntents` also brings in Foundation, where LocalizedStringResource lives; Foundation
// on Linux has no LocalizedStringResource, so it is declared here, mirroring Foundation's declaration.
@_exported import Foundation

// MARK: LocalizedStringResource (Foundation on Apple platforms)

public struct LocalizedStringResource: ExpressibleByStringInterpolation, Sendable {
    public var key: String
    public init(stringLiteral value: String) { key = value }
    public init(stringInterpolation: StringInterpolation) { key = stringInterpolation.text }
    public struct StringInterpolation: StringInterpolationProtocol {
        var text = ""
        public init(literalCapacity: Int, interpolationCount: Int) {}
        public mutating func appendLiteral(_ literal: String) { text += literal }
        public mutating func appendInterpolation(_ value: String) { text += value }
        public mutating func appendInterpolation(_ value: Int) { text += String(value) }
    }
}

// MARK: Intents

public protocol IntentResult {}

public protocol ReturnsValue<Value>: IntentResult {
    associatedtype Value
}

public struct _ValueResult<Value>: IntentResult, ReturnsValue {}
public struct _EmptyResult: IntentResult {}

// Apple's `.result()` / `.result(value:)` are implicit-member friendly; this stub models them with a `Self`
// constraint, which Swift requires for `return .result(...)` in a function returning `some IntentResult & ...`.
extension IntentResult {
    public static func result() -> Self where Self == _EmptyResult { _EmptyResult() }
    public static func result<Value>(value: Value) -> Self where Self == _ValueResult<Value> { _ValueResult<Value>() }
}

public struct IntentDescription: Sendable {
    public init(_ descriptionText: LocalizedStringResource, categoryName: LocalizedStringResource? = nil, searchKeywords: [LocalizedStringResource] = [], resultValueName: LocalizedStringResource? = nil) {}
}

public protocol _IntentValue {}
extension String: _IntentValue {}
extension Int: _IntentValue {}
extension Bool: _IntentValue {}
extension Double: _IntentValue {}

public protocol AppIntent: Sendable {
    associatedtype PerformResult: IntentResult
    static var title: LocalizedStringResource { get }
    static var description: IntentDescription { get }
    static var openAppWhenRun: Bool { get }
    init()
    func perform() async throws -> Self.PerformResult
}

extension AppIntent {
    public static var description: IntentDescription { IntentDescription("") }
    public static var openAppWhenRun: Bool { false }
}

@propertyWrapper
public struct IntentParameter<Value: _IntentValue>: @unchecked Sendable {
    private var storage: Value?
    public init(wrappedValue: Value) { storage = wrappedValue }
    public var wrappedValue: Value {
        get { storage! }
        set { storage = newValue }
    }
    public var projectedValue: IntentParameter<Value> { self }
}

extension IntentParameter where Value == String {
    public init(title: LocalizedStringResource, description: LocalizedStringResource? = nil, default defaultValue: String? = nil) {
        storage = defaultValue
    }
}

public typealias Parameter = IntentParameter

// MARK: App Shortcuts

public struct AppShortcutPhraseToken: Sendable {
    public static let applicationName = AppShortcutPhraseToken()
}

public struct AppShortcutPhrase<Intent: AppIntent>: ExpressibleByStringInterpolation {
    public init(stringLiteral value: String) {}
    public init(stringInterpolation: StringInterpolation) {}
    public struct StringInterpolation: StringInterpolationProtocol {
        public init(literalCapacity: Int, interpolationCount: Int) {}
        public mutating func appendLiteral(_ literal: String) {}
        public mutating func appendInterpolation(_ token: AppShortcutPhraseToken) {}
    }
}

public struct AppShortcut {
    public init<Intent: AppIntent>(intent: Intent, phrases: [AppShortcutPhrase<Intent>], shortTitle: LocalizedStringResource, systemImageName: String) {}
}

@resultBuilder
public struct AppShortcutsBuilder {
    public static func buildBlock(_ components: [AppShortcut]...) -> [AppShortcut] { components.flatMap { $0 } }
    public static func buildExpression(_ expression: AppShortcut) -> [AppShortcut] { [expression] }
    public static func buildExpression(_ expression: [AppShortcut]) -> [AppShortcut] { expression }
    public static func buildArray(_ components: [[AppShortcut]]) -> [AppShortcut] { components.flatMap { $0 } }
    public static func buildOptional(_ component: [AppShortcut]?) -> [AppShortcut] { component ?? [] }
    public static func buildEither(first component: [AppShortcut]) -> [AppShortcut] { component }
    public static func buildEither(second component: [AppShortcut]) -> [AppShortcut] { component }
    public static func buildLimitedAvailability(_ component: [AppShortcut]) -> [AppShortcut] { component }
}

public protocol AppShortcutsProvider {
    @AppShortcutsBuilder static var appShortcuts: [AppShortcut] { get }
}
