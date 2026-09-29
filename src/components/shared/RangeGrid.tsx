import { useId, useState } from 'react';
import { addDays } from '../../lib/calendar';
import type { LocalDate } from '../../types/domain';
import { ContributionGrid, type GridDay } from './ContributionGrid';
import {
  GRID_RANGES,
  weeksForDays,
  YEAR_WEEKS,
  type GridPalette,
  type GridRangeId,
} from './contribution-grid';

/**
 * A contribution calendar with a range switch (7 days … 12 months), the same
 * GitHub geometry at every range. Short ranges (7 and 30 days) draw exactly
 * those days; longer ones show whole weeks (13 for 90 days, 26 for six
 * months, 53 for a year). The switch sits below the grid,
 * so Tab from the controls above goes straight into the squares.
 */
export function RangeGrid({
  name,
  today,
  days,
  palette,
  initial = '182',
  showDetail = false,
  surface = 'raised',
}: {
  /** What the grid shows, e.g. "All rhythms"; the grid's label adds the range. */
  name: string;
  today: LocalDate;
  days: ReadonlyMap<LocalDate, GridDay>;
  palette: GridPalette;
  initial?: GridRangeId;
  showDetail?: boolean;
  surface?: 'raised' | 'paper';
}) {
  const [rangeId, setRangeId] = useState<GridRangeId>(initial);
  const range = GRID_RANGES.find((r) => r.id === rangeId)!;
  const groupId = useId();
  const short = range.days <= 30;
  return (
    <div>
      <ContributionGrid
        label={`${name}, last ${range.label}`}
        today={today}
        days={days}
        palette={palette}
        weeks={
          range.days >= 365
            ? YEAR_WEEKS
            : short
              ? weeksForDays(range.days)
              : Math.round(range.days / 7)
        }
        {...(short ? { since: addDays(today, -(range.days - 1)) } : {})}
        showDetail={showDetail}
        surface={surface}
      />
      <div
        role="radiogroup"
        aria-labelledby={groupId}
        className="mt-1 flex flex-wrap items-center gap-1 text-xs"
      >
        <span id={groupId} className="mr-1 text-ink-muted">
          Range
        </span>
        {GRID_RANGES.map((r) => (
          <label
            key={r.id}
            className={`relative cursor-pointer rounded-full border px-2 py-0.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
              r.id === rangeId
                ? 'border-line-strong bg-paper-raised font-medium text-ink'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            <input
              type="radio"
              name={groupId}
              value={r.id}
              checked={r.id === rangeId}
              onChange={() => setRangeId(r.id)}
              className="sr-only"
            />
            {r.label}
          </label>
        ))}
      </div>
    </div>
  );
}
