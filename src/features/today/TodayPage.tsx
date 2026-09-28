import { CalendarMinus } from 'lucide-react';
import { format } from 'date-fns';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { IconButton } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import { fromLocalDate } from '../../lib/time';
import type { Task } from '../../types/domain';
import { CaptureComposer } from '../inbox/CaptureComposer';
import { TaskLine } from '../tasks/TaskLine';
import { composeToday } from './compose';
import { PlanPicker } from './PlanPicker';
import { ProtectedTimeSection } from './ProtectedTimeSection';
import { SectionHeading } from './SectionHeading';
import { TodayHackathons } from './TodayHackathons';

type Action = 'complete' | 'removeFromPlan';

const FAILED: Record<Action, string> = {
  complete: 'Couldn’t mark that task done. Nothing changed.',
  removeFromPlan: 'Couldn’t take that out of today’s plan. Nothing changed.',
};

/**
 * Today: a small daily page. Capture first; then what's pressing (deadlines),
 * what you chose to work on (plan), and the time you've kept for people and
 * rest. Nothing here is scored.
 */
export function TodayPage() {
  useDocumentTitle('Today');
  const today = useToday();
  const { tasks, inbox } = useRepositories();
  const watchDay = useMemo(() => tasks.watchForDay(today), [tasks, today]);
  const dayTasks = useWatch(watchDay);
  const waiting = useWatch(inbox.watchUnprocessed);
  const sections = useMemo(
    () => (dayTasks.status === 'ready' ? composeToday(dayTasks.data, today) : null),
    [dayTasks, today],
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  async function act(task: Task, action: Action, headingId: string) {
    setBusyId(task.id);
    setError(null);
    try {
      await tasks[action](task.id);
      setAnnouncement(
        action === 'complete' ? `Done: ${task.title}` : `Taken out of today’s plan: ${task.title}`,
      );
      // The row leaves; keep focus in the same section.
      document.getElementById(headingId)?.focus();
    } catch {
      setError(FAILED[action]);
    } finally {
      setBusyId(null);
    }
  }

  function renderTask(task: Task, headingId: string, inPlanSection: boolean) {
    const planned = task.plannedFor === today;
    return (
      <TaskLine
        key={task.id}
        task={task}
        today={today}
        busy={busyId === task.id}
        hidePlan={inPlanSection}
        onComplete={() => void act(task, 'complete', headingId)}
        actions={
          planned && (
            <IconButton
              label={`Take out of today’s plan: ${task.title}`}
              icon={<CalendarMinus aria-hidden className="size-4" />}
              onClick={() => void act(task, 'removeFromPlan', headingId)}
              disabled={busyId === task.id}
            />
          )
        }
      />
    );
  }

  const waitingCount = waiting.status === 'ready' ? waiting.data.length : 0;

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h1 className="font-serif text-xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-ink-muted">
          <time dateTime={today}>{format(fromLocalDate(today), 'EEEE d MMMM')}</time>
        </p>
      </div>

      <div className="mt-4">
        <CaptureComposer autoFocus />
        {waitingCount > 0 && (
          <p className="mt-1 text-xs">
            <Link to="/inbox" className="text-accent-ink hover:underline">
              {waitingCount === 1 ? '1 thought' : `${waitingCount} thoughts`} waiting in your inbox
            </Link>
          </p>
        )}
      </div>

      {error && <ErrorNotice>{error}</ErrorNotice>}
      {dayTasks.status === 'error' && (
        <ErrorNotice>Couldn’t read today’s tasks. Try reloading.</ErrorNotice>
      )}

      {sections && (
        <>
          <section aria-labelledby="attention-heading" className="mt-7">
            <SectionHeading id="attention-heading">Needs attention</SectionHeading>
            {sections.attention.length === 0 ? (
              <p className="py-2 text-sm text-ink-muted">Nothing pressing today.</p>
            ) : (
              <ul>
                {sections.attention.map((task) => renderTask(task, 'attention-heading', false))}
              </ul>
            )}
          </section>

          <section aria-labelledby="plan-heading" className="mt-7">
            <SectionHeading id="plan-heading">My plan</SectionHeading>
            {sections.planned.length === 0 ? (
              <p className="py-2 text-sm text-ink-muted">Nothing else planned.</p>
            ) : (
              <ul>{sections.planned.map((task) => renderTask(task, 'plan-heading', true))}</ul>
            )}
            <PlanPicker today={today} onPlanned={(title) => setAnnouncement(`Planned: ${title}`)} />
          </section>
        </>
      )}

      <TodayHackathons today={today} />
      <ProtectedTimeSection date={today} />
      <Announcer message={announcement} />
    </>
  );
}
