# Checklist nghiệm thu

Mỗi giai đoạn có hai phần: phần **đã kiểm tra tự động** (build và test chạy trên máy phát triển) và phần **cần kiểm tra trên thiết bị thật** (chỉ người dùng làm được).

## Giai đoạn 0: Khung repo

Đã kiểm tra tự động:

- [x] Mọi file test vector là JSON hợp lệ.
- [x] Token giao diện sinh ra cho cả ba nền tảng; mọi cặp màu chữ/nền đạt tương phản AA (≥ 4.5:1).
- [x] Biểu tượng xuất đủ cỡ cho extension (16, 32, 48, 128) và bản gốc 1024 px.

## Giai đoạn 1: Extension Edge

Đã kiểm tra tự động (`cd extension && npm run check && npm run e2e`):

- [x] Lõi logic TypeScript cho kết quả đúng với toàn bộ test vector dùng chung.
- [x] Luật chặn của Edge (declarativeNetRequest) và hàm kiểm tra URL cho cùng kết quả trên 30+ địa chỉ mẫu (trang chặn, link được phép, khoảng được phép, tên miền con, cổng).
- [x] Trong Edge thật (chạy ẩn): trang bị chặn chuyển sang trang cảnh báo trước khi tải; nút Vào khóa và đếm ngược; Enter và Esc là Thoát, kể cả khi đã hết đếm ngược và con trỏ bàn phím nằm chỗ khác; bấm Vào bằng bàn phím không có tác dụng; bấm chuột vào Vào rồi chọn thời gian thì mở đúng trang và trong khoảng được phép trang mở thẳng; cấp tăng theo số lần mở; link được phép mở thẳng còn chuyển trang bên trong (kiểu YouTube) sang trang khác thì bị chặn; tải lại trang cảnh báo không bị đếm hai lần; Làm việc khác chạy đồng hồ; gỡ trang khỏi danh sách hiện hộp xác nhận chờ 60 giây; tắt rồi bật lại bảo vệ.

Cần kiểm tra trên máy thật:

- [ ] Cài từ `extension/dist` (edge://extensions → Chế độ nhà phát triển → Load unpacked) và dùng 7 ngày liền mà không tắt.
- [ ] Mở YouTube, Facebook, TikTok: không thấy thumbnail nào trước màn hình cảnh báo.
- [ ] Khoảng được phép: thông báo "Còn 1 phút" hiện đúng lúc, hết giờ thì tab đang mở chuyển sang cảnh báo.
- [ ] Bật "Cho phép trong InPrivate" cho extension và thử mở trang bị chặn trong cửa sổ InPrivate.

## Giai đoạn 2: App Android

Đã kiểm tra tự động (`.\android\build.ps1 testDebugUnitTest lintDebug assembleRelease`):

- [x] Lõi logic Kotlin cho kết quả đúng với toàn bộ test vector dùng chung; logic quyết định (thời gian khóa, khoảng được phép, làm việc khác, giảm bảo vệ) và bộ đếm độ trễ của game có unit test riêng.
- [x] Android Lint không còn lỗi; APK release được ký và có đủ khai báo (dịch vụ Trợ năng có quyền `BIND_ACCESSIBILITY_SERVICE`, không xin quyền đọc nội dung màn hình).
- [x] Trên máy ảo Android 14 (`python android/e2e/emulator_test.py`): bật Trợ năng, gán tag Giải trí cho một app qua giao diện, mở app đó thì lớp phủ cảnh báo hiện ra; nút Back là Thoát và đưa về màn hình chính; lần chặn và lựa chọn Thoát được đếm đúng; mở lại thì cảnh báo hiện lại với cấp cao hơn (khóa 10 giây).

Cần kiểm tra trên điện thoại thật (Xiaomi):

- [ ] Cài APK, làm đủ các bước trong trang Hướng dẫn (Trợ năng, thông báo, pin, Autostart, khóa trong đa nhiệm).
- [ ] Chạy 7 ngày liền mà quyền Trợ năng không bị tắt.
- [ ] Mở YouTube/TikTok: cảnh báo hiện ra kịp, video phía sau tạm dừng tiếng.
- [ ] Game có độ trễ 30 giây: cảnh báo hiện sau khi game tải xong, không bị game che.

## Giai đoạn 3: Agent Windows

Đã kiểm tra tự động:

- [x] Lõi logic Rust cho kết quả đúng với toàn bộ test vector dùng chung (kể cả khớp tên miền); kho dữ liệu SQLite, quy tắc giảm bảo vệ, khóa trong giờ học, link được phép và manifest cầu nối Edge có unit test (`cargo test`, `cargo clippy` không cảnh báo).
- [x] Giao diện agent: kiểm tra kiểu và build (`npm run check`).
- [x] Edge thật + agent thật qua native messaging (`node extension/test/e2e/with-agent.mjs`): extension nối được với agent; đổi tag trang web đi qua agent và agent vẫn đòi xác nhận khi gỡ chặn; cấu hình agent về tới extension; lần chặn trong Edge và lựa chọn Thoát được ghi vào cơ sở dữ liệu của agent; bấm Vào tạo khoảng được phép ở agent; popup hiện số liệu của agent; tắt agent thì extension vẫn tự chặn.
- [x] Agent nhận đúng chương trình đang ở phía trước (đã thấy `notepad.exe` khi mở Notepad).

Cần kiểm tra trên máy (lúc không dùng máy cho việc khác, vì sẽ có cửa sổ cảnh báo bật lên):

- [ ] `python agent\e2e\desktop_test.py`: gắn tag Giải trí cho Notepad, mở Notepad thì cửa sổ cảnh báo phủ lên, Enter là Thoát và Notepad được thu nhỏ.
- [ ] Cài bộ cài NSIS, khởi động lại máy: DopaDam tự chạy ở khay hệ thống.
- [ ] Gắn tag Game cho một game: cảnh báo hiện sau độ trễ (mặc định 30 giây), không bị game che.
- [ ] Mở Edge (đã cài extension): trang Tổng quan của agent báo "Đã nối"; Edge và Chrome… gắn tag Giải trí thì bị chặn như chương trình thường.

## Giai đoạn 4: Đồng bộ, tài khoản và thống kê

Đã kiểm tra tự động:

- [x] Cấu trúc bảng Supabase chạy thật trong PGlite (`cd supabase; npm test`): mỗi tài khoản chỉ thấy dữ liệu của mình (RLS), `anon` không đọc/ghi được gì, bản cũ hơn không ghi đè bản mới hơn, nhật ký chặn không sửa được, `delete_my_data()` xóa sạch dữ liệu của đúng tài khoản gọi.
- [x] Agent với server giả (`cargo test -- --ignored`, cần `mock-server.mjs` đang chạy): tạo tài khoản, đăng nhập sai mật khẩu ra thông báo tiếng Việt, làm mới phiên, hai máy đẩy và kéo dữ liệu qua lại, "bản mới hơn thắng", tài khoản khác không thấy gì, xóa dữ liệu trên server, phiên hết hạn trả về lỗi đúng.
- [x] Android với server giả và với server giả lập trong bộ nhớ (`SyncEngineTest`): tag đi qua lại giữa hai máy và bản mới hơn thắng, nhật ký chặn chỉ thêm, dòng thời gian dùng của máy này không bị bản trên server ghi đè, kéo theo từng trang 1000 dòng và lùi con trỏ 5 phút, lỗi 401 không làm mất dữ liệu chưa đẩy.
- [x] Trang Thống kê và mục Tài khoản trên agent hiển thị không lỗi (dữ liệu giả); app Android build, lint và unit test đều qua.

Cần kiểm tra với project Supabase thật (làm theo mục "Đồng bộ và đăng nhập" trong README):

- [ ] Tạo tài khoản email trên agent, đăng nhập cùng tài khoản trên điện thoại: tag gắn ở máy này hiện ở máy kia trong vòng 1 phút.
- [ ] Đăng nhập bằng Google trên agent (mở trình duyệt, quay lại app qua `dopadam://`) và trên điện thoại (chọn tài khoản Google).
- [ ] Trang Thống kê trên cả hai thiết bị gộp lần chặn của cả điện thoại và máy tính.
- [ ] Tắt mạng: vẫn chặn bình thường; bật lại thì dữ liệu lúc offline được đẩy lên.
- [ ] "Xóa dữ liệu trên server" phải qua bước chờ 60 giây và gõ câu xác nhận.

