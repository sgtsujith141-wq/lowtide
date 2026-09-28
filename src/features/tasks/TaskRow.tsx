import { Check, CircleSlash, Pencil } from 'lucide-react';
import { IconButton } from '../../components/ui/Button';
import type { LocalDate, Task } from '../../types/domain';
import { describeDeadline, type DeadlineTone } from './deadline';

const TONE_CLASS: Record<DeadlineTone, string> = {
  overdue: 'text-warn font-medium',
  today: 'text-accent-ink font-medium',
  soon: 'text-ink-muted',
  later: 'text-ink-muted',
};

interface Props {
  task: Task;
  today: LocalDate;
  busy: boolean;
  onComplete: () => void;
  onEdit: () => void;
  onDrop: () => void;
}

/** One open task: a line or two, never a card. */
export function TaskRow({ task, today, busy, onComplete, onEdit, onDrop }: Props) {
  const deadline = task.dueAt ? describeDeadline(task.dueAt, today) : null;
  const titleId = `task-${task.id}`;
  const meta = [
    deadline && (
      <span key="due" className={TONE_CLASS[deadline.tone]}>
        {deadline.text}
      </span>
    ),
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
        <p
          id={titleId}
          className={`break-words ${task.priority === 'low' ? 'text-ink-muted' : ''}`}
        >
          {task.title}
        </p>
        {task.notes && (
          <p className="mt-0.5 line-clamp-2 text-sm break-words whitespace-pre-wrap text-ink-muted">
            {task.notes}
          </p>
        )}
        {meta.length > 0 && (
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-muted [&>*+*]:before:mr-2 [&>*+*]:before:text-ink-faint [&>*+*]:before:content-['·']">
            {meta}
          </p>
        )}
      </div>
      <div className="-my-1 flex shrink-0">
        <IconButton
          label={`Edit: ${task.title}`}
          icon={<Pencil aria-hidden className="size-4" />}
          data-task-edit={task.id}
          onClick={onEdit}
          disabled={busy}
        />
        <IconButton
          label={`Drop: ${task.title}`}
          icon={<CircleSlash aria-hidden className="size-4" />}
          onClick={onDrop}
          disabled={busy}
        />
      </div>
    </li>
  );
}
