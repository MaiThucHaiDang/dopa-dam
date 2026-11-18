Bản thử nghiệm (pre-release) của DopaDam. Mỗi lần bạn mở một ứng dụng hoặc trang web giải trí, DopaDam hỏi "Bạn mở … để làm gì?" và cho ba lựa chọn: **Thoát**, **Vào** (phải chờ đếm ngược) hoặc **Làm việc khác**.

## Tải file nào

| Thiết bị | File | Cách cài |
| --- | --- | --- |
| Máy tính Windows | `DopaDam_…_x64-setup.exe` | Chạy file. Windows có thể hiện "Windows đã bảo vệ máy tính của bạn" vì bộ cài chưa được ký: bấm **Thông tin thêm → Vẫn chạy**. Cài cho người dùng hiện tại, không cần quyền quản trị. |
| Máy tính Linux (Ubuntu, Debian) | `DopaDam_…_amd64.deb` | `sudo apt install ./DopaDam_…_amd64.deb`. Trên GNOME: mở DopaDam, bấm **Cài tiện ích GNOME**, rồi đăng xuất và đăng nhập lại. |
| Máy tính Linux khác | `DopaDam_…_amd64.AppImage` | `chmod +x` rồi chạy file. |
| Trình duyệt (Edge, Chrome, Brave) | `DopaDam-extension.zip` | Giải nén vào một thư mục cố định. Mở `edge://extensions` (hoặc `chrome://extensions`), bật **Chế độ nhà phát triển**, bấm **Load unpacked** và chọn thư mục đó. |
| Điện thoại Android | `DopaDam-android-debug.apk` | Chép sang điện thoại, mở file, cho phép cài từ nguồn này. Sau đó mở DopaDam → **Hướng dẫn và kiểm tra quyền** và làm hết các bước. |
| iPhone | `DopaDam-unsigned.ipa` | Phải ký và cài bằng Sideloadly từ máy tính. Các bước nằm trong [ios/native/HUONG-DAN.md](https://github.com/MaiThucHaiDang/dopa-dam/blob/main/ios/native/HUONG-DAN.md). |

Trên máy tính, hãy cài cả chương trình DopaDam và extension trình duyệt. Hai phần tự nối với nhau: chương trình canh các phần mềm, extension canh các trang web.

## Cần biết trước

- **Đồng bộ giữa các máy chưa bật** trong bản này. Mỗi thiết bị có dữ liệu riêng.
- **iPhone:** khi ký bằng Apple ID miễn phí, app hết hạn sau 7 ngày và phải cài lại bằng Sideloadly; dữ liệu vẫn còn nếu cài đè. iPhone không cho app tự kéo bạn ra khỏi ứng dụng khác, nên DopaDam hỏi qua một tự động hóa trong ứng dụng Phím tắt.
- **Android:** đây là bản debug. Cài một bản mới hơn sau này có thể phải gỡ bản cũ trước, và gỡ thì mất dữ liệu.
- DopaDam tạo một khoảng dừng để bạn kịp nghĩ lại, không phải một ổ khóa. Ai muốn tắt thì vẫn tắt được.

## Thử nhanh sau khi cài

1. Mở một trang hoặc ứng dụng giải trí (ví dụ YouTube). DopaDam hỏi "Bạn mở … để làm gì?", và nút **Vào** bị khóa 5 giây.
2. Bấm **Thoát**, rồi mở lại ngay: lần này câu hỏi ghi "Lần thứ 2 trong 60 phút qua" và khóa 10 giây.
3. Chờ hết đếm ngược, bấm **Vào** và chọn 5 phút. Trong 5 phút đó DopaDam không hỏi lại.
4. Bật **Chế độ Học** 25 phút rồi mở lại: nút Vào bị khóa 30 giây và chỉ còn lựa chọn ngắn.
5. Thử giảm một thời gian khóa trong Cài đặt: DopaDam bắt chờ 60 giây và gõ "tôi chọn giảm bảo vệ".
6. Sau vài ngày dùng, trang **Thống kê** có bản đồ **Giờ nguy cơ** và gợi ý một khung giờ để tăng cản trở.
7. Trên YouTube, thêm một video bài giảng vào danh sách được phép: khi mở video đó, phần đề xuất, Shorts và màn hình cuối video bị ẩn (**Chế độ bài giảng**).
