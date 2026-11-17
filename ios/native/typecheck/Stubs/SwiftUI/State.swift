import Foundation
import Observation

// MARK: Property wrappers

@propertyWrapper
public struct State<Value>: DynamicProperty {
    public init(wrappedValue value: Value) { storage = value }
    public init(initialValue value: Value) { storage = value }
    private var storage: Value
    public var wrappedValue: Value {
        get { storage }
        nonmutating set {}
    }
    public var projectedValue: Binding<Value> { Binding(get: { storage }, set: { _ in }) }
}

@propertyWrapper
@dynamicMemberLookup
public struct Binding<Value> {
    private let getter: () -> Value
    private let setter: (Value) -> Void

    @preconcurrency
    public init(get: @escaping @Sendable () -> Value, set: @escaping @Sendable (Value) -> Void) {
        getter = get
        setter = set
    }
    public var wrappedValue: Value {
        get { getter() }
        nonmutating set { setter(newValue) }
    }
    public var projectedValue: Binding<Value> { self }
    public subscript<Subject>(dynamicMember keyPath: WritableKeyPath<Value, Subject>) -> Binding<Subject> {
        Binding<Subject>(
            get: { getter()[keyPath: keyPath] },
            set: { var v = getter(); v[keyPath: keyPath] = $0; setter(v) })
    }
}

@propertyWrapper
public struct Environment<Value>: DynamicProperty {
    public init(_ keyPath: KeyPath<EnvironmentValues, Value>) { fatalError() }
    public var wrappedValue: Value { fatalError() }
}
extension Environment {
    /// iOS 17: reads an `@Observable` object from the environment.
    public init(_ objectType: Value.Type) where Value: AnyObject, Value: Observable { fatalError() }
}

public struct EnvironmentValues {
    public var isEnabled: Bool { get { true } set {} }
    public var scenePhase: ScenePhase { get { .active } set {} }
}

public enum ScenePhase: Hashable, Sendable {
    case background
    case inactive
    case active
}
