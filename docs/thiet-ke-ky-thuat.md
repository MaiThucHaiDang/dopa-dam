# Thiết kế kỹ thuật DopaDam

Tài liệu cho người phát triển: cấu trúc repo, lõi logic dùng chung, giao thức giữa agent và extension, lưu trữ và đồng bộ. Hành vi của ứng dụng do [đặc tả](../DopaDam-dac-ta.md) quyết định; tài liệu này chỉ mô tả cách hiện thực.

## 1. Cấu trúc repo

| Thư mục | Nội dung |
| --- | --- |
| `shared/design-tokens/` | `tokens.json` (bộ màu và cỡ chữ duy nhất) và `generate.mjs` sinh ra file token cho từng nền tảng, kèm kiểm tra độ tương phản AA |
| `shared/test-vectors/` | Các file JSON mô tả đầu vào và kết quả mong đợi của lõi logic; cả ba nền tảng chạy chung bộ này |
| `extension/` | Extension Edge, TypeScript, Manifest V3, build bằng esbuild, test bằng Vitest |
| `android/` | App Android, Kotlin + Jetpack Compose, package `com.dang.dopadam` |
| `agent/` | Agent máy tính (Windows và Linux), Tauri 2: `src-tauri/` (Rust) và `ui/` (React + TypeScript) |
| `linux/` | Tiện ích GNOME Shell (GJS) cho agent trên Linux: `dopadam@dang/` (tiện ích), `test/`, `fake-agent.mjs`, `install.sh` |
| `supabase/` | Migration SQL: bảng, trigger, Row Level Security |
| `docs/` | Tài liệu kỹ thuật và checklist nghiệm thu từng giai đoạn |

## 2. Lõi logic dùng chung

Mỗi nền tảng hiện thực các hàm dưới đây bằng ngôn ngữ của mình (TypeScript, Kotlin, Rust) và phải cho kết quả giống hệt nhau trên `shared/test-vectors/`. Thời gian là mili giây kể từ epoch (UTC). Múi giờ truyền vào dưới dạng số phút lệch so với UTC (`tzOffsetMinutes`, Việt Nam là `420`), để test vector không phụ thuộc máy chạy test.

| Hàm | Quy tắc | Test vector |
| --- | --- | --- |
| `recentCount(timestamps, now)` | Số mốc `t` thỏa `now - 3 600 000 < t ≤ now` | `recent-count.json` |
| `computeLevel(n, inStudy, overBudget, settings)` | `inStudy` hoặc `overBudget` → cấp 3; ngược lại `n = 0` → 0, `n = 1–2` → 1, `n ≥ 3` → 2. Trả về cấp, số giây khóa (`settings.lockSeconds[cấp]`) và các mức khoảng được phép (cấp 3 dùng `allowOptionsRestricted`, còn lại `allowOptionsNormal`) | `level.json` |
| `dayKey(t, tzOffsetMinutes)` | Ngày địa phương của `t - 4 giờ`, dạng `YYYY-MM-DD` (ngày bắt đầu lúc 4 giờ sáng) | `day-key.json` |
| `budgetStatus(usedMinutes, budgetMinutes)` | `budgetMinutes ≤ 0` nghĩa là tắt ngân sách: không bao giờ vượt, `remaining = null`. Ngược lại `over = used ≥ budget`, `remaining = max(0, budget - used)` | `budget.json` |
| `effectiveDelay(appDelay, tag, tagDelays)` | `appDelay` (nếu có) ghi đè, nếu không thì `tagDelays[tag]`, nếu không có thì 0; kẹp trong 0–120 giây | `delay.json` |
| `resolveStudy(now, tzOffsetMinutes, manual, rules, external)` | Xem mục 2.1 | `study.json` |
| `activeRuleOccurrences(rules, now, tzOffsetMinutes)`, `classifyStudyRuleChange(old, new, now, tzOffsetMinutes)` | Xem mục 2.1 và 2.3 | `study-change.json` |
| `matchDomainTag(host, rules)` | Luật khớp khi `host == pattern` hoặc `host` kết thúc bằng `"." + pattern`; nhiều luật khớp thì luật dài nhất thắng; không khớp trả về `null` | `domain.json` |
| `parseAllowUrl(text)`, `isAllowedUrl(url, allowList)` | Xem mục 2.2 (chỉ extension dùng) | `allow-url.json` |
| `classifyTagChange(old, new)`, `classifyNumberChange(field, old, new)` | Thay đổi làm yếu bảo vệ trả về `"weaken"` (cần bước xác nhận FR14), còn lại `"ok"`. Xem mục 2.3 | `friction.json` |

### 2.1 Gộp nguồn Chế độ Học

- Phiên bật tay và phiên TaskFlow: `{id, start, end, label}`, hiệu lực khi `start ≤ now < end`.
- Khung giờ cố định: `{id, days, start, end, label, exceptions}`. `days` theo ISO (1 = thứ 2 … 7 = chủ nhật), `start`/`end` dạng `HH:MM` theo giờ địa phương. Nếu `end ≤ start` thì khung kéo qua nửa đêm. Mỗi ngày `D` có thứ nằm trong `days` và không nằm trong `exceptions` sinh ra một lần xuất hiện từ `D start` đến `end` (cùng ngày, hoặc ngày hôm sau nếu qua nửa đêm). Ngoại lệ tính theo ngày bắt đầu.
- Nhãn trống hoặc `null` thì dùng nhãn mặc định: "Khung giờ học" (khung giờ), "Phiên học" (bật tay), "Phiên TaskFlow" (TaskFlow).
- Đang học khi có ít nhất một phiên hiệu lực. Phiên dùng để hiển thị chọn theo nguồn: bật tay > TaskFlow > khung giờ; cùng nguồn thì chọn phiên kết thúc muộn nhất. Kết quả: `{active, source, label, endsAt}`; khi không học thì `source`, `label`, `endsAt` là `null`.
- Mỗi nguồn cài interface `StudySessionSource` (`kind` + `sessions(now, tzOffsetMinutes)`); `resolveSources` gộp danh sách nguồn theo thứ tự ưu tiên trên, `resolveStudy` chỉ là cách gọi tắt với ba nguồn. Nối TaskFlow sau v1 là viết thêm một nguồn `taskflow`, phần chặn không đổi.
- `activeRuleOccurrences` trả về các khung đang diễn ra lúc `now` kèm ngày bắt đầu của lần xuất hiện đó (`{ruleId, date}`). "Kết thúc sớm" dùng nó: phiên bật tay đang chạy được đặt `end = now`, còn khung giờ đang chạy được thêm ngoại lệ cho ngày đó.
- Phiên bật tay dài 5–480 phút (giao diện có sẵn 25, 50, 90 phút), nhãn tối đa 60 ký tự. Bật thêm phiên trong lúc đang học là được, vì chỉ có thể kéo dài giờ học.

### 2.2 Link được phép

- `parseAllowUrl` nhận link người dùng dán vào:
  - `youtube.com/watch?v=ID` (kể cả `m.`, `www.`, `music.`), `youtu.be/ID` → `{kind: "video", id}`; nếu link có cả `v` và `list` thì lấy video.
  - `youtube.com/playlist?list=ID` → `{kind: "playlist", id}`.
  - Shorts (`/shorts/`) không được hỗ trợ → `null`.
  - Link `http(s)` khác → `{kind: "prefix", value}`: bỏ scheme, bỏ `www.`, bỏ `#…`, bỏ `/` cuối.
  - Không phải link hợp lệ → `null`.
- `isAllowedUrl(url, allowList)`: video khớp theo `v` (trang `/watch`) hoặc đường dẫn của `youtu.be`; playlist khớp theo tham số `list` trên `/watch` hoặc `/playlist`; prefix khớp khi URL đã chuẩn hóa như trên bắt đầu bằng `value` và ký tự kế tiếp (nếu có) là `/`, `?` hoặc `#`.

### 2.3 Thay đổi làm yếu bảo vệ

- Mã tag: `entertainment` (Giải trí), `game`, `work` (Công việc), `study` (Học tập), `communication` (Liên lạc), `utility` (Tiện ích), `ignore` (Không theo dõi).
- Tag: `"weaken"` khi tag cũ là Giải trí hoặc Game và tag mới không thuộc hai tag này (kể cả xóa luật), hoặc khi đổi Giải trí → Game (vì Game có độ trễ). Game → Giải trí và mọi trường hợp khác là `"ok"`.
- Số: `lockSeconds` giảm, `budgetMinutes` tăng hoặc chuyển về ≤ 0 (tắt), `delaySeconds` tăng → `"weaken"`. Ngược lại `"ok"`.
- Khung giờ học (`classifyStudyRuleChange`): thêm khung mới, thêm ngày, bắt đầu sớm hơn, kết thúc muộn hơn, đổi nhãn, bỏ ngoại lệ, hoặc thêm ngoại lệ cho ngày mai trở đi là `"ok"`. Xóa khung, bớt ngày, bắt đầu muộn hơn, kết thúc sớm hơn, hoặc thêm ngoại lệ cho hôm nay hay cho ngày của phiên đang diễn ra là `"weaken"`. So sánh khung tính theo phút kể từ nửa đêm của ngày bắt đầu (khung qua nửa đêm cộng thêm 24 giờ vào giờ kết thúc).
- Luôn cần xác nhận: tắt bảo vệ, thêm link được phép, kết thúc Chế độ Học trước giờ, xóa nhật ký.
- Trong giờ học: đổi tag, mức cản trở, ngân sách, độ trễ, tắt bảo vệ, xóa nhật ký (vì xóa nhật ký đưa số lần mở và ngân sách đã dùng về 0) và mọi thay đổi `"weaken"` của khung giờ đều bị khóa (`study-locked`), kể cả khi đã xác nhận. Vẫn làm được: thêm link được phép (có xác nhận), thay đổi làm mạnh bảo vệ, và "Kết thúc sớm" (có xác nhận).
- Bước xác nhận: chờ 60 giây rồi gõ đúng câu `tôi chọn giảm bảo vệ`.
- Tùy chọn số phút cho vào (`allowOptions`, `allowOptionsRestricted`): mỗi danh sách có 1 đến 4 giá trị, thường là 1 đến 120 phút, lúc bị hạn chế là 1 đến 10 phút; tăng giá trị lớn nhất của một danh sách là `"weaken"`. Agent và Android cùng kiểm tra ở phía sau, không chỉ ở giao diện.
- Nhãn buổi học dài tối đa 60 ký tự, đếm theo điểm mã Unicode trên cả ba nền tảng để không cắt đôi một emoji.

**Giới hạn đã biết, giữ nguyên có chủ ý.**

- Thêm ngoại lệ cho các ngày sau hôm nay không cần xác nhận (đúng theo đặc tả mục 7), nên về lý thuyết có thể bỏ trước rất nhiều buổi. Giao diện chỉ cho thêm từng ngày một.
- Cờ `confirmed` do giao diện gửi lên sau khi chờ 60 giây và gõ câu xác nhận; người mở công cụ nhà phát triển có thể tự gửi cờ này. Việc đó tốn công hơn tắt hẳn extension, mà agent thì cảnh báo khi extension ngừng phản hồi.
- Extension chỉ chặn khung chính của tab. Trang giải trí nhúng trong `iframe` của trang khác không bị chặn, để bài giảng nhúng video trong trang học vẫn xem được.
- Trang cảnh báo trên web chỉ đếm ngược khi tab đang hiện. Thời gian đã hiện được lưu trong `sessionStorage` theo mã cảnh báo, nên tải lại một tab đang ẩn không mở khóa nút Vào sớm hơn. Background vẫn kiểm tra theo đồng hồ thực như một ngưỡng dưới.

### 2.4 Tiến bộ theo tuần

Thẻ "Tiến bộ tuần này" (trang Thống kê của agent, và popup của extension khi extension chạy riêng) so 7 ngày gần nhất tính đến hôm nay với 7 ngày trước đó, theo ba mục tiêu đo được của đặc tả. Ngày tính theo mốc 4 giờ sáng như mọi thống kê khác; ngày không có dữ liệu coi là 0.

| Chỉ số | Cách tính cho mỗi tuần | Tốt hơn khi |
| --- | --- | --- |
| Tỉ lệ rời đi | (Thoát + Làm việc khác) / (Vào + Thoát + Làm việc khác); lần chặn chưa có lựa chọn không tính | tăng từ 5 điểm phần trăm trở lên (giảm từ 5 điểm là kém hơn) |
| Số giây đến lúc Thoát | tổng số giây cân nhắc của các lần Thoát / số lần Thoát | giảm từ 1 giây trở lên (tăng từ 1 giây là kém hơn) |
| Mở giải trí trong giờ học | số lần cảnh báo hiện ra khi đang học, kể cả lần chưa có lựa chọn | ít hơn tuần trước |

Chỉ so sánh khi mỗi tuần có ít nhất 5 lần bị chặn đã có lựa chọn; nếu không thì hiện "Cần ít nhất 5 lần bị chặn mỗi tuần để so sánh". Phần tính nằm ở `agent/ui/src/progress.ts` và `weeklyProgress` trong `extension/src/background/logic.ts`; agent lấy số lần mở trong giờ học từ trường `studyWarnings` của thống kê theo ngày. App Android có cùng thẻ ở màn hình Thống kê (`logic/Progress.kt`, cùng quy tắc và cùng câu chữ). Khi extension nối với agent thì popup không hiện thẻ (xem ở trang Thống kê của agent).

### 2.5 Giờ nguy cơ

Mục tiêu: tăng cản trở đúng vào những khung giờ người dùng hay mở giải trí nhất, dựa trên nhật ký chặn sẵn có. Ba nền tảng dùng cùng quy tắc dưới đây; ca kiểm thử chung nằm ở `shared/test-vectors/risk.json` và các ca `inRisk` trong `level.json`.

**Dữ liệu.** `riskWindows` là danh sách khung `{ id, days, start, end }`, lưu trong cài đặt và đồng bộ cùng cài đặt (khóa `riskWindows` trong JSON cài đặt). `days` là thứ theo ISO (1 = thứ Hai … 7 = Chủ nhật), `start` và `end` là giờ địa phương `"HH:MM"`; `end <= start` nghĩa là khung chạy qua nửa đêm, hệt như khung giờ học. Tối đa 12 khung. Khung không hợp lệ (không có ngày, giờ sai, `start == end`) bị bỏ.

**Đang trong giờ nguy cơ** (`inRiskWindow(windows, now, tz)`): đúng khi `now` nằm trong một lần diễn ra của ít nhất một khung, tính như khung giờ học (bắt đầu tính cả, kết thúc không tính; khung bắt đầu vào một ngày có trong `days` và chạy qua nửa đêm vẫn tính sau nửa đêm).

**Cấp cản trở.** `computeLevel` nhận thêm `inRisk` (mặc định sai). Tính cấp như cũ, rồi nếu `inRisk` và cấp < 3 thì cộng 1. Lên tới cấp 3 thì dùng thời gian khóa và các lựa chọn số phút của cấp 3. Màn hình cảnh báo hiện thêm một dòng: "Đây là khung giờ bạn hay mở giải trí nên thời gian chờ dài hơn một cấp."

**Bản đồ nhiệt** (`riskHeatmap(events, now, tz, days)`): bảng 7 hàng (thứ Hai … Chủ nhật) × 24 cột (giờ 0 … 23), mỗi ô có `opens` và `enters`. Tính mọi lần cảnh báo có `now − days ngày <= shownAt <= now` (`days` là 28 trên agent và Android, 14 trong extension vì extension chỉ giữ 14 ngày). Thứ và giờ lấy theo giờ địa phương của `shownAt` (không dùng mốc 4 giờ sáng). `opens` đếm mọi lần cảnh báo; `enters` đếm lần có lựa chọn Vào.

**Gợi ý khung** (`suggestRiskWindow(cells, existing)`), trả về nhiều nhất một khung:

1. Hai nhóm ngày: trong tuần `[1,2,3,4,5]` và cuối tuần `[6,7]`.
2. Với mỗi nhóm và mỗi giờ bắt đầu `h` từ 0 đến 22, xét khối 2 giờ gồm cột `h` và `h+1`: `opens` và `enters` của khối là tổng các ô của những ngày trong nhóm.
3. Khối đủ điều kiện khi `opens >= 6` và chưa được phủ. Khối đã được phủ khi với mọi ngày của nhóm, cả hai giờ của khối đều nằm trọn trong một khung đang có (giờ `x` của thứ `d` nằm trọn trong khung khi `d` thuộc `days` và `start <= x:00`, `(x+1):00 <= end` với `end` đã cộng 24 giờ nếu qua nửa đêm; hoặc ngày liền trước `d` thuộc `days` và khung của ngày đó chạy qua nửa đêm phủ hết giờ ấy).
4. Chọn khối có `opens` chia cho số ngày của nhóm lớn nhất (so bằng phép nhân chéo số nguyên, không dùng số thực). Bằng nhau thì chọn khối có `enters` chia cho số ngày lớn hơn, rồi nhóm trong tuần trước nhóm cuối tuần, rồi `h` nhỏ hơn.
5. Kết quả: `{ days, start: "hh:00", end: "hh:00", opens, enters }` (`end` là `"00:00"` khi `h = 22`), hoặc không có gì.

**Thay đổi làm yếu bảo vệ** (`classifyRiskWindowsChange(old, next)`): là `"weaken"` khi có ít nhất một phút trong tuần được danh sách cũ phủ mà danh sách mới không phủ (gỡ khung, bớt ngày, rút ngắn); ngược lại là `"ok"` (thêm khung, mở rộng). `"weaken"` phải qua bước xác nhận của FR14 và bị khóa trong giờ học.

**Các điểm chốt thêm** (đều có ca kiểm thử trong `risk.json`):

- Khung không hợp lệ coi như không có ở mọi hàm: không phủ phút nào. Ngày ngoài 1..7 bị bỏ, phần còn lại của khung được giữ. Giờ được đọc như khung giờ học (`"7:05"` thành `"07:05"`; `"24:00"`, `"12:60"`, `"7:5"` là sai). Khác khung giờ học ở một điểm: `start == end` là không hợp lệ.
- Khi xét khối đã được phủ hay chưa, từng giờ của khối phải nằm trọn trong một khung, nhưng hai giờ có thể thuộc hai khung khác nhau (hai khung liền nhau 20:00–21:00 và 21:00–22:00 phủ khối 20:00–22:00).
- Khung qua nửa đêm của thứ Hai đến thứ Sáu phủ cả các giờ đầu ngày hôm sau; ngày liền trước của thứ Hai là Chủ nhật.
- Tỉ lệ theo ngày luôn chia cho số ngày của nhóm (5 hoặc 2), kể cả khi chỉ vài ngày có dữ liệu. Khi tỉ lệ bằng nhau, nhóm trong tuần thắng nhóm cuối tuần trước khi xét `h`.
- `enters` chỉ đếm lựa chọn đúng bằng `"enter"`.
- Độ phủ của danh sách khung tính theo từng phút của tuần (khung qua nửa đêm Chủ nhật vòng sang thứ Hai); mã `id` của khung không ảnh hưởng. Tách một khung thành hai khung phủ cùng thời gian là `"ok"`.
- Trong tệp ca kiểm thử, bản đồ nhiệt được ghi gọn thành danh sách ô khác 0 `{ row, hour, opens, enters }` với `row` 0 = thứ Hai … 6 = Chủ nhật, xếp theo `row` rồi `hour`.

**Giao diện.** Thẻ "Giờ nguy cơ" nằm ở trang Thống kê của agent và của app Android, và ở trang tùy chọn của extension khi extension chạy riêng: bản đồ nhiệt một màu (ô càng đậm càng nhiều lần mở, không dùng màu báo động), một dòng gợi ý kèm nút "Tăng cản trở trong khung này", và danh sách các khung đang bật, mỗi khung có nút "Gỡ". Khi không có khối nào đủ điều kiện thì hiện "Chưa có khung giờ nào nổi bật."

**Điều đã biết.** Sau khi thêm khung 22:00–24:00, gợi ý kế tiếp có thể là 21:00–23:00, vì khối chỉ bị loại khi cả hai giờ của nó đã được phủ. Bấm tiếp sẽ nới khung sớm lên từng giờ; cấp chỉ tăng một bậc dù các khung chồng nhau.

### 2.6 Chế độ bài giảng trên YouTube

Chỉ có trong extension. Khi tab đang ở một link được phép trên `www.youtube.com`, `youtube.com` hoặc `m.youtube.com`, content script `lecture.js` đặt lớp `dopadam-lecture` lên `<html>`; mọi luật trong `lecture.css` đều nằm dưới lớp này nên trang không đổi gì khi lớp không có.

- Bị ẩn: cột gợi ý, màn hình gợi ý cuối video và thẻ gợi ý trong trình phát, kệ Shorts, logo và menu trái (lối về trang chủ), nút tự phát video kế. Khi video kết thúc ngoài playlist được phép, script bấm nút hủy tự phát của YouTube.
- Được giữ: trình phát, tiêu đề, mô tả, chương, bản chép lời, dòng kênh và bình luận. Với link được phép là playlist thì giữ cả bảng playlist và nút trước/sau.
- Quyết định nằm ở background (`lecture:check`, hàm thuần `lectureModeFor` trong `src/shared/lecture.ts`), vì background biết danh sách link được phép ở cả chế độ chạy riêng lẫn khi nối với agent. Tắt bảo vệ thì không có chế độ bài giảng. Trang hỏi lại khi URL đổi (`yt-navigate-finish`, `popstate`, kiểm tra URL mỗi giây) và khi cài đặt đổi.
- Hỏng thì mở: background không trả lời trong 4 giây thì trang coi như không ở chế độ bài giảng.
- Vào bằng nút Vào (khoảng được phép) không bật chế độ này; đó là giờ giải trí.
- Bộ chọn phần tử đã được thử trên YouTube thật (bố cục máy tính và di động, tháng 11/2026). YouTube đổi bố cục thì cần cập nhật `lecture.css`.

## 3. Giao thức agent ↔ extension

```
Edge (extension) ──stdio, khung 4 byte độ dài──▶ dopadam.exe (chế độ host) ──named pipe, JSON mỗi dòng──▶ agent (dopadam.exe)
```

- Extension gọi `chrome.runtime.connectNative("com.dang.dopadam")`. Edge chạy lại chính `dopadam.exe` theo manifest mà agent đăng ký tại `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.dang.dopadam`. Khi được Edge gọi (có tham số bắt đầu bằng `chrome-extension://`), chương trình chạy ở chế độ host thay vì mở giao diện.
- Host chỉ chuyển tiếp tin nhắn giữa stdio và pipe `\\.\pipe\dopadam-agent`. Không nối được pipe thì host gửi `{"type":"agent_offline"}` rồi thoát; extension thử lại mỗi phút.
- Mọi tin nhắn là JSON có trường `type`. Yêu cầu cần trả lời mang `requestId`; agent đáp `{"type":"result","requestId","ok","error"}` (riêng `warning_request` đáp bằng `warning_context`). Số phiên bản giao thức hiện tại: `1` (trong `version.json`).

| Chiều | `type` | Nội dung |
| --- | --- | --- |
| ext → agent | `hello` | `protocol`, `extVersion`, `profileId` |
| agent → ext | `welcome` | `protocol`, `agentVersion`, `compatible`. Lệch giao thức thì extension chạy riêng, agent báo lệch phiên bản |
| agent → ext | `config` | Ảnh chụp đầy đủ: `domainRules`, `allowUrls`, `settings`, `allowWindows`, `study`, `studyRules`, `budget`, `protectionEnabled`, `summary` (số lần chặn và Thoát hôm nay). Gửi sau `welcome` và mỗi khi có thay đổi |
| ext → agent | `warning_request` | `requestId`, `eventId` (do trang cảnh báo tạo, nên tải lại trang không bị đếm hai lần), `object` (tên miền khớp luật), `url` |
| agent → ext | `warning_context` | `requestId`, `skip` (đang được phép thì mở thẳng), `eventId`, `level`, `lockSeconds`, `allowOptions`, `n`, `shownAt`, `decision`, `budget`, `study`, `activities` |
| ext → agent | `decision` | `requestId`, `eventId`, `decision` (`enter` / `exit` / `alternative`), `allowMinutes`, `activity`, `activityMinutes` |
| ext → agent | `usage` | `domain`, `url`, `seconds` (mỗi phút, cho tab đang xem); agent quy ra tag, link được phép tính là Học tập |
| ext → agent | `set_domain_rule` | `requestId`, `pattern`, `tag` (`null` để gỡ), `confirmed` |
| ext → agent | `add_allow_url`, `remove_allow_url` | `requestId`, `entry` (`{kind, id}` hoặc `{kind, value}`), `confirmed` |
| ext → agent | `set_friction` | `requestId`, `lockSeconds`, `budgetMinutes`, `confirmed` |
| ext → agent | `set_protection`, `clear_log` | `requestId`, `enabled` (với `set_protection`), `confirmed` |
| ext → agent | `start_study` | `requestId`, `minutes`, `label` |
| ext → agent | `stop_study` | `requestId`, `confirmed` |
| ext → agent | `set_study_rule` | `requestId`, `rule` (`{id, days, start, end, label, exceptions}`; `id` rỗng là thêm mới), `confirmed` |
| ext → agent | `delete_study_rule` | `requestId`, `id`, `confirmed` |

Khi agent đang chạy, mọi số đếm, khoảng được phép và nhật ký nằm ở agent; agent tự kiểm tra lại quy tắc giảm bảo vệ và khóa cấu hình trong giờ học. Extension giữ bản sao cấu hình gần nhất trong `chrome.storage.local` để vẫn chặn được khi mất kết nối.

## 4. Lưu trữ cục bộ

| Nền tảng | Nơi lưu |
| --- | --- |
| Extension | `chrome.storage.local` (cấu hình, phiên học và khung giờ học, nhật ký 14 ngày gần nhất, thời gian dùng theo ngày) |
| Android | Room (`dopadam.db`, nhật ký 30 ngày); phiên đăng nhập mã hóa bằng khóa trong Android Keystore |
| Agent (Windows) | SQLite tại `%APPDATA%\DopaDam\dopadam.db` (nhật ký 30 ngày); phiên đăng nhập trong Windows Credential Manager |
| Agent (Linux) | SQLite tại `$XDG_DATA_HOME/DopaDam/dopadam.db` (mặc định `~/.local/share/DopaDam`) |

## 5. Đồng bộ qua Supabase

Cấu trúc bảng nằm ở `supabase/migrations/`; `supabase/test/schema.test.mjs` chạy chính file đó trong PGlite để kiểm tra quy tắc, `supabase/test/mock-server.mjs` dựng một server giả (phần GoTrue và PostgREST mà DopaDam gọi) trên cùng cấu trúc bảng để test đồng bộ đầu-cuối.

**Bảng và khóa.** Bảng `devices`, `tag_rules`, `settings`, `study_rules`, `study_sessions`, `usage_daily`, `intercept_events`. Khóa chính là `(user_id, id)`; `user_id` mặc định là `auth.uid()`. Thời gian là số mili giây (`bigint`), riêng `server_updated_at` là `timestamptz` do trigger đặt bằng `clock_timestamp()` mỗi lần ghi. Mỗi bảng có `schema_version` để sau này đổi cấu trúc mà không làm hỏng bản cũ.

**Định danh.** `id` của tag là cố định theo nội dung (`kind:pattern`: `app:<tên gói>` trên Android, `exe:<tên chương trình>` và `domain:<tên miền>` ở agent, `allow_url:<link>` cho link được phép), nên hai thiết bị gắn tag cho cùng một đối tượng sẽ ghi vào cùng một dòng thay vì tạo hai dòng. `usage_daily` có `id = ngày|thiết bị|tag` và chỉ thiết bị đó ghi. Sự kiện chặn và phiên học dùng UUID do thiết bị tạo. Xóa là xóa mềm (`deleted = true`) để lần xóa cũng đồng bộ được.

**Quy tắc trên server.**

- Trigger `keep_newest` (trước khi cập nhật): giữ nguyên dòng cũ nếu bản gửi lên có `updated_at` nhỏ hơn, nên "bản mới hơn thắng" kể cả khi thiết bị gửi muộn.
- `intercept_events` chỉ thêm: trigger chặn mọi lệnh sửa.
- RLS `own_rows` cho vai trò `authenticated`: chỉ đọc/ghi được dòng có `user_id = auth.uid()`. Vai trò `anon` không có quyền gì trên các bảng.
- Hàm `delete_my_data()` (gọi qua RPC) xóa toàn bộ dữ liệu của tài khoản đang đăng nhập.
- Khóa `service_role` không bao giờ nằm trong ứng dụng; ứng dụng chỉ dùng anon key cộng phiên đăng nhập.

**Một vòng đồng bộ** (giống nhau ở agent `sync.rs` và Android `SyncEngine.kt`):

1. Đẩy các dòng có cờ "chưa đồng bộ" theo từng bảng, mỗi lần tối đa 500 dòng, bằng upsert `?on_conflict=user_id,id` (`Prefer: resolution=merge-duplicates`; riêng sự kiện chặn là `ignore-duplicates`). Đẩy xong mới xóa cờ, nên lỗi giữa chừng thì lần sau đẩy lại. Sự kiện chưa có lựa chọn được giữ lại 10 phút rồi mới đẩy.
2. Ghi dòng `devices` của máy này (tên, phiên bản, `last_seen`).
3. Kéo về từng bảng: `server_updated_at >= con trỏ − 5 phút`, sắp xếp theo `server_updated_at` rồi `id` tăng dần, mỗi trang 1000 dòng. Lùi 5 phút để không sót dòng được ghi trễ với dấu thời gian sớm hơn. Trang đầy mà dòng đầu và dòng cuối khác dấu thời gian thì trang sau bắt đầu từ dấu của dòng cuối (dùng `>=` nên các dòng cùng dấu ở ranh giới trang không bị sót); trang đầy mà mọi dòng cùng một dấu thì giữ mốc và đi tiếp bằng `offset`. Trang chưa đầy là hết. Dòng kéo lại lần hai không gây thay đổi nào: dòng trên server thắng khi `updated_at` lớn hơn, hoặc bằng nhau mà dòng trên máy không còn chờ đẩy lên; dòng trên máy đang chờ đẩy với cùng `updated_at` thì giữ và được đẩy lên. Dòng `usage_daily` của chính máy này không bao giờ bị ghi đè bằng bản trên server.
4. Hết hạn phiên (HTTP 401) thì làm mới bằng refresh token rồi chạy lại một lần.

**Đăng nhập.**

| Cách | Agent | Android |
| --- | --- | --- |
| Email + mật khẩu | `grant_type=password`, tạo tài khoản qua `/signup` | Như agent |
| Google | Mở trình duyệt tới `/authorize?provider=google` với PKCE (S256); Supabase trả về `dopadam://auth-callback?code=…`, Windows chuyển link đó cho agent (giao thức `dopadam://` đăng ký trong HKCU, plugin single-instance), agent đổi `code` lấy phiên (`grant_type=pkce`) | Credential Manager lấy ID token Google (kèm nonce đã băm SHA-256), đổi lấy phiên bằng `grant_type=id_token` |
| Lưu phiên | Refresh token trong Windows Credential Manager | Refresh token mã hóa AES-GCM bằng khóa trong Android Keystore |

Đổi sang tài khoản khác thì trước hết xóa trên máy các dòng thời gian dùng và lần chặn đến từ thiết bị khác của tài khoản cũ (nếu không chúng sẽ bị tính vào ngân sách và số lần mở của tài khoản mới), rồi con trỏ được xóa và mọi dữ liệu còn lại trên máy được đánh dấu "chưa đồng bộ", để tài khoản mới nhận đủ dữ liệu của máy này. "Xóa dữ liệu trên server" cũng đặt lại con trỏ và quên tài khoản vừa dùng, để lần đăng nhập sau đẩy lại đầy đủ. Chỉ những lần chặn đã có lựa chọn mới được đẩy lên; lần chưa có lựa chọn được coi là Thoát sau 12 giờ, trừ cảnh báo đang hiện trên màn hình.

**Tần suất.** Agent đồng bộ 30 giây một lần, và khoảng 5 giây sau mỗi thay đổi trên máy. Android đồng bộ khi mở app, tối đa mỗi phút một lần trong lúc dịch vụ bảo vệ chạy, cộng một lần nền qua WorkManager mỗi 15 phút khi có mạng. Extension không tự đồng bộ: khi agent đang chạy, extension dùng cấu hình và ghi nhật ký qua agent, nên dữ liệu trình duyệt đi theo agent lên server.

**Không cấu hình hoặc chưa đăng nhập.** Thiếu URL hoặc anon key (trong `agent/src-tauri/config.local.json` hoặc `android/secrets.properties`), hoặc chưa đăng nhập, thì mọi phần đồng bộ tắt; từng thiết bị vẫn chạy đầy đủ với dữ liệu của riêng nó.

**Giữ dữ liệu.** Nhật ký chặn và thời gian dùng được giữ 30 ngày trên agent và Android (đủ cho biểu đồ 4 tuần), 14 ngày trong extension (khi chạy riêng, không có agent); trên server dữ liệu được giữ đến khi người dùng bấm "Xóa dữ liệu trên server".

## 6. Bản Linux của agent

Phần Rust của agent đã build và chạy test trên Linux, và chương trình đã được chạy thử ở chế độ ẩn (socket, `hello`, cầu nối). Việc theo dõi cửa sổ qua tiện ích GNOME Shell và X11, cùng cửa sổ cảnh báo, chưa được thử trên phiên thật; các mục đó nằm trong [checklist nghiệm thu](nghiem-thu.md).

**Lớp nền tảng.** Giao diện React không đổi. Backend có thêm lệnh `get_platform` trả về `{ os, sessionType, focusBackend, shellExtensionConnected }`; giao diện dùng nó để chọn câu chữ (Windows hay Linux) và để Tổng quan báo nguồn theo dõi cửa sổ. Lệnh không có (backend cũ) thì giao diện coi như Windows. Trên Linux, danh tính chương trình là tên file của `/proc/<pid>/exe` (không có đuôi `.exe`).

**Hai nguồn cho biết cửa sổ phía trước** (`focusBackend`):

1. `gnome-shell`: tiện ích GNOME Shell `dopadam@dang` (GNOME Shell 45 đến 50), dùng trên Wayland vì ứng dụng thường không đọc được cửa sổ phía trước, không thu nhỏ được cửa sổ khác và không giữ cảnh báo ở trên cùng.
2. `x11`: thư viện `x11rb`, dùng trên phiên X11.

Không có nguồn nào (`none`) thì agent vẫn chạy khay hệ thống, cài đặt, thống kê, Chế độ Học, đồng bộ và cầu nối trình duyệt, nhưng không canh chương trình trên máy tính.

**Giao thức với tiện ích.** Agent lắng nghe trên Unix socket (stream) `$XDG_RUNTIME_DIR/dopadam-agent.sock`; socket này cũng phục vụ client khác nên mọi bên bỏ qua `type` lạ. Mỗi chiều là một đối tượng JSON mỗi dòng (UTF-8, kết thúc `\n`). Tiện ích thử nối lại mỗi 5 giây, mãi mãi. Tiện ích không bao giờ gửi tiêu đề cửa sổ.

| Chiều | `type` | Nội dung |
| --- | --- | --- |
| shell → agent | `shell_hello` | `protocol` (hiện là `1`), `shellVersion`. Gửi ngay khi nối |
| shell → agent | `focus` | `windowId` (id ổn định của Mutter), `pid`, `wmClass` hoặc `null`, `appId` hoặc `null` (ví dụ `org.gnome.Nautilus.desktop`), `fullscreen`, `monitor` (`{x, y, width, height}` hoặc `null`). Gửi sau `shell_hello`, mỗi khi cửa sổ có focus đổi, và khi cửa sổ đó vào hoặc ra toàn màn hình. Không có cửa sổ nào có focus: `windowId` 0, `pid` 0, các trường còn lại rỗng. Không gửi hai tin `focus` giống hệt nhau liên tiếp |
| shell → agent | `idle` | `seconds`: thời gian từ lần gõ phím hoặc di chuột cuối, theo bộ đo của Mutter. Gửi mỗi 30 giây và kèm mỗi `focus` |
| agent → shell | `shell_minimize` | `windowId`: thu nhỏ cửa sổ |
| agent → shell | `shell_activate` | `windowId`: bỏ thu nhỏ nếu cần và cho nhận focus |
| agent → shell | `shell_raise` | `pid`, `title`, `above`, `activate`: tìm cửa sổ của tiến trình `pid` có tiêu đề đúng bằng `title` (chỉ dành cho cửa sổ cảnh báo và thông báo của chính agent; tiêu đề không bao giờ được gửi ngược lại). `above` bật thì giữ cửa sổ trên các cửa sổ khác, tắt thì bỏ; `activate` bật thì cho nhận focus. Chưa thấy cửa sổ thì tiện ích tìm tiếp tối đa 2 giây rồi bỏ qua |

**Đăng ký cầu nối trình duyệt.** Agent ghi manifest native messaging vào thư mục cấu hình của Edge, Chrome, Chromium và Brave khi thư mục đó tồn tại dưới `~/.config`. Trình duyệt cài bằng snap không khởi động được chương trình bên ngoài snap, nên ở đó extension chạy riêng. Đóng gói bằng `.deb` và AppImage; tự chạy khi đăng nhập theo cơ chế của máy tính (không phải mục "Cùng Windows").

**Giới hạn đã biết.**

- Wayland trên trình quản lý cửa sổ khác GNOME (KDE, Sway, Hyprland…) không có nguồn cửa sổ phía trước, nên desktop không được canh.
- Trình duyệt cài bằng snap: không có cầu nối với agent, extension chạy riêng, không dùng chung bộ đếm.
- Chương trình viết bằng ngôn ngữ thông dịch cùng mang một tên file (ví dụ `python3`), nên gán tag cho một chương trình sẽ gán cho tất cả.
