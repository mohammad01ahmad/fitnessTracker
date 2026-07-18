import Link from "next/link";
import { DAY_LETTERS } from "../../constants/constants";

// Shared card chrome/typography so every widget reads as one system.
const CARD = "flex h-full min-h-0 flex-col gap-2 rounded-3xl bg-white p-4 shadow-sm shadow-black/5";
const LABEL = "text-sm font-medium text-[#8A8894]";
const BADGE = "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F4F3F8] text-sm";

// iOS-style progress ring: fills to `target`, then laps in `colorOver` for
// whatever's past 100% instead of clipping — mirrors Apple's overflow rings.
export function ActivityRing({
  label,
  badge,
  value,
  target,
  unit,
  color,
  colorOver,
}: {
  label: string;
  badge: string;
  value: number;
  target: number;
  unit: string;
  color: string;
  colorOver: string;
}) {
  const size = 128;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = target > 0 ? value / target : 0;
  const base = Math.min(pct, 1);
  const over = pct > 1 ? Math.min(pct - 1, 1) : 0;

  return (
    <div className={CARD}>
      <div className="flex shrink-0 items-center justify-between">
        <span className={LABEL}>{label}</span>
        <span className={BADGE}>{badge}</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="relative aspect-square h-full max-w-full">
          <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#EFEEF4" strokeWidth={stroke} />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - base)}
            />
            {over > 0 && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={colorOver}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - over)}
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-extrabold tabular-nums text-[#16151A]">
              {Math.round(value).toLocaleString()}
            </span>
            <span className="text-[11px] text-[#8A8894]">
              / {target.toLocaleString()}
              {unit}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}


// 7-day sparkline for the selected week. Bars are sized with flex-grow
// ratios (spacer + bar per column) instead of pixel heights, so the whole
// chart scales to fit whatever height its grid cell gets, no JS needed.
export function WeeklyBars({
  title,
  badge,
  color,
  target,
  selected,
  days,
}: {
  title: string;
  badge: string;
  color: string;
  target: number;
  selected: string;
  days: { date: string; value: number }[];
}) {
  const max = Math.max(target, ...days.map((d) => d.value), 1);
  const avg = Math.round(days.reduce((sum, d) => sum + d.value, 0) / days.length);

  return (
    <div className={CARD}>
      <div className="flex shrink-0 items-center justify-between">
        <span className={LABEL}>{title}</span>
        <span className="text-lg">{badge}</span>
      </div>
      <div className="flex shrink-0 items-baseline gap-1.5">
        <span className="text-xl font-extrabold tabular-nums text-[#16151A]">{avg.toLocaleString()}</span>
        <span className="text-xs text-[#8A8894]">avg / day</span>
      </div>
      <div className="relative flex min-h-0 flex-1 items-stretch justify-between gap-2">
        <div
          className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-[#D8D6E2]"
          style={{ bottom: `${Math.min(target / max, 1) * 100}%` }}
        />
        {days.map((d, i) => (
          <div key={d.date} className="z-10 flex flex-1 flex-col items-center gap-1">
            <div className="flex min-h-0 w-full flex-1 flex-col justify-end">
              <div style={{ flexGrow: Math.max(max - d.value, 0), flexBasis: 0 }} />
              <div
                className="w-full rounded-full"
                style={{
                  flexGrow: Math.max(d.value, max * 0.015),
                  flexBasis: 0,
                  backgroundColor: color,
                  opacity: d.date === selected ? 1 : 0.5,
                }}
              />
            </div>
            <span
              className={`shrink-0 text-[10px] ${d.date === selected ? "font-bold text-[#16151A]" : "text-[#8A8894]"}`}
            >
              {DAY_LETTERS[i]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Calendar heatmap for the selected month: one cell per day, shaded by
// intensity relative to `target`. Row count is computed from `cells.length`
// so a 6-week month can't overflow its card.
export function MonthlyHeatmap({
  title,
  badge,
  color,
  target,
  selected,
  monthLabel,
  cells,
}: {
  title: string;
  badge: string;
  color: string;
  target: number;
  selected: string;
  monthLabel: string;
  cells: { date: string | null; value: number }[];
}) {
  const logged = cells.filter((c) => c.date && c.value > 0);
  const avg = logged.length ? Math.round(logged.reduce((sum, c) => sum + c.value, 0) / logged.length) : 0;
  const rows = Math.ceil(cells.length / 7);

  return (
    <div className={CARD}>
      <div className="flex shrink-0 items-center justify-between">
        <span className={LABEL}>{title}</span>
        <span className="text-lg">{badge}</span>
      </div>
      <div className="flex shrink-0 items-baseline gap-1.5">
        <span className="text-xl font-extrabold tabular-nums text-[#16151A]">{avg.toLocaleString()}</span>
        <span className="text-xs text-[#8A8894]">avg / day · {monthLabel}</span>
      </div>
      <div
        className="grid min-h-0 flex-1 grid-cols-7 gap-1"
        style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {cells.map((c, i) => {
          if (!c.date) return <div key={`blank-${i}`} />;
          const ratio = target > 0 ? Math.min(c.value / target, 1) : 0;
          const opacity = c.value > 0 ? 0.15 + ratio * 0.85 : 0.06;
          return (
            <div
              key={c.date}
              title={`${c.date}: ${Math.round(c.value)}`}
              className={`rounded-md ${c.date === selected ? "ring-2 ring-[#16151A]" : ""}`}
              style={{ backgroundColor: color, opacity }}
            />
          );
        })}
      </div>
    </div>
  );
}

// Month header + prev/next-week nav + a tappable week strip. Navigation is
// plain hrefs (?date=...), so date selection needs no client-side state.
export function DateStrip({
  monthLabel,
  selected,
  weekDays,
  prevHref,
  nextHref,
}: {
  monthLabel: string;
  selected: string;
  weekDays: { date: string; day: number }[];
  prevHref: string;
  nextHref: string;
}) {
  return (
    <div className={CARD}>
      <div className="flex shrink-0 items-center justify-between">
        <span className="text-lg font-bold text-[#16151A]">{monthLabel}</span>
        <div className="flex gap-2">
          <Link href={prevHref} className={`${BADGE} hover:bg-[#EAE8F1]`} aria-label="Previous week">
            ←
          </Link>
          <Link href={nextHref} className={`${BADGE} hover:bg-[#EAE8F1]`} aria-label="Next week">
            →
          </Link>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-2">
        <div className="grid grid-cols-7 gap-2 text-center">
          {DAY_LETTERS.map((letter, i) => (
            <span key={`${letter}-${i}`} className="text-xs font-medium text-[#8A8894]">
              {letter}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2 text-center">
          {weekDays.map((d) => (
            <Link
              key={d.date}
              href={`?date=${d.date}`}
              className={`flex aspect-square items-center justify-center rounded-full text-sm font-bold tabular-nums transition-colors ${d.date === selected ? "bg-[#16151A] text-white" : "text-[#16151A] hover:bg-[#F4F3F8]"
                }`}
            >
              {d.day}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
