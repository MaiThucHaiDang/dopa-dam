import Foundation
import UIKit

// MARK: Text and localisation

public struct LocalizedStringKey: ExpressibleByStringInterpolation, Equatable {
    public init(stringLiteral value: String) {}
    public init(stringInterpolation: StringInterpolation) {}
    public struct StringInterpolation: StringInterpolationProtocol {
        public init(literalCapacity: Int, interpolationCount: Int) {}
        public mutating func appendLiteral(_ literal: String) {}
        public mutating func appendInterpolation(_ string: String) {}
        public mutating func appendInterpolation<T: _FormatSpecifiable>(_ value: T) {}
    }
}

public protocol _FormatSpecifiable {}
extension Int: _FormatSpecifiable {}
extension Double: _FormatSpecifiable {}
extension Float: _FormatSpecifiable {}
extension UInt: _FormatSpecifiable {}

public struct Text: View {
    public init(_ key: LocalizedStringKey, tableName: String? = nil, bundle: Bundle? = nil, comment: StaticString? = nil) {}
    public init<S: StringProtocol>(_ content: S) {}
    public init(verbatim content: String) {}
    public typealias Body = Never
    public var body: Never { fatalError() }

    public func font(_ font: Font?) -> Text { self }
    public func foregroundColor(_ color: Color?) -> Text { self }
    public func fontWeight(_ weight: Font.Weight?) -> Text { self }
    public func bold() -> Text { self }
}

public struct Font: Sendable {
    public static func system(size: CGFloat, weight: Font.Weight? = nil, design: Font.Design? = nil) -> Font { Font() }
    public struct Weight: Hashable, Sendable {
        public static let regular = Weight()
        public static let medium = Weight()
        public static let semibold = Weight()
        public static let bold = Weight()
    }
    public enum Design: Hashable, Sendable {
        case `default`, serif, rounded, monospaced
    }
}

// MARK: Colour and styles

public protocol ShapeStyle: Sendable {}

public struct Color: ShapeStyle, View, Hashable {
    public enum RGBColorSpace: Equatable, Sendable {
        case sRGB, sRGBLinear, displayP3
    }
    public init(_ colorSpace: Color.RGBColorSpace = .sRGB, red: Double, green: Double, blue: Double, opacity: Double = 1) {}
    public func opacity(_ opacity: Double) -> Color { self }
    public static let clear = Color(red: 0, green: 0, blue: 0, opacity: 0)
    public typealias Body = Never
    public var body: Never { fatalError() }
}

// MARK: Geometry and layout types

public enum Axis: Int8, CaseIterable, Sendable {
    case horizontal, vertical
    public struct Set: OptionSet, Sendable {
        public let rawValue: Int8
        public init(rawValue: Int8) { self.rawValue = rawValue }
        public static let horizontal = Set(rawValue: 1)
        public static let vertical = Set(rawValue: 2)
    }
}

public enum Edge: Int8, CaseIterable, Sendable {
    case top, leading, bottom, trailing
    public struct Set: OptionSet, Sendable {
        public let rawValue: Int8
        public init(rawValue: Int8) { self.rawValue = rawValue }
        public static let top = Set(rawValue: 1)
        public static let leading = Set(rawValue: 2)
        public static let bottom = Set(rawValue: 4)
        public static let trailing = Set(rawValue: 8)
        public static let all: Set = [.top, .leading, .bottom, .trailing]
        public static let horizontal: Set = [.leading, .trailing]
        public static let vertical: Set = [.top, .bottom]
    }
}

public struct HorizontalAlignment: Equatable, Sendable {
    public static let leading = HorizontalAlignment()
    public static let center = HorizontalAlignment()
    public static let trailing = HorizontalAlignment()
}

public struct VerticalAlignment: Equatable, Sendable {
    public static let top = VerticalAlignment()
    public static let center = VerticalAlignment()
    public static let bottom = VerticalAlignment()
}

public struct Alignment: Equatable, Sendable {
    public static let center = Alignment()
    public static let leading = Alignment()
    public static let trailing = Alignment()
    public static let top = Alignment()
    public static let bottom = Alignment()
    public static let topLeading = Alignment()
    public static let bottomLeading = Alignment()
}

public enum TextAlignment: Hashable, CaseIterable, Sendable {
    case leading, center, trailing
}

public enum ContentMode: Hashable, CaseIterable, Sendable {
    case fit, fill
}

public enum ColorScheme: CaseIterable, Hashable, Sendable {
    case light, dark
}

public struct SafeAreaRegions: OptionSet, Sendable {
    public let rawValue: UInt
    public init(rawValue: UInt) { self.rawValue = rawValue }
    public static let container = SafeAreaRegions(rawValue: 1)
    public static let keyboard = SafeAreaRegions(rawValue: 2)
    public static let all: SafeAreaRegions = [.container, .keyboard]
}

public struct ScrollDismissesKeyboardMode: Hashable, Sendable {
    public static let automatic = ScrollDismissesKeyboardMode()
    public static let immediately = ScrollDismissesKeyboardMode()
    public static let interactively = ScrollDismissesKeyboardMode()
    public static let never = ScrollDismissesKeyboardMode()
}

public struct TextInputAutocapitalization: Equatable, Sendable {
    public static let never = TextInputAutocapitalization()
    public static let words = TextInputAutocapitalization()
    public static let sentences = TextInputAutocapitalization()
    public static let characters = TextInputAutocapitalization()
}

public struct FillStyle: Equatable, Sendable {
    public init(eoFill: Bool = false, antialiased: Bool = true) {}
}

// MARK: Shapes

public struct Path: Sendable {
    public init() {}
}

@preconcurrency
public protocol Shape: Sendable, View {
    func path(in rect: CGRect) -> Path
}

extension Shape {
    public func fill<S: ShapeStyle>(_ content: S, style: FillStyle = FillStyle()) -> some View { _ModifiedView(self) }
    public func stroke<S: ShapeStyle>(_ content: S, lineWidth: CGFloat = 1) -> some View { _ModifiedView(self) }
}

public struct RoundedRectangle: Shape {
    public init(cornerRadius: CGFloat, style: RoundedCornerStyle = .circular) {}
    public func path(in rect: CGRect) -> Path { Path() }
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public struct Rectangle: Shape {
    public init() {}
    public func path(in rect: CGRect) -> Path { Path() }
    public typealias Body = Never
    public var body: Never { fatalError() }
}

public enum RoundedCornerStyle: Hashable, Sendable {
    case circular, continuous
}

// MARK: Button, text field and picker styles

@MainActor @preconcurrency
public protocol ButtonStyle {
    associatedtype Body: View
    @ViewBuilder @MainActor func makeBody(configuration: Self.Configuration) -> Self.Body
    typealias Configuration = ButtonStyleConfiguration
}

public struct ButtonStyleConfiguration {
    public struct Label: View {
        public typealias Body = Never
        public var body: Never { fatalError() }
    }
    public let role: ButtonRole?
    public let label: ButtonStyleConfiguration.Label
    public let isPressed: Bool
}

public protocol TextFieldStyle {}
public struct RoundedBorderTextFieldStyle: TextFieldStyle {
    public init() {}
}
extension TextFieldStyle where Self == RoundedBorderTextFieldStyle {
    public static var roundedBorder: RoundedBorderTextFieldStyle { RoundedBorderTextFieldStyle() }
}

public protocol PickerStyle {}
public struct MenuPickerStyle: PickerStyle {
    public init() {}
}
extension PickerStyle where Self == MenuPickerStyle {
    public static var menu: MenuPickerStyle { MenuPickerStyle() }
}

public struct Animation: Equatable, Sendable {
    public static func easeInOut(duration: Double) -> Animation { Animation() }
}

public struct AnyTransition: Sendable {
    public static let opacity = AnyTransition()
    public static func move(edge: Edge) -> AnyTransition { AnyTransition() }
    public func combined(with other: AnyTransition) -> AnyTransition { self }
}

public enum VerticalEdge: Int8, CaseIterable, Sendable {
    case top, bottom
}
