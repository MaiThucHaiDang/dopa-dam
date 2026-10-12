import { api } from "../api";
import { ErrorBanner, useSubmit } from "../components/Confirm";
import { useNavigate } from "./MainApp";

/** Reached from the tray menu: quitting turns desktop protection off, so it needs the confirmation. */
export function QuitPage() {
  const navigate = useNavigate();
  const { submit, error, dialog } = useSubmit();
  return (
    <div className="page">
      <h1>Thoát DopaDam</h1>
      <p className="muted">
        Khi thoát, các chương trình trên máy tính sẽ không bị cảnh báo nữa và extension Edge chạy riêng cho đến khi DopaDam mở
        lại.
      </p>
      <ErrorBanner error={error} />
      <div className="row">
        <button className="btn-primary" onClick={() => navigate("/")}>
          Giữ DopaDam chạy
        </button>
        <button
          className="btn-quiet"
          onClick={() => void submit("Thoát DopaDam: máy tính không được bảo vệ cho đến khi mở lại.", (c) => api.quitAgent(c))}
        >
          Thoát
        </button>
      </div>
      {dialog}
    </div>
  );
}
