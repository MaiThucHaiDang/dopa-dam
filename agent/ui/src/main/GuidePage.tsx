export function GuidePage() {
  return (
    <div className="page">
      <h1>Hướng dẫn</h1>

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
          sách giải trí mỗi ngày. Số liệu gộp cả máy tính, Edge và điện thoại (khi đã đăng nhập).
        </p>
      </section>

      <section className="card">
        <h2>Khi có trục trặc</h2>
        <ul className="steps">
          <li>Extension không nối: ở Tổng quan bấm "Đăng ký lại" rồi khởi động lại Edge.</li>
          <li>Không thấy biểu tượng DopaDam ở khay hệ thống: mở lại DopaDam từ menu Start.</li>
          <li>Windows báo SmartScreen khi cài: chọn "More info" → "Run anyway" (bản tự build chưa được ký số).</li>
        </ul>
      </section>
    </div>
  );
}
