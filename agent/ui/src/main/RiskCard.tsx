// "Giờ nguy cơ": when the user most often opens entertainment, a suggestion to make waiting longer then,
// and the windows that are on. Adding strengthens (no confirmation); removing goes through the confirmation.
import { useCallback, useEffect, useState } from "react";
import { api, type RiskOverview } from "../api";
import { ErrorBanner, useSubmit } from "../components/Confirm";
import {
  MAX_RISK_WINDOWS,
  busiestCell,
  cellLabel,
  dayNameCapital,
  formatDays,
  formatRange,
  formatSuggestion,
  formatWindow,
  heatIntensity,
  suggestionToWindow,
} from "../risk";
import { useRefresh } from "./MainApp";

const ROW_NAMES = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** Hour labels above the columns: every third hour. */
const LABELLED_HOURS = new Set([0, 3, 6, 9, 12, 15, 18, 21]);

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `risk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function HeatMap({ cells }: { cells: RiskOverview["cells"] }) {
  const max = busiestCell(cells);
  return (
    <table className="heatmap" aria-label="Số lần mở giải trí theo thứ và giờ trong 4 tuần gần nhất">
      <thead>
        <tr>
          <td />
          {HOURS.map((h) => (
            <th key={h} scope="col" className="heat-hour" aria-label={`${h} giờ`}>
              {LABELLED_HOURS.has(h) ? h : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ROW_NAMES.map((name, row) => (
          <tr key={name}>
            <th scope="row" className="heat-day" aria-label={dayNameCapital(row + 1)}>
              {name}
            </th>
            {HOURS.map((h) => {
              const cell = cells[row]?.[h] ?? { opens: 0, enters: 0 };
              const label = cellLabel(row, h, cell);
              const strength = heatIntensity(cell.opens, max);
              return (
                <td
                  key={h}
                  className={strength > 0 ? "heat-cell on" : "heat-cell"}
                  style={strength > 0 ? { opacity: strength } : undefined}
                  title={label}
                  aria-label={label}
                />
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RiskCard() {
  const tick = useRefresh();
  const [view, setView] = useState<RiskOverview | null>(null);
  const reload = useCallback(() => void api.riskOverview().then(setView), []);
  const { submit, error, dialog } = useSubmit(reload);
  useEffect(reload, [tick, reload]);

  if (!view) return null;
  const { suggestion, windows } = view;
  const full = windows.length >= MAX_RISK_WINDOWS;

  function add() {
    if (!suggestion) return;
    const next = [...windows, suggestionToWindow(suggestion, newId())];
    void submit("Thêm khung giờ nguy cơ.", (confirmed) => api.setRiskWindows(next, confirmed));
  }

  function remove(index: number) {
    const gone = windows[index];
    const next = windows.filter((_, i) => i !== index);
    void submit(
      `Gỡ khung giờ nguy cơ ${formatRange(gone.start, gone.end)}, ${formatDays(gone.days)}: ở khung này thời gian chờ sẽ không còn dài hơn một cấp.`,
      (confirmed) => api.setRiskWindows(next, confirmed),
    );
  }

  return (
    <section className="card" aria-label="Giờ nguy cơ">
      <h2>Giờ nguy cơ</h2>
      <p className="muted" style={{ margin: 0 }}>
        4 tuần gần nhất. Ô càng đậm, bạn càng hay mở giải trí vào giờ đó.
      </p>
      <ErrorBanner error={error} />
      <HeatMap cells={view.cells} />
      {suggestion ? (
        <div className="row risk-suggestion">
          <span>{formatSuggestion(suggestion)}</span>
          <button className="btn-secondary small-btn" disabled={full} onClick={add}>
            Tăng cản trở trong khung này
          </button>
          {full && <span className="faint">Đã có {MAX_RISK_WINDOWS} khung, gỡ bớt một khung để thêm.</span>}
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Chưa có khung giờ nào nổi bật.
        </p>
      )}
      {windows.length > 0 && (
        <ul className="risk-windows" aria-label="Các khung giờ nguy cơ đang bật">
          {windows.map((w, i) => (
            <li key={`${w.id}-${i}`}>
              <span>{formatWindow(w)}</span>
              <button className="btn-quiet small-btn" onClick={() => remove(i)}>
                Gỡ
              </button>
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </section>
  );
}
