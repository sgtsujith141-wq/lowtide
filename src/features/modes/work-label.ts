import { useEffect, useState } from 'react';
import { useRepositories } from '../../hooks/useRepositories';
import type { WorkSession } from '../../types/domain';

const KIND_LABEL = {
  general: 'General work',
  college: 'College / study',
  project: 'Project',
  task: 'Task',
} as const;

/** "Engine › Wire the grid", "College / study: essay", … */
export function useWorkLabel(session: WorkSession): string {
  const { projects, tasks } = useRepositories();
  const [label, setLabel] = useState<string>(session.intent ?? KIND_LABEL[session.kind]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const project = session.projectId ? await projects.get(session.projectId) : undefined;
      const task = session.taskId ? await tasks.get(session.taskId) : undefined;
      const parts = [project?.name, task?.title].filter(Boolean) as string[];
      const base = parts.length ? parts.join(' › ') : KIND_LABEL[session.kind];
      if (live) setLabel(session.intent ? `${base}: ${session.intent}` : base);
    })();
    return () => {
      live = false;
    };
  }, [session, projects, tasks]);
  return label;
}
