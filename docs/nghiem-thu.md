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
