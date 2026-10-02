import { format } from 'date-fns';
import { useMemo, useState } from 'react';
import { Drawer } from '../../components/layout';
import { ContributionGrid } from '../../components/shared/ContributionGrid';
import { formatDuration } from '../../lib/duration';
import { fromLocalDate } from '../../lib/time';
import type { LocalDate } from '../../types/domain';
import { gridDays, type DaySummary } from '../pulse/days';
import { Timeline } from '../activity/Timeline';

const PULSE_WORD = ['No pulse', 'Light', 'Moderate', 'Strong', 'High'];
const PULSE_FILL = ['', 'bg-pulse-1', 'bg-pulse-2', 'bg-pulse-3', 'bg-pulse-4'];

/**
 * Home's hero (ADR-037, v2 PHASE 012): the year of Daily Pulse as a large
 * green contribution calendar that uses the width of the screen. The only
 * figure beside it is the number of days with a pulse: counted from the
 * records, never estimated. Choosing a day opens what it holds.
 */
export function PulseHero({
  today,
  days,
  ready,
}: {
  today: LocalDate;
  days: Map<LocalDate, DaySummary>;
  ready: boolean;
}) {
  const pulse = useMemo(() => gridDays(days, 'pulse'), [days]);
  const [selected, setSelected] = useState<LocalDate | null>(null);
  const active = useMemo(() => [...days.values()].filter((d) => d.pulse.level > 0).length, [days]);

  return (
    <section aria-labelledby="pulse-heading" className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="pulse-heading" className="text-section font-semibold">
          Daily Pulse
        </h2>
        <p className="text-sm text-fg-muted">
          <span className="figure text-lg font-semibold text-fg">{ready ? active : '–'}</span>{' '}
          {active === 1 ? 'day' : 'days'} with a pulse in the last 12 months
        </p>
      </div>
      <div className="mt-4 min-w-0">
        <ContributionGrid
          label="Daily Pulse, last 12 months"
          today={today}
          days={pulse}
          palette="pulse"
          size="xl"
          minCell={10}
          selected={selected}
          onSelect={(d) => setSelected(d)}
        />
      </div>
      <DayDrawer
        date={selected}
        day={selected ? days.get(selected) : undefined}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}

/** One day, from the records: only what it actually holds, then its timeline. */
function DayDrawer({
  date,
  day,
  onClose,
}: {
  date: LocalDate | null;
  day: DaySummary | undefined;
  onClose: () => void;
}) {
  const facts: [string, string][] = day
    ? ([
        ['Work', day.workMinutes ? formatDuration(day.workMinutes) : ''],
        ['Tasks done', day.tasksCompleted ? String(day.tasksCompleted) : ''],
        ['Milestones', day.milestonesCompleted ? String(day.milestonesCompleted) : ''],
        ['Decisions', day.decisions ? String(day.decisions) : ''],
        ['Blockers and approvals resolved', day.resolved ? String(day.resolved) : ''],
        [
          'College',
          day.collegeMinutes
            ? `${formatDuration(day.collegeMinutes)} studied`
            : day.collegeDone
              ? `${day.collegeDone} done`
              : '',
        ],
        ['Routines', day.routines.length ? String(day.routines.length) : ''],
        ['Off time', day.offTimeMinutes ? `${formatDuration(day.offTimeMinutes)} marked` : ''],
        ['Day off', day.dayOff ? 'Yes' : ''],
      ].filter(([, v]) => v !== '') as [string, string][])
    : [];
  const level = day?.pulse.level ?? 0;
  return (
    <Drawer
      open={date !== null}
      onClose={onClose}
      title={date ? format(fromLocalDate(date), 'EEEE d MMMM') : ''}
    >
      {date && (
        <>
          <p className="flex items-center gap-3 text-sm">
            <span className="text-fg-muted">Daily Pulse</span>
            <span aria-hidden className="flex gap-0.5">
              {[1, 2, 3, 4].map((l) => (
                <span
                  key={l}
                  className={`h-2.5 w-5 rounded-[2px] ${l <= level ? PULSE_FILL[level] : 'bg-grid-0'}`}
                />
              ))}
            </span>
            <span className="font-medium">{PULSE_WORD[level]}</span>
            {day?.pulse.dayOffApplied && <span className="text-fg-muted">rest day</span>}
          </p>
          {facts.length === 0 ? (
            <p className="mt-4 text-sm text-fg-muted">Nothing recorded that day.</p>
          ) : (
            <dl className="mt-4 divide-y divide-line border-y border-line text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 py-2">
                  <dt className="text-fg-muted">{k}</dt>
                  <dd className="figure font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <h3 className="mt-6 text-sm font-semibold">Timeline</h3>
          <div className="mt-3">
            <Timeline day={date} limit={50} emptyText="No timeline events that day." />
          </div>
        </>
      )}
    </Drawer>
  );
}
