# DopaDam

DopaDam chen một khoảng dừng ngắn giữa cú bấm vô thức và nội dung giải trí, trên điện thoại Android, máy tính Windows và trình duyệt Edge, rồi siết khoảng dừng đó chặt hơn trong giờ học. Ứng dụng cảnh báo chứ không cấm: nút Thoát luôn bấm được ngay, nút Vào chỉ mở sau vài giây đếm ngược.

- Đặc tả: [DopaDam-dac-ta.md](DopaDam-dac-ta.md)
- Thiết kế kỹ thuật: [docs/thiet-ke-ky-thuat.md](docs/thiet-ke-ky-thuat.md)
- Checklist nghiệm thu: [docs/nghiem-thu.md](docs/nghiem-thu.md)

## Cấu trúc

| Thư mục | Thành phần |
| --- | --- |
| `extension/` | Extension Microsoft Edge (TypeScript, Manifest V3) |
| `android/` | App Android (Kotlin, Jetpack Compose) |
| `agent/` | Agent Windows (Tauri 2: Rust + React) |
| `supabase/` | Cấu trúc bảng và quy tắc bảo mật cho phần đồng bộ |
| `shared/` | Token giao diện, biểu tượng và bộ test vector dùng chung |
| `docs/` | Tài liệu kỹ thuật |

## Token giao diện và biểu tượng

```bash
node shared/design-tokens/generate.mjs          # sinh token cho 3 nền tảng, kiểm tra tương phản AA
node shared/design-tokens/generate.mjs --check  # chỉ kiểm tra, không ghi file
python shared/brand/make_icons.py               # vẽ lại biểu tượng (cần Pillow)
```
