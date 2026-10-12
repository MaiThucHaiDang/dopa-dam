// FR09: Study mode. Start a session by hand, or set weekly hours; ending early waits for the FR14 confirmation.
import { useCallback, useEffect, useState } from "react";
import { MANUAL_STUDY_MINUTES, STUDY_LABEL_MAX, formatStudyDays, shortDate, type StudyRule } from "@core";
import { api, type StudyView } from "../api";
import { ErrorBanner, useSubmit } from "../components/Confirm";
import { useRefresh } from "./MainApp";

const WEEKDAYS: [number, string][] = [
  [1, "T2"],
  [2, "T3"],
  [3, "T4"],
  [4, "T5"],
  [5, "T6"],
  [6, "T7"],
  [7, "CN"],
];

function clock(at: number): string {
  return new Date(at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

const SOURCE_TEXT: Record<string, string> = {
  manual: "bật tay",
  rule: "theo khung giờ",
  taskflow: "theo TaskFlow",
};

export function StudyPage() {
  const tick = useRefresh();
  const [view, setView] = useState<StudyView | null>(null);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState("19:30");
  const [end, setEnd] = useState("22:00");
  const [ruleLabel, setRuleLabel] = useState("");
  const [skip, setSkip] = useState<Record<string, string>>({});
  const reload = useCallback(() => void api.study().then(setView), []);
  const { submit, error, setError, dialog } = useSubmit(reload);

  useEffect(reload, [tick, reload]);

  if (!view) return null;
  const { status, today } = view;

  function skipDay(rule: StudyRule) {
    const date = skip[rule.id];
    if (!date) {
      setError("Chọn ngày muốn bỏ qua.");
      return;
    }
    const next = { ...rule, exceptions: [...rule.exceptions, date] };
    void submit(`Bỏ qua khung giờ học ngày ${shortDate(date)}.`, (confirmed) => api.setStudyRule(next, confirmed));
  }

  return (
    <div className="page">
      <h1>Chế độ Học</h1>
      <p className="muted" style={{ margin: 0 }}>
        Trong giờ học, nút Vào khóa 30 giây, chỉ cho vào 5 hoặc 10 phút, và các cài đặt bị khóa (trừ thêm link được phép).
        Khi đã đăng nhập, bật ở máy này thì điện thoại cũng vào giờ học, và ngược lại.
      </p>
      <ErrorBanner error={error} />

      <section className="card">
        <h2>Bây giờ</h2>
        {status.active && status.endsAt !== null ? (
          <>
            <p>
              <span className="dot on" />
              Đang học: <strong>{status.label}</strong> ({SOURCE_TEXT[status.source ?? ""] ?? "đang bật"}), đến{" "}
              {clock(status.endsAt)}.
            </p>
            <div className="row">
              <span className="muted">Học thêm:</span>
              {MANUAL_STUDY_MINUTES.map((m) => (
                <button key={m} className="btn-secondary" onClick={() => void submit(`Bật phiên học ${m} phút.`, () => api.startStudy(m, status.label))}>
                  {m} phút
                </button>
              ))}
              <button
                className="btn-quiet"
                onClick={() =>
                  void submit("Kết thúc giờ học ngay bây giờ: cảnh báo trở về mức bình thường và cài đặt được mở khóa.", (confirmed) =>
                    api.stopStudy(confirmed),
                  )
                }
              >
                Kết thúc sớm
              </button>
            </div>
          </>
        ) : (
          <form className="row" onSubmit={(e) => e.preventDefault()}>
            <input
              type="text"
              placeholder="Học gì? vd: Ôn Hệ điều hành"
              maxLength={STUDY_LABEL_MAX}
              value={label}
              aria-label="Nhãn phiên học"
              onChange={(e) => setLabel(e.target.value)}
            />
            {MANUAL_STUDY_MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                className="btn-primary"
                onClick={() => {
                  void submit(`Bật phiên học ${m} phút.`, () => api.startStudy(m, label.trim() || null));
                  setLabel("");
                }}
              >
                Học {m} phút
              </button>
            ))}
          </form>
        )}
      </section>

      <section className="card">
        <h2>Khung giờ cố định</h2>
        <p className="muted">
          Tự vào giờ học theo lịch tuần. Thêm khung hoặc kéo dài thì không cần xác nhận; xóa, rút ngắn hoặc bỏ qua hôm nay
          thì phải xác nhận, và bị khóa khi đang học.
        </p>
        <table className="list">
          <tbody>
            {view.rules.length === 0 && (
              <tr>
                <td className="faint">Chưa có khung giờ nào.</td>
              </tr>
            )}
            {view.rules.map((r) => {
              const upcoming = r.exceptions.filter((d) => d >= today);
              return (
                <tr key={r.id}>
                  <td>
                    <strong>
                      {formatStudyDays(r.days)} · {r.start}–{r.end}
                    </strong>
                    {r.label ? ` · ${r.label}` : ""}
                    {upcoming.length > 0 && <div className="faint">Bỏ qua: {upcoming.map(shortDate).join(", ")}</div>}
                  </td>
                  <td className="actions">
                    <input
                      type="date"
                      min={today}
                      value={skip[r.id] ?? ""}
                      aria-label="Ngày bỏ qua"
                      onChange={(e) => setSkip({ ...skip, [r.id]: e.target.value })}
                    />
                    <button className="btn-quiet small-btn" onClick={() => skipDay(r)}>
                      Bỏ qua ngày này
                    </button>
                    <button
                      className="btn-quiet small-btn"
                      onClick={() =>
                        void submit(`Xóa khung giờ học ${formatStudyDays(r.days)} ${r.start}–${r.end}.`, (confirmed) =>
                          api.deleteStudyRule(r.id, confirmed),
                        )
                      }
                    >
                      Xóa
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2>Thêm khung giờ</h2>
        <fieldset className="weekdays">
          <legend className="muted">Ngày trong tuần</legend>
          {WEEKDAYS.map(([d, name]) => (
            <label key={d}>
              <input
                type="checkbox"
                checked={days.includes(d)}
                onChange={(e) => setDays(e.target.checked ? [...days, d] : days.filter((x) => x !== d))}
              />
              {name}
            </label>
          ))}
        </fieldset>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!days.length || start === end) {
              setError("Chọn ít nhất một ngày, và giờ kết thúc khác giờ bắt đầu.");
              return;
            }
            const rule: StudyRule = { id: "", days, start, end, label: ruleLabel.trim() || null, exceptions: [] };
            void submit("Thêm khung giờ học.", (confirmed) => api.setStudyRule(rule, confirmed));
            setRuleLabel("");
          }}
        >
          <label>
            Từ <input type="time" value={start} required onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            đến <input type="time" value={end} required onChange={(e) => setEnd(e.target.value)} />
          </label>
          <input
            type="text"
            placeholder="Nhãn (không bắt buộc)"
            maxLength={STUDY_LABEL_MAX}
            value={ruleLabel}
            aria-label="Nhãn khung giờ"
            onChange={(e) => setRuleLabel(e.target.value)}
          />
          <button className="btn-primary" type="submit">
            Thêm
          </button>
        </form>
        <p className="faint">Giờ kết thúc sớm hơn giờ bắt đầu nghĩa là khung kéo qua nửa đêm.</p>
      </section>
      {dialog}
    </div>
  );
}
