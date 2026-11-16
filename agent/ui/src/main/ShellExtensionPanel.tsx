import { useState } from "react";
import { api, describeShellInstall, shellExtensionState, type PlatformInfo } from "../api";

/**
 * What to do about the GNOME Shell extension, on GNOME with Wayland: install it, log out and in,
 * or update it. Renders nothing elsewhere, or when the extension is connected and current.
 * `onChanged` runs after the install command finished so the page can reload the platform status.
 */
export function ShellExtensionPanel({ platform, onChanged }: { platform: PlatformInfo; onChanged: () => void }) {
  const state = shellExtensionState(platform);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The message outlives the state: after an update the extension is "current" again, but the
  // Shell still runs the old files until the next login.
  if (state === "none" || (state === "ok" && !message)) return null;

  const run = () => {
    setBusy(true);
    setError(null);
    api
      .installShellExtension()
      .then(
        (r) => {
          setMessage(describeShellInstall(r));
          onChanged();
        },
        (e) => setError(String(e)),
      )
      .finally(() => setBusy(false));
  };

  const button = (label: string, className: string) => (
    <button className={className} disabled={busy} onClick={run}>
      {busy ? "Đang cài…" : label}
    </button>
  );

  return (
    <div className="shell-extension">
      {message ? (
        <p className="notice">{message}</p>
      ) : state === "missing" ? (
        <>
          <p className="muted">
            Trên GNOME dùng Wayland, DopaDam cần một tiện ích nhỏ của GNOME Shell để biết chương trình nào đang ở phía trước.
            Tiện ích có sẵn trong DopaDam, không cần tải thêm và không cần quyền quản trị.
          </p>
          <div>{button("Cài tiện ích GNOME", "small-btn")}</div>
        </>
      ) : state === "needs-login" ? (
        <>
          <p className="notice">Đăng xuất rồi đăng nhập lại để GNOME nạp tiện ích.</p>
          <p className="faint">
            Đã đăng nhập lại mà vẫn chưa nối?{" "}
            <button className="btn-link" disabled={busy} onClick={run}>
              Cài lại tiện ích
            </button>
          </p>
        </>
      ) : (
        <p className="faint">
          Có bản tiện ích GNOME mới hơn.{" "}
          <button className="btn-link" disabled={busy} onClick={run}>
            Cập nhật tiện ích
          </button>
        </p>
      )}
      {error && <p className="faint">{error}</p>}
    </div>
  );
}
