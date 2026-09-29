import { Check } from 'lucide-react';
import { format } from 'date-fns';
import { formatDuration } from '../../../lib/duration';
import { fromLocalDate } from '../../../lib/time';
import type { Milestone } from '../../../types/domain';
import type { ProgressPoint, WeekBar } from '../charts';

/** Large milestone-derived completion ring (ADR-038). */
export function CompletionRing({ percent, label }: { percent: number | null; label: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid size-28 shrink-0 place-items-center">
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} strokeWidth="9" className="fill-none stroke-grid-0" />
        {percent !== null && percent > 0 && (
          <circle
            cx="50"
            cy="50"
            r={r}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${(percent / 100) * c} ${c}`}
            className="fill-none stroke-projects-3"
          />
        )}
      </svg>
      <p className="relative text-center" role="img" aria-label={label}>
        {percent === null ? (
          <span className="block px-3 text-[11px] leading-tight text-ink-muted">
            No milestones yet
          </span>
        ) : (
          <>
            <span className="block font-serif text-3xl leading-none font-semibold tabular-nums">
              {percent}
              <span className="text-base">%</span>
            </span>
            <span className="text-[10px] text-ink-muted">of milestones</span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * The milestone rail: ✓ done ── ● current ── ○ upcoming. Scrolls sideways
 * when long; an ordered list for screen readers.
 */
export function MilestonePipeline({ milestones }: { milestones: readonly Milestone[] }) {
  if (milestones.length === 0) return null;
  const current = milestones.find((m) => !m.completedAt)?.id;
  return (
    <div className="relative overflow-x-auto pb-1">
      <ol aria-label="Milestone pipeline" className="flex min-w-max items-start">
        {milestones.map((m, i) => {
          const done = m.completedAt !== undefined;
          const now = m.id === current;
          return (
            <li key={m.id} className="flex items-start">
              {i > 0 && (
                <span
                  aria-hidden
                  className={`mt-[11px] h-0.5 w-8 sm:w-12 ${done || now ? 'bg-projects-3' : 'bg-line'}`}
                />
              )}
              <span className="flex w-20 flex-col items-center gap-1 text-center sm:w-24">
                <span
                  className={`grid size-6 place-items-center rounded-full border-2 ${
                    done
                      ? 'border-projects-3 bg-projects-3 text-paper'
                      : now
                        ? 'border-projects-3 bg-projects-1'
                        : 'border-line bg-paper-raised'
                  }`}
                >
                  {done ? (
                    <Check aria-hidden className="size-3.5" strokeWidth={3} />
                  ) : now ? (
                    <span aria-hidden className="size-2 rounded-full bg-projects-3" />
                  ) : null}
                </span>
                <span
                  className={`text-xs leading-tight ${now ? 'font-semibold' : done ? '' : 'text-ink-muted'}`}
                >
                  {m.title}
                  <span className="sr-only">
                    {done ? ' (done)' : now ? ' (current)' : ' (upcoming)'}
                  </span>
                </span>
                {m.weight !== 1 && (
                  <span className="text-[10px] text-ink-faint">weight {m.weight}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Progress over time from real snapshots (step line; carried days are dashed). */
export function ProgressChart({ points }: { points: readonly ProgressPoint[] }) {
  if (points.length === 0)
    return <p className="text-sm text-ink-muted">Progress is tracked from the first change on.</p>;
  const w = 320;
  const h = 90;
  const n = Math.max(1, points.length - 1);
  const x = (i: number) => (i / n) * w;
  const y = (p: number) => h - (p / 100) * h;
  const path: string[] = [];
  let started = false;
  points.forEach((pt, i) => {
    if (pt.percent === null) {
      started = false;
      return;
    }
    path.push(`${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(pt.percent).toFixed(1)}`);
    started = true;
  });
  const lastKnown = [...points].reverse().find((p) => p.percent !== null);
  const first = points[0]!.date;
  return (
    <figure>
      <svg
        viewBox={`-2 -4 ${w + 4} ${h + 8}`}
        className="h-28 w-full"
        role="img"
        aria-label={`Completion over time, from ${format(fromLocalDate(first), 'd MMM')}: now ${lastKnown?.percent ?? 0}%`}
        preserveAspectRatio="none"
      >
        {[0, 50, 100].map((g) => (
          <line
            key={g}
            x1={0}
            x2={w}
            y1={y(g)}
            y2={y(g)}
            className="stroke-line"
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {path.length > 0 && (
          <path
            d={path.join(' ')}
            className="fill-none stroke-projects-3"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-ink-muted">
        <span>Since {format(fromLocalDate(first), 'd MMM')}</span>
        <span>
          {points.length} day{points.length === 1 ? '' : 's'} tracked
        </span>
      </figcaption>
    </figure>
  );
}

/** Time invested per week (real work sessions only). */
export function TimeChart({ weeks }: { weeks: readonly WeekBar[] }) {
  const max = Math.max(60, ...weeks.map((w) => w.minutes));
  const total = weeks.reduce((s, w) => s + w.minutes, 0);
  return (
    <figure>
      <div
        role="img"
        aria-label={`Work on this project: ${formatDuration(total)} over the last ${weeks.length} weeks`}
        className="flex h-28 items-end gap-1"
      >
        {weeks.map((wk) => (
          <div
            key={wk.weekStart}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${format(fromLocalDate(wk.weekStart), 'd MMM')}: ${formatDuration(wk.minutes)}`}
          >
            <div
              className={`w-full rounded-t-[3px] ${wk.minutes > 0 ? 'bg-work-3' : 'bg-grid-0'}`}
              style={{
                height: wk.minutes > 0 ? `${Math.max(4, (wk.minutes / max) * 100)}%` : '2px',
              }}
            />
          </div>
        ))}
      </div>
      <figcaption className="mt-1 flex justify-between text-[11px] text-ink-muted">
        <span>{format(fromLocalDate(weeks[0]!.weekStart), 'd MMM')}</span>
        <span>
          {formatDuration(total)} in {weeks.length} weeks
        </span>
      </figcaption>
    </figure>
  );
}
