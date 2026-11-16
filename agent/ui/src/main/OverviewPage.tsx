import { useEffect, useState } from "react";
import { api, describeFocusSource, shellExtensionState, type Overview } from "../api";
import { usePlatform } from "./usePlatform";
import { useNavigate, useRefresh } from "./MainApp";
import { ShellExtensionPanel } from "./ShellExtensionPanel";

function minutesUntil(at: number): number {
  return Math.max(0, Math.ceil((at - Date.now()) / 60_000));
}

export function OverviewPage() {
  const tick = useRefresh();
  const navigate = useNavigate();
  const [o, setO] = useState<Overview | null>(null);
  const [reloads, setReloads] = useState(0);
  const platform = usePlatform(`${tick}:${reloads}`);
  const [hostMessage, setHostMessage] = useState<string | null>(null);

  useEffect(() => {
    void api.overview().then(setO);
  }, [tick]);

  if (!o) return null;
  const focus = platform.os === "linux" ? describeFocusSource(platform) : null;
  const shellState = shellExtensionState(platform);
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

      {focus && (
        <section className="card">
          <h2>Theo dõi chương trình</h2>
          <p>
            <span className={`dot ${focus.ok ? "on" : ""}`} />
            {focus.text}
          </p>
          <ShellExtensionPanel platform={platform} onChanged={() => setReloads((n) => n + 1)} />
          {!focus.ok && shellState === "none" && (
            <div>
              <button className="btn-link" onClick={() => navigate("/guide")}>
                Cách bật theo dõi chương trình
              </button>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2>Extension trình duyệt</h2>
        {linked.length > 0 ? (
          <p>
            <span className="dot on" />
            Đã nối {linked.length} profile trình duyệt (extension {linked[0].extVersion ?? "?"}). Trang web dùng chung bộ đếm với
            máy tính.
          </p>
        ) : (
          <p>
            <span className="dot" />
            Chưa có extension nào nối với agent. Mở trình duyệt có cài extension DopaDam để nối.
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
            <span className="muted">Chưa đăng ký cầu nối với trình duyệt.</span>
            <button
              className="btn-secondary small-btn"
              onClick={() =>
                void api.registerHost().then(
                  () => setHostMessage("Đã đăng ký. Khởi động lại trình duyệt để extension nối vào."),
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
        <p className="notice">DopaDam đang không tự chạy khi đăng nhập máy tính. Bật lại trong Cài đặt để máy tính luôn được bảo vệ.</p>
      )}
      <p className="faint">DopaDam {o.version}</p>
    </div>
  );
}
