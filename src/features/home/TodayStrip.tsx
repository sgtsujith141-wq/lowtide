import { ArrowRight } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import { formatDuration } from '../../lib/duration';
import { toLocalDate } from '../../lib/time';
import type { LocalDate } from '../../types/domain';
import type { ProjectSummary } from '../projects/summary';
import { habitLevel } from '../rhythm/intensity';
import { CATEGORY_PRESET } from '../rhythm/presets';
import { composeToday } from '../today/compose';
import { activeMinutes } from '../work/duration';
import { pickNext, selectHomeProjects } from './model';
import { Play } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useModeApi } from '../modes/mode-context';

/**
 * Today on Home (v2 PHASE 012): one strip of honest figures, then what to
 * do next. Work and tasks always show (zero is a fact); college, personal
 * routines, off time and the inbox only when there's something. No gym
 * figure and no routine names here (private routines stay off Home). Time kept for
 * people and rest is named, never measured.
 */
export function TodayStrip({
  today,
  summaries,
  now,
}: {
  today: LocalDate;
  summaries: readonly ProjectSummary[];
  now: Date;
}) {
  const { tasks, work, college, habits, offTime, inbox, protectedTime } = useRepositories();
  const modes = useModeApi();
  const watchDay = useMemo(() => tasks.watchForDay(today), [tasks, today]);
  const day = useWatch(watchDay);
  const closed = useWatch(tasks.watchClosed);
  const watchWork = useMemo(() => work.watchRange(today, today), [work, today]);
  const sessions = useWatch(watchWork);
  const watchCollege = useMemo(() => college.watchRange(today, today), [college, today]);
  const classes = useWatch(watchCollege);
  const allHabits = useWatch(habits.watchAll);
  const watchEntries = useMemo(() => habits.watchEntries(today, today), [habits, today]);
  const entries = useWatch(watchEntries);
  const watchOff = useMemo(() => offTime.watchRange(today, today), [offTime, today]);
  const off = useWatch(watchOff);
  const waiting = useWatch(inbox.watchUnprocessed);
  const watchKept = useMemo(() => protectedTime.watchForDate(today), [protectedTime, today]);
  const kept = useWatch(watchKept);

  if (day.status !== 'ready' || closed.status !== 'ready' || sessions.status !== 'ready') {
    return null;
  }

  const workMinutes = sessions.data.reduce((sum, s) => sum + activeMinutes(s, now), 0);
  const doneToday = closed.data.filter(
    (t) => t.status === 'done' && t.completedAt && toLocalDate(new Date(t.completedAt)) === today,
  ).length;
  const sections = composeToday(day.data, today);
  const openToday = new Set([...sections.attention, ...sections.planned].map((t) => t.id)).size;

  const classCount =
    classes.status === 'ready'
      ? classes.data.filter((c) => c.kind === 'class' || c.kind === 'lab').length
      : 0;
  const personal =
    allHabits.status === 'ready'
      ? allHabits.data.filter((h) => !h.archived && CATEGORY_PRESET[h.category] === 'personal')
      : [];
  const entryOf = new Map(
    entries.status === 'ready' ? entries.data.map((e) => [e.habitId, e]) : [],
  );
  const personalDone = personal.filter((h) => habitLevel(h, entryOf.get(h.id)) === 4).length;
  const offMinutes =
    off.status === 'ready'
      ? off.data
          .filter((o) => o.kind !== 'day_off' && o.startedAt && o.endedAt)
          .reduce(
            (sum, o) =>
              sum + Math.max(0, (Date.parse(o.endedAt!) - Date.parse(o.startedAt!)) / 60_000),
            0,
          )
      : 0;
  const inboxCount = waiting.status === 'ready' ? waiting.data.length : 0;
  const next = pickNext([...sections.attention, ...sections.planned], summaries);
  // Before anything has happened, the useful thing is a way to begin. Minutes
  // count as shown: a few seconds of off time still reads 0 m.
  const quiet =
    Math.round(workMinutes) === 0 &&
    doneToday === 0 &&
    personalDone === 0 &&
    Math.round(offMinutes) === 0 &&
    !modes.work;
  const lead = selectHomeProjects(summaries).shown[0]?.project;

  return (
    <section aria-labelledby="today-heading" className="mt-12">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="today-heading" className="text-section font-semibold">
          Today
        </h2>
        <Link
          to="/today"
          className="inline-flex items-center gap-1 text-sm text-fg-muted transition-colors hover:text-fg"
        >
          Open Today <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
      {quiet && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-[15px]">Nothing started yet.</p>
          {!modes.offTime && (
            <Button
              variant="primary"
              onClick={() =>
                lead
                  ? void modes
                      .startWork({ kind: 'project', projectId: lead.id })
                      .catch(() => modes.openStartWork())
                  : modes.openStartWork()
              }
            >
              <Play aria-hidden className="size-3.5" /> {lead ? `Start ${lead.name}` : 'Start work'}
            </Button>
          )}
        </div>
      )}
      <dl
        aria-label="Today in figures"
        className={`mt-3 flex flex-wrap gap-y-4 border-y border-line py-4 [&>div]:min-w-[8rem] [&>div]:pr-8 ${quiet ? '[&_dd]:text-sm [&_dd]:font-normal' : ''}`}
      >
        <Figure label="Work" value={formatDuration(Math.round(workMinutes))} tint="text-work-4" />
        <Figure
          label="Tasks"
          value={
            doneToday + openToday === 0
              ? 'Nothing planned'
              : `${doneToday} / ${doneToday + openToday}`
          }
          hint={doneToday + openToday === 0 ? undefined : 'done'}
        />
        {classCount > 0 && (
          <Figure
            label="College"
            value={`${classCount} ${classCount === 1 ? 'class' : 'classes'}`}
            tint="text-college-4"
          />
        )}
        {personal.length > 0 && (
          <Figure
            label="Personal"
            value={`${personalDone} / ${personal.length}`}
            hint="routines done"
            tint="text-personal-4"
          />
        )}
        {offMinutes > 0 && (
          <Figure
            label="Off time"
            value={formatDuration(Math.round(offMinutes))}
            hint="marked"
            tint="text-sleep-4"
          />
        )}
        {inboxCount > 0 && (
          <Figure
            label="Inbox"
            value={
              <Link to="/inbox" className="underline-offset-2 hover:underline">
                {inboxCount}
              </Link>
            }
            hint={inboxCount === 1 ? 'thought to sort' : 'thoughts to sort'}
          />
        )}
      </dl>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-2 text-sm">
        {next && (
          <p className="min-w-0">
            <span className="mr-2 text-xs text-fg-muted">Next</span>
            <Link to={next.to} className="font-medium hover:underline">
              {next.context && <span className="text-fg-muted">{next.context}: </span>}
              {next.text}
            </Link>
          </p>
        )}
        {kept.status === 'ready' && kept.data.length > 0 && (
          <p className="text-fg-muted">
            <span className="mr-2 text-xs">Kept for people and rest</span>
            {kept.data.map((p) => p.title).join(', ')}
          </p>
        )}
      </div>
    </section>
  );
}

function Figure({
  label,
  value,
  hint,
  tint = 'text-fg',
}: {
  label: string;
  value: ReactNode;
  hint?: string | undefined;
  tint?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={`figure mt-0.5 text-lg font-semibold ${tint}`}>{value}</dd>
      {hint && <dd className="text-xs text-fg-subtle">{hint}</dd>}
    </div>
  );
}
