// Full-screen warning over a blocked program. Thoát is always one keypress away; Vào unlocks after
// the countdown and only responds to a real mouse click.
import { useEffect, useRef, useState } from "react";
import { api, isCmdError, onEvent, type WarningContext } from "../api";

function minutesUntil(at: number): number {
  return Math.max(0, Math.ceil((at - Date.now()) / 60_000));
}

export function WarningApp() {
  const [ctx, setCtx] = useState<WarningContext | null>(null);

  useEffect(() => {
    void api.warningCurrent().then((c) => c && setCtx(c));
    const un = onEvent<WarningContext>("warning:show", setCtx);
    return () => void un.then((f) => f());
  }, []);

  // A fresh component per warning resets the countdown and the chosen step.
  return <div className="warning">{ctx ? <Warning key={ctx.eventId} ctx={ctx} /> : null}</div>;
}

function Warning({ ctx }: { ctx: WarningContext }) {
  const [step, setStep] = useState<"choice" | "alternative">("choice");
  const [remaining, setRemaining] = useState(() => lockLeft(ctx));
  const [showOptions, setShowOptions] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const exitButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setRemaining(lockLeft(ctx)), 200);
    return () => clearInterval(timer);
  }, [ctx]);

  useEffect(() => {
    if (step === "choice") exitButton.current?.focus();
  }, [step]);

  async function decide(decision: "enter" | "exit" | "alternative", extra: Record<string, unknown> = {}) {
    if (busy.current) return;
    busy.current = true;
    try {
      await api.warningDecide({ eventId: ctx.eventId, decision, ...extra });
    } catch (e) {
      setError(isCmdError(e) ? e.message : String(e));
    } finally {
      busy.current = false;
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (step === "choice" && (e.key === "Enter" || e.key === "Escape")) {
        e.preventDefault();
        e.stopPropagation();
        void decide("exit");
      } else if (step === "alternative" && e.key === "Escape") {
        e.preventDefault();
        setStep("choice");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const unlocked = remaining <= 0;
  // Keyboard activation produces detail === 0: only a real click opens Vào.
  const pointerOnly = (fn: () => void) => (e: React.MouseEvent) => {
    if (unlocked && e.isTrusted && e.detail > 0) fn();
  };
  const used = Math.round(ctx.budget.usedMinutes);

  return (
    <main className="warning-inner">
      <p className="muted" style={{ margin: 0 }}>
        Lần thứ {ctx.countThisHour} trong 60 phút qua · nút Vào khóa {ctx.lockSeconds} giây
      </p>

      {step === "choice" ? (
        <section style={{ display: "grid", gap: "var(--dd-space-lg)" }}>
          <h1 className="question">Bạn mở {ctx.appName} để làm gì?</h1>
          <p className="muted" style={{ margin: 0, fontSize: "var(--dd-font-large)" }}>
            Dành vài giây trả lời câu hỏi này trong đầu.
          </p>
          <div className="primary-actions">
            <button ref={exitButton} className="btn-primary exit" onClick={() => void decide("exit")}>
              Thoát
            </button>
            <p className="faint">Enter hoặc Esc cũng là Thoát</p>
            <button className="btn-link" onClick={() => setStep("alternative")}>
              Làm việc khác thay vì vào
            </button>
          </div>
          <div className="enter-area">
            <button className="btn-quiet enter" tabIndex={-1} disabled={!unlocked} onClick={pointerOnly(() => setShowOptions(true))}>
              {unlocked ? "Vào" : `Vào (${remaining})`}
            </button>
            {showOptions && (
              <>
                <p className="faint">Vào trong bao lâu?</p>
                <div className="row">
                  {ctx.allowOptions.map((m) => (
                    <button
                      key={m}
                      className="btn-quiet small-btn"
                      tabIndex={-1}
                      onClick={pointerOnly(() => void decide("enter", { allowMinutes: m }))}
                    >
                      {m} phút
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      ) : (
        <section style={{ display: "grid", gap: "var(--dd-space-lg)" }}>
          <h1 className="question">Làm gì thay vào đó?</h1>
          <div className="row activities" role="radiogroup" aria-label="Hoạt động">
            {ctx.activities.map((a) => (
              <button
                key={a}
                role="radio"
                aria-checked={activity === a}
                className="btn-secondary"
                style={{ fontSize: "var(--dd-font-large)", padding: "14px 22px" }}
                onClick={() => setActivity(a)}
              >
                {a}
              </button>
            ))}
          </div>
          <label className="row muted">
            Trong
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {Array.from({ length: 9 }, (_, i) => i + 2).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            phút
          </label>
          <div className="row">
            <button
              className="btn-primary"
              disabled={!activity}
              onClick={() => activity && void decide("alternative", { activity, activityMinutes: minutes })}
            >
              Bắt đầu
            </button>
            <button className="btn-secondary" onClick={() => setStep("choice")}>
              Quay lại
            </button>
          </div>
          <p className="faint" style={{ margin: 0 }}>
            Chương trình sẽ được thu nhỏ; hết giờ DopaDam nhắc ở góc màn hình.
          </p>
        </section>
      )}

      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}

      <footer className="footer">
        <span>
          {ctx.budget.budgetMinutes > 0
            ? `Hôm nay: ${used} / ${ctx.budget.budgetMinutes} phút giải trí`
            : `Hôm nay: ${used} phút giải trí`}
        </span>
        {ctx.study.active && ctx.study.endsAt !== null && (
          <span className="chip">
            Đang học: {ctx.study.label} · còn {minutesUntil(ctx.study.endsAt)} phút
          </span>
        )}
      </footer>
    </main>
  );
}

function lockLeft(ctx: WarningContext): number {
  return Math.max(0, Math.ceil((ctx.lockSeconds * 1000 - (Date.now() - ctx.shownAt)) / 1000));
}
