import { useMemo } from 'react';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import type { WorkSession } from '../../types/domain';
import { withoutProjectPrefix } from '../home/model';
import { activeMs } from '../work/duration';

/*
 * What a running work session is about, and today's total with it
 * (v2 PHASE 015). Shared by Work Mode, the compact bar and the summaries.
 */

const KIND_TITLE = { general: 'General work', college: 'College / study' } as const;

/** The session's project, task, a title and a subtitle. */
export function useWorkContext(session: WorkSession) {
  const { projects, tasks } = useRepositories();
  const watchAll = useWatch(projects.watchAll);
  const open = useWatch(tasks.watchOpen);
  const closed = useWatch(tasks.watchClosed);
  const project =
    session.projectId && watchAll.status === 'ready'
      ? watchAll.data.find((p) => p.id === session.projectId)
      : undefined;
  const allTasks = [
    ...(open.status === 'ready' ? open.data : []),
    ...(closed.status === 'ready' ? closed.data : []),
  ];
  const task = session.taskId ? allTasks.find((t) => t.id === session.taskId) : undefined;
  const title =
    project?.name ??
    (session.kind === 'general' || session.kind === 'college' ? KIND_TITLE[session.kind] : 'Work');
  const subtitle = task ? withoutProjectPrefix(task.title, project?.name) : session.intent;
  return { project, task, title, subtitle, tasks: allTasks };
}

/** Effective time today, the running session included. */
export function useTodayTotal(session: WorkSession, now: Date): number {
  const { work } = useRepositories();
  const today = useToday();
  const watch = useMemo(() => work.watchRange(today, today), [work, today]);
  const todays = useWatch(watch);
  return todays.status === 'ready'
    ? todays.data.reduce((sum, s) => sum + (s.id === session.id ? 0 : activeMs(s, now)), 0) +
        activeMs(session, now)
    : activeMs(session, now);
}
