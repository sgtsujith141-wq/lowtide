import type { ReactNode } from 'react';

/*
 * Small, dependency-free visual pieces (plain HTML/SVG, no chart library):
 * progress bars, sparklines, chips and stat tiles. Each carries a text
 * equivalent, so nothing depends on colour or on seeing the shape.
 */

export function ProgressBar({
  percent,
  label,
  tone = 'projects',
  size = 'md',
}: {
  percent: number;
  label: string;
  tone?: 'projects' | 'pulse' | 'work' | 'accent';
  size?: 'sm' | 'md' | 'lg';
}) {
  const fill = {
    projects: 'bg-projects-3',
    pulse: 'bg-pulse-3',
    work: 'bg-work-3',
    accent: 'bg-accent',
  }[tone];
  const height = size === 'lg' ? 'h-3' : size === 'sm' ? 'h-1' : 'h-1.5';
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={`${height} w-full overflow-hidden rounded-full bg-grid-0`}
    >
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Tiny bar sparkline, e.g. minutes per day. */
export function Sparkline({
  values,
  label,
  tone = 'work',
  height = 20,
}: {
  values: readonly number[];
  label: string;
  tone?: 'work' | 'projects' | 'pulse';
  height?: number;
}) {
  const max = Math.max(1, ...values);
  const bar = { work: 'fill-work-3', projects: 'fill-projects-3', pulse: 'fill-pulse-3' }[tone];
  const w = values.length * 4;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${w} ${height}`}
      width={w}
      height={height}
      className="shrink-0 overflow-visible"
    >
      {values.map((v, i) => {
        const h = v > 0 ? Math.max(2, (v / max) * height) : 1;
        return (
          <rect
            key={i}
            x={i * 4}
            y={height - h}
            width={3}
            height={h}
            rx={1}
            className={v > 0 ? bar : 'fill-grid-0'}
          />
        );
      })}
    </svg>
  );
}

/** A status: a small dot for scanning, and always the word (never colour alone). */
const CHIP = {
  calm: { dot: 'bg-accent', text: 'text-fg-muted' },
  attention: { dot: 'bg-work-4', text: 'text-warn' },
  quiet: { dot: 'bg-fg-subtle', text: 'text-fg-muted' },
  done: { dot: 'bg-pulse-3', text: 'text-fg-muted' },
} as const;

export function Chip({ tone, children }: { tone: keyof typeof CHIP; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-5 items-center gap-1.5 rounded-sm bg-hover px-1.5 text-[11px] font-medium whitespace-nowrap ${CHIP[tone].text}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${CHIP[tone].dot}`} />
      {children}
    </span>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="min-w-0">
      <p className="figure text-2xl leading-none font-semibold">{value}</p>
      <p className="mt-1 text-[11px] text-fg-muted">{label}</p>
    </div>
  );
}
