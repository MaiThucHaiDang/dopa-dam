import { useCallback, useEffect, useState } from "react";
import { TAGS, TAG_LABELS, isBlockedTag, type Tag } from "@core";
import { api, type AppRow } from "../api";
import { ErrorBanner, useSubmit } from "../components/Confirm";
import { useRefresh } from "./MainApp";

export function AppsPage() {
  const tick = useRefresh();
  const [apps, setApps] = useState<AppRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const reload = useCallback(() => void api.listApps().then(setApps), []);
  const { submit, error, dialog } = useSubmit(reload);

  useEffect(reload, [tick, reload]);

  const filtered = (apps ?? []).filter(
    (a) => !query.trim() || a.name.toLowerCase().includes(query.trim().toLowerCase()) || a.exe.includes(query.trim().toLowerCase()),
  );
  const untagged = filtered.filter((a) => !a.tag);
  const tagged = filtered.filter((a) => a.tag);

  function setTag(app: AppRow, value: string) {
    const tag = value ? (value as Tag) : null;
    const action = tag
      ? `Đổi ${app.name} sang tag ${TAG_LABELS[tag]}.`
      : `Bỏ tag của ${app.name}: chương trình này sẽ không bị cảnh báo nữa.`;
    void submit(action, (confirmed) => api.setAppTag(app.exe, tag, confirmed));
  }

  function setDelay(app: AppRow, value: string) {
    const delay = value.trim() === "" ? null : Number(value);
    if (delay !== null && (!Number.isInteger(delay) || delay < 0 || delay > 120)) return;
    if (delay === app.delaySeconds) return;
    void submit(`Tăng độ trễ cảnh báo của ${app.name}.`, (confirmed) => api.setAppDelay(app.exe, delay, confirmed));
  }

  const row = (app: AppRow) => (
    <tr key={app.exe}>
      <td>
        <div>{app.name}</div>
        <div className="faint">{app.exe}</div>
      </td>
      <td>
        <select value={app.tag ?? ""} aria-label={`Tag của ${app.name}`} onChange={(e) => setTag(app, e.target.value)}>
          <option value="">Chưa gán</option>
          {TAGS.map((t) => (
            <option key={t} value={t}>
              {TAG_LABELS[t]}
            </option>
          ))}
        </select>
      </td>
      <td>
        {app.tag && isBlockedTag(app.tag) ? (
          <input
            className="delay-input"
            type="number"
            min={0}
            max={120}
            defaultValue={app.delaySeconds ?? ""}
            placeholder={String(app.effectiveDelay)}
            aria-label={`Độ trễ của ${app.name} (giây)`}
            title="Độ trễ riêng (giây). Để trống = theo tag."
            onBlur={(e) => setDelay(app, e.target.value)}
          />
        ) : (
          <span className="faint">—</span>
        )}
      </td>
    </tr>
  );

  return (
    <div className="page">
      <h1>Chương trình</h1>
      <p className="muted" style={{ margin: 0 }}>
        Chương trình gắn tag Giải trí hoặc Game sẽ hiện cảnh báo khi được đưa lên phía trước. Game có độ trễ để kịp tải xong
        rồi mới cảnh báo; cột độ trễ để trống thì theo tag.
      </p>
      <ErrorBanner error={error} />
      <div className="row">
        <input type="text" placeholder="Tìm chương trình" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button
          className="btn-secondary"
          disabled={scanning}
          onClick={() => {
            setScanning(true);
            void api.rescanApps().finally(() => {
              setScanning(false);
              reload();
            });
          }}
        >
          {scanning ? "Đang quét…" : "Quét lại menu Start"}
        </button>
      </div>
      {apps === null ? (
        <p className="muted">Đang tải…</p>
      ) : (
        <section className="card">
          <table className="list">
            <thead>
              <tr>
                <th>Chương trình</th>
                <th>Tag</th>
                <th>Độ trễ (giây)</th>
              </tr>
            </thead>
            <tbody>
              {tagged.map(row)}
              {untagged.length > 0 && (
                <tr>
                  <td colSpan={3} className="faint">
                    Chưa gán tag ({untagged.length})
                  </td>
                </tr>
              )}
              {untagged.map(row)}
            </tbody>
          </table>
        </section>
      )}
      {dialog}
    </div>
  );
}
