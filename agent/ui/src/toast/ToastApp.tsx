// Small notice in the corner of the screen (heads-up before an allow window ends, timers, new apps).
import { useEffect, useState } from "react";
import { api, onEvent, type Toast } from "../api";

export function ToastApp() {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    void api.toastCurrent().then(setToast);
    const un = onEvent<Toast>("toast:show", setToast);
    return () => void un.then((f) => f());
  }, []);

  if (!toast) return null;
  return (
    <div className="toast">
      <strong>{toast.title}</strong>
      <p className="muted">{toast.body}</p>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        {toast.action && (
          <button className="btn-primary small-btn" onClick={() => void api.toastDismiss(toast.action)}>
            Mở
          </button>
        )}
        <button className="btn-quiet small-btn" onClick={() => void api.toastDismiss(null)}>
          Đóng
        </button>
      </div>
    </div>
  );
}
