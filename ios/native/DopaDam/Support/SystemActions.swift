import UIKit

/// The two things the app asks of the system besides drawing.
enum SystemActions {
    /// Sends DopaDam to the background, which shows the Home screen. iOS has no public call for this; sending
    /// `suspend` to the application is the usual way and may stop working in a future iOS.
    @MainActor
    static func goHome() {
        _ = UIApplication.shared.perform(#selector(NSXPCConnection.suspend))
    }

    /// Opens another app by its URL scheme. Does nothing when the string is not a URL.
    @MainActor
    static func open(urlString: String) {
        guard let url = URL(string: urlString) else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }
}
