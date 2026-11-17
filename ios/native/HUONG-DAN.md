# Ứng dụng DopaDam cho iPhone (bản gốc)

Đây là ứng dụng iOS thật (SwiftUI), cài lên máy như mọi app khác. Nó không dùng Screen Time của Apple (thứ đó cần tài khoản nhà phát triển trả phí); thay vào đó app cung cấp hai hành động cho ứng dụng Phím tắt, và một tự động hóa "khi mở app X" gọi hai hành động này để hiện màn hình hỏi.

## Tình trạng hiện tại, nói thẳng

- **Phần lõi** (`DopaDamCore`: cách tính cấp, Chế độ Học, Giờ nguy cơ, thống kê, lưu dữ liệu) đã được biên dịch và chạy 111 test trên Linux, gồm toàn bộ ca kiểm thử chung với các nền tảng khác.
- **Phần giao diện và hai hành động Phím tắt chưa từng được biên dịch**, vì việc đó cần Xcode trên macOS. Mã mới chỉ qua kiểm tra cú pháp. Lần biên dịch đầu trên GitHub rất có thể báo vài lỗi; khi đó tải tệp `xcodebuild.log` trong kết quả của lần chạy và gửi lại để sửa.
- Chưa có gì được chạy trên iPhone thật.

Nếu cần dùng ngay hôm nay, bản trang web trong `ios/HUONG-DAN.md` đã chạy thử được trong trình duyệt.

## Bước 1: Cho GitHub biên dịch (không cần máy Mac)

1. Đẩy nhánh mã này lên GitHub.
2. Trên GitHub, mở tab **Actions**, chọn workflow **Ung dung DopaDam cho iPhone**, bấm **Run workflow**. GitHub chạy nó trên một máy Mac của họ, mất khoảng 10 phút. Kho mã riêng tư bị tính phút máy Mac gấp 10 lần vào hạn mức miễn phí; kho công khai thì không tốn.
3. Chạy xong, mở lần chạy đó, phần **Artifacts** có `DopaDam-unsigned.ipa` (ứng dụng chưa ký) và `xcodebuild.log`.
   - Nếu lần chạy báo đỏ: tải `xcodebuild.log`, tìm các dòng có `error:` và gửi lại.

## Bước 2: Cài lên iPhone từ máy Windows

Tệp `.ipa` chưa ký nên phải ký bằng một Apple ID trước khi cài. Cách không tốn tiền:

1. Cài **iTunes** và **iCloud** bản tải từ trang Apple (không dùng bản trong Microsoft Store), rồi cài **Sideloadly** (sideloadly.io).
2. Cắm iPhone vào máy tính, bấm "Tin cậy" trên iPhone.
3. Mở Sideloadly, kéo `DopaDam-unsigned.ipa` vào, nhập Apple ID của người dùng iPhone, bấm Start.
4. Trên iPhone: **Cài đặt → Cài đặt chung → Quản lý VPN & Thiết bị**, chọn Apple ID vừa dùng, bấm **Tin cậy**. Từ iOS 16 còn phải bật **Cài đặt → Quyền riêng tư & Bảo mật → Chế độ nhà phát triển**.

Giới hạn của Apple ID miễn phí: app hết hạn sau **7 ngày** và phải cắm máy cài lại (dữ liệu trong app vẫn còn nếu cài đè); mỗi Apple ID cài được tối đa 3 app kiểu này. Tài khoản nhà phát triển trả phí (99 USD/năm) thì hạn là 1 năm.

Apple ID nhập vào Sideloadly là của bạn của bạn: hãy để chính người đó nhập, hoặc tạo một Apple ID riêng chỉ để ký app.

## Bước 3: Tạo tự động hóa cho từng app muốn canh (trên iPhone)

Mở DopaDam một lần trước để hai hành động của nó xuất hiện trong Phím tắt. Tab **Hướng dẫn** trong app cũng có các bước này.

1. Ứng dụng **Phím tắt** → tab **Tự động hóa** → dấu **+** → **Ứng dụng**.
2. Chọn app (ví dụ TikTok), đánh dấu **Được mở**, chọn **Chạy ngay**, tắt **Thông báo khi chạy**. Bấm **Tiếp** → **Tự động hóa trống mới**.
3. Thêm hành động **DopaDam: có cần hỏi không**, ô **Tên ứng dụng** gõ `TikTok`.
4. Thêm **Nếu** (If): điều kiện là kết quả của hành động trên **là đúng** (hoặc "có giá trị 1", tùy máy hiện).
5. Bên trong nhánh Nếu, thêm hành động **DopaDam: mở màn hình hỏi**, ô **Tên ứng dụng** gõ đúng tên ở bước 3.
6. Bấm **Xong**. Làm lại cho từng app.

Tên gõ ở bước 3 và 5 phải giống nhau. Với các app DopaDam biết địa chỉ mở (YouTube, TikTok, Facebook, Instagram, Messenger, X, Reddit, Netflix, Zalo, Threads), hãy gõ đúng tên đó để sau khi bấm Vào, DopaDam tự mở lại app cho bạn.

## Kiểm tra sau khi cài

1. Mở một app đã tạo tự động hóa → DopaDam bật lên với câu "Bạn mở … để làm gì?", nút Vào đếm ngược 5 giây.
2. Bấm **Thoát** → về màn hình chính.
3. Mở lại app → cảnh báo ghi "Lần thứ 2 trong 60 phút qua", khóa 10 giây.
4. Chờ hết đếm ngược, bấm **Vào**, chọn **5 phút** → app giải trí mở ra (hoặc DopaDam báo "Đã cho vào 5 phút. Mở lại …").
5. Thoát app giải trí rồi mở lại ngay → vào thẳng, không hỏi.
6. Sau 4 phút có thông báo "Còn 1 phút"; hết 5 phút có thông báo hết thời gian. Mở lại app sau đó → cảnh báo hiện lại.
7. Trong DopaDam, tab **Học**: bật 25 phút rồi mở app giải trí → khóa 30 giây, chỉ còn lựa chọn 5 hoặc 10 phút.
8. Tab **Cài đặt**: giảm một thời gian khóa → phải chờ 60 giây và gõ "tôi chọn giảm bảo vệ".

Nếu ở bước 4 của phần tạo tự động hóa không chọn được điều kiện "là đúng": báo lại, hành động thứ nhất sẽ được đổi sang trả về chữ thay vì giá trị đúng/sai.

## Khác gì so với bản Android

- Hết thời gian cho vào, iPhone không tự kéo bạn ra khỏi app; bạn nhận thông báo, và cảnh báo hiện lại ở lần mở kế tiếp.
- Ngân sách ngày tính theo số phút đã cho vào, vì app không đo được thời gian dùng thật.
- Chưa đồng bộ với máy tính và điện thoại khác.
- Người dùng tắt được tự động hóa trong Phím tắt. Cũng như mọi nền tảng, DopaDam tạo một khoảng dừng, không phải ổ khóa.
