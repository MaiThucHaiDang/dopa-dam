import { useState } from "react";
import { shellExtensionState, type PlatformInfo } from "../api";
import { ShellExtensionPanel } from "./ShellExtensionPanel";
import { usePlatform } from "./usePlatform";

export function GuidePage() {
  const [reloads, setReloads] = useState(0);
  const platform = usePlatform(reloads);
  const linux = platform.os === "linux";
  return (
    <div className="page">
      <h1>Hướng dẫn</h1>

      {linux ? (
        <LinuxInstall platform={platform} onChanged={() => setReloads((n) => n + 1)} />
      ) : (
      <section className="card">
        <h2>Cài extension cho Edge</h2>
        <ol className="steps">
          <li>
            Build extension: trong thư mục <code>extension</code> chạy <code>npm install</code> rồi <code>npm run build</code>.
          </li>
          <li>
            Mở <code>edge://extensions</code>, bật <strong>Chế độ nhà phát triển</strong> ở góc trái.
          </li>
          <li>
            Bấm <strong>Load unpacked</strong> (Tải tiện ích đã giải nén) và chọn thư mục <code>extension\dist</code>.
          </li>
          <li>
            Trong thẻ DopaDam, bật <strong>Cho phép trong InPrivate</strong> để cửa sổ InPrivate cũng được bảo vệ.
          </li>
          <li>Khởi động lại Edge. Trang Tổng quan sẽ báo "Đã nối" khi extension tìm thấy agent.</li>
        </ol>
        <p className="muted">
          Dùng nhiều profile Edge thì cài extension ở từng profile; tất cả dùng chung một bộ đếm qua agent. Trình duyệt khác
          (Chrome, Cốc Cốc…) không có extension: gán tag Giải trí cho chúng ở mục Chương trình để không lách qua được.
        </p>
      </section>
      )}

      <section className="card">
        <h2>DopaDam hoạt động thế nào</h2>
        <p className="muted">
          Khi một chương trình hoặc trang web gắn tag Giải trí hay Game lên phía trước, DopaDam hiện câu hỏi "Bạn mở … để làm
          gì?". Thoát luôn bấm được ngay, Enter và Esc cũng là Thoát. Nút Vào khóa vài giây và chỉ bấm được bằng chuột: 5 giây
          lần đầu trong giờ, 10 giây lần 2–3, 20 giây từ lần thứ 4, 30 giây khi đang học hoặc đã dùng hết ngân sách giải trí.
        </p>
        <p className="muted">
          Chọn Vào thì được dùng trong 5, 15 hoặc 30 phút (đang học: 5 hoặc 10). Còn 1 phút có thông báo ở góc màn hình, hết
          giờ thì hỏi lại. Game có độ trễ: cảnh báo hiện sau khi game đã mở đủ số giây cài đặt; game chạy toàn màn hình độc
          quyền sẽ được thu nhỏ để cảnh báo hiện lên được.
        </p>
        <p className="muted">
          Giảm bảo vệ (bỏ tag Giải trí, giảm thời gian khóa, nới ngân sách, tắt bảo vệ, thoát DopaDam…) phải chờ 60 giây rồi
          gõ "tôi chọn giảm bảo vệ".
        </p>
      </section>

      <section className="card">
        <h2>Chế độ Học</h2>
        <p className="muted">
          Bật tay 25, 50 hoặc 90 phút kèm nhãn (ví dụ "Ôn Hệ điều hành"), hoặc đặt khung giờ cố định theo tuần (ví dụ T2–T6,
          19:30–22:00). Trong giờ học, nút Vào khóa 30 giây, chỉ cho vào 5 hoặc 10 phút, và tag, mức cản trở, ngân sách bị
          khóa; vẫn thêm được link học được phép. Cảnh báo nhắc lại nhãn phiên học để quay về việc đang làm.
        </p>
        <p className="muted">
          Kết thúc sớm, xóa hoặc rút ngắn khung giờ, hay bỏ qua hôm nay đều phải qua bước chờ 60 giây. Bỏ qua một ngày sau này
          thì không cần. Đã đăng nhập thì bật ở máy tính hay điện thoại, thiết bị còn lại cũng vào giờ học trong khoảng một
          phút.
        </p>
      </section>

      <section className="card">
        <h2>Đọc trang Thống kê</h2>
        <p className="muted">
          Biểu đồ "Số giây trung bình đến lúc bấm Thoát" là chỉ số chính: con số giảm dần nghĩa là bạn dừng lại nhanh hơn, ít
          giằng co hơn. Biểu đồ lần bị chặn cho thấy tỉ lệ Thoát so với Vào; biểu đồ thời gian theo tag có đường gạch là ngân
          sách giải trí mỗi ngày. Số liệu gộp cả máy tính, trình duyệt và điện thoại (khi đã đăng nhập).
        </p>
      </section>

      <section className="card">
        <h2>Khi có trục trặc</h2>
        <ul className="steps">
          <li>Extension không nối: ở Tổng quan bấm "Đăng ký lại" rồi khởi động lại trình duyệt.</li>
          {linux ? (
            <>
              <li>
                Không thấy biểu tượng DopaDam ở khay hệ thống: mở lại DopaDam từ menu ứng dụng. GNOME cần tiện ích AppIndicator
                để hiện khay.
              </li>
              <li>
                Tổng quan báo chưa nối với GNOME Shell: đăng xuất rồi đăng nhập lại sau khi cài tiện ích. Vẫn chưa nối thì bấm
                "Cài lại tiện ích" ở Tổng quan, hoặc chạy <code>gnome-extensions info dopadam@dang</code> để xem GNOME báo gì.
              </li>
            </>
          ) : (
            <>
              <li>Không thấy biểu tượng DopaDam ở khay hệ thống: mở lại DopaDam từ menu Start.</li>
              <li>Windows báo SmartScreen khi cài: chọn "More info" → "Run anyway" (bản tự build chưa được ký số).</li>
            </>
          )}
        </ul>
      </section>
    </div>
  );
}

function LinuxInstall({ platform, onChanged }: { platform: PlatformInfo; onChanged: () => void }) {
  const showPanel = shellExtensionState(platform) !== "none";
  return (
    <>
      <section className="card">
        <h2>Cài DopaDam trên Linux</h2>
        <ol className="steps">
          <li>
            Cài file <code>.deb</code>: <code>sudo apt install ./DopaDam_0.1.0_amd64.deb</code>. Đây là lệnh duy nhất cần
            gõ trong terminal.
          </li>
          <li>Mở DopaDam từ menu ứng dụng. Biểu tượng DopaDam hiện ở khay hệ thống.</li>
          <li>Nếu bạn dùng GNOME với Wayland, làm tiếp phần dưới đây.</li>
        </ol>
      </section>

      <section className="card">
        <h2>Cho DopaDam thấy chương trình đang mở (GNOME)</h2>
        <p className="muted">
          Trên GNOME dùng Wayland, một ứng dụng thường không biết cửa sổ nào đang ở phía trước, không thu nhỏ được cửa sổ
          khác và không tự đặt cảnh báo lên trên. Tiện ích GNOME Shell của DopaDam làm ba việc đó thay cho agent. Nó không bao
          giờ gửi tiêu đề cửa sổ. Tiện ích nằm sẵn trong DopaDam nên không cần tải hay chép gì thêm.
        </p>
        <ol className="steps">
          <li>
            Ở trang Tổng quan (hoặc ngay dưới đây) bấm <strong>Cài tiện ích GNOME</strong>. Không cần sudo.
          </li>
          <li>Đăng xuất rồi đăng nhập lại. Trên Wayland, GNOME Shell chỉ nạp tiện ích mới khi đăng nhập.</li>
          <li>Mở DopaDam. Trang Tổng quan sẽ báo đã nối với GNOME Shell.</li>
        </ol>
        {showPanel && <ShellExtensionPanel platform={platform} onChanged={onChanged} />}
        <p className="muted">
          Phiên X11 không cần tiện ích: agent tự theo dõi cửa sổ qua X11. Nếu cả hai đều không có (ví dụ Wayland với KDE, Sway
          hay Hyprland), DopaDam vẫn chạy khay hệ thống, cài đặt, thống kê, chế độ Học, đồng bộ và cầu nối trình duyệt, nhưng
          không cảnh báo được các chương trình trên máy tính. Khi đó chỉ trang web (qua extension) được canh.
        </p>
        <p className="muted">
          Chương trình viết bằng ngôn ngữ thông dịch (ví dụ game chạy bằng <code>python3</code>) mang tên file chung của trình
          thông dịch, nên gán tag cho nó sẽ gán cho mọi chương trình cùng loại.
        </p>
        <p className="faint">
          Chạy DopaDam từ mã nguồn thay vì file .deb: trong thư mục <code>linux/gnome-shell-extension</code> chạy{" "}
          <code>./install.sh</code>, đăng xuất rồi đăng nhập lại, rồi chạy <code>gnome-extensions enable dopadam@dang</code>.
        </p>
      </section>

      <section className="card">
        <h2>Cài extension cho trình duyệt</h2>
        <ol className="steps">
          <li>
            Build extension: trong thư mục <code>extension</code> chạy <code>npm install</code> rồi <code>npm run build</code>.
          </li>
          <li>
            Mở <code>chrome://extensions</code> (hoặc <code>edge://extensions</code>, <code>brave://extensions</code>), bật{" "}
            <strong>Chế độ nhà phát triển</strong>.
          </li>
          <li>
            Bấm <strong>Load unpacked</strong> (Tải tiện ích đã giải nén) và chọn thư mục <code>extension/dist</code>.
          </li>
          <li>Trong thẻ DopaDam, bật cho phép chạy ở chế độ ẩn danh để cửa sổ ẩn danh cũng được bảo vệ.</li>
          <li>Khởi động lại trình duyệt. Trang Tổng quan sẽ báo "Đã nối" khi extension tìm thấy agent.</li>
        </ol>
        <p className="muted">
          Hỗ trợ Edge, Chrome, Chromium và Brave khi thư mục cấu hình của chúng có trong <code>~/.config</code>. Trình duyệt
          cài bằng snap không khởi động được cầu nối bên ngoài snap, nên extension ở đó chạy riêng, không dùng chung bộ đếm
          với agent; hãy dùng bản không đóng gói snap, hoặc gán tag Giải trí cho trình duyệt đó ở mục Chương trình. Dùng
          nhiều profile thì cài extension ở từng profile.
        </p>
      </section>
    </>
  );
}
