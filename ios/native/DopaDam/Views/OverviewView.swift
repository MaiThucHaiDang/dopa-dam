import SwiftUI
import DopaDamCore

struct OverviewView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 30)) { timeline in
            content(now: nowMs(of: timeline.date))
        }
    }

    private func content(now: Int64) -> some View {
        let tz = deviceTzOffset(at: now)
        let today = model.state.todaySummary(now: now, tz: tz)
        let study = model.state.studyPanel(now: now, tz: tz)
        let apps = model.state.appsSeen()
        return TabPage(title: "Tổng quan") {
            Card {
                SectionTitle("Hôm nay")
                HStack(alignment: .top) {
                    ForEach(todayStatItems(today)) { item in
                        VStack(spacing: Theme.Space.xs) {
                            Text(item.value)
                                .font(.system(size: Theme.FontSize.title, weight: .bold))
                                .foregroundColor(Theme.text)
                            Text(item.label)
                                .font(.system(size: Theme.FontSize.small))
                                .foregroundColor(Theme.textMuted)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                BodyText(exitShareLine(today))
                Muted(today.budgetLine)
            }
            Card {
                SectionTitle("Việc học")
                BodyText(study.statusLine)
            }
            Card {
                SectionTitle("App đã hỏi")
                if apps.isEmpty {
                    Muted(OverviewText.noApps)
                } else {
                    ForEach(apps) { app in
                        VStack(alignment: .leading, spacing: Theme.Space.xs) {
                            BodyText(app.name)
                            Muted(appUsageLine(app))
                        }
                    }
                }
            }
        }
    }
}
