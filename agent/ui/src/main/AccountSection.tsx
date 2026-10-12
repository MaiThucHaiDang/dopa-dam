// Sign-in (Google or email + password) and sync status, part of the Settings page.
import { useCallback, useEffect, useState } from "react";
import { api, isCmdError, type AccountStatus, type DeviceRow } from "../api";
import { useSubmit } from "../components/Confirm";
import { useRefresh } from "./MainApp";

const PLATFORM: Record<string, string> = { android: "Điện thoại Android", windows: "Máy tính Windows", extension: "Extension" };

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} giờ trước` : `${Math.round(hours / 24)} ngày trước`;
}

export function AccountSection() {
  const tick = useRefresh();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => void api.account().then(setStatus), []);
  const { submit, error, dialog } = useSubmit(reload);

  useEffect(reload, [tick, reload]);
  useEffect(() => {
    if (status?.signedIn) void api.devices().then(setDevices, () => setDevices([]));
  }, [status?.signedIn, status?.lastSync]);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (done) setMessage(done);
    } catch (e) {
      setMessage(isCmdError(e) ? e.message : String(e));
    } finally {
      setBusy(false);
      reload();
    }
  }

  if (!status) return null;
  return (
    <section className="card">
      <h2>Tài khoản và đồng bộ</h2>
      {!status.configured ? (
        <p className="muted">
          Chưa cấu hình server đồng bộ. DopaDam vẫn chạy đầy đủ trên máy này; để đồng bộ với điện thoại, làm theo mục Supabase
          trong README rồi build lại.
        </p>
      ) : status.signedIn ? (
        <>
          <p style={{ margin: 0 }}>
            Đã đăng nhập: <strong>{status.email ?? "tài khoản Google"}</strong>
          </p>
          <p className="muted" style={{ margin: 0 }}>
            {status.syncing ? "Đang đồng bộ…" : status.lastSync ? `Đồng bộ lần cuối ${ago(status.lastSync)}` : "Chưa đồng bộ lần nào"}
          </p>
          {devices.length > 0 && (
            <ul className="steps" style={{ listStyle: "none", paddingLeft: 0 }}>
              {devices.map((d) => (
                <li key={`${d.platform}-${d.name}-${d.lastSeen}`} className="muted">
                  {PLATFORM[d.platform] ?? d.platform} {d.name && `· ${d.name}`} · {d.thisDevice ? "máy này" : `lần cuối ${ago(d.lastSeen)}`}
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <button className="btn-secondary" disabled={busy || status.syncing} onClick={() => void run(api.syncNow, "Đã đồng bộ.")}>
              Đồng bộ ngay
            </button>
            <button className="btn-quiet" disabled={busy} onClick={() => void run(api.signOut)}>
              Đăng xuất
            </button>
            <button
              className="btn-quiet"
              onClick={() =>
                void submit("Xóa toàn bộ dữ liệu của tài khoản trên server và nhật ký trên máy này, rồi đăng xuất.", (c) =>
                  api.deleteServerData(c),
                )
              }
            >
              Xóa dữ liệu trên server
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Đăng nhập để dùng chung tag, Chế độ Học và bộ đếm với điện thoại. Không đăng nhập thì mọi dữ liệu chỉ nằm trên máy này.
          </p>
          <div className="row">
            <button className="btn-primary" disabled={busy} onClick={() => void run(api.signInGoogle, "Đã mở trình duyệt để đăng nhập Google.")}>
              Đăng nhập bằng Google
            </button>
          </div>
          <form
            className="grid-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api.signIn(email, password));
            }}
          >
            <label>
              Email
              <input type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              Mật khẩu (ít nhất 6 ký tự)
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <div className="row">
              <button className="btn-secondary" type="submit" disabled={busy}>
                Đăng nhập
              </button>
              <button
                className="btn-quiet"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await api.signUp(email, password);
                    if (r === "confirm-email") throw new Error("Đã tạo tài khoản. Mở email xác nhận rồi bấm Đăng nhập.");
                  })
                }
              >
                Tạo tài khoản
              </button>
            </div>
          </form>
        </>
      )}
      {(message || error || status.lastError) && (
        <p className="notice" role="status">
          {message ?? error ?? status.lastError}
        </p>
      )}
      {dialog}
    </section>
  );
}
