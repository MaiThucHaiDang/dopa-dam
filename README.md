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

## Extension Edge

Cần Node.js 20 trở lên.

```bash
cd extension
npm install
npm run check      # kiểm tra kiểu + unit test + build ra extension/dist
npm run e2e        # chạy thử đầu-cuối trong Microsoft Edge (chế độ ẩn)
```

Cài vào Edge: mở `edge://extensions`, bật **Chế độ nhà phát triển**, chọn **Load unpacked** và trỏ tới thư mục `extension/dist`. ID của extension cố định là `oaidmfkacjppoliemldjfbpnilmeejid` (nhờ trường `key` trong manifest), agent dùng ID này để nhận kết nối.

## App Android

Cần JDK 17 và Android SDK (platform 35). Build bằng script, script tự tìm JDK Temurin 17 trong `%LOCALAPPDATA%\Programs\Eclipse Adoptium` nếu chưa đặt `JAVA_HOME`:

```powershell
.\android\build.ps1                      # unit test + APK release (ký bằng khóa debug của máy)
.\android\build.ps1 assembleDebug        # chỉ APK debug
```

Vì sao có `build.ps1`: các công cụ Java trên Windows không đọc được đường dẫn có chữ có dấu (ví dụ `D:\Học\...`), nên script tạm ánh xạ repo sang một ổ đĩa ảo (lệnh `subst`) trong lúc build rồi gỡ ra. Nếu repo nằm ở đường dẫn chỉ có chữ không dấu thì cũng có thể chạy thẳng `android\gradlew.bat`.

Cài lên điện thoại: `adb install -r android\app\build\outputs\apk\release\app-release.apk` (hoặc chép file APK sang điện thoại rồi mở), sau đó mở DopaDam → **Hướng dẫn và kiểm tra quyền**.

Kiểm thử trên máy ảo hoặc điện thoại thật đang cắm cáp: `python android/e2e/emulator_test.py --shots <thư mục ảnh>`.

## Token giao diện và biểu tượng

```bash
node shared/design-tokens/generate.mjs          # sinh token cho 3 nền tảng, kiểm tra tương phản AA
node shared/design-tokens/generate.mjs --check  # chỉ kiểm tra, không ghi file
python shared/brand/make_icons.py               # vẽ lại biểu tượng (cần Pillow)
```
