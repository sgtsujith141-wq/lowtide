import { TASK_PRIORITIES, type TaskPriority } from '../../types/domain';
import { fieldClass, labelClass } from '../../components/ui/styles';
import type { TaskDraft } from './draft';

const PRIORITY_LABEL: Record<TaskPriority, string> = { low: 'Low', normal: 'Normal', high: 'High' };

interface Props {
  idPrefix: string;
  draft: TaskDraft;
  onChange: (draft: TaskDraft) => void;
  projects: readonly string[];
}

/** Optional task details (everything except the title). */
export function TaskFields({ idPrefix, draft, onChange, projects }: Props) {
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const listId = `${idPrefix}-projects`;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="sm:col-span-3">
        <label htmlFor={`${idPrefix}-notes`} className={labelClass}>
          Notes
        </label>
        <textarea
          id={`${idPrefix}-notes`}
          value={draft.notes}
          onChange={(e) => set('notes', e.target.value)}
          rows={2}
          className={`${fieldClass} resize-y text-sm`}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-due`} className={labelClass}>
          Deadline
        </label>
        <input
          id={`${idPrefix}-due`}
          type="date"
          value={draft.due}
          onChange={(e) => set('due', e.target.value)}
          className={`${fieldClass} text-sm`}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-priority`} className={labelClass}>
          Priority
        </label>
        <select
          id={`${idPrefix}-priority`}
          value={draft.priority}
          onChange={(e) => set('priority', e.target.value as TaskPriority)}
          className={`${fieldClass} text-sm`}
        >
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-project`} className={labelClass}>
          Project
        </label>
        <input
          id={`${idPrefix}-project`}
          value={draft.project}
          onChange={(e) => set('project', e.target.value)}
          list={listId}
          autoComplete="off"
          className={`${fieldClass} text-sm`}
        />
        <datalist id={listId}>
          {projects.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
