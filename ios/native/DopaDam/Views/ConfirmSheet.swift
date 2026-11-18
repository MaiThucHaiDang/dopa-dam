import SwiftUI
import DopaDamCore

/// The confirmation for every change that weakens protection: wait 60 seconds, then type the phrase.
struct ConfirmSheet: View {
    @Environment(AppModel.self) private var model
    @State private var typed: String = ""

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                Text(Wording.confirmTitle)
                    .font(.system(size: Theme.FontSize.title, weight: .bold))
                    .foregroundColor(Theme.text)
                    .fixedSize(horizontal: false, vertical: true)
                TimelineView(.periodic(from: Date(), by: 0.5)) { timeline in
                    gateContent(now: nowMs(of: timeline.date))
                }
                Spacer()
            }
            .padding(Theme.Space.lg)
        }
        .preferredColorScheme(.dark)
        .interactiveDismissDisabled()
    }

    private func gateContent(now: Int64) -> some View {
        let gate = model.confirmGate ?? ConfirmGate(startedAt: now)
        return VStack(alignment: .leading, spacing: Theme.Space.md) {
            BodyText(gate.countdownText(now: now))
                .accessibilityIdentifier("confirm.countdown")
            Muted(Wording.confirmTypeLabel)
            Muted(ConfirmGate.hint)
            TextField(confirmPhrase, text: $typed)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled(true)
                .textInputAutocapitalization(.never)
                .disabled(!gate.canType(now: now))
                .accessibilityIdentifier("confirm.field")
            Button {
                model.confirmPendingChange(typed: typed)
            } label: {
                Text(Wording.confirmOk)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!gate.canConfirm(input: typed, now: now))
            .accessibilityIdentifier("confirm.ok")
            Button {
                model.cancelPendingChange()
            } label: {
                Text(Wording.confirmCancel)
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityIdentifier("confirm.cancel")
        }
    }
}
