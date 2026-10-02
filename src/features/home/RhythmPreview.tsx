import { ArrowRight } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ContributionGrid } from '../../components/shared/ContributionGrid';
import { segmentClass, segmentedClass } from '../../components/ui/styles';
import type { LocalDate } from '../../types/domain';
import { gridDays, type DaySummary, type ThemedGrid } from '../pulse/days';

const CATEGORIES: { grid: Exclude<ThemedGrid, 'pulse' | 'gym'>; label: string }[] = [
  { grid: 'work', label: 'Work' },
  { grid: 'sleep', label: 'Sleep' },
  { grid: 'college', label: 'College' },
  { grid: 'personal', label: 'Personal' },
  { grid: 'projects', label: 'Projects' },
];

/**
 * Individual rhythms on Home (v2 PHASE 012): one compact grid at a time,
 * chosen by category. The Daily Pulse stays the hero; deeper analysis lives
 * on Rhythm and Life. The gym isn't promoted on Home.
 */
export function RhythmPreview({
  today,
  days,
}: {
  today: LocalDate;
  days: Map<LocalDate, DaySummary>;
}) {
  const [grid, setGrid] = useState<(typeof CATEGORIES)[number]['grid']>('work');
  const cells = useMemo(() => gridDays(days, grid), [days, grid]);
  const label = CATEGORIES.find((c) => c.grid === grid)!.label;
  const groupId = useId();
  return (
    <section aria-labelledby="rhythms-heading" className="mt-12">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="rhythms-heading" className="text-section font-semibold">
          Rhythms
        </h2>
        <Link
          to="/rhythm"
          className="inline-flex items-center gap-1 text-sm text-fg-muted transition-colors hover:text-fg"
        >
          Open Rhythm <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span id={groupId} className="sr-only">
          Rhythm to show
        </span>
        <div role="radiogroup" aria-labelledby={groupId} className={segmentedClass}>
          {CATEGORIES.map((c) => (
            <label key={c.grid} className={segmentClass(c.grid === grid)}>
              <input
                type="radio"
                name={groupId}
                value={c.grid}
                checked={c.grid === grid}
                onChange={() => setGrid(c.grid)}
                className="sr-only"
              />
              {c.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-fg-muted">
          {cells.size} active {cells.size === 1 ? 'day' : 'days'}
        </p>
      </div>
      <div className="mt-3 max-w-[60rem]">
        <ContributionGrid
          key={grid}
          label={`${label}, last 12 months`}
          today={today}
          days={cells}
          palette={grid}
          size="md"
        />
      </div>
    </section>
  );
}
