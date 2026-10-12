# Checklist nghiệm thu

Mỗi giai đoạn có hai phần: phần **đã kiểm tra tự động** (build và test chạy trên máy phát triển) và phần **cần kiểm tra trên thiết bị thật** (chỉ người dùng làm được).

## Giai đoạn 0: Khung repo

Đã kiểm tra tự động:

- [x] Mọi file test vector là JSON hợp lệ.
- [x] Token giao diện sinh ra cho cả ba nền tảng; mọi cặp màu chữ/nền đạt tương phản AA (≥ 4.5:1).
- [x] Biểu tượng xuất đủ cỡ cho extension (16, 32, 48, 128) và bản gốc 1024 px.
