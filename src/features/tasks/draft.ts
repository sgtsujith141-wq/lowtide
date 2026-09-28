import type { NewTask, TaskChanges } from '../../db/repositories';
import { deadlineFromLocalDate, localDateOfDeadline } from '../../lib/time';
import type { Task, TaskPriority } from '../../types/domain';

/** Form state for creating or editing a task. `due` is a `YYYY-MM-DD` day or ''. */
export interface TaskDraft {
  title: string;
  notes: string;
  priority: TaskPriority;
  due: string;
  project: string;
}

export const emptyDraft: TaskDraft = {
  title: '',
  notes: '',
  priority: 'normal',
  due: '',
  project: '',
};

export function draftFromTask(task: Task): TaskDraft {
  return {
    title: task.title,
    notes: task.notes ?? '',
    priority: task.priority,
    due: task.dueAt ? localDateOfDeadline(task.dueAt) : '',
    project: task.project ?? '',
  };
}

export function draftToNewTask(draft: TaskDraft): NewTask {
  const task: NewTask = { title: draft.title, priority: draft.priority };
  if (draft.notes.trim()) task.notes = draft.notes;
  if (draft.project.trim()) task.project = draft.project;
  if (draft.due) task.dueAt = deadlineFromLocalDate(draft.due);
  return task;
}

/** Every field is sent, so clearing a field in the form clears it in storage. */
export function draftToChanges(draft: TaskDraft): TaskChanges {
  return {
    title: draft.title,
    priority: draft.priority,
    notes: draft.notes,
    project: draft.project,
    dueAt: draft.due ? deadlineFromLocalDate(draft.due) : null,
  };
}
