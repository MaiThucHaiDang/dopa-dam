import Foundation

/// A local notification described as plain data; the app turns it into a `UNNotificationRequest`.
public struct NotificationSpec: Equatable, Sendable {
    public var identifier: String
    public var title: String
    public var body: String
    /// When to show it, milliseconds since 1970.
    public var fireAt: Int64

    public init(identifier: String, title: String, body: String, fireAt: Int64) {
        self.identifier = identifier
        self.title = title
        self.body = body
        self.fireAt = fireAt
    }

    /// Seconds from `now` until it fires; at least 1, because a time-interval trigger must be positive.
    public func delaySeconds(now: Int64) -> Double { max(1, Double(fireAt - now) / 1000) }
}

/// Identifiers of the notifications the app schedules. Stable per app / warning so that scheduling again
/// replaces the old one and cancelling is exact.
public enum NotificationIds {
    public static let prefix = "dopadam."

    public static func allowHeadsUp(app: String) -> String { "\(prefix)allow.headsup.\(AppName.key(app) ?? "app")" }
    public static func allowEnd(app: String) -> String { "\(prefix)allow.end.\(AppName.key(app) ?? "app")" }
    public static func activity(eventId: String) -> String { "\(prefix)activity.\(eventId)" }

    /// Both identifiers of an app's allow window.
    public static func allow(app: String) -> [String] { [allowHeadsUp(app: app), allowEnd(app: app)] }
}

/// "Còn 1 phút" (when more than a minute is left) and "Hết thời gian" for an allow window.
public func allowNotificationSpecs(_ n: AllowNotifications) -> [NotificationSpec] {
    var specs: [NotificationSpec] = []
    if let headsUp = n.headsUpAt {
        specs.append(NotificationSpec(
            identifier: NotificationIds.allowHeadsUp(app: n.app), title: Wording.headsUpTitle,
            body: Wording.headsUpBody(app: n.app), fireAt: headsUp))
    }
    specs.append(NotificationSpec(
        identifier: NotificationIds.allowEnd(app: n.app), title: Wording.allowEndedTitle,
        body: Wording.allowEndedBody(app: n.app), fireAt: n.endsAt))
    return specs
}

/// The notification for the end of a "Làm việc khác" timer; nil when the warning has no activity.
public func activityNotificationSpec(event: WarningEvent) -> NotificationSpec? {
    guard let activity = event.activity, let minutes = event.activityMinutes, let decidedAt = event.decidedAt else { return nil }
    return NotificationSpec(
        identifier: NotificationIds.activity(eventId: event.id),
        title: Wording.activityDoneNotificationTitle(minutes: minutes, activity: activity),
        body: Wording.activityDoneNotificationBody(studyLabel: event.studyLabel),
        fireAt: decidedAt + Int64(minutes) * Ms.minute)
}

/// Whether the app may show notifications, as the guide page reports it.
public enum NotificationPermission: Equatable, Sendable {
    case notAsked, granted, denied

    public var text: String {
        switch self {
        case .notAsked: return "Chưa bật thông báo."
        case .granted: return "Thông báo đã bật."
        case .denied: return "Thông báo đang tắt. Bật lại trong Cài đặt của iPhone."
        }
    }
}
