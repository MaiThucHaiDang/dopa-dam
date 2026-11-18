import SwiftUI
import DopaDamCore

struct StatsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let now = nowMs()
        let tz = deviceTzOffset(at: now)
        let progress = model.state.weeklyProgressCard(now: now, tz: tz)
        let risk = model.state.riskCard(now: now, tz: tz)
        let days = model.state.dayStats(days: 14, now: now, tz: tz)
        return TabPage(title: "Thống kê") {
            progressCard(progress)
            riskCardView(risk)
            chartCard(days)
        }
    }

    // MARK: Weekly progress

    private func progressCard(_ card: ProgressCard) -> some View {
        Card {
            SectionTitle(card.title)
            Muted(card.subtitle)
            ForEach(card.rows.indices, id: \.self) { index in
                let row = card.rows[index]
                VStack(alignment: .leading, spacing: Theme.Space.xs) {
                    BodyText(row.label)
                    Text(row.text)
                        .font(.system(size: Theme.FontSize.base, weight: .semibold))
                        .foregroundColor(Theme.accent)
                    Muted(row.comparison)
                }
            }
        }
    }

    // MARK: Risk hours

    private func riskCardView(_ card: RiskCard) -> some View {
        Card {
            SectionTitle("Giờ nguy cơ")
            Muted(card.subtitle)
            HeatmapView(card: card)
            BodyText(card.suggestionText)
                .accessibilityIdentifier("stats.risk.suggestion")
            if let suggestion = card.suggestion, card.canAddWindow {
                Button {
                    model.request(.addRiskWindow(suggestion.asWindow()))
                } label: {
                    Text("Tăng cản trở trong khung này")
                }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("stats.risk.add")
            }
            if card.windows.isEmpty {
                Muted(OverviewText.noWindows)
            } else {
                ForEach(card.windows) { row in
                    HStack {
                        BodyText(row.line)
                            .accessibilityIdentifier("stats.risk.window")
                        Spacer()
                        Button {
                            model.request(.removeRiskWindow(id: row.id))
                        } label: {
                            Text("Gỡ")
                                .foregroundColor(Theme.accent)
                        }
                        .accessibilityIdentifier("stats.risk.remove")
                    }
                }
            }
        }
    }

    // MARK: 14-day chart

    private func chartCard(_ days: [DayStat]) -> some View {
        Card {
            SectionTitle(ChartText.title)
            StackedBarsView(days: days)
        }
    }
}

/// 7 rows (Monday first) of 24 hours, one square per hour; the shade is `intensity`.
struct HeatmapView: View {
    let card: RiskCard
    @State private var selected: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 0) {
                Text("")
                    .frame(width: 24)
                ForEach([0, 6, 12, 18], id: \.self) { hour in
                    Text("\(hour)")
                        .font(.system(size: 10))
                        .foregroundColor(Theme.textFaint)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            ForEach(card.cells.indices, id: \.self) { row in
                HStack(spacing: 2) {
                    Text(card.rowLabels[row])
                        .font(.system(size: 10))
                        .foregroundColor(Theme.textFaint)
                        .frame(width: 22, alignment: .leading)
                    ForEach(card.cells[row].indices, id: \.self) { hour in
                        cell(card.cells[row][hour])
                    }
                }
            }
            if !selected.isEmpty {
                Muted(selected)
                    .padding(.top, Theme.Space.xs)
            }
        }
    }

    private func cell(_ cell: RiskCellView) -> some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(cell.intensity > 0 ? Theme.accent.opacity(cell.intensity) : Theme.surfaceRaised)
            .frame(maxWidth: .infinity)
            .aspectRatio(1, contentMode: .fit)
            .onTapGesture {
                selected = cell.label
            }
    }
}

/// Stacked bars of the last days: Thoát, Vào, Làm việc khác, Chưa chọn from the bottom up.
struct StackedBarsView: View {
    let days: [DayStat]
    private let chartHeight: CGFloat = 140

    var body: some View {
        let top = chartMax(days)
        return VStack(alignment: .leading, spacing: Theme.Space.sm) {
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(days) { day in
                    VStack(spacing: 0) {
                        segment(day.undecided, top: top, color: Theme.textFaint)
                        segment(day.alternative, top: top, color: Theme.textMuted)
                        segment(day.enter, top: top, color: Theme.text)
                        segment(day.exit, top: top, color: Theme.accent)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: chartHeight, alignment: .bottom)
                }
            }
            HStack(spacing: 3) {
                ForEach(days) { day in
                    Text(day.label)
                        .font(.system(size: 8))
                        .foregroundColor(Theme.textFaint)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .frame(maxWidth: .infinity)
                }
            }
            HStack(spacing: Theme.Space.md) {
                legend(ChartText.exit, Theme.accent)
                legend(ChartText.enter, Theme.text)
                legend(ChartText.alternative, Theme.textMuted)
                legend(ChartText.undecided, Theme.textFaint)
            }
        }
    }

    private func segment(_ count: Int, top: Int, color: Color) -> some View {
        Rectangle()
            .fill(color)
            .frame(height: CGFloat(count) / CGFloat(top) * chartHeight)
    }

    private func legend(_ text: String, _ color: Color) -> some View {
        HStack(spacing: Theme.Space.xs) {
            Rectangle()
                .fill(color)
                .frame(width: 10, height: 10)
            Text(text)
                .font(.system(size: 11))
                .foregroundColor(Theme.textMuted)
        }
    }
}
