import { useMemo } from 'react';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import { addDays } from '../../lib/calendar';
import type { LocalDate, Task } from '../../types/domain';
import { isLive, summariseProject } from './summary';

/** Live summaries of every project that isn't done or archived. */
export function useProjectSummaries(today: LocalDate) {
  const { projects, work, tasks } = useRepositories();
  const all = useWatch(projects.watchAll);
  const milestones = useWatch(projects.watchAllMilestones);
  const items = useWatch(projects.watchAllItems);
  const open = useWatch(tasks.watchOpen);
  const closed = useWatch(tasks.watchClosed);
  const since = addDays(today, -27);
  const watchSessions = useMemo(() => work.watchRange(since, today), [work, since, today]);
  const sessions = useWatch(watchSessions);
  return useMemo(() => {
    if (
      all.status !== 'ready' ||
      milestones.status !== 'ready' ||
      items.status !== 'ready' ||
      open.status !== 'ready' ||
      closed.status !== 'ready' ||
      sessions.status !== 'ready'
    )
      return null;
    const taskList: Task[] = [...open.data, ...closed.data];
    return {
      summaries: all.data
        .filter(isLive)
        .map((p) =>
          summariseProject(p, milestones.data, items.data, taskList, sessions.data, today),
        ),
      sessions: sessions.data,
      total: all.data.length,
    };
  }, [all, milestones, items, open, closed, sessions, today]);
}
