// Small SVG bar chart (stacked or single series) with a hover tooltip, legend and a table view.
// Series colors come from the validated categorical slots in app.css (--dd-series-N), in fixed order.
import { useMemo, useState } from "react";

export interface Series {
  key: string;
  label: string;
  /** CSS color, e.g. "var(--dd-series-1)". */
  color: string;
}

interface Props {
  title: string;
  categories: string[];
  series: Series[];
  /** values[s][c]: value of series s in category c; null = no data (no bar). */
  values: (number | null)[][];
  unit: string;
  format?: (v: number) => string;
  reference?: { value: number; label: string };
}

const W = 720;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 40 };
const GAP = 2;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Bar with 4px rounded top corners, square at the baseline side. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function BarChart({ title, categories, series, values, unit, format = (v) => String(Math.round(v)), reference }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const totals = useMemo(
    () => categories.map((_, c) => series.reduce((sum, _s, s) => sum + (values[s][c] ?? 0), 0)),
    [categories, series, values],
  );
  const max = niceMax(Math.max(...totals, reference?.value ?? 0));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / Math.max(1, categories.length);
  const barW = Math.max(4, Math.min(28, band * 0.6));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(categories.length / 8);
  const hasData = totals.some((t) => t > 0);

  return (
    <section className="card chart-card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>{title}</h2>
        <button className="btn-link" onClick={() => setAsTable(!asTable)}>
          {asTable ? "Xem biểu đồ" : "Xem dạng bảng"}
        </button>
      </div>
      {series.length > 1 && (
        <div className="legend" aria-hidden={asTable}>
          {series.map((s) => (
            <span key={s.key}>
              <span className="swatch" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {asTable ? (
        <table className="list">
          <thead>
            <tr>
              <th>Thời gian</th>
              {series.map((s) => (
                <th key={s.key}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((cat, c) => (
              <tr key={cat}>
                <td>{cat}</td>
                {series.map((s, si) => (
                  <td key={s.key}>{values[si][c] === null ? "—" : `${format(values[si][c]!)} ${unit}`}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : !hasData ? (
        <p className="faint">Chưa có số liệu.</p>
      ) : (
        <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
                <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="axis">
                  {Number.isInteger(t) ? t : t.toFixed(1)}
                </text>
              </g>
            ))}
            {categories.map((cat, c) => {
              const x = PAD.left + band * c + (band - barW) / 2;
              let base = 0;
              const parts = series
                .map((s, si) => ({ s, v: values[si][c] ?? 0 }))
                .filter((p) => p.v > 0);
              return (
                <g key={cat}>
                  {parts.map((p, i) => {
                    const top = y(base + p.v);
                    const bottom = y(base);
                    base += p.v;
                    const isTop = i === parts.length - 1;
                    // A 2px surface gap between stacked segments.
                    const h = Math.max(1, bottom - top - (i > 0 ? GAP : 0));
                    return isTop ? (
                      <path key={p.s.key} d={topRounded(x, top, barW, h, 4)} fill={p.s.color} />
                    ) : (
                      <rect key={p.s.key} x={x} y={top} width={barW} height={h} fill={p.s.color} />
                    );
                  })}
                  {c % labelEvery === 0 && (
                    <text x={x + barW / 2} y={H - 8} textAnchor="middle" className="axis">
                      {cat}
                    </text>
                  )}
                  {/* Hit target: the whole column, larger than the bar. */}
                  <rect
                    x={PAD.left + band * c}
                    y={PAD.top}
                    width={band}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(c)}
                  />
                </g>
              );
            })}
            {reference && reference.value > 0 && (
              <g>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(reference.value)} y2={y(reference.value)} className="reference" />
                <text x={W - PAD.right} y={y(reference.value) - 4} textAnchor="end" className="axis">
                  {reference.label}
                </text>
              </g>
            )}
            {hover !== null && (
              <line
                x1={PAD.left + band * hover + band / 2}
                x2={PAD.left + band * hover + band / 2}
                y1={PAD.top}
                y2={PAD.top + plotH}
                className="crosshair"
              />
            )}
          </svg>
          {hover !== null && (
            <div
              className="tooltip"
              style={{ left: `${((PAD.left + band * hover + band / 2) / W) * 100}%` }}
              role="status"
            >
              <strong>{categories[hover]}</strong>
              {series.map((s, si) => (
                <div key={s.key} className="tooltip-row">
                  <span className="swatch" style={{ background: s.color }} />
                  <span>{s.label}</span>
                  <span className="tooltip-value">
                    {values[si][hover] === null ? "—" : `${format(values[si][hover]!)} ${unit}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
