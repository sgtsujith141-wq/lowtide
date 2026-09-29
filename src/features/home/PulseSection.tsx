import { useMemo, useState } from 'react';
import { ContributionGrid } from '../../components/shared/ContributionGrid';
import { gridStart, longDay, YEAR_WEEKS } from '../../components/shared/contribution-grid';
import { formatDuration } from '../../lib/duration';
import type { LocalDate } from '../../types/domain';
import { gridDays, type DaySummary, type ThemedGrid } from '../pulse/days';
import { useDaySummaries } from '../pulse/useDaySummaries';

const PULSE_WORD = ['No pulse', 'Light', 'Moderate', 'Strong', 'High'];

/**
 * LOWTIDE's signature: the year of Daily Pulse (ADR-037) as a large green
 * contribution calendar. Selecting a day opens what that day holds, from the
 * records. Empty days stay empty; nothing is backfilled.
 */
export function PulseSection({ today }: { today: LocalDate }) {
  const start = gridStart(today, YEAR_WEEKS);
  const { days, status } = useDaySummaries(start, today);
  const pulse = useMemo(() => gridDays(days, 'pulse'), [days]);
  const [selected, setSelected] = useState<LocalDate | null>(null);
  const activeDays = [...days.values()].filter((d) => d.pulse.level > 0).length;

  return (
    <section aria-labelledby="pulse-heading" className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id="pulse-heading" className="font-serif text-lg font-semibold tracking-tight">
          Daily Pulse
        </h2>
        <p className="text-xs text-ink-muted">
          {status === 'ready'
            ? `${activeDays} day${activeDays === 1 ? '' : 's'} with a pulse in the last year`
            : ' '}
        </p>
      </div>
      <div className="mt-2 min-w-0 rounded-xl border border-line bg-paper-raised p-3 sm:p-4">
        <ContributionGrid
          label="Daily Pulse, last 12 months"
          today={today}
          days={pulse}
          palette="pulse"
          size="lg"
          selected={selected}
          onSelect={(d) => setSelected((current) => (current === d ? null : d))}
        />
        {selected && (
          <DayDetail date={selected} day={days.get(selected)} onClose={() => setSelected(null)} />
        )}
      </div>
    </section>
  );
}

function DayDetail({
  date,
  day,
  onClose,
}: {
  date: LocalDate;
  day: DaySummary | undefined;
  onClose: () => void;
}) {
  const facts: [string, string][] = day
    ? ([
        ['Work', day.workMinutes ? formatDuration(day.workMinutes) : ''],
        ['Study', day.collegeMinutes ? formatDuration(day.collegeMinutes) : ''],
        ['Tasks done', day.tasksCompleted ? String(day.tasksCompleted) : ''],
        ['Milestones', day.milestonesCompleted ? String(day.milestonesCompleted) : ''],
        ['Decisions', day.decisions ? String(day.decisions) : ''],
        ['Resolved', day.resolved ? String(day.resolved) : ''],
        ['Routines', day.routines.map((r) => r.name).join(', ')],
        ['Off time', day.offTimeMinutes ? `${formatDuration(day.offTimeMinutes)} marked` : ''],
        ['Day off', day.dayOff ? 'Yes' : ''],
      ].filter(([, v]) => v !== '') as [string, string][])
    : [];
  return (
    <div
      role="region"
      aria-label={`Details for ${longDay(date)}`}
      className="mt-3 border-t border-line pt-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">
          {longDay(date)}
          <span className="ml-2 text-xs font-normal text-ink-muted">
            {PULSE_WORD[day?.pulse.level ?? 0]}
            {day?.pulse.dayOffApplied ? ' · rest day' : ''}
          </span>
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-ink-muted hover:text-ink hover:underline"
        >
          Close
        </button>
      </div>
      {facts.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">Nothing recorded that day.</p>
      ) : (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] text-ink-muted">{k}</dt>
              <dd className="truncate">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

const SECONDARY: { grid: ThemedGrid; title: string; palette: ThemedGrid }[] = [
  { grid: 'work', title: 'Work', palette: 'work' },
  { grid: 'projects', title: 'Projects', palette: 'projects' },
  { grid: 'college', title: 'College', palette: 'college' },
  { grid: 'personal', title: 'Personal', palette: 'personal' },
  { grid: 'sleep', title: 'Sleep & off time', palette: 'sleep' },
];

/**
 * Individual grids under the main pulse, smaller and secondary. The gym grid
 * lives in Life/Rhythm, never on Home (ADR-043).
 */
export function SecondaryGrids({ today }: { today: LocalDate }) {
  const start = gridStart(today, YEAR_WEEKS);
  const { days } = useDaySummaries(start, today);
  return (
    <section aria-labelledby="rhythms-heading" className="mt-10">
      <h2 id="rhythms-heading" className="text-sm font-medium text-ink-muted">
        Individual rhythms
      </h2>
      <div className="mt-2 grid gap-4 xl:grid-cols-2">
        {SECONDARY.map(({ grid, title }) => (
          <SecondaryGrid key={grid} grid={grid} title={title} today={today} days={days} />
        ))}
      </div>
    </section>
  );
}

function SecondaryGrid({
  grid,
  title,
  today,
  days,
}: {
  grid: ThemedGrid;
  title: string;
  today: LocalDate;
  days: Map<LocalDate, DaySummary>;
}) {
  const cells = useMemo(() => gridDays(days, grid), [days, grid]);
  const active = cells.size;
  return (
    <div className="min-w-0 rounded-lg border border-line bg-paper-raised p-3">
      <p className="mb-1 flex items-baseline justify-between text-sm font-medium">
        {title}
        <span className="text-[11px] font-normal text-ink-muted">
          {active} active day{active === 1 ? '' : 's'}
        </span>
      </p>
      <ContributionGrid
        label={`${title}, last 12 months`}
        today={today}
        days={cells}
        palette={grid === 'pulse' ? 'pulse' : grid}
        size="sm"
      />
    </div>
  );
}
