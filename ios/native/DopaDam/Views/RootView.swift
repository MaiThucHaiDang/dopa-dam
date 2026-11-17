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
        .alert(Wording.errorTitle, isPresented: errorBinding) {
            Button("Đã hiểu", role: .cancel) {}
        } message: {
            Text(model.errorMessage ?? "")
        }
    }

    private var confirmBinding: Binding<Bool> {
        Binding(
            get: { model.pendingChange != nil },
            set: { shown in
                if !shown { model.cancelPendingChange() }
            })
    }

    private var errorBinding: Binding<Bool> {
        Binding(
            get: { model.errorMessage != nil },
            set: { shown in
                if !shown { model.errorMessage = nil }
            })
    }
}
