// Stub of the parts of SwiftUI the DopaDam app touches. Declarations mirror Apple's iOS 17 SDK (Xcode 16):
// names, labels, generic constraints, @ViewBuilder / @escaping / @MainActor placement. Bodies are placeholders.
// This is NOT SwiftUI; it only lets the Swift compiler check the app's calls.
@_exported import Foundation
import Observation
import UIKit

// MARK: View, Scene, App

@MainActor @preconcurrency
public protocol View {
    associatedtype Body: View
    @ViewBuilder @MainActor var body: Self.Body { get }
}

extension Never: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
}

@MainActor @preconcurrency
public protocol Scene {
    associatedtype Body: Scene
    @SceneBuilder @MainActor var body: Self.Body { get }
}

extension Never: Scene {}

@MainActor @preconcurrency
public protocol App {
    associatedtype Body: Scene
    @SceneBuilder @MainActor var body: Self.Body { get }
    @MainActor init()
}

extension App {
    @MainActor public static func main() {}
}

@MainActor @preconcurrency
public protocol DynamicProperty {
    mutating func update()
}
extension DynamicProperty {
    public mutating func update() {}
}

// MARK: Result builders

@resultBuilder
public struct ViewBuilder {
    public static func buildBlock() -> EmptyView { EmptyView() }
    public static func buildBlock<Content: View>(_ content: Content) -> Content { content }
    public static func buildBlock<C0: View, C1: View>(_ c0: C0, _ c1: C1) -> TupleView<(C0, C1)> { TupleView() }
    public static func buildBlock<C0: View, C1: View, C2: View>(_ c0: C0, _ c1: C1, _ c2: C2) -> TupleView<(C0, C1, C2)> { TupleView() }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3) -> TupleView<(C0, C1, C2, C3)> { TupleView() }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4) -> TupleView<(C0, C1, C2, C3, C4)> { TupleView() }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View, C5: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5) -> TupleView<(C0, C1, C2, C3, C4, C5)> { TupleView() }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View, C5: View, C6: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5, _ c6: C6) -> TupleView<(C0, C1, C2, C3, C4, C5, C6)> { TupleView() }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View, C5: View, C6: View, C7: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5, _ c6: C6, _ c7: C7) -> TupleView<(C0, C1, C2, C3, C4, C5, C6, C7)> { TupleView() }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View, C5: View, C6: View, C7: View, C8: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5, _ c6: C6, _ c7: C7, _ c8: C8) -> TupleView<(C0, C1, C2, C3, C4, C5, C6, C7, C8)> { TupleView() }
    public static func buildBlock<C0: View, C1: View, C2: View, C3: View, C4: View, C5: View, C6: View, C7: View, C8: View, C9: View>(_ c0: C0, _ c1: C1, _ c2: C2, _ c3: C3, _ c4: C4, _ c5: C5, _ c6: C6, _ c7: C7, _ c8: C8, _ c9: C9) -> TupleView<(C0, C1, C2, C3, C4, C5, C6, C7, C8, C9)> { TupleView() }

    // Real SwiftUI returns `Content?` here (Optional is a View there); a wrapper stands in.
    public static func buildIf<Content: View>(_ content: Content?) -> _OptionalContent<Content> { _OptionalContent() }
    public static func buildEither<TrueContent: View, FalseContent: View>(first: TrueContent) -> _ConditionalContent<TrueContent, FalseContent> { _ConditionalContent() }
    public static func buildEither<TrueContent: View, FalseContent: View>(second: FalseContent) -> _ConditionalContent<TrueContent, FalseContent> { _ConditionalContent() }
    public static func buildLimitedAvailability<Content: View>(_ content: Content) -> AnyView { AnyView() }
}

@resultBuilder
public struct SceneBuilder {
    public static func buildBlock<Content: Scene>(_ content: Content) -> Content { content }
}

// MARK: Primitive containers

public struct EmptyView: View {
    public init() {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public struct AnyView: View {
    init() {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public struct TupleView<T>: View {
    init() {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public struct _OptionalContent<Content: View>: View {
    init() {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public struct _ConditionalContent<TrueContent: View, FalseContent: View>: View {
    init() {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}

/// What every modifier returns in the stub.
public struct _ModifiedView<Content: View>: View {
    init(_ content: Content) {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public struct VStack<Content: View>: View {
    public init(alignment: HorizontalAlignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> Content) {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public struct HStack<Content: View>: View {
    public init(alignment: VerticalAlignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> Content) {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public struct ZStack<Content: View>: View {
    public init(alignment: Alignment = .center, @ViewBuilder content: () -> Content) {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public struct Spacer: View {
    public init(minLength: CGFloat? = nil) {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public struct ScrollView<Content: View>: View {
    public init(_ axes: Axis.Set = .vertical, showsIndicators: Bool = true, @ViewBuilder content: () -> Content) {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public struct ForEach<Data: RandomAccessCollection, ID: Hashable, Content> {
    public init(_ data: Data, id: KeyPath<Data.Element, ID>, @ViewBuilder content: @escaping (Data.Element) -> Content) where Content: View {}
}
extension ForEach where ID == Data.Element.ID, Content: View, Data.Element: Identifiable {
    public init(_ data: Data, @ViewBuilder content: @escaping (Data.Element) -> Content) {}
}
extension ForEach: View where Content: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public struct TabView<SelectionValue: Hashable, Content: View>: View {
    public init(selection: Binding<SelectionValue>?, @ViewBuilder content: () -> Content) {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public struct Label<Title: View, Icon: View>: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
}
extension Label where Title == Text, Icon == Image {
    public init(_ titleKey: LocalizedStringKey, systemImage name: String) {}
    public init<S: StringProtocol>(_ title: S, systemImage name: String) {}
}

public struct Image: View {
    public init(systemName: String) {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public struct Picker<Label: View, SelectionValue: Hashable, Content: View>: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
}
extension Picker where Label == Text {
    public init(_ titleKey: LocalizedStringKey, selection: Binding<SelectionValue>, @ViewBuilder content: () -> Content) {}
    public init<S: StringProtocol>(_ title: S, selection: Binding<SelectionValue>, @ViewBuilder content: () -> Content) {}
}

public struct Stepper<Label: View>: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
}
extension Stepper where Label == Text {
    public init<V: Strideable>(_ titleKey: LocalizedStringKey, value: Binding<V>, in bounds: ClosedRange<V>, step: V.Stride = 1, onEditingChanged: @escaping (Bool) -> Void = { _ in }) {}
    public init<S: StringProtocol, V: Strideable>(_ title: S, value: Binding<V>, in bounds: ClosedRange<V>, step: V.Stride = 1, onEditingChanged: @escaping (Bool) -> Void = { _ in }) {}
}

public struct TextField<Label: View>: View {
    public typealias Body = Never
    public var body: Never { fatalError() }
}
extension TextField where Label == Text {
    public init(_ titleKey: LocalizedStringKey, text: Binding<String>) {}
    public init<S: StringProtocol>(_ title: S, text: Binding<String>) {}
}

public struct Button<Label: View>: View {
    public init(action: @escaping @MainActor () -> Void, @ViewBuilder label: () -> Label) {}
    public init(role: ButtonRole?, action: @escaping @MainActor () -> Void, @ViewBuilder label: () -> Label) {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}
extension Button where Label == Text {
    public init(_ titleKey: LocalizedStringKey, action: @escaping @MainActor () -> Void) {}
    public init(_ titleKey: LocalizedStringKey, role: ButtonRole?, action: @escaping @MainActor () -> Void) {}
    public init<S: StringProtocol>(_ title: S, action: @escaping @MainActor () -> Void) {}
    public init<S: StringProtocol>(_ title: S, role: ButtonRole?, action: @escaping @MainActor () -> Void) {}
}

public struct ButtonRole: Equatable, Sendable {
    public static let destructive = ButtonRole()
    public static let cancel = ButtonRole()
}

// MARK: TimelineView

public protocol TimelineSchedule {}

public struct PeriodicTimelineSchedule: TimelineSchedule {
    public init(from startDate: Date, by interval: TimeInterval) {}
}

extension TimelineSchedule where Self == PeriodicTimelineSchedule {
    public static func periodic(from startDate: Date, by interval: TimeInterval) -> PeriodicTimelineSchedule {
        PeriodicTimelineSchedule(from: startDate, by: interval)
    }
}

public struct TimelineViewDefaultContext {
    public let date: Date
}

public struct TimelineView<Schedule: TimelineSchedule, Content: View>: View {
    public typealias Context = TimelineViewDefaultContext
    public init(_ schedule: Schedule, @ViewBuilder content: @escaping (TimelineView<Schedule, Content>.Context) -> Content) {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}

// MARK: Scenes

public struct WindowGroup<Content: View>: Scene {
    public init(@ViewBuilder content: () -> Content) {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}

/// macOS-only scene. On iOS it is declared unavailable, but the name is still visible, which is the point: the
/// type name `Settings` from DopaDamCore must be qualified in the app.
@available(iOS, unavailable)
@available(macCatalyst, unavailable)
public struct Settings<Content: View>: Scene {
    public init(@ViewBuilder content: () -> Content) {}
    public typealias Body = Never
    public var body: Never { fatalError() }
}
