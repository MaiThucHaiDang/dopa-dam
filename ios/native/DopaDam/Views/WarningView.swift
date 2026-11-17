import SwiftUI
import DopaDamCore

/// The full-screen question "Bạn mở … để làm gì?" and everything that follows from the choice.
struct WarningView: View {
    @Environment(AppModel.self) private var model
    let flow: WarningFlow

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                phaseContent
            }
            .padding(Theme.Space.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.bg.ignoresSafeArea())
    }

    @ViewBuilder
    private var phaseContent: some View {
        switch flow.phase {
        case .question:
            questionView
        case .chooseMinutes:
            minutesView
        case .chooseActivity:
            activityPickerView
        case .allowed:
            allowedView
        case .exited:
            exitedView
        case .activity(let name, _, _):
            activityTimerView(name: name)
        }
    }

    // MARK: Question

    private var questionView: some View {
        let context = flow.context
        return VStack(alignment: .leading, spacing: Theme.Space.md) {
            Text(context.headline)
                .font(.system(size: Theme.FontSize.hero, weight: .bold))
                .foregroundColor(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, Theme.Space.xl)
            Text(context.subtitle)
                .font(.system(size: Theme.FontSize.large))
                .foregroundColor(Theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            Muted(context.metaLine)
            if let risk = context.riskLine {
                Muted(risk)
            }
            Muted(context.budgetLine)
            if let study = context.studyLine {
                Muted(study)
            }
            Button {
                model.exitWarning()
            } label: {
                Text(Wording.exitButton)
                    .font(.system(size: Theme.FontSize.title, weight: .bold))
                    .padding(.vertical, Theme.Space.md)
            }
            .buttonStyle(PrimaryButtonStyle())
            .padding(.top, Theme.Space.lg)
            Button {
                model.openAlternative()
            } label: {
                Text(Wording.alternativeLink)
            }
            .buttonStyle(SecondaryButtonStyle())
            TimelineView(.periodic(from: Date(), by: 0.5)) { timeline in
                let now = nowMs(of: timeline.date)
                Button {
                    model.openEnterChoices()
                } label: {
                    Text(flow.enterButtonTitle(now: now))
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(!flow.canEnter(now: now))
            }
        }
    }

    // MARK: Minutes

    private var minutesView: some View {
        VStack(alignment: .leading, spacing: Theme.Space.md) {
            Text(Wording.allowQuestion)
                .font(.system(size: Theme.FontSize.title, weight: .bold))
                .foregroundColor(Theme.text)
                .padding(.top, Theme.Space.xl)
            Muted(flow.context.budgetLine)
            ForEach(flow.context.allowOptions, id: \.self) { minutes in
                Button {
                    model.enter(minutes: minutes)
                } label: {
                    Text(formatMinutes(minutes))
                }
                .buttonStyle(PrimaryButtonStyle())
            }
            Button {
                model.backInWarning()
            } label: {
                Text(Wording.backButton)
            }
            .buttonStyle(SecondaryButtonStyle())
        }
    }

    // MARK: Activity picker

    private var activityPickerView: some View {
        VStack(alignment: .leading, spacing: Theme.Space.md) {
            Text(Wording.alternativeHeadline)
                .font(.system(size: Theme.FontSize.title, weight: .bold))
                .foregroundColor(Theme.text)
                .padding(.top, Theme.Space.xl)
            ForEach(flow.context.activities, id: \.self) { name in
                Button {
                    model.selectActivity(name)
                } label: {
                    HStack {
                        Text(name)
                        Spacer()
                        if name == flow.activity {
                            Image(systemName: "checkmark")
                        }
                    }
                    .padding(.horizontal, Theme.Space.md)
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            Stepper(
                flow.activityMinutesText,
                value: Binding(
                    get: { flow.activityMinutes },
                    set: { model.setActivityMinutes($0) }),
                in: flow.context.activityMinutesRange)
                .font(.system(size: Theme.FontSize.base))
                .foregroundColor(Theme.text)
            Button {
                model.startActivity()
            } label: {
                Text(Wording.startActivityButton)
            }
            .buttonStyle(PrimaryButtonStyle())
            Button {
                model.backInWarning()
            } label: {
                Text(Wording.backButton)
            }
            .buttonStyle(SecondaryButtonStyle())
        }
    }

    // MARK: Results

    private var allowedView: some View {
        VStack(alignment: .leading, spacing: Theme.Space.md) {
            Text(flow.allowedLine ?? "")
                .font(.system(size: Theme.FontSize.title, weight: .bold))
                .foregroundColor(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, Theme.Space.xl)
            Button {
                model.finishWarning(goHome: true)
            } label: {
                Text(AppWording.homeButton)
            }
            .buttonStyle(PrimaryButtonStyle())
        }
    }

    private var exitedView: some View {
        VStack(alignment: .leading, spacing: Theme.Space.md) {
            Text(Wording.exitedTitle)
                .font(.system(size: Theme.FontSize.hero, weight: .bold))
                .foregroundColor(Theme.text)
                .padding(.top, Theme.Space.xl)
            Text(Wording.exitedBody)
                .font(.system(size: Theme.FontSize.large))
                .foregroundColor(Theme.textMuted)
            Button {
                model.finishWarning(goHome: true)
            } label: {
                Text(AppWording.homeButton)
            }
            .buttonStyle(PrimaryButtonStyle())
        }
    }

    private func activityTimerView(name: String) -> some View {
        TimelineView(.periodic(from: Date(), by: 0.5)) { timeline in
            let now = nowMs(of: timeline.date)
            let finished = flow.activityFinished(now: now)
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                Text(finished ? Wording.activityDoneTitle : Wording.restTitle)
                    .font(.system(size: Theme.FontSize.title, weight: .bold))
                    .foregroundColor(Theme.text)
                    .padding(.top, Theme.Space.xl)
                Text(name)
                    .font(.system(size: Theme.FontSize.large))
                    .foregroundColor(Theme.textMuted)
                if finished {
                    Text(Wording.activityDoneBody)
                        .font(.system(size: Theme.FontSize.large))
                        .foregroundColor(Theme.text)
                } else {
                    Text(flow.activityClock(now: now) ?? "")
                        .font(.system(size: 72, weight: .bold, design: .rounded))
                        .foregroundColor(Theme.accent)
                    Muted(Wording.activityTimerNote)
                }
                Button {
                    model.finishWarning(goHome: false)
                } label: {
                    Text(AppWording.doneButton)
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        }
    }
}
