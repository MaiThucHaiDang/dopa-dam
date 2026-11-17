// Stub of the parts of UIKit the DopaDam app touches. Declarations mirror Apple's iOS 17 SDK.
// This is NOT UIKit; it only lets the Swift compiler check the app's calls.
@_exported import Foundation

public enum UIKeyboardType: Int, Sendable {
    case `default` = 0
    case asciiCapable
    case numbersAndPunctuation
    case URL
    case numberPad
    case phonePad
    case namePhonePad
    case emailAddress
    case decimalPad
    case twitter
    case webSearch
    case asciiCapableNumberPad
}

@MainActor
open class UIApplication {
    public static let shared: UIApplication = UIApplication()
    private init() {}

    public struct OpenExternalURLOptionsKey: Hashable, RawRepresentable, Sendable {
        public var rawValue: String
        public init(rawValue: String) { self.rawValue = rawValue }
    }

    /// `open(_:options:completionHandler:)`; the completion handler is `@MainActor @Sendable` since the iOS 17 SDK.
    open func open(_ url: URL, options: [UIApplication.OpenExternalURLOptionsKey: Any] = [:], completionHandler completion: (@MainActor @Sendable (Bool) -> Void)? = nil) {}

    /// NSObject's `perform(_:)` (Objective-C only; used by the real SystemActions.swift).
    @discardableResult
    open func perform(_ aSelector: Selector) -> Unmanaged<AnyObject>! { nil }
}

/// Stand-in for Objective-C `Selector` (the `#selector` expression does not exist on Linux).
public struct Selector: ExpressibleByStringLiteral {
    public init(stringLiteral value: String) {}
    public init(_ name: String) {}
}
