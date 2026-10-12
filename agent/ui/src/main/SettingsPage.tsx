import { useCallback, useEffect, useState } from "react";
import { api, type Overview, type Settings } from "../api";
import { ErrorBanner, useSubmit } from "../components/Confirm";
import { AccountSection } from "./AccountSection";
import { useRefresh } from "./MainApp";

const LEVELS = ["Cấp 0 · lần đầu trong giờ", "Cấp 1 · lần 2–3", "Cấp 2 · từ lần 4", "Cấp 3 · đang học hoặc vượt ngân sách"];

export function SettingsPage() {
  const tick = useRefresh();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [draft, setDraft] = useState<{ locks: string[]; budget: string; game: string; ent: string } | null>(null);
  const reload = useCallback(() => {
    void api.settings().then((s) => {
      setSettings(s);
      setDraft({
        locks: s.lockSeconds.map(String),
        budget: String(s.budgetMinutes),
        game: String(s.tagDelays.game ?? 0),
        ent: String(s.tagDelays.entertainment ?? 0),
      });
    });
    void api.overview().then(setOverview);
  }, []);
  const { submit, error, dialog } = useSubmit(reload);

  useEffect(reload, [tick, reload]);

  if (!settings || !draft || !overview) return null;
  const locked = overview.study.active;

  function save() {
    if (!settings || !draft) return;
    const tagDelays: Record<string, number> = { ...settings.tagDelays };
    tagDelays.game = Number(draft.game) || 0;
    tagDelays.entertainment = Number(draft.ent) || 0;
    for (const k of Object.keys(tagDelays)) if (!tagDelays[k]) delete tagDelays[k];
    const next: Settings = {
      ...settings,
      lockSeconds: draft.locks.map((v) => Number(v) || 0),
      budgetMinutes: Number(draft.budget) || 0,
      tagDelays,
    };
    void submit("Giảm thời gian khóa nút Vào, nới ngân sách hoặc tăng độ trễ.", (confirmed) => api.saveSettings(next, confirmed));
  }

  return (
    <div className="page">
      <h1>Cài đặt</h1>
      {locked && <p className="notice">Đang trong phiên học: mức cản trở và tag bị khóa đến hết phiên.</p>}
      <ErrorBanner error={error} />

      <section className="card">
        <h2>Mức cản trở</h2>
        <p className="muted">Số giây khóa nút Vào ở mỗi cấp. Tăng thì áp dụng ngay, giảm thì cần xác nhận.</p>
        <form
          className="grid-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {LEVELS.map((label, i) => (
            <label key={label}>
              {label}
              <input
                type="number"
                min={0}
                max={300}
                disabled={locked}
                value={draft.locks[i]}
                onChange={(e) => setDraft({ ...draft, locks: draft.locks.map((v, j) => (j === i ? e.target.value : v)) })}
              />
            </label>
          ))}
          <label>
            Ngân sách giải trí mỗi ngày (phút, 0 = tắt)
            <input type="number" min={0} max={1440} disabled={locked} value={draft.budget} onChange={(e) => setDraft({ ...draft, budget: e.target.value })} />
          </label>
          <label>
            Độ trễ cảnh báo cho Game (giây, tối đa 120)
            <input type="number" min={0} max={120} disabled={locked} value={draft.game} onChange={(e) => setDraft({ ...draft, game: e.target.value })} />
          </label>
          <label>
            Độ trễ cảnh báo cho Giải trí (giây)
            <input type="number" min={0} max={120} disabled={locked} value={draft.ent} onChange={(e) => setDraft({ ...draft, ent: e.target.value })} />
          </label>
          <div>
            <button className="btn-primary" type="submit" disabled={locked}>
              Lưu
            </button>
          </div>
        </form>
      </section>

      <AccountSection />

      <section className="card">
        <h2>Bảo vệ</h2>
        <div className="row">
          <button
            className="btn-secondary"
            onClick={() =>
              void submit("Tắt bảo vệ trên máy tính: chương trình và trang web sẽ mở thẳng.", (confirmed) =>
                api.setProtection(!overview.protectionEnabled, confirmed),
              )
            }
          >
            {overview.protectionEnabled ? "Tắt bảo vệ" : "Bật lại bảo vệ"}
          </button>
          <button
            className="btn-secondary"
            onClick={() =>
              void submit("Không tự chạy DopaDam khi mở máy: lần sau bật máy sẽ không được bảo vệ.", (confirmed) =>
                api.setAutostart(!overview.autostart, confirmed),
              )
            }
          >
            {overview.autostart ? "Tắt tự chạy cùng Windows" : "Bật tự chạy cùng Windows"}
          </button>
          <button className="btn-quiet" onClick={() => void submit("Xóa toàn bộ nhật ký chặn và thời gian dùng.", (c) => api.clearLog(c))}>
            Xóa nhật ký
          </button>
        </div>
      </section>
      {dialog}
    </div>
  );
}
