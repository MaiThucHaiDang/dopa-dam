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

- [x] Trên Linux (JDK 17 và Android SDK đặt trong `.toolchain/`): build debug và 54 unit test chạy qua, gồm các ca mới về đồng bộ theo trang, quy tắc khi `updated_at` bằng nhau, đọc cài đặt đồng bộ có giá trị hỏng, kiểm tra tùy chọn số phút, cắt nhãn theo điểm mã, theo dõi dịch vụ canh, và thẻ tiến bộ tuần.
- [x] Chạy lại `android/e2e/emulator_test.py` trên máy ảo Android 14 với bản mới: đủ 10 bước, gồm cả phiên học và xác nhận khi kết thúc sớm. Bấm "Xóa nhật ký" khi đang trong phiên học thì app báo "Đang trong phiên học nên không chỉnh được". Thẻ "Tiến bộ tuần này" hiện đúng trên màn hình Thống kê.

Chưa kiểm tra được bằng máy (không có server thật và điện thoại thật):

- [ ] Đồng bộ trên Android sau các sửa đổi: kéo theo trang, đổi tài khoản, "Xóa dữ liệu trên server" rồi đăng nhập lại. Phần Room chỉ được kiểm bằng cách đọc mã.
- [ ] Thông báo "dịch vụ canh không chạy" khi quyền Trợ năng vẫn bật mà dịch vụ không được gắn (trường hợp Xiaomi).

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

- [x] `python agent\e2e\desktop_test.py`: agent chạy ẩn không lấy bàn phím của người dùng; gắn tag Giải trí cho Notepad, mở Notepad thì cửa sổ cảnh báo phủ lên, Enter là Thoát và Notepad được thu nhỏ (chạy trên máy Windows của GitHub, xem mục CI trên Windows).
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

## Giai đoạn 5: Chế độ Học

Đã kiểm tra tự động:

- [x] Lõi logic ba nền tảng cho kết quả giống nhau trên `study-change.json`: thêm hoặc kéo dài khung giờ không cần xác nhận; xóa, bớt ngày, rút ngắn, bỏ qua hôm nay hoặc bỏ qua phiên đang chạy thì cần; tìm đúng khung đang diễn ra (kể cả khung qua nửa đêm) để "Kết thúc sớm".
- [x] Extension chạy riêng (`npm run check`, `npm run e2e`): bấm "Học 25 phút" trên popup thì trang cảnh báo hiện nhãn phiên học và chỉ cho vào 5 hoặc 10 phút; trong giờ học không đổi được tag; "Kết thúc sớm" hiện bước chờ 60 giây; thêm khung giờ ở trang cài đặt thì hiện trong danh sách.
- [x] Agent (`cargo test`): bật tay, kết thúc sớm chỉ khi xác nhận, khung giờ khóa thay đổi làm yếu trong lúc chạy, kết thúc sớm thêm ngoại lệ cho hôm nay, xóa khung cần xác nhận; dữ liệu được đánh dấu để đồng bộ.
- [x] Edge + agent (`node test/e2e/with-agent.mjs`): bật học từ extension được ghi vào agent; agent khóa tag trong giờ học; kết thúc sớm cần xác nhận; khung giờ thêm từ extension nằm trong agent và quay lại extension qua cấu hình.
- [x] App Android build, lint và unit test đều qua (kiểm tra quy tắc khung giờ và kết thúc sớm).
- [x] Trên máy ảo Android 14 (`python android/e2e/emulator_test.py`): bấm "Học 25 phút" ở tab Học thì app hiện "Đang học"; mở app gắn tag Giải trí thì cảnh báo khóa nút Vào 30 giây và hiện nhãn phiên học; "Kết thúc sớm" mở bước chờ 60 giây, bấm "Giữ nguyên bảo vệ" thì vẫn đang học. Trang Thống kê và mục Tài khoản hiển thị đúng.

Cần kiểm tra trên thiết bị thật:

- [ ] Bật "Học 25 phút" trên điện thoại, đã đăng nhập: trong khoảng 1 phút máy tính cũng vào giờ học (trang Tổng quan của agent hiện "Đang học"), và ngược lại.
- [ ] Đặt khung giờ (ví dụ 5 phút sau giờ hiện tại): đến giờ thì cả hai thiết bị tự vào giờ học, kể cả khi điện thoại tắt mạng.
- [ ] "Kết thúc sớm" trên một thiết bị thì thiết bị kia cũng thoát giờ học sau lần đồng bộ kế tiếp.


## Giai đoạn 6: Linux (GNOME)

Đã kiểm tra tự động:

- [x] Logic giao thức của tiện ích GNOME Shell (`cd linux/gnome-shell-extension && node --test`, 16 test): mã hóa tin nhắn, không có tiêu đề cửa sổ trong `focus`, không gửi hai `focus` giống nhau liên tiếp, ghép dòng khi đọc từng phần, bỏ qua JSON hỏng và lệnh sai, kiểm tra lệnh `shell_minimize`, `shell_activate`, `shell_raise`.
- [x] `fake-agent.mjs` tạo socket, nhận kết nối thử, nhận dòng và gửi lệnh đúng định dạng, rồi xóa socket khi thoát.
- [x] Mọi file `.js` của tiện ích qua kiểm tra cú pháp; `protocol.js` nạp được trong `gjs`.
- [x] Extension trình duyệt trên Chromium (`cd extension && npm run check`, rồi `npm run e2e` với `DOPADAM_E2E_CHANNEL=chromium`): 251 unit test và 18 kịch bản đầu-cuối, gồm luật tên miền con không gỡ được chặn khi chưa xác nhận, link được phép kèm `#…` không lặp, và link playlist không làm kẹt các luật chặn khác.
- [x] Giao diện agent (`cd agent && npm run check`) và cấu trúc bảng Supabase có thiết bị `linux` (`cd supabase && npm test`).
- [x] Agent Rust build được trên Linux (`cargo build`); `cargo test` (114 test, cộng 2 test đồng bộ với server giả) và `cargo clippy --all-targets` không lỗi.
- [x] Chạy file chương trình của agent ở chế độ ẩn với thư mục dữ liệu tạm: mở socket `dopadam-agent.sock` quyền 0600, trả lời `hello` bằng `welcome` và `config`, bật phiên học qua cầu nối, nhận client của tiện ích GNOME mà không gửi `config` cho nó, ghi manifest native messaging cho Brave.

- [x] Bản Windows biên dịch được từ Linux: `cargo check` và `cargo clippy --all-targets` cho đích `x86_64-pc-windows-gnu` (bộ biên dịch chéo mingw) không lỗi, không cảnh báo, gồm cả `win.rs` và các test. Đây là kiểm tra biên dịch, chưa phải chạy trên Windows.
- [x] Đóng gói `npx tauri build --bundles deb` ra `DopaDam_0.1.0_amd64.deb` (gói `dopa-dam`, phụ thuộc `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-1`).
- [x] Chạy thật trong một GNOME Shell 50.1 riêng, không màn hình (`linux/e2e/core_flow.py`, 34 bước đều qua): tiện ích nạp không lỗi và nối với agent; cảnh báo hiện toàn màn hình, ở trên cùng và có tiêu điểm; nút Vào bị khóa trong lúc đếm ngược; Enter và Esc là Thoát và thu nhỏ chương trình; Vào rồi chọn 5 phút cho dùng tiếp; "Còn 1 phút" hiện ở góc trên bên phải và không lấy tiêu điểm; hết thời gian thì cảnh báo trở lại; "Làm việc khác" hoạt động; tắt rồi bật agent thì tiện ích nối lại; mở lại chương trình 0,5 giây sau khi Thoát vẫn bị cảnh báo; đóng chương trình khi cảnh báo đang hiện thì cảnh báo biến mất và không sinh thêm lần chặn nào.
- [x] Đường X11 (Shell chạy kèm Xwayland, không bật tiện ích; `linux/e2e/x11_flow.py`, 10 bước đều qua): agent theo dõi cửa sổ qua X11, ba cảnh báo liên tiếp đều có tiêu điểm, Enter và Esc đóng được.
- [x] Chromium của Playwright + agent Linux thật qua native messaging (`cd extension && npm run build && PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 DOPADAM_E2E_CHANNEL=chromium npm run e2e:agent`, 19 kịch bản, chạy hai lần đều qua; cần bản debug của agent đã build: `cd agent && npm run build:ui && cd src-tauri && . ~/.cache/dopadam-sysroot/env.sh && cargo build --features tauri/custom-protocol`). Cùng một tệp `with-agent.mjs` chạy được trên Windows (Edge) và Linux. Trên Linux agent chạy ẩn trong GNOME Shell riêng không màn hình (`linux/e2e/session.sh`, tự bật và tắt nếu chưa có), thư mục dữ liệu tạm, và `DOPADAM_NO_HOST_REGISTER=1` để agent không ghi manifest vào `~/.config`; manifest được ghi vào `NativeMessagingHosts/` trong thư mục hồ sơ tạm của Chromium, trình duyệt chạy với HOME tạm, không có màn hình và không có D-Bus. Sau khi chạy, `~/.config/chromium` và các thư mục trình duyệt khác không đổi. Phủ: extension nối được với agent; đổi tag, gỡ chặn đòi xác nhận; cấu hình agent về tới extension; cảnh báo và Thoát được ghi vào cơ sở dữ liệu của agent; Vào tạo khoảng được phép; popup hiện số liệu của agent và không hiện thẻ tiến bộ tuần; trang tùy chọn hiện dòng "giờ nguy cơ được xem ở ứng dụng" và ẩn phần giờ nguy cơ; **Giờ nguy cơ**: khung thêm ở agent (ghi thẳng vào cài đặt của agent, vì extension không sửa được) làm lần chặn đầu khóa 10 giây thay vì 5 (nút Vào mở sau khoảng 10 giây), trang cảnh báo có dòng "Đây là khung giờ bạn hay mở giải trí nên thời gian chờ dài hơn một cấp.", sự kiện trong cơ sở dữ liệu ghi cấp 1, mức tăng cộng dồn với số lần mở (lần 2 và 3 khóa 20 giây, lần 4 khóa 30 giây), còn nguyên sau khi tải lại, gỡ khung thì về 5 giây và mất dòng đó; **Chế độ bài giảng**: link được phép thêm qua agent (`allow_url` trong cơ sở dữ liệu của agent) ẩn gợi ý, Shorts, logo, menu và màn hình cuối trên trang YouTube giả, không phát sinh lần chặn nào; playlist được phép giữ bảng playlist; chuyển giữa hai video được phép trong trang vẫn giữ chế độ; gỡ link ở agent khi trang đang mở thì trang trở lại như YouTube làm; tắt bảo vệ ở agent thì tắt chế độ, bật lại thì có lại; video không được phép bị agent chặn và Vào không bật chế độ bài giảng; học (bật, khóa tag, kết thúc sớm đòi xác nhận, khung giờ học); tắt agent thì extension tự chặn, mở lại agent thì extension nối lại và nhận lại cấu hình. Chưa chạy trên Windows (Edge, `dopadam.exe`, khóa registry): đường đó giữ nguyên, các kịch bản mới dùng chung cho cả hai nền tảng.
- [x] Trang Tổng quan báo "Đã nối với GNOME Shell qua tiện ích DopaDam"; mọi trang của cửa sổ chính mở được, không lỗi bố cục.

Chưa chạy, cần làm:

- [x] Chạy bản Windows thật sau khi thêm lớp nền tảng và các sửa đổi ở phần logic dùng chung (CI trên Windows, bên dưới).
- [ ] Gói AppImage (chưa thử đóng gói).
- [ ] Nút "Cài tiện ích GNOME" trong ứng dụng: phần chép file và sửa danh sách tiện ích có unit test, nhưng chưa bấm thật trong một phiên GNOME.

Cần kiểm tra trên phiên Linux thật (phiên riêng không màn hình không có đăng nhập, khóa màn hình, khay hệ thống và nhiều màn hình):

- [ ] Cài `.deb`, mở DopaDam, bấm "Cài tiện ích GNOME", đăng xuất và đăng nhập lại: Tổng quan báo đã nối với GNOME Shell.
- [ ] Khóa màn hình rồi mở lại: tiện ích tự tắt và bật, agent nối lại trong vài giây.
- [ ] Biểu tượng ở khay hệ thống, tự chạy khi đăng nhập, thoát từ khay và từ mục "Thoát DopaDam" trong Cài đặt.
- [ ] Hai màn hình hoặc màn hình có tỉ lệ phóng khác 100%: cảnh báo phủ đúng màn hình đang dùng.
- [ ] Phiên X11 thật với trình quản lý cửa sổ khác Mutter.
- [ ] Phiên không có nguồn nào (ví dụ Wayland trên KDE): Tổng quan báo chưa có nguồn và trỏ tới Hướng dẫn; tray, thống kê và extension vẫn dùng được.
- [ ] Extension trong Chrome, Chromium hoặc Brave (không phải snap): Tổng quan báo "Đã nối"; trong trình duyệt snap: extension chạy riêng, không báo lỗi.
- [ ] Đăng nhập đồng bộ trên Linux: thiết bị hiện là "Máy tính Linux" trong danh sách thiết bị (đã chạy migration `20261116000000_devices_linux.sql` trên project thật).

### CI trên Linux (`.github/workflows/linux-ci.yml`)

Chạy trên ubuntu-24.04 (không dùng `ubuntu-latest`: nay là 26.04, Playwright 1.55 chưa hỗ trợ) khi push lên `linux-port` và `main`, pull request, hoặc bấm tay. Bảy job độc lập; log từng job và bảng kết quả `summary` nằm ở nhánh `ci-logs-linux` (`git fetch origin ci-logs-linux`, mỗi job một thư mục con, `run-summary.txt` nêu commit và số liệu).

- [x] `extension`: `npm run check` (497 test) và `npm run e2e` trong Chromium của Playwright (28 kịch bản).
- [x] `agent`: `npm run check` (24 test), `cargo test` (132 test), hai test đồng bộ với server giả (`cargo test -- --ignored`, qua `supabase/test/mock-server.mjs`), `cargo clippy --all-targets -- -D warnings`.
- [x] `android`: `./gradlew testDebugUnitTest` (84 test).
- [x] `supabase`: `npm test` (8 test). `gnome`: `node --test` trong `linux/gnome-shell-extension` (16 test).
- [x] `iphone`: trang web cho iPhone, build, tsc, 55 test và 29 kịch bản trình duyệt.
- [x] `extension-agent`: `extension/test/e2e/with-agent.mjs` trong Chromium với agent thật (bản debug build trong job), chạy dưới Xvfb (`DOPADAM_E2E_NO_SESSION=1`, đường X11 của agent, không có GNOME Shell): 19 kịch bản. Extension tìm lại agent khi worker khởi động hoặc ở nhịp 1 phút nên kịch bản "nối lại" chờ tới 100 giây.

Lần chạy xanh cả bảy job: commit `082c117`, run 44369089487 (extension 497 test + 28 kịch bản; agent 24 + 132 + 2 test đồng bộ, clippy sạch; Android 84 test; Supabase 8; GNOME 16; iPhone 55 + 29; extension-agent 19 kịch bản).

Lỗi thật tìm ra nhờ CI: test đồng bộ `pages_through_the_mock_server` giả định mỗi hàng có dấu thời gian riêng, nhưng server giả ghi theo mili giây nên trên máy nhanh nhiều hàng trùng dấu; `seedEvents` trong `run.mjs` có thể hỏng khi service worker dừng giữa chừng trên máy chậm (nay ghi dữ liệu từ trang extension và thử lại); `gradlew` không có quyền chạy sau khi checkout.

### CI trên Windows (`.github/workflows/windows-agent.yml`)

Chạy trên máy Windows Server 2025 của GitHub (có desktop thật, Edge và WebView2) khi push lên `linux-port` có đổi `agent/`, `shared/` hoặc `supabase/test/`, khi bấm tay, hoặc khi `release.yml` gọi. Log, ảnh chụp màn hình và `summary.txt` nằm ở nhánh `ci-logs-windows` (nhánh bị ghi đè mỗi lần chạy, nên lấy về bằng `git fetch origin +ci-logs-windows:refs/remotes/ci/ci-logs-windows`).

- [x] `npm run check` (24 test), `cargo test` (83 test), cả bộ test cùng hai test đồng bộ với server giả (85), `cargo clippy --all-targets -- -D warnings` không cảnh báo, bản debug và bộ cài NSIS `DopaDam_0.1.0_x64-setup.exe`.
- [x] Bộ cài (`agent/e2e/ci/smoke-installer.ps1` và `smoke.mjs`, 8 bước): cài im lặng vào hồ sơ người dùng, có lối tắt Start và mục gỡ cài đặt; chương trình đã cài tạo cơ sở dữ liệu, mở named pipe, trả lời hello, từ chối lệnh trước hello, nhận nhiều client cùng lúc, đổi tag qua pipe được ghi và phát cho client khác; giao diện WebView2 thật hiện đủ ba trang (chính, cảnh báo, thông báo) và trả lời lệnh Tauri (qua cổng gỡ lỗi mở bằng `DOPADAM_WEBVIEW2_DEBUG_PORT`); mở lần hai thì chuyển sang bản đang chạy và hiện cửa sổ chính; thoát qua `quit_agent` đóng pipe; gỡ cài đặt im lặng xóa chương trình.
- [x] Desktop (`agent/e2e/desktop_test.py`, 4 bước): agent chạy ẩn không lấy bàn phím; Notepad gắn tag Giải trí bị cảnh báo phủ lên; Enter là Thoát, quyết định được ghi và Notepad thu nhỏ.
- [x] Edge thật cùng agent thật (`extension/test/e2e/with-agent.mjs`, 19 kịch bản, giống Linux). Trang YouTube giả chạy bằng HTTPS với chứng chỉ tự ký tạo lúc chạy, vì Edge và Chrome luôn chuyển youtube.com sang https.

Lần chạy xanh: commit `bb1e6ce`, run 44434294594 (cùng commit đó CI Linux xanh cả bảy job, run 44434294588).

Lỗi thật tìm ra nhờ CI trên Windows: cửa sổ chính (khi chạy ẩn) và cửa sổ cảnh báo được tạo ẩn nhưng vẫn lấy bàn phím khi WebView2 khởi tạo xong, nên vài giây sau khi máy khởi động DopaDam lấy bàn phím của chương trình người dùng đang gõ, và agent thấy chính nó ở phía trước thay vì chương trình vừa mở (nay tạo với `focused(false)`, trang nhận bàn phím khi cửa sổ thật sự hiện ra); bản debug không có `custom-protocol` thì tải giao diện từ dev server.

## Giai đoạn 7: Tiến bộ theo tuần

Đã kiểm tra tự động:

- [x] Phần tính (`cd agent && npm run check`, `cd extension && npm run check`): hai tuần đủ dữ liệu, tuần không có lần chặn nào, ngưỡng 5 lần bị chặn, từng ngưỡng tốt hơn / kém hơn đúng tại biên, ngày thiếu dữ liệu; thống kê theo ngày của agent có số lần mở trong giờ học (`cargo test`).
- [x] Trong Chromium với dữ liệu giả: popup của extension hiện đúng tỉ lệ và nhận xét cho tuần tốt hơn, kém hơn, gần như cũ, thiếu dữ liệu và chưa có dữ liệu; thẻ trên trang Thống kê của agent (lệnh Tauri được giả lập) hiện đúng cả ba chỉ số. Chữ không tràn, không có màu báo động.

Cần kiểm tra trên thiết bị thật:

- [ ] Sau ít nhất hai tuần dùng thật: thẻ trên agent khớp với biểu đồ bên dưới.
- [ ] Giao diện sáng (nếu bật) trên popup. (Popup khi extension đã nối với agent không hiện thẻ tiến bộ: đã kiểm tra bằng `npm run e2e:agent`.)

## Giai đoạn 8: Chế độ bài giảng và Giờ nguy cơ

Đã kiểm tra tự động:

- [x] Quy tắc Giờ nguy cơ trên cả ba nền tảng với cùng bộ ca kiểm thử (`shared/test-vectors/risk.json`, 189 ca, và các ca `inRisk` trong `level.json`): TypeScript (`cd extension && npm run check`, 479 test), Rust (`cargo test`, 132 test), Kotlin (80 unit test).
- [x] Extension trong Chromium (`npm run e2e`, 28 kịch bản): có khung giờ nguy cơ đang chạy thì lần chặn đầu bị khóa 10 giây và trang cảnh báo có dòng giải thích; không có khung thì 5 giây và không có dòng đó; bản đồ nhiệt và gợi ý dựng đúng từ dữ liệu mẫu, nút thêm khung hoạt động; "Gỡ" đòi xác nhận 60 giây; trang tùy chọn không tràn ngang ở 360 px.
- [x] Agent trong GNOME Shell riêng với 126 lần chặn mẫu: thẻ "Giờ nguy cơ" hiện đúng ở trang Thống kê, nút gợi ý thêm khung vào danh sách, "Gỡ" mở hộp xác nhận, cửa sổ ở bề rộng tối thiểu không tràn; cảnh báo trong khung giờ nguy cơ khóa 10 giây và có dòng giải thích. `linux/e2e/core_flow.py --quick` vẫn qua.
- [x] App Android trên máy ảo Android 14 với 122 lần chặn mẫu: thẻ hiện đúng và vừa bề rộng màn hình, nút gợi ý thêm khung, "Gỡ" mở hộp xác nhận 60 giây; kịch bản `emulator_test.py` vẫn qua đủ 10 bước.
- [x] Chế độ bài giảng với trang YouTube giả (`npm run e2e`): video được phép thì gợi ý bị ẩn và có dòng ghi chú; playlist được phép giữ bảng playlist; vào bằng nút Vào thì không ẩn gì; chuyển từ video được phép này sang video được phép khác vẫn giữ chế độ.
- [x] Chế độ bài giảng trên YouTube thật (Chromium, không đăng nhập), bố cục máy tính và di động: cột gợi ý, logo, menu trái và màn hình cuối video biến mất; mô tả và bình luận còn nguyên; video không tự nhảy sang video kế khi hết.

Cần kiểm tra trên thiết bị thật:

- [ ] Chế độ bài giảng trong Edge khi đã đăng nhập YouTube. (Khi extension nối với agent: đã kiểm tra trên trang YouTube giả bằng `npm run e2e:agent`, xem phần Linux.)
- [x] Giờ nguy cơ khi extension nối với agent: trang cảnh báo trên web có dòng giải thích (trường `risk` trong `warning_context`), khóa đúng cấp đã tăng (`npm run e2e:agent`, Chromium + agent Linux; chưa thử với Edge và agent Windows).
- [ ] Khung giờ nguy cơ thêm trên máy tính xuất hiện trên điện thoại sau khi đồng bộ, và ngược lại.
- [ ] Sau vài tuần dùng thật: bản đồ nhiệt khớp với thói quen, gợi ý hợp lý.

## Giai đoạn 9: iPhone

Đã kiểm tra tự động:

- [x] Trang web (`cd ios && npm run check`, `npm run e2e`): 55 unit test và 29 kịch bản trong Chromium ở khung 390×844 có cảm ứng: lần đầu khóa 5 giây và nút Vào chưa bấm được; chọn số phút sinh đúng liên kết `shortcuts://`; Thoát ghi nhận và hiện lối về màn hình chính; lần thứ ba khóa 10 giây, lần thứ tư 20 giây; đang học khóa 30 giây với lựa chọn ngắn; khung giờ nguy cơ tăng một cấp; cảnh báo bỏ dở được tính là Thoát; giảm thời gian khóa đòi xác nhận 60 giây; không tràn ngang ở 320 và 390 px; mở được khi mất mạng sau lần đầu.
- [x] Lõi Swift của ứng dụng gốc (`cd ios/native/DopaDamCore && swift test` trên Linux, Swift 6.2): 111 test, gồm mọi ca của tám tệp ca kiểm thử chung áp dụng cho iPhone.
- [x] 18 tệp mã giao diện của ứng dụng gốc qua kiểm tra cú pháp (`swiftc -frontend -parse`).

Chưa làm được trên máy phát triển Linux:

- [x] Biên dịch ứng dụng gốc (workflow "Ung dung DopaDam cho iPhone" trên GitHub Actions, Xcode 16.4): bản Release cho iPhone không có cảnh báo nào, ra file `.ipa` chưa ký.

Cần kiểm tra trên iPhone thật:

- [ ] Bản trang web: làm đủ 7 bước "Kiểm tra sau khi cài" trong `ios/HUONG-DAN.md` (các bước dựng phím tắt chưa được thử trên máy thật).
- [ ] Bản ứng dụng gốc: cài bằng Sideloadly, làm đủ 8 bước "Kiểm tra sau khi cài" trong `ios/native/HUONG-DAN.md`.
- [ ] Điều kiện "Nếu kết quả là đúng" trong tự động hóa nhận được giá trị trả về của hành động "có cần hỏi không".
- [ ] Thông báo "Còn 1 phút" và "Hết thời gian" đến đúng lúc; app đích mở lại được sau khi bấm Vào.

