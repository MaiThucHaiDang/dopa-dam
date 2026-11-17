import Foundation

/// The titles under which the two actions appear in Shortcuts (the same strings are in the app's intents).
public enum IntentTitles {
    public static let shouldAsk = "DopaDam: có cần hỏi không"
    public static let showWarning = "DopaDam: mở màn hình hỏi"
    public static let parameter = "Tên ứng dụng"
}

public struct GuideStep: Equatable, Sendable, Identifiable {
    public var id: Int
    public var title: String
    public var body: String
}

/// "Hướng dẫn" tab: how to make the Shortcuts automation, once per guarded app.
public enum Guide {
    public static let intro = "iPhone không cho app thường chặn app khác. DopaDam dùng Phím tắt: mỗi khi bạn mở một app giải trí, một lệnh tự động hỏi DopaDam và mở màn hình hỏi nếu cần. Làm các bước sau cho từng app muốn canh."
    public static let notificationNote = "DopaDam dùng thông báo để nhắc \"còn 1 phút\", \"hết thời gian\" và khi xong việc khác."
    public static let requestButton = "Bật thông báo"
    public static let knownAppsLine = "Các app sau được mở thẳng sau khi bấm Vào: " + AppLinks.knownNames.joined(separator: ", ") + ". App khác: bạn tự mở lại."

    public static let steps: [GuideStep] = [
        GuideStep(id: 1, title: "Tạo lệnh tự động",
                  body: "Mở app Phím tắt, vào tab Tự động hóa, bấm dấu cộng, chọn Ứng dụng."),
        GuideStep(id: 2, title: "Chọn app cần canh",
                  body: "Chọn Đã mở, rồi chọn app giải trí (ví dụ YouTube). Bấm Tiếp."),
        GuideStep(id: 3, title: "Thêm hành động 1",
                  body: "Thêm hành động \"\(IntentTitles.shouldAsk)\" của DopaDam. Ở ô \(IntentTitles.parameter), gõ đúng tên app, ví dụ YouTube."),
        GuideStep(id: 4, title: "Thêm điều kiện",
                  body: "Thêm hành động Nếu. Điều kiện: kết quả của hành động 1 là có (true)."),
        GuideStep(id: 5, title: "Thêm hành động 2",
                  body: "Trong nhánh Nếu, thêm hành động \"\(IntentTitles.showWarning)\" của DopaDam, cùng \(IntentTitles.parameter) như hành động 1."),
        GuideStep(id: 6, title: "Chạy ngay, không hỏi",
                  body: "Ở màn hình cuối, chọn Chạy ngay (không chọn Chạy sau khi xác nhận) và tắt Thông báo khi chạy."),
    ]

    public static let outro = "Gõ cùng một tên app ở cả hai hành động. Thêm một lệnh tự động riêng cho mỗi app."
}
