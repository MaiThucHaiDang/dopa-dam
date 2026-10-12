import { useEffect, useState } from "react";
import { api, type Overview } from "../api";
import { useNavigate, useRefresh } from "./MainApp";

function minutesUntil(at: number): number {
  return Math.max(0, Math.ceil((at - Date.now()) / 60_000));
}

export function OverviewPage() {
  const tick = useRefresh();
  const navigate = useNavigate();
  const [o, setO] = useState<Overview | null>(null);
  const [hostMessage, setHostMessage] = useState<string | null>(null);

  useEffect(() => {
    void api.overview().then(setO);
  }, [tick]);

  if (!o) return null;
  const used = Math.round(o.budget.usedMinutes);
  const linked = o.extensions.filter((e) => e.compatible);
  const mismatched = o.extensions.filter((e) => !e.compatible);

  return (
    <div className="page">
      <h1>Tổng quan</h1>
      <p className="muted" style={{ margin: 0 }}>
        <span className={`dot ${o.protectionEnabled ? "on" : ""}`} />
        {o.protectionEnabled ? "Bảo vệ đang bật trên máy tính này" : "Bảo vệ đang TẮT trên máy tính này"}
      </p>

      {o.study.active && o.study.endsAt !== null && (
        <p className="notice">
          Đang học: <strong>{o.study.label}</strong> · còn {minutesUntil(o.study.endsAt)} phút. Nút Vào khóa lâu hơn và cài
          đặt bị khóa.
        </p>
      )}

      <section className="card">
        <h2>Hôm nay</h2>
        <div className="stats">
          <div className="stat">
            <div className="muted">Bị chặn</div>
            <div className="value">{o.warningsToday}</div>
          </div>
          <div className="stat">
            <div className="muted">Chọn Thoát</div>
            <div className="value">{o.exitsToday}</div>
          </div>
          <div className="stat">
            <div className="muted">Giải trí</div>
            <div className="value">{o.budget.budgetMinutes > 0 ? `${used} / ${o.budget.budgetMinutes}` : used} phút</div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Extension Edge</h2>
        {linked.length > 0 ? (
          <p>
            <span className="dot on" />
            Đã nối {linked.length} profile Edge (extension {linked[0].extVersion ?? "?"}). Trang web dùng chung bộ đếm với
            máy tính.
          </p>
        ) : (
          <p>
            <span className="dot" />
            Chưa có extension nào nối với agent. Mở Edge có cài extension DopaDam để nối.
          </p>
        )}
        {mismatched.length > 0 && (
          <p className="notice">
            Có extension khác phiên bản (extension {mismatched[0].extVersion ?? "?"}, agent {o.version}). Hãy build lại cả
            hai cùng một phiên bản.
          </p>
        )}
        {!o.hostRegistered && (
          <div className="row">
            <span className="muted">Chưa đăng ký cầu nối với Edge.</span>
            <button
              className="btn-secondary small-btn"
              onClick={() =>
                void api.registerHost().then(
                  () => setHostMessage("Đã đăng ký. Khởi động lại Edge để extension nối vào."),
                  (e) => setHostMessage(String(e)),
                )
              }
            >
              Đăng ký lại
            </button>
          </div>
        )}
        {hostMessage && <p className="faint">{hostMessage}</p>}
        <div>
          <button className="btn-link" onClick={() => navigate("/guide")}>
            Cách cài extension
          </button>
        </div>
      </section>

      {!o.autostart && (
        <p className="notice">DopaDam đang không tự chạy cùng Windows. Bật lại trong Cài đặt để máy tính luôn được bảo vệ.</p>
      )}
      <p className="faint">DopaDam {o.version}</p>
    </div>
  );
}
