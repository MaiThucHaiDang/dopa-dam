# Thiết kế kỹ thuật DopaDam

Tài liệu cho người phát triển: cấu trúc repo, lõi logic dùng chung, giao thức giữa agent và extension, lưu trữ và đồng bộ. Hành vi của ứng dụng do [đặc tả](../DopaDam-dac-ta.md) quyết định; tài liệu này chỉ mô tả cách hiện thực.

## 1. Cấu trúc repo

| Thư mục | Nội dung |
| --- | --- |
| `shared/design-tokens/` | `tokens.json` (bộ màu và cỡ chữ duy nhất) và `generate.mjs` sinh ra file token cho từng nền tảng, kèm kiểm tra độ tương phản AA |
| `shared/test-vectors/` | Các file JSON mô tả đầu vào và kết quả mong đợi của lõi logic; cả ba nền tảng chạy chung bộ này |
| `extension/` | Extension Edge, TypeScript, Manifest V3, build bằng esbuild, test bằng Vitest |
| `android/` | App Android, Kotlin + Jetpack Compose, package `com.dang.dopadam` |
| `agent/` | Agent Windows, Tauri 2: `src-tauri/` (Rust) và `ui/` (React + TypeScript) |
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
| `matchDomainTag(host, rules)` | Luật khớp khi `host == pattern` hoặc `host` kết thúc bằng `"." + pattern`; nhiều luật khớp thì luật dài nhất thắng; không khớp trả về `null` | `domain.json` |
| `parseAllowUrl(text)`, `isAllowedUrl(url, allowList)` | Xem mục 2.2 (chỉ extension dùng) | `allow-url.json` |
| `classifyTagChange(old, new)`, `classifyNumberChange(field, old, new)` | Thay đổi làm yếu bảo vệ trả về `"weaken"` (cần bước xác nhận FR14), còn lại `"ok"`. Xem mục 2.3 | `friction.json` |

### 2.1 Gộp nguồn Chế độ Học

- Phiên bật tay và phiên TaskFlow: `{id, start, end, label}`, hiệu lực khi `start ≤ now < end`.
- Khung giờ cố định: `{id, days, start, end, label, exceptions}`. `days` theo ISO (1 = thứ 2 … 7 = chủ nhật), `start`/`end` dạng `HH:MM` theo giờ địa phương. Nếu `end ≤ start` thì khung kéo qua nửa đêm. Mỗi ngày `D` có thứ nằm trong `days` và không nằm trong `exceptions` sinh ra một lần xuất hiện từ `D start` đến `end` (cùng ngày, hoặc ngày hôm sau nếu qua nửa đêm). Ngoại lệ tính theo ngày bắt đầu.
- Nhãn trống hoặc `null` thì dùng nhãn mặc định: "Khung giờ học" (khung giờ), "Phiên học" (bật tay), "Phiên TaskFlow" (TaskFlow).
- Đang học khi có ít nhất một phiên hiệu lực. Phiên dùng để hiển thị chọn theo nguồn: bật tay > TaskFlow > khung giờ; cùng nguồn thì chọn phiên kết thúc muộn nhất. Kết quả: `{active, source, label, endsAt}`; khi không học thì `source`, `label`, `endsAt` là `null`.

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
- Luôn cần xác nhận: tắt bảo vệ, thêm link được phép, kết thúc Chế độ Học trước giờ, thêm ngoại lệ cho ngày đang có phiên, xóa nhật ký.
- Bước xác nhận: chờ 60 giây rồi gõ đúng câu `tôi chọn giảm bảo vệ`.

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
| agent → ext | `config` | Ảnh chụp đầy đủ: `domainRules`, `allowUrls`, `settings`, `allowWindows`, `study`, `budget`, `protectionEnabled`, `summary` (số lần chặn và Thoát hôm nay). Gửi sau `welcome` và mỗi khi có thay đổi |
| ext → agent | `warning_request` | `requestId`, `eventId` (do trang cảnh báo tạo, nên tải lại trang không bị đếm hai lần), `object` (tên miền khớp luật), `url` |
| agent → ext | `warning_context` | `requestId`, `skip` (đang được phép thì mở thẳng), `eventId`, `level`, `lockSeconds`, `allowOptions`, `n`, `shownAt`, `decision`, `budget`, `study`, `activities` |
| ext → agent | `decision` | `requestId`, `eventId`, `decision` (`enter` / `exit` / `alternative`), `allowMinutes`, `activity`, `activityMinutes` |
| ext → agent | `usage` | `domain`, `url`, `seconds` (mỗi phút, cho tab đang xem); agent quy ra tag, link được phép tính là Học tập |
| ext → agent | `set_domain_rule` | `requestId`, `pattern`, `tag` (`null` để gỡ), `confirmed` |
| ext → agent | `add_allow_url`, `remove_allow_url` | `requestId`, `entry` (`{kind, id}` hoặc `{kind, value}`), `confirmed` |
| ext → agent | `set_friction` | `requestId`, `lockSeconds`, `budgetMinutes`, `confirmed` |
| ext → agent | `set_protection`, `clear_log` | `requestId`, `enabled` (với `set_protection`), `confirmed` |

Khi agent đang chạy, mọi số đếm, khoảng được phép và nhật ký nằm ở agent; agent tự kiểm tra lại quy tắc giảm bảo vệ và khóa cấu hình trong giờ học. Extension giữ bản sao cấu hình gần nhất trong `chrome.storage.local` để vẫn chặn được khi mất kết nối.

## 4. Lưu trữ cục bộ

| Nền tảng | Nơi lưu |
| --- | --- |
| Extension | `chrome.storage.local` (cấu hình, nhật ký 7 ngày gần nhất, thời gian dùng theo ngày) |
| Android | Room (`dopadam.db`); phiên đăng nhập mã hóa bằng khóa trong Android Keystore |
| Agent | SQLite tại `%APPDATA%\DopaDam\dopadam.db`; phiên đăng nhập trong Windows Credential Manager |

## 5. Đồng bộ qua Supabase

- Mỗi bảng có `id` (UUID do thiết bị tạo), `user_id`, `updated_at` (thời điểm thay đổi theo đồng hồ thiết bị, dùng cho "bản mới hơn thắng"), `server_updated_at` (do trigger đặt, dùng làm con trỏ kéo về) và `schema_version`.
- Đẩy lên: upsert qua PostgREST (`Prefer: resolution=merge-duplicates`). Trigger `BEFORE UPDATE` bỏ qua bản ghi có `updated_at` cũ hơn bản đang có.
- Kéo về: `server_updated_at > con trỏ` cho từng bảng, sắp xếp tăng dần.
- `intercept_events` chỉ thêm. `usage_daily` mỗi dòng thuộc đúng một thiết bị (`id = ngày|thiết bị|tag`), chỉ thiết bị đó ghi, nên không xung đột.
- Tần suất: agent 30 giây một lần khi có mạng; Android mỗi 60 giây khi màn hình bật, cộng một lần đồng bộ nền qua WorkManager mỗi 15 phút.
- Chưa cấu hình Supabase (thiếu URL hoặc anon key) hoặc chưa đăng nhập thì mọi phần đồng bộ tắt, ứng dụng vẫn chạy đầy đủ trên từng thiết bị.
