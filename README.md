# DopaDam

DopaDam chen một khoảng dừng ngắn giữa cú bấm vô thức và nội dung giải trí, trên điện thoại Android, máy tính Windows và trình duyệt Edge, rồi siết khoảng dừng đó chặt hơn trong giờ học. Ứng dụng cảnh báo chứ không cấm: nút Thoát luôn bấm được ngay, nút Vào chỉ mở sau vài giây đếm ngược.

- Đặc tả: [DopaDam-dac-ta.md](DopaDam-dac-ta.md)
- Thiết kế kỹ thuật: [docs/thiet-ke-ky-thuat.md](docs/thiet-ke-ky-thuat.md)
- Checklist nghiệm thu: [docs/nghiem-thu.md](docs/nghiem-thu.md)

## Cài lần đầu, theo thứ tự

1. **Agent Windows:** build bộ cài (mục Agent Windows bên dưới), cài và chạy một lần. Agent tự chạy cùng Windows và tự đăng ký cầu nối với Edge.
2. **Extension Edge:** build rồi "Load unpacked" thư mục `extension/dist`, khởi động lại Edge. Trang Tổng quan của agent sẽ báo "Đã nối".
3. **App Android:** build APK, cài lên điện thoại, mở **Hướng dẫn và kiểm tra quyền** và làm hết các bước (Trợ năng, thông báo, pin, các bước của Xiaomi).
4. **Đồng bộ (tùy chọn):** làm theo mục "Đồng bộ và đăng nhập" để điện thoại và máy tính dùng chung tag, bộ đếm và Chế độ Học. Bỏ qua bước này thì mỗi thiết bị vẫn chạy đầy đủ với dữ liệu riêng.

Những gì cần tự kiểm tra trên máy thật (điện thoại Xiaomi, game toàn màn hình, project Supabase thật) nằm trong [docs/nghiem-thu.md](docs/nghiem-thu.md).

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

Kiểm thử trên máy ảo hoặc điện thoại thật đang cắm cáp: `python android/e2e/emulator_test.py --shots <thư mục ảnh>` (máy ảo có thể chạy ẩn: `emulator -avd <tên> -no-window`).

## Agent Windows

Cần Rust (rustup, bộ MSVC), Node.js và WebView2 (có sẵn trên Windows 10/11).

```powershell
cd agent
npm install
npx tauri build          # build giao diện + Rust bản release + bộ cài NSIS
```

Bộ cài nằm ở `agent\src-tauri\target\release\bundle\nsis\DopaDam_<phiên bản>_x64-setup.exe`. Cài cho người dùng hiện tại, không cần quyền quản trị. Lần chạy đầu, agent tự bật chạy cùng Windows (chạy ẩn ở khay hệ thống) và tự đăng ký cầu nối với Edge, nên extension Edge nối được ngay khi Edge khởi động lại.

Kiểm tra cho người phát triển:

```powershell
cd agent; npm run check                      # kiểm tra kiểu + test giao diện + build giao diện
cd src-tauri; cargo test; cargo clippy --all-targets
cd ..\..\extension; npm run build; node test\e2e\with-agent.mjs   # Edge + agent qua native messaging
python agent\e2e\desktop_test.py             # bật cảnh báo thật trên Notepad (sẽ hiện cửa sổ lên màn hình)
```

## Đồng bộ và đăng nhập (Supabase)

Không bắt buộc: chưa cấu hình thì mỗi thiết bị vẫn chạy đầy đủ với dữ liệu riêng. Cần làm một lần:

1. **Tạo project Supabase** (gói miễn phí). Vào **SQL Editor**, dán toàn bộ `supabase/migrations/20261012000000_init.sql` và chạy.
2. **Đăng nhập bằng email:** **Authentication → Sign In / Providers → Email** đang bật sẵn. Nếu không muốn bước xác nhận qua email, tắt **Confirm email**.
3. **Đăng nhập bằng Google** (tùy chọn):
   - Google Cloud Console → **APIs & Services → Credentials**, tạo **OAuth client ID** loại *Web application*, thêm *Authorized redirect URI* `https://<project>.supabase.co/auth/v1/callback`.
   - Tạo thêm một OAuth client loại *Android*: package `com.dang.dopadam`, SHA-1 lấy bằng `keytool -list -v -keystore %USERPROFILE%\.android\debug.keystore -alias androiddebugkey -storepass android` (APK release cũng ký bằng khóa này).
   - Supabase → **Providers → Google**: bật, dán Client ID và Client secret của client *Web*.
   - Supabase → **Authentication → URL Configuration → Redirect URLs**: thêm `dopadam://auth-callback` (agent nhận kết quả đăng nhập Google qua link này).
4. **Điền khóa vào hai file cục bộ** (đã nằm trong `.gitignore`, không commit), lấy ở **Project Settings → API**. Chỉ dùng *anon key*, không bao giờ dùng *service_role key*:
   - Agent: chép `agent/src-tauri/config.local.example.json` thành `config.local.json`, điền `supabaseUrl` và `supabaseAnonKey`.
   - Android: chép `android/secrets.properties.example` thành `secrets.properties`, điền `SUPABASE_URL`, `SUPABASE_ANON_KEY` và `GOOGLE_WEB_CLIENT_ID` (Client ID của client *Web*).
5. Build lại agent và app Android, rồi đăng nhập cùng một tài khoản ở **Cài đặt → Tài khoản và đồng bộ** trên cả hai.

Kiểm tra cho người phát triển (không cần project thật):

```powershell
# Cửa sổ 1, từ thư mục gốc của repo:
cd supabase; npm install; npm test        # cấu trúc bảng, RLS, "bản mới hơn thắng", nhật ký chỉ thêm
node test\mock-server.mjs 54329           # server giả, để chạy

# Cửa sổ 2, từ thư mục gốc của repo:
$env:DOPADAM_MOCK_SUPABASE = "http://127.0.0.1:54329"
cd agent\src-tauri; cargo test -- --ignored; cd ..\..   # agent: đăng ký, đăng nhập, đẩy/kéo giữa hai máy, xóa dữ liệu
.\android\build.ps1 testDebugUnitTest                   # Android: như trên, qua SupabaseApi thật
```

## Token giao diện và biểu tượng

```bash
node shared/design-tokens/generate.mjs          # sinh token cho 3 nền tảng, kiểm tra tương phản AA
node shared/design-tokens/generate.mjs --check  # chỉ kiểm tra, không ghi file
python shared/brand/make_icons.py               # vẽ lại biểu tượng (cần Pillow)
```
