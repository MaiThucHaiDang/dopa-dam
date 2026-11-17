import SwiftUI
import DopaDamCore

struct GuideView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        TabPage(title: "Hướng dẫn") {
            Card {
                BodyText(Guide.intro)
            }
            ForEach(Guide.steps) { step in
                Card {
                    SectionTitle("\(step.id). \(step.title)")
                    BodyText(step.body)
                }
            }
            Card {
                BodyText(Guide.outro)
                Muted(Guide.knownAppsLine)
            }
            Card {
                SectionTitle("Thông báo")
                BodyText(Guide.notificationNote)
                Muted(model.permission.text)
                Button {
                    model.requestNotificationPermission()
                } label: {
                    Text(Guide.requestButton)
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        }
    }
}
