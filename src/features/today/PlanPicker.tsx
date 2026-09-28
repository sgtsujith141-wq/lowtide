import { CalendarPlus, Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import type { LocalDate, Task } from '../../types/domain';
import { describeDeadline } from '../tasks/deadline';
import { planCandidates } from './compose';

/**
 * "Add from Tasks": one click to open, one click to plan. Lists open tasks
 * not already on Today. Escape closes and returns focus to the toggle.
 */
export function PlanPicker({
  today,
  onPlanned,
}: {
  today: LocalDate;
  onPlanned: (title: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();

  function close() {
    setOpen(false);
    toggle.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  return (
    <div className="mt-1" onKeyDown={onKeyDown}>
      <Button
        ref={toggle}
        variant="ghost"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => setOpen((v) => !v)}
        className="-ml-2.5"
      >
        <Plus aria-hidden className="size-4" />
        Add from Tasks
      </Button>
      {open && (
        <Candidates
          id={`${id}-list`}
          today={today}
          onPlanned={onPlanned}
          focusToggle={() => toggle.current?.focus()}
        />
      )}
    </div>
  );
}

function Candidates({
  id,
  today,
  onPlanned,
  focusToggle,
}: {
  id: string;
  today: LocalDate;
  onPlanned: (title: string) => void;
  focusToggle: () => void;
}) {
  const { tasks } = useRepositories();
  const open = useWatch(tasks.watchOpen);
  const candidates = useMemo(
    () => (open.status === 'ready' ? planCandidates(open.data, today) : []),
    [open, today],
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const focusAfterUpdate = useRef<{ index: number; id: string } | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  // Once the planned task has left the list, focus whatever took its place
  // (or the toggle when nothing is left), so keyboard users stay in context.
  // Runs on the data update and on the tick; acts only once the task is gone.
  useEffect(() => {
    const pending = focusAfterUpdate.current;
    if (!pending || candidates.some((t) => t.id === pending.id)) return;
    focusAfterUpdate.current = null;
    const index = pending.index;
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>('button');
    const next = buttons?.[Math.min(index, buttons.length - 1)];
    if (next) next.focus();
    else focusToggle();
  }, [candidates, focusToggle, focusTick]);

  async function plan(task: Task, index: number) {
    setBusyId(task.id);
    setFailed(false);
    try {
      await tasks.planFor(task.id, today);
      onPlanned(task.title);
      focusAfterUpdate.current = { index, id: task.id };
      setFocusTick((t) => t + 1);
    } catch {
      setFailed(true);
    } finally {
      setBusyId(null);
    }
  }

  if (open.status !== 'ready') return null;

  return (
    <div id={id} className="mt-1 mb-2">
      {candidates.length === 0 ? (
        <p className="py-1 text-sm text-ink-muted">
          No other open tasks.{' '}
          <Link to="/tasks" className="text-accent-ink underline underline-offset-2">
            Add one in Tasks
          </Link>
          .
        </p>
      ) : (
        <ul
          ref={list}
          aria-label="Open tasks you could plan for today"
          className="max-h-72 overflow-y-auto rounded-md border border-line bg-paper-raised"
        >
          {candidates.map((task, index) => (
            <li
              key={task.id}
              className="flex items-center gap-2 border-b border-line px-2.5 py-1.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 text-sm">
                <span className="break-words">{task.title}</span>
                {task.dueAt && (
                  <span className="ml-1 text-xs whitespace-nowrap text-ink-muted">
                    {' '}
                    {describeDeadline(task.dueAt, today).text}
                  </span>
                )}
              </span>
              <Button
                variant="ghost"
                aria-label={`Plan for today: ${task.title}`}
                disabled={busyId === task.id}
                onClick={() => void plan(task, index)}
                className="px-2"
              >
                <CalendarPlus aria-hidden className="size-4" />
                <span className="hidden sm:inline">Plan</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {failed && <ErrorNotice>Couldn’t add that to today’s plan. Nothing changed.</ErrorNotice>}
    </div>
  );
}
