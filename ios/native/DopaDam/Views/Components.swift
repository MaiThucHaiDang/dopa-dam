import SwiftUI

/// A panel on the surface colour.
struct Card<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Theme.Space.md)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .stroke(Theme.border, lineWidth: 1))
    }
}

/// Filled button in the accent colour (the main choice).
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: Theme.FontSize.large, weight: .semibold))
            .foregroundColor(isEnabled ? Theme.accentText : Theme.textFaint)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Theme.Space.md)
            .background(isEnabled ? Theme.accent : Theme.surfaceRaised)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// Outlined button for the other choices.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: Theme.FontSize.base, weight: .medium))
            .foregroundColor(isEnabled ? Theme.text : Theme.textFaint)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Theme.Space.md)
            .background(Theme.surfaceRaised)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.lg)
                    .stroke(Theme.border, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// Section heading inside a tab.
struct SectionTitle: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.system(size: Theme.FontSize.large, weight: .semibold))
            .foregroundColor(Theme.text)
    }
}

/// Muted body text.
struct Muted: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.system(size: Theme.FontSize.small))
            .foregroundColor(Theme.textMuted)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Normal body text.
struct BodyText: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.system(size: Theme.FontSize.base))
            .foregroundColor(Theme.text)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A scrolling tab page with the common background and padding.
struct TabPage<Content: View>: View {
    private let title: String
    private let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                Text(title)
                    .font(.system(size: Theme.FontSize.title, weight: .bold))
                    .foregroundColor(Theme.text)
                content
            }
            .padding(Theme.Space.md)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.bg.ignoresSafeArea())
    }
}

/// The error message, shown over the top of the screen until the user dismisses it. It hangs off the root view
/// as a plain overlay, not as an alert, because an alert is dropped when a sheet is closing in the same moment
/// (a confirmed change that fails sets the error and closes the confirmation together).
struct ErrorBanner: View {
    let title: String
    let message: String
    let dismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            Text(title)
                .font(.system(size: Theme.FontSize.large, weight: .bold))
                .foregroundColor(Theme.text)
                .accessibilityIdentifier("error.title")
            Text(message)
                .font(.system(size: Theme.FontSize.base))
                .foregroundColor(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("error.message")
            Button {
                dismiss()
            } label: {
                Text("Đã hiểu")
            }
            .buttonStyle(PrimaryButtonStyle())
            .accessibilityIdentifier("error.dismiss")
        }
        .padding(Theme.Space.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .stroke(Theme.accent, lineWidth: 2))
        .padding(.horizontal, Theme.Space.md)
        .padding(.top, Theme.Space.sm)
    }
}
