import { format } from 'date-fns';
import { useState } from 'react';
import { formatDuration } from '../../../lib/duration';
import { fromLocalDate } from '../../../lib/time';
import type { LocalDate } from '../../../types/domain';
import type { ProgressPoint, WeekBar } from '../charts';

/*
 * The Command Room's two small charts (v2 PHASE 013): plain SVG, no chart
 * library, every value also in words. Nothing drawn that the records don't
 * hold: no line before the first snapshot, no bar for a week without work.
 */

const day = (d: LocalDate) => format(fromLocalDate(d), 'd MMM');

/**
 * Progress over time from real snapshots (a step line with a soft area),
 * ending at today's live value. With no snapshots yet it says so and shows
 * only where the project stands now.
 */
export function ProgressHistory({
  points,
  current,
  today,
}: {
  points: readonly ProgressPoint[];
  /** Today's milestone completion, live; null without milestones. */
  current: number | null;
  today: LocalDate;
}) {
  const [focus, setFocus] = useState<number | null>(null);
  if (current === null && points.length === 0)
    return (
      <p className="text-sm text-fg-muted">No milestones yet, so there’s no progress to chart.</p>
    );

  const recorded = points.filter((p) => !p.carried && p.percent !== null);
  if (recorded.length === 0)
    return (
      <div>
        <p className="figure text-sm">
          Now <span className="font-semibold text-projects-4">{current ?? 0}%</span>
        </p>
        <p className="mt-1 text-sm text-fg-muted">
          History starts with the first milestone change recorded in LOWTIDE. Nothing earlier is
          drawn.
        </p>
      </div>
    );

  const w = 600;
  const h = 120;
  const series = points.length > 0 ? points : [];
  const n = Math.max(1, series.length - 1);
  const x = (i: number) => (i / n) * w;
  const y = (p: number) => h - (p / 100) * h;
  let line = '';
  let area = '';
  let open = false;
  let firstX = 0;
  series.forEach((pt, i) => {
    if (pt.percent === null) return;
    const px = x(i).toFixed(1);
    const py = y(pt.percent).toFixed(1);
    if (!open) {
      line += `M${px},${py}`;
      area += `M${px},${h} L${px},${py}`;
      firstX = x(i);
      open = true;
    } else {
      const prev = series[i - 1]!.percent ?? pt.percent;
      line += ` L${px},${y(prev).toFixed(1)} L${px},${py}`;
      area += ` L${px},${y(prev).toFixed(1)} L${px},${py}`;
    }
  });
  const lastX = x(series.length - 1);
  area += ` L${lastX.toFixed(1)},${h} L${firstX.toFixed(1)},${h} Z`;
  const now = current ?? series.at(-1)?.percent ?? 0;
  const shown = focus !== null ? series[focus] : undefined;

  return (
    <figure>
      <div className="relative">
        <svg
          viewBox={`-6 -10 ${w + 12} ${h + 20}`}
          preserveAspectRatio="none"
          className="h-36 w-full overflow-visible"
          role="img"
          aria-label={`Milestone completion from ${day(series[0]!.date)} to today: ${recorded
            .map((p) => `${day(p.date)} ${p.percent}%`)
            .join(', ')}; now ${now}%`}
          onPointerLeave={() => setFocus(null)}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const i = Math.round(((e.clientX - box.left) / box.width) * n);
            setFocus(Math.max(0, Math.min(series.length - 1, i)));
          }}
        >
          {[0, 50, 100].map((g) => (
            <line
              key={g}
              x1={0}
              x2={w}
              y1={y(g)}
              y2={y(g)}
              className="stroke-line"
              strokeDasharray="2 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={area} className="fill-projects-3/15" />
          <path
            d={line}
            className="fill-none stroke-projects-3"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {focus !== null && (
            <line
              x1={x(focus)}
              x2={x(focus)}
              y1={0}
              y2={h}
              className="stroke-fg-subtle"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {/* Points drawn in HTML so they stay round at any width. */}
        {series.map((p, i) =>
          !p.carried && p.percent !== null ? (
            <span
              key={p.date}
              aria-hidden
              title={`${day(p.date)}: ${p.percent}%`}
              className="absolute size-2 -translate-1/2 rounded-full bg-projects-3"
              style={{
                left: `${(x(i) / w) * 100}%`,
                top: `${((y(p.percent) + 10) / (h + 20)) * 100}%`,
              }}
            />
          ) : null,
        )}
        <span
          aria-hidden
          className="absolute size-3 -translate-1/2 rounded-full border-2 border-projects-3 bg-canvas"
          style={{ left: '100%', top: `${((y(now) + 10) / (h + 20)) * 100}%` }}
        />
      </div>
      <figcaption className="mt-2 flex items-baseline justify-between gap-3 text-xs text-fg-muted">
        <span>
          {shown
            ? `${day(shown.date)}: ${shown.percent ?? 0}%${shown.carried ? ' (no change that day)' : ''}`
            : `Since ${day(series[0]!.date)}`}
        </span>
        <span>
          {day(today)} · now <span className="figure font-semibold text-projects-4">{now}%</span>
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * Time invested from real work sessions: this week, the last weeks as bars,
 * and the total. Nothing at all without sessions; the caller says so quietly.
 */
export function TimeInvested({
  weeks,
  thisWeek,
  total,
}: {
  weeks: readonly WeekBar[];
  thisWeek: number;
  total: number;
}) {
  const max = Math.max(60, ...weeks.map((w) => w.minutes));
  const recent = weeks.reduce((s, w) => s + w.minutes, 0);
  return (
    <figure>
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <dt className="text-xs text-fg-muted">This week</dt>
          <dd className="figure text-lg font-semibold">{formatDuration(Math.round(thisWeek))}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Last {weeks.length} weeks</dt>
          <dd className="figure text-lg font-semibold">{formatDuration(Math.round(recent))}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">All time</dt>
          <dd className="figure text-lg font-semibold">{formatDuration(Math.round(total))}</dd>
        </div>
      </dl>
      <div
        role="img"
        aria-label={`Work per week, last ${weeks.length} weeks: ${weeks
          .filter((w) => w.minutes > 0)
          .map((w) => `week of ${day(w.weekStart)} ${formatDuration(Math.round(w.minutes))}`)
          .join(', ')}`}
        className="mt-4 flex h-14 items-end gap-1"
      >
        {weeks.map((wk) => (
          <div
            key={wk.weekStart}
            className="flex h-full flex-1 flex-col justify-end"
            title={`Week of ${day(wk.weekStart)}: ${formatDuration(Math.round(wk.minutes))}`}
          >
            <div
              className={`w-full rounded-t-[2px] ${wk.minutes > 0 ? 'bg-work-3' : 'bg-grid-0'}`}
              style={{
                height: wk.minutes > 0 ? `${Math.max(6, (wk.minutes / max) * 100)}%` : '2px',
              }}
            />
          </div>
        ))}
      </div>
      <figcaption className="mt-1 flex justify-between text-[11px] text-fg-muted">
        <span>{day(weeks[0]!.weekStart)}</span>
        <span>This week</span>
      </figcaption>
    </figure>
  );
}
