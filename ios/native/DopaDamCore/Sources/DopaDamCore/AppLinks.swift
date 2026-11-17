import Foundation

/// URL schemes that open an entertainment app, so "Vào" can take the user straight into it. The key is the app
/// name as the user types it in the automation, after `AppName.key` (case, accents composition and spacing
/// ignored). An app that is not here is simply not opened: the screen asks the user to open it.
public enum AppLinks {
    /// Names (lower case) and their schemes. Several spellings may share one scheme.
    static let table: [String: String] = [
        "youtube": "youtube://",
        "tiktok": "snssdk1233://",
        "tik tok": "snssdk1233://",
        "facebook": "fb://",
        "instagram": "instagram://",
        "messenger": "fb-messenger://",
        "x": "twitter://",
        "twitter": "twitter://",
        "reddit": "reddit://",
        "netflix": "nflx://",
        "zalo": "zalo://",
        "threads": "barcelona://",
    ]

    /// The scheme URL string for an app name, nil when unknown or empty.
    public static func urlString(for app: String) -> String? {
        guard let key = AppName.key(app) else { return nil }
        return table[key]
    }

    /// The names that have a link, for the guide ("YouTube, TikTok, ...").
    public static let knownNames = ["YouTube", "TikTok", "Facebook", "Instagram", "Messenger", "X", "Reddit", "Netflix", "Zalo", "Threads"]
}
