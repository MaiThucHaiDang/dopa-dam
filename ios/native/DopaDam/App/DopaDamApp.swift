import SwiftUI

@main
@MainActor
struct DopaDamApp: App {
    private var model: AppModel { AppModel.shared }

    init() {
        #if DEBUG
        DebugLaunch.run()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
        }
    }
}
