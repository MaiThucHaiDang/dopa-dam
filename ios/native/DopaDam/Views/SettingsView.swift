import SwiftUI
import DopaDamCore

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var form = SettingsForm(settings: DopaDamCore.Settings())
    @State private var loaded = false
    @State private var formProblem: String?

    var body: some View {
        TabPage(title: "Cài đặt") {
            Card {
                SectionTitle("Thời gian chờ nút Vào")
                Muted("Số giây nút Vào bị khóa, theo mức cản trở. Hỏi càng nhiều trong một giờ thì mức càng cao.")
                ForEach(0..<4, id: \.self) { level in
                    HStack {
                        BodyText(SettingsForm.lockLabels[level])
                        Spacer()
                        TextField("giây", text: lockBinding(level))
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 80)
                            .accessibilityIdentifier("settings.lock.\(level)")
                    }
                }
            }
            Card {
                SectionTitle("Số phút được vào")
                BodyText("Mức 0 đến 2")
                TextField("5, 15, 30", text: normalBinding)
                    .textFieldStyle(.roundedBorder)
                BodyText("Mức 3")
                TextField("5, 10", text: restrictedBinding)
                    .textFieldStyle(.roundedBorder)
                Muted("Mỗi mức có 1 đến 4 lựa chọn, cách nhau bằng dấu phẩy.")
            }
            Card {
                SectionTitle("Hạn mức mỗi ngày")
                HStack {
                    BodyText("Phút giải trí")
                    Spacer()
                    TextField("phút", text: budgetBinding)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 80)
                        .accessibilityIdentifier("settings.budget")
                }
                Muted("0 là tắt hạn mức. Quá hạn mức thì mọi lần hỏi ở mức 3.")
            }
            if let problem = formProblem {
                Muted(problem)
            }
            Button {
                save()
            } label: {
                Text("Lưu cài đặt")
            }
            .buttonStyle(PrimaryButtonStyle())
            .accessibilityIdentifier("settings.save")
            Button {
                form = SettingsForm(settings: model.state.settings)
                formProblem = nil
            } label: {
                Text("Hoàn tác thay đổi chưa lưu")
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityIdentifier("settings.undo")
            Card {
                SectionTitle("Nhật ký")
                Muted("Xóa nhật ký sẽ đưa số lần hỏi và số phút đã dùng hôm nay về 0.")
                Button {
                    model.request(.clearLog)
                } label: {
                    Text("Xóa nhật ký")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
        .onAppear {
            if !loaded {
                form = SettingsForm(settings: model.state.settings)
                loaded = true
            }
        }
    }

    private func save() {
        switch form.settings() {
        case .success(let settings):
            formProblem = nil
            model.request(.settings(settings))
        case .failure(let error):
            formProblem = error.message
        }
    }

    private func lockBinding(_ level: Int) -> Binding<String> {
        Binding(
            get: { level < form.lockSeconds.count ? form.lockSeconds[level] : "" },
            set: { newValue in
                if level < form.lockSeconds.count { form.lockSeconds[level] = newValue }
            })
    }

    private var normalBinding: Binding<String> {
        Binding(get: { form.allowNormal }, set: { form.allowNormal = $0 })
    }

    private var restrictedBinding: Binding<String> {
        Binding(get: { form.allowRestricted }, set: { form.allowRestricted = $0 })
    }

    private var budgetBinding: Binding<String> {
        Binding(get: { form.budget }, set: { form.budget = $0 })
    }
}
