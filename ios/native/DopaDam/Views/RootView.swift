import SwiftUI
import DopaDamCore

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            if let flow = model.flow {
                WarningView(flow: flow)
            } else {
                MainTabsView()
            }
        }
        .tint(Theme.accent)
        .onAppear {
            model.sceneDidBecomeActive()
        }
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .active:
                model.sceneDidBecomeActive()
            case .background:
                model.sceneDidEnterBackground()
            default:
                break
            }
        }
        .sheet(isPresented: confirmBinding) {
            ConfirmSheet()
        }
        .overlay(alignment: .top) {
            if let message = model.errorMessage {
                ErrorBanner(title: Wording.errorTitle, message: message) {
                    model.errorMessage = nil
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: model.errorMessage)
    }

    private var confirmBinding: Binding<Bool> {
        Binding(
            get: { model.pendingChange != nil },
            set: { shown in
                if !shown { model.cancelPendingChange() }
            })
    }
}
