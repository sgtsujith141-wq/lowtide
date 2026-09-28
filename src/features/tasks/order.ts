import { localDateOfDeadline } from '../../lib/time';
import type { Task, TaskPriority } from '../../types/domain';

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

/**
 * Order for the open list: tasks with a deadline first, soonest first; then
 * by priority (high → low); then oldest first. Undated tasks keep their
 * capture order within a priority.
 */
export function orderOpenTasks(tasks: readonly Task[]): Task[] {
  const dueKey = (task: Task) => (task.dueAt ? localDateOfDeadline(task.dueAt) : '9999-12-31');
  return [...tasks].sort(
    (a, b) =>
      dueKey(a).localeCompare(dueKey(b)) ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.createdAt.localeCompare(b.createdAt),
  );
}
