import { format } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button, IconButton } from '../../components/ui/Button';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import { eachDay } from '../../lib/calendar';
import { fromLocalDate } from '../../lib/time';
import type { LocalDate } from '../../types/domain';
import {
  buildCalendar,
  CALENDAR_KINDS,
  KIND_LABEL,
  monthBlock,
  shiftMonth,
  type CalendarEntry,
  type CalendarKind,
} from './entries';

const DOT: Record<CalendarKind, string> = {
  dayoff: 'bg-pulse-3',
  protected: 'bg-sleep-3',
  college: 'bg-college-3',
  hackathon: 'bg-accent',
  milestone: 'bg-projects-3',
  deadline: 'bg-danger',
  planned: 'bg-fg-subtle',
  work: 'bg-work-3',
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * A calm combined calendar (ADR-053): college, hackathons, milestone due
 * dates, task deadlines and plans, work done, days off, and protected time,
 * one month at a time, with the selected day's agenda below.
 */
export function CalendarPage() {
  useDocumentTitle('Calendar');
  const today = useToday();
  const [cursor, setCursor] = useState<LocalDate>(today);
  const [selected, setSelected] = useState<LocalDate>(today);
  const block = monthBlock(cursor);
  const { college, hackathons, projects, tasks, protectedTime, offTime, work } = useRepositories();
  const w = useMemo(
    () => ({
      college: college.watchRange(block.start, block.end),
      protected: protectedTime.watchRange(block.start, block.end),
      offTime: offTime.watchRange(block.start, block.end),
      work: work.watchRange(block.start, block.end),
    }),
    [college, protectedTime, offTime, work, block.start, block.end],
  );
  const collegeItems = useWatch(w.college);
  const kept = useWatch(w.protected);
  const off = useWatch(w.offTime);
  const worked = useWatch(w.work);
  const hacks = useWatch(hackathons.watchAll);
  const milestones = useWatch(projects.watchAllMilestones);
  const allProjects = useWatch(projects.watchAll);
  const open = useWatch(tasks.watchOpen);

  const entries = useMemo(() => {
    const ready = <T,>(live: { status: string; data?: T }, empty: T): T =>
      live.status === 'ready' ? (live.data as T) : empty;
    return buildCalendar(
      {
        college: ready(collegeItems, []),
        hackathons: ready(hacks, []),
        milestones: ready(milestones, []),
        projects: ready(allProjects, []),
        tasks: ready(open, []),
        protectedTime: ready(kept, []),
        offTime: ready(off, []),
        work: ready(worked, []),
      },
      block.start,
      block.end,
    );
  }, [
    collegeItems,
    hacks,
    milestones,
    allProjects,
    open,
    kept,
    off,
    worked,
    block.start,
    block.end,
  ]);

  const days = eachDay(block.start, block.end);
  const weeks = Array.from({ length: 6 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  const monthName = format(fromLocalDate(`${block.month}-01`), 'MMMM yyyy');
  const agenda = entries.get(selected) ?? [];

  function go(delta: number) {
    const next = shiftMonth(cursor, delta);
    setCursor(next);
    setSelected(next);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-page font-semibold">Calendar</h1>
        <div className="flex items-center gap-1">
          <IconButton
            label="Previous month"
            icon={<ChevronLeft aria-hidden className="size-4" />}
            onClick={() => go(-1)}
          />
          <p aria-live="polite" className="min-w-36 text-center font-medium">
            {monthName}
          </p>
          <IconButton
            label="Next month"
            icon={<ChevronRight aria-hidden className="size-4" />}
            onClick={() => go(1)}
          />
          <Button
            variant="ghost"
            onClick={() => {
              setCursor(today);
              setSelected(today);
            }}
          >
            Today
          </Button>
        </div>
      </div>

      <ul
        aria-label="Legend"
        className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-muted"
      >
        {CALENDAR_KINDS.map((k) => (
          <li key={k} className="flex items-center gap-1">
            <span aria-hidden className={`size-2 rounded-full ${DOT[k]}`} />
            {KIND_LABEL[k]}
          </li>
        ))}
      </ul>

      <table className="mt-3 w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{monthName}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th key={d} scope="col" className="pb-1 text-[11px] font-normal text-fg-muted">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((date) => (
                <DayCell
                  key={date}
                  date={date}
                  inMonth={date.startsWith(block.month)}
                  isToday={date === today}
                  isSelected={date === selected}
                  entries={entries.get(date) ?? []}
                  onSelect={() => setSelected(date)}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <section aria-labelledby="agenda-heading" className="mt-6">
        <h2 id="agenda-heading" className="text-section font-semibold">
          {format(fromLocalDate(selected), 'EEEE d MMMM')}
          {selected === today && (
            <span className="ml-2 text-sm font-normal text-fg-muted">today</span>
          )}
        </h2>
        {agenda.length === 0 ? (
          <p className="mt-1 text-sm text-fg-muted">Nothing on this day.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {agenda.map((e) => (
              <AgendaRow key={e.key} entry={e} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function DayCell({
  date,
  inMonth,
  isToday,
  isSelected,
  entries,
  onSelect,
}: {
  date: LocalDate;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  entries: CalendarEntry[];
  onSelect: () => void;
}) {
  const label = `${format(fromLocalDate(date), 'EEEE d MMMM')}${
    entries.length ? `, ${entries.length} item${entries.length === 1 ? '' : 's'}` : ''
  }`;
  return (
    <td className="h-16 border border-line p-0 align-top sm:h-24">
      <button
        type="button"
        onClick={onSelect}
        aria-label={label}
        aria-pressed={isSelected}
        aria-current={isToday ? 'date' : undefined}
        className={`flex size-full flex-col items-stretch gap-0.5 p-1 text-left ${
          isSelected ? 'bg-accent-soft' : inMonth ? 'hover:bg-raised' : 'bg-surface/50'
        } ${inMonth ? '' : 'text-fg-muted'}`}
      >
        <span
          className={`self-start rounded-full px-1 text-xs tabular-nums ${
            isToday ? 'bg-fg font-semibold text-canvas' : inMonth ? '' : 'text-fg-muted'
          }`}
        >
          {Number(date.slice(8, 10))}
        </span>
        <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
          {entries.slice(0, 3).map((e) => (
            <span key={e.key} className="flex min-w-0 items-center gap-1 text-[10px] leading-tight">
              <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${DOT[e.kind]}`} />
              <span className="truncate">{e.title}</span>
            </span>
          ))}
          {entries.length > 3 && (
            <span className="text-[10px] text-fg-muted">+{entries.length - 3} more</span>
          )}
        </span>
        <span className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden>
          {entries.slice(0, 6).map((e) => (
            <span key={e.key} className={`size-1.5 rounded-full ${DOT[e.kind]}`} />
          ))}
        </span>
      </button>
    </td>
  );
}

function AgendaRow({ entry }: { entry: CalendarEntry }) {
  const body = (
    <>
      <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[entry.kind]}`} />
      <span className="min-w-0 flex-1">
        <span className="block">{entry.title}</span>
        <span className="block text-xs text-fg-muted">
          {KIND_LABEL[entry.kind]}
          {entry.detail ? ` · ${entry.detail}` : ''}
        </span>
      </span>
    </>
  );
  return (
    <li className="py-2 text-sm">
      {entry.to ? (
        <Link to={entry.to} className="flex items-start gap-2 hover:underline">
          {body}
        </Link>
      ) : (
        <span className="flex items-start gap-2">{body}</span>
      )}
    </li>
  );
}
