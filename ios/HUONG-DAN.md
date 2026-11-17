# DopaDam trên iPhone

Bản iPhone không phải một app cài từ App Store. Nó gồm hai phần:

- **Trang DopaDam**: một trang web mở trong Safari, hiện màn hình cảnh báo (Thoát, Vào có đếm ngược, Làm việc khác), Chế độ Học, thống kê, Giờ nguy cơ. Mọi dữ liệu nằm trong Safari trên chính chiếc iPhone đó; trang không gửi gì đi đâu và dùng được khi mất mạng sau lần mở đầu.
- **Ba phím tắt** trong ứng dụng Phím tắt (Shortcuts) có sẵn của iPhone: mỗi khi bạn mở một app giải trí, iPhone tự chạy phím tắt và đưa bạn tới trang cảnh báo.

Không cần máy Mac, không cần tài khoản nhà phát triển. Cần iPhone chạy iOS 17 trở lên (để tự động hóa chạy ngay, không hỏi lại).

> Phần trang web đã được chạy thử trong trình duyệt máy tính ở kích thước màn hình iPhone. Các bước dựng phím tắt dưới đây **chưa được thử trên iPhone thật**: tên thao tác có thể hơi khác tùy phiên bản iOS và ngôn ngữ máy. Khi không thấy đúng tên, hãy gõ từ khóa tiếng Anh trong ngoặc vào ô tìm thao tác. Mục "Kiểm tra sau khi cài" ở cuối cho biết thế nào là chạy đúng.

## Khác gì so với bản Android và máy tính

- Hết thời gian cho vào, iPhone không tự kéo bạn ra khỏi app. Cảnh báo chỉ hiện lại ở lần kế tiếp bạn mở hoặc chuyển sang app đó.
- Ngân sách ngày tính theo số phút bạn đã chọn khi bấm Vào, vì trang web không đo được thời gian dùng app.
- Không đồng bộ với máy tính hay điện thoại khác. Mỗi iPhone có dữ liệu riêng.
- Ai cũng tắt được tự động hóa trong ứng dụng Phím tắt. Cũng như trên các nền tảng khác, DopaDam tạo một khoảng dừng, không phải một ổ khóa.

## Bước 1: Đưa trang DopaDam lên mạng (làm một lần, trên máy tính)

Trang là một thư mục tệp tĩnh (`ios/dist`), đặt ở đâu có HTTPS cũng được. Cách không tốn tiền là GitHub Pages, ngay từ kho mã này:

1. Trên GitHub, mở kho mã, vào **Settings → Pages**, ở mục **Build and deployment** chọn **Source: GitHub Actions**.
2. Vào tab **Actions**, chọn workflow **Trang DopaDam cho iPhone**, bấm **Run workflow**.
3. Chạy xong, địa chỉ trang hiện ở Settings → Pages, dạng `https://<tên-tài-khoản>.github.io/<tên-kho>/`. Ghi lại địa chỉ này; dưới đây gọi là **ĐỊA_CHỈ**.

Kho mã để riêng tư thì GitHub Pages cần gói trả phí; khi đó có thể kéo thả thư mục `ios/dist` (tạo bằng `node ios/build.mjs`) lên một dịch vụ lưu trang tĩnh khác.

Mở ĐỊA_CHỈ bằng Safari trên iPhone một lần để trang được lưu lại cho lúc mất mạng.

## Bước 2: Tạo ba phím tắt (trên iPhone, ứng dụng Phím tắt)

Tên phím tắt phải gõ **đúng từng chữ, có dấu**, vì trang web gọi chúng theo tên.

### Phím tắt 1: `DopaDam Thoát`

1. Tab **Phím tắt** → dấu **+** → đặt tên `DopaDam Thoát`.
2. Thêm thao tác **Đi tới Màn hình chính** (Go to Home Screen).

### Phím tắt 2: `DopaDam Vào`

Trang web gọi phím tắt này với một dòng chữ dạng `TikTok|15` (tên app, dấu gạch đứng, số phút). Phím tắt ghi lại "được vào đến mấy giờ" cho app đó.

1. Tạo phím tắt mới, đặt tên `DopaDam Vào`.
2. Thêm **Tách văn bản** (Split Text): tách **Đầu vào phím tắt** (Shortcut Input), dấu tách **Tùy chỉnh** là `|`.
3. Thêm **Lấy mục từ danh sách** (Get Item from List): lấy **Mục đầu tiên**. Thêm **Đặt biến** (Set Variable), tên biến `App`.
4. Thêm lại **Lấy mục từ danh sách** trên kết quả của bước 2 (chọn biến "Tách văn bản"): lấy **Mục cuối cùng**. Thêm **Đặt biến**, tên biến `Phút`.
5. Thêm **Điều chỉnh ngày** (Adjust Date): **Cộng** `Phút` **phút** vào **Ngày hiện tại** (Current Date).
6. Thêm **Định dạng ngày** (Format Date) cho kết quả bước 5: định dạng ngày **ISO 8601**, bật **Bao gồm giờ** (Include ISO 8601 Time).
7. Thêm **Lưu tệp** (Save File) cho kết quả bước 6: tắt **Hỏi nơi lưu** (Ask Where to Save); thư mục **Shortcuts** (trong iCloud Drive hoặc "Trên iPhone"); **Đường dẫn con** (Subpath) là `DopaDam/` rồi chèn biến `App` rồi `.txt`; bật **Ghi đè nếu tệp tồn tại** (Overwrite If File Exists).
8. Thêm **Hiển thị thông báo** (Show Notification): `Đã cho vào` + biến `App` + ` ` + biến `Phút` + ` phút. Mở lại app.`

### Phím tắt 3: `DopaDam Cổng`

Phím tắt này chạy mỗi lần bạn mở một app được canh. Nó nhận tên app, xem app đó còn trong thời gian cho vào không; nếu không thì mở trang cảnh báo.

1. Tạo phím tắt mới, đặt tên `DopaDam Cổng`. Bấm biểu tượng thông tin (ⓘ), bật nhận đầu vào dạng **Văn bản** nếu máy hỏi.
2. Thêm **Lấy tệp từ thư mục** (Get File from Folder): thư mục **Shortcuts** (cùng nơi đã chọn ở phím tắt 2); **Đường dẫn tệp** là `DopaDam/` + **Đầu vào phím tắt** + `.txt`; tắt **Lỗi nếu không tìm thấy** (Error If Not Found).
3. Thêm **Lấy ngày từ đầu vào** (Get Dates from Input) cho tệp vừa lấy.
4. Thêm **Nếu** (If): điều kiện là **Ngày** (kết quả bước 3) **sau** (is after) **Ngày hiện tại**.
   - Trong nhánh **Nếu**: thêm **Dừng phím tắt này** (Stop This Shortcut).
   - Trong nhánh **Nếu không** (Otherwise): thêm **Mã hóa URL** (URL Encode) cho **Đầu vào phím tắt**; rồi thêm **URL** với nội dung `ĐỊA_CHỈ#/warn?app=` + kết quả mã hóa + `&t=` + **Ngày hiện tại** (thay ĐỊA_CHỈ bằng địa chỉ ở Bước 1, giữ dấu `/` cuối, ví dụ `https://ten.github.io/DopaDam/#/warn?app=`; phần `&t=` chỉ để mỗi lần mở là một địa chỉ khác nhau, nếu không Safari có thể hiện lại trang cũ); rồi thêm **Mở URL** (Open URLs).

## Bước 3: Tạo tự động hóa cho từng app muốn canh

Làm lại các bước này cho mỗi app (TikTok, YouTube, Facebook, một trò chơi…):

1. Tab **Tự động hóa** (Automation) → dấu **+** → **Ứng dụng** (App).
2. Chọn app, đánh dấu **Được mở** (Is Opened), chọn **Chạy ngay** (Run Immediately), tắt **Thông báo khi chạy** (Notify When Run). Bấm **Tiếp**.
3. Chọn **Tự động hóa trống mới** (New Blank Automation).
4. Thêm **Văn bản** (Text), gõ tên app, ví dụ `TikTok`. Tên này hiện trong câu hỏi "Bạn mở TikTok để làm gì?" và trong thống kê. Chỉ dùng chữ không dấu và số, không có dấu `|` hay `/`, để tên tệp ghi thời gian cho vào khớp chính xác.
5. Thêm **Chạy phím tắt** (Run Shortcut): chọn `DopaDam Cổng`, mục **Đầu vào** (Input) chọn **Văn bản** của bước 4.
6. Bấm **Xong**.

## Bước 4: Đặt lối tắt tới trang chính (không bắt buộc)

Trang chính (`ĐỊA_CHỈ`) có Chế độ Học, thống kê, Giờ nguy cơ và cài đặt. Hãy lưu nó thành dấu trang trong Safari.

Đừng dùng "Thêm vào MH chính" của Safari cho trang này: bản thêm vào màn hình chính giữ dữ liệu riêng, tách khỏi Safari, nên sẽ không thấy các lần chặn mà phím tắt ghi nhận. Nếu muốn có biểu tượng trên màn hình chính, hãy tạo một phím tắt `DopaDam` chỉ có thao tác **Mở URL** tới ĐỊA_CHỈ, rồi thêm phím tắt đó vào màn hình chính.

## Kiểm tra sau khi cài

Làm lần lượt; mỗi dòng nêu điều phải thấy.

1. Mở một app đã tạo tự động hóa → Safari mở trang hỏi "Bạn mở … để làm gì?", nút Vào đang đếm ngược 5 giây.
2. Bấm **Thoát** → trang báo "Đã thoát."; bấm **Về màn hình chính**, Safari hỏi có mở Phím tắt không, đồng ý → về màn hình chính.
3. Mở lại app → cảnh báo hiện lại; dòng trên cùng ghi "Lần thứ 2 trong 60 phút qua" và thời gian khóa là 10 giây.
4. Chờ hết đếm ngược, bấm **Vào**, chọn **5 phút**, bấm nút lớn để tiếp tục → Safari hỏi có mở Phím tắt không, đồng ý → có thông báo "Đã cho vào … 5 phút. Mở lại app."
5. Mở lại app ngay → vào thẳng, không có cảnh báo.
6. Sau hơn 5 phút, thoát ra màn hình chính rồi mở lại app → cảnh báo hiện lại.
7. Bật chế độ máy bay, mở app → trang cảnh báo vẫn hiện (đã được lưu sẵn).

Nếu bước 5 vẫn hiện cảnh báo: phím tắt `DopaDam Vào` và `DopaDam Cổng` đang trỏ tới hai thư mục khác nhau, hoặc tên app trong tự động hóa khác với tên trang gửi sang. Mở ứng dụng Tệp, vào thư mục Shortcuts/DopaDam xem có tệp `<tên app>.txt` chứa ngày giờ hay không.

Nếu bước 4 không có thông báo: tên phím tắt chưa đúng từng chữ (`DopaDam Vào`, có dấu).

## Gỡ bỏ

Xóa các tự động hóa trong tab Tự động hóa, xóa ba phím tắt, xóa thư mục Shortcuts/DopaDam trong ứng dụng Tệp. Dữ liệu của trang: Cài đặt → Safari → Nâng cao → Dữ liệu trang web, xóa mục của địa chỉ trang.
