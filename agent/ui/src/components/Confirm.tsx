// FR14: changes that weaken protection wait 60 seconds, then need a typed sentence.
import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIRM_PHRASE, CONFIRM_WAIT_SECONDS, isConfirmPhrase } from "@core";
import { isCmdError } from "../api";

interface DialogProps {
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ action, onConfirm, onCancel }: DialogProps) {
  const [remaining, setRemaining] = useState(CONFIRM_WAIT_SECONDS);
  const [typed, setTyped] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (remaining === 0) input.current?.focus();
  }, [remaining]);

  const ready = remaining === 0 && isConfirmPhrase(typed);
  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">Thay đổi này làm yếu bảo vệ</h2>
        <p>{action}</p>
        <p className="muted" aria-live="polite">
          {remaining > 0 ? `Chờ ${remaining} giây rồi mới gõ được câu xác nhận.` : "Bây giờ có thể gõ câu xác nhận."}
        </p>
        <p className="faint">
          Gõ chính xác: <strong>{CONFIRM_PHRASE}</strong>
        </p>
        <input
          ref={input}
          type="text"
          value={typed}
          disabled={remaining > 0}
          autoComplete="off"
          spellCheck={false}
          placeholder={CONFIRM_PHRASE}
          aria-label="Câu xác nhận"
          onChange={(e) => setTyped(e.target.value)}
        />
        <div className="modal-actions">
          <button className="btn-secondary" disabled={!ready} onClick={() => ready && onConfirm()}>
            Xác nhận
          </button>
          <button className="btn-primary" autoFocus onClick={onCancel}>
            Giữ nguyên bảo vệ
          </button>
        </div>
      </div>
    </div>
  );
}

interface Pending {
  action: string;
  run: () => Promise<void>;
}

/**
 * Runs a change; if the agent answers "needs-confirm", shows the confirmation and then runs it again
 * with confirmed = true. Errors end up in `error`.
 */
export function useSubmit(onDone?: () => void) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  const report = useCallback((e: unknown) => {
    setError(isCmdError(e) ? e.message : String(e));
  }, []);

  const submit = useCallback(
    async (action: string, call: (confirmed: boolean) => Promise<unknown>) => {
      setError(null);
      try {
        await call(false);
        onDone?.();
      } catch (e) {
        if (isCmdError(e) && e.code === "needs-confirm") {
          setPending({
            action,
            run: async () => {
              try {
                await call(true);
              } catch (err) {
                report(err);
              }
              onDone?.();
            },
          });
        } else {
          report(e);
          onDone?.();
        }
      }
    },
    [onDone, report],
  );

  const dialog = pending ? (
    <ConfirmDialog
      action={pending.action}
      onCancel={() => {
        setPending(null);
        onDone?.();
      }}
      onConfirm={() => {
        const p = pending;
        setPending(null);
        void p.run();
      }}
    />
  ) : null;

  return { submit, error, setError, dialog };
}

export function ErrorBanner({ error }: { error: string | null }) {
  return error ? (
    <p className="notice" role="alert">
      {error}
    </p>
  ) : null;
}
