import { CircleSlash, Pencil } from 'lucide-react';
import { IconButton } from '../../components/ui/Button';
import type { LocalDate, Task } from '../../types/domain';
import { TaskLine } from './TaskLine';

interface Props {
  task: Task;
  today: LocalDate;
  busy: boolean;
  onComplete: () => void;
  onEdit: () => void;
  onDrop: () => void;
}

/** An open task on the Tasks screen: complete, edit, drop. */
export function TaskRow({ task, today, busy, onComplete, onEdit, onDrop }: Props) {
  return (
    <TaskLine
      task={task}
      today={today}
      busy={busy}
      onComplete={onComplete}
      actions={
        <>
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
        </>
      }
    />
  );
}
