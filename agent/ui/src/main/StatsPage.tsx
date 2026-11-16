// FR08: bar charts per day or week, counting every synced device.
import { useEffect, useMemo, useState } from "react";
import { api, type DayStat } from "../api";
import { BarChart, type Series } from "../components/BarChart";
import { weeklyProgress, MIN_INTERCEPTIONS, type Verdict, type WeeklyProgress } from "../progress";
import { useRefresh } from "./MainApp";

type Range = "days" | "weeks";

const DECISIONS: Series[] = [
  { key: "exit", label: "Thoát", color: "var(--dd-series-1)" },
  { key: "enter", label: "Vào", color: "var(--dd-series-2)" },
  { key: "alternative", label: "Làm việc khác", color: "var(--dd-series-3)" },
];

// Giải trí and Game first, so the budget line reads against the bottom of the stack.
const TAG_GROUPS: (Series & { tags: string[] })[] = [
  { key: "ent", label: "Giải trí", color: "var(--dd-series-1)", tags: ["entertainment"] },
  { key: "game", label: "Game", color: "var(--dd-series-2)", tags: ["game"] },
  { key: "study", label: "Học tập", color: "var(--dd-series-3)", tags: ["study"] },
  { key: "work", label: "Công việc", color: "var(--dd-series-4)", tags: ["work"] },
  { key: "other", label: "Khác", color: "var(--dd-series-5)", tags: ["communication", "utility"] },
];

function shortDay(day: string): string {
  const [, m, d] = day.split("-");
  return `${Number(d)}/${Number(m)}`;
}

interface Bucket {
  label: string;
  days: DayStat[];
}

function bucketize(stats: DayStat[], range: Range): Bucket[] {
  if (range === "days") return stats.slice(-14).map((d) => ({ label: shortDay(d.day), days: [d] }));
  const weeks: Bucket[] = [];
  for (let i = 0; i < stats.length; i += 7) {
    const chunk = stats.slice(i, i + 7);
    weeks.push({ label: `${shortDay(chunk[0].day)}–${shortDay(chunk[chunk.length - 1].day)}`, days: chunk });
  }
  return weeks;
}

const VERDICT_TEXT: Record<Verdict, string> = {
  better: "Tốt hơn tuần trước",
  worse: "Chưa tốt bằng tuần trước",
  same: "Gần như tuần trước",
  "not-enough-data": `Cần ít nhất ${MIN_INTERCEPTIONS} lần bị chặn mỗi tuần để so sánh`,
};

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
// Vietnamese writes decimals with a comma.
const secs = (v: number | null) => (v === null ? "–" : `${v < 10 ? v.toFixed(1).replace(".", ",") : Math.round(v)} giây`);

function ProgressCard({ p }: { p: WeeklyProgress }) {
  // Worse seconds are stated as a plain difference, e.g. "Chậm hơn tuần trước 2 giây".
  let secondsText = VERDICT_TEXT[p.seconds];
  if (p.thisWeek.avgExitSeconds !== null && p.lastWeek.avgExitSeconds !== null && p.seconds !== "same" && p.seconds !== "not-enough-data") {
    const diff = Math.round(Math.abs(p.thisWeek.avgExitSeconds - p.lastWeek.avgExitSeconds));
    secondsText = `${p.seconds === "better" ? "Nhanh hơn" : "Chậm hơn"} tuần trước ${diff} giây`;
  }
  const rows: { label: string; now: string; before: string; text: string }[] = [
    { label: "Tỉ lệ rời đi", now: pct(p.thisWeek.leaveRate), before: pct(p.lastWeek.leaveRate), text: VERDICT_TEXT[p.leaveRate] },
    { label: "Số giây đến lúc Thoát", now: secs(p.thisWeek.avgExitSeconds), before: secs(p.lastWeek.avgExitSeconds), text: secondsText },
    { label: "Mở giải trí trong giờ học", now: `${p.thisWeek.studyOpens} lần`, before: `${p.lastWeek.studyOpens} lần`, text: VERDICT_TEXT[p.studyOpens] },
  ];
  return (
    <section className="card" aria-label="Tiến bộ tuần này">
      <h2>Tiến bộ tuần này</h2>
      <p className="muted" style={{ margin: 0 }}>7 ngày gần nhất so với 7 ngày trước đó.</p>
      {rows.map((r) => (
        <div key={r.label}>
          <strong>{r.label}</strong>
          <p style={{ margin: 0 }}>
            Tuần này {r.now} · Tuần trước {r.before}
          </p>
          <p className="muted" style={{ margin: 0 }}>{r.text}</p>
        </div>
      ))}
    </section>
  );
}

export function StatsPage() {
  const tick = useRefresh();
  const [stats, setStats] = useState<DayStat[] | null>(null);
  const [budget, setBudget] = useState(0);
  const [range, setRange] = useState<Range>("days");

  useEffect(() => {
    void api.stats(28).then(setStats);
    void api.settings().then((s) => setBudget(s.budgetMinutes));
  }, [tick]);

  const buckets = useMemo(() => (stats ? bucketize(stats, range) : []), [stats, range]);
  if (!stats) return null;
  const sum = (b: Bucket, f: (d: DayStat) => number) => b.days.reduce((s, d) => s + f(d), 0);
  const categories = buckets.map((b) => b.label);

  const decisions = DECISIONS.map((s) => buckets.map((b) => sum(b, (d) => d[s.key as "exit" | "enter" | "alternative"])));
  const avgExit = [
    buckets.map((b) => {
      const n = sum(b, (d) => d.exitCount);
      return n ? sum(b, (d) => d.exitSecondsSum) / n : null;
    }),
  ];
  const minutes = TAG_GROUPS.map((g) => buckets.map((b) => sum(b, (d) => g.tags.reduce((s, t) => s + (d.minutes[t] ?? 0), 0))));

  return (
    <div className="page">
      <h1>Thống kê</h1>
      <p className="muted" style={{ margin: 0 }}>
        Gộp mọi thiết bị đã đồng bộ. Mục tiêu: tỉ lệ Thoát tăng dần, số giây đến lúc Thoát giảm dần.
      </p>
      {stats.length > 0 && <ProgressCard p={weeklyProgress(stats, stats[stats.length - 1].day)} />}
      <div className="row" role="group" aria-label="Khoảng thời gian">
        <button className={range === "days" ? "btn-primary small-btn" : "btn-secondary small-btn"} onClick={() => setRange("days")}>
          14 ngày
        </button>
        <button className={range === "weeks" ? "btn-primary small-btn" : "btn-secondary small-btn"} onClick={() => setRange("weeks")}>
          4 tuần
        </button>
      </div>
      <BarChart title="Lần bị chặn và lựa chọn" categories={categories} series={DECISIONS} values={decisions} unit="lần" />
      <BarChart
        title="Số giây trung bình đến lúc bấm Thoát"
        categories={categories}
        series={[{ key: "avg", label: "Giây đến Thoát", color: "var(--dd-series-1)" }]}
        values={avgExit}
        unit="giây"
        format={(v) => (v < 10 ? v.toFixed(1) : String(Math.round(v)))}
      />
      <BarChart
        title="Thời gian dùng theo tag"
        categories={categories}
        series={TAG_GROUPS}
        values={minutes}
        unit="phút"
        reference={range === "days" && budget > 0 ? { value: budget, label: `Ngân sách ${budget} phút (Giải trí + Game)` } : undefined}
      />
    </div>
  );
}
