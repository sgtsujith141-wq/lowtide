import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LocalDate, Task } from '../../types/domain';
import { describeDeadline, type DeadlineTone } from './deadline';
import { describePlan } from './planning';

const TONE_CLASS: Record<DeadlineTone, string> = {
  overdue: 'text-warn font-medium',
  today: 'text-accent-ink font-medium',
  soon: 'text-fg-muted',
  later: 'text-fg-muted',
};

interface Props {
  task: Task;
  today: LocalDate;
  busy: boolean;
  onComplete: () => void;
  /** Row actions (icon buttons), rendered at the end of the line. */
  actions: ReactNode;
  /** Hide the "In today's plan" label where the context already says it. */
  hidePlan?: boolean;
}

/**
 * One open task as a line or two, never a card: completion circle, title,
 * notes, and a meta line (deadline · plan · project · priority).
 * Shared by the Tasks and Today screens.
 */
export function TaskLine({ task, today, busy, onComplete, actions, hidePlan = false }: Props) {
  const deadline = task.dueAt ? describeDeadline(task.dueAt, today) : null;
  const plan = hidePlan ? null : describePlan(task.plannedFor, today);
  const meta = [
    deadline && (
      <span key="due" className={TONE_CLASS[deadline.tone]}>
        {deadline.text}
      </span>
    ),
    plan && <span key="plan">{plan}</span>,
    task.project && <span key="project">{task.project}</span>,
    task.priority !== 'normal' && (
      <span key="priority">{task.priority === 'high' ? 'High priority' : 'Low priority'}</span>
    ),
  ].filter(Boolean);

  return (
    <li
      className="flex items-start gap-2.5 border-b border-line py-2"
      aria-busy={busy || undefined}
    >
      <button
        type="button"
        onClick={onComplete}
        disabled={busy}
        aria-label={`Complete: ${task.title}`}
        title="Complete"
        className="group -mx-0.5 grid size-6 shrink-0 place-items-center rounded-full"
      >
        <span className="grid size-5 place-items-center rounded-full border border-line-strong text-accent-ink transition-colors group-hover:border-accent group-hover:bg-accent-soft">
          <Check aria-hidden className="size-3 opacity-0 group-hover:opacity-100" strokeWidth={3} />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className={`break-words ${task.priority === 'low' ? 'text-fg-muted' : ''}`}>
          {task.title}
        </p>
        {task.notes && (
          <p className="mt-0.5 line-clamp-2 text-sm break-words whitespace-pre-wrap text-fg-muted">
            {task.notes}
          </p>
        )}
        {meta.length > 0 && (
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-fg-muted [&>*+*]:before:mr-2 [&>*+*]:before:text-fg-subtle [&>*+*]:before:content-['·']">
            {meta}
          </p>
        )}
      </div>
      <div className="-my-1 flex shrink-0">{actions}</div>
    </li>
  );
}
