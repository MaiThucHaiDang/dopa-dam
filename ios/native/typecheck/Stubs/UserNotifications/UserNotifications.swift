// Stub of the parts of UserNotifications the DopaDam app touches (iOS 17 SDK shapes).
@_exported import Foundation

public struct UNAuthorizationOptions: OptionSet, Sendable {
    public let rawValue: UInt
    public init(rawValue: UInt) { self.rawValue = rawValue }
    public static let badge = UNAuthorizationOptions(rawValue: 1 << 0)
    public static let sound = UNAuthorizationOptions(rawValue: 1 << 1)
    public static let alert = UNAuthorizationOptions(rawValue: 1 << 2)
    public static let carPlay = UNAuthorizationOptions(rawValue: 1 << 3)
    public static let criticalAlert = UNAuthorizationOptions(rawValue: 1 << 4)
    public static let providesAppNotificationSettings = UNAuthorizationOptions(rawValue: 1 << 5)
    public static let provisional = UNAuthorizationOptions(rawValue: 1 << 6)
}

public enum UNAuthorizationStatus: Int, Sendable {
    case notDetermined = 0
    case denied = 1
    case authorized = 2
    case provisional = 3
    case ephemeral = 4   // iOS 14, App Clips
}

open class UNNotificationSettings: @unchecked Sendable {
    public init() {}
    open var authorizationStatus: UNAuthorizationStatus { .notDetermined }
}

open class UNNotificationSound: @unchecked Sendable {
    public init() {}
    open class var `default`: UNNotificationSound { UNNotificationSound() }
}

open class UNNotificationContent: @unchecked Sendable {
    public init() {}
    open var title: String { "" }
    open var body: String { "" }
    open var sound: UNNotificationSound? { nil }
}

open class UNMutableNotificationContent: UNNotificationContent, @unchecked Sendable {
    public override init() { super.init() }
    private var _title = ""
    private var _body = ""
    private var _sound: UNNotificationSound?
    open override var title: String { get { _title } set { _title = newValue } }
    open override var body: String { get { _body } set { _body = newValue } }
    open override var sound: UNNotificationSound? { get { _sound } set { _sound = newValue } }
}

open class UNNotificationTrigger: @unchecked Sendable {
    public let repeats: Bool
    init(repeats: Bool) { self.repeats = repeats }
}

open class UNTimeIntervalNotificationTrigger: UNNotificationTrigger, @unchecked Sendable {
    public let timeInterval: TimeInterval
    public init(timeInterval: TimeInterval, repeats: Bool) {
        self.timeInterval = timeInterval
        super.init(repeats: repeats)
    }
}

open class UNNotificationRequest: @unchecked Sendable {
    public let identifier: String
    public let content: UNNotificationContent
    public let trigger: UNNotificationTrigger?
    public init(identifier: String, content: UNNotificationContent, trigger: UNNotificationTrigger?) {
        self.identifier = identifier
        self.content = content
        self.trigger = trigger
    }
}

open class UNUserNotificationCenter: @unchecked Sendable {
    fileprivate init() {}
    public static func current() -> UNUserNotificationCenter { UNUserNotificationCenter() }

    open func add(_ request: UNNotificationRequest, withCompletionHandler completionHandler: (@Sendable (Error?) -> Void)? = nil) {}
    open func add(_ request: UNNotificationRequest) async throws {}

    open func removePendingNotificationRequests(withIdentifiers identifiers: [String]) {}

    open func getNotificationSettings(completionHandler: @escaping @Sendable (UNNotificationSettings) -> Void) {}
    /// The async form Swift derives from `getNotificationSettings(completionHandler:)`.
    open func notificationSettings() async -> UNNotificationSettings { UNNotificationSettings() }

    open func requestAuthorization(options: UNAuthorizationOptions = [], completionHandler: @escaping @Sendable (Bool, Error?) -> Void) {}
    open func requestAuthorization(options: UNAuthorizationOptions = []) async throws -> Bool { false }
}
