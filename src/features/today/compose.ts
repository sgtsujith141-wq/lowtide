import { localDateOfDeadline } from '../../lib/time';
import type { LocalDate, Task } from '../../types/domain';
import { orderOpenTasks } from '../tasks/order';

export interface TodaySections {
  /** Open tasks due today or overdue: deadlines take precedence. */
  attention: Task[];
  /** Open tasks planned for today that aren't already under `attention`. */
  planned: Task[];
}

const isOpen = (task: Task) => task.status === 'todo' || task.status === 'doing';

/** Whether a task is shown under Needs attention on `today` (ADR-020). */
export function needsAttention(task: Task, today: LocalDate): boolean {
  return isOpen(task) && task.dueAt !== undefined && localDateOfDeadline(task.dueAt) <= today;
}

/**
 * Splits tasks into Today's sections. Each task appears at most once: a task
 * that is due (or overdue) *and* planned for today shows under `attention`.
 * Future deadlines and plans for other days are not shown. Closed tasks never
 * are. Order is deterministic (`orderOpenTasks`: deadline, priority, age).
 */
export function composeToday(tasks: readonly Task[], today: LocalDate): TodaySections {
  const attention = tasks.filter((task) => needsAttention(task, today));
  const planned = tasks.filter(
    (task) => isOpen(task) && task.plannedFor === today && !needsAttention(task, today),
  );
  return { attention: orderOpenTasks(attention), planned: orderOpenTasks(planned) };
}

/** Open tasks that could be added to today's plan: anything not already on Today. */
export function planCandidates(openTasks: readonly Task[], today: LocalDate): Task[] {
  return orderOpenTasks(
    openTasks.filter(
      (task) => isOpen(task) && task.plannedFor !== today && !needsAttention(task, today),
    ),
  );
}
