import SwiftUI
import DopaDamCore

struct StudyView: View {
    @Environment(AppModel.self) private var model
    @State private var label: String = ""
    @State private var form = StudyRuleForm()

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 30)) { timeline in
            content(now: nowMs(of: timeline.date))
        }
    }

    private func content(now: Int64) -> some View {
        let panel = model.state.studyPanel(now: now, tz: deviceTzOffset(at: now))
        return TabPage(title: "Học") {
            Card {
                SectionTitle("Phiên học")
                BodyText(panel.statusLine)
                if panel.canStop {
                    Button {
                        model.request(.stopStudy)
                    } label: {
                        Text("Kết thúc sớm")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }
            Card {
                SectionTitle("Bắt đầu học")
                TextField("Nhãn (ví dụ: Ôn thi)", text: $label)
                    .textFieldStyle(.roundedBorder)
                HStack(spacing: Theme.Space.sm) {
                    ForEach(panel.manualMinutes, id: \.self) { minutes in
                        Button {
                            model.startStudy(minutes: minutes, label: label)
                        } label: {
                            Text(OverviewText.minuteButton(minutes))
                        }
                        .buttonStyle(PrimaryButtonStyle())
                    }
                }
                Muted("Trong phiên học, các thay đổi làm yếu bảo vệ bị khóa.")
            }
            Card {
                SectionTitle("Khung giờ học hằng tuần")
                if panel.rules.isEmpty {
                    Muted(OverviewText.noRules)
                } else {
                    ForEach(panel.rules) { row in
                        HStack {
                            BodyText(row.line)
                            Spacer()
                            Button {
                                model.request(.deleteStudyRule(id: row.id))
                            } label: {
                                Text("Xóa")
                                    .foregroundColor(Theme.accent)
                            }
                        }
                    }
                }
            }
            ruleForm
        }
    }

    private var ruleForm: some View {
        Card {
            SectionTitle("Thêm khung giờ")
            HStack {
                ForEach(1...7, id: \.self) { day in
                    Button {
                        form.toggle(day: day)
                    } label: {
                        Text(Wording.riskRowLabels[day - 1])
                            .font(.system(size: Theme.FontSize.small, weight: .semibold))
                            .foregroundColor(form.days.contains(day) ? Theme.accentText : Theme.text)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, Theme.Space.sm)
                            .background(form.days.contains(day) ? Theme.accent : Theme.surfaceRaised)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
                    }
                }
            }
            HStack {
                BodyText("Từ")
                timePickers(hour: $form.startHour, minute: $form.startMinute)
            }
            HStack {
                BodyText("Đến")
                timePickers(hour: $form.endHour, minute: $form.endMinute)
            }
            TextField("Nhãn (không bắt buộc)", text: $form.label)
                .textFieldStyle(.roundedBorder)
            if let problem = form.problem {
                Muted(problem)
            }
            Button {
                model.request(.studyRule(form.rule()))
            } label: {
                Text("Thêm")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(form.problem != nil)
        }
    }

    private func timePickers(hour: Binding<Int>, minute: Binding<Int>) -> some View {
        HStack(spacing: Theme.Space.xs) {
            Picker("Giờ", selection: hour) {
                ForEach(0..<24, id: \.self) { h in
                    Text(h < 10 ? "0\(h)" : "\(h)").tag(h)
                }
            }
            .pickerStyle(.menu)
            BodyText(":")
            Picker("Phút", selection: minute) {
                ForEach([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55], id: \.self) { m in
                    Text(m < 10 ? "0\(m)" : "\(m)").tag(m)
                }
            }
            .pickerStyle(.menu)
        }
    }
}
