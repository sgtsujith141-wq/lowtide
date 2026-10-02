import { ChevronDown, Play } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { ErrorNotice } from '../../../components/ui/Notice';
import { useNow } from '../../../hooks/useNow';
import { formatDuration } from '../../../lib/duration';
import type { Project, Task, WorkSession } from '../../../types/domain';
import { withoutProjectPrefix } from '../../home/model';
import { useModeApi } from '../../modes/mode-context';
import { activeMinutes, isPaused } from '../../work/duration';
import type { ProjectSummary } from '../summary';

/*
 * Start Work from a project (v2 PHASE 013, ADR-049; Work Mode since PHASE
 * 015): one press enters Work Mode on this project; the chevron opens the
 * chooser with this project first. While work runs, the room says so.
 */

export function StartWork({ summary, tasks }: { summary: ProjectSummary; tasks: readonly Task[] }) {
  const project = summary.project;
  const api = useModeApi();
  const [error, setError] = useState(false);
  if (!api.ready || project.state === 'archived') return null;
  if (api.work) return <Running session={api.work} project={project} tasks={tasks} />;
  if (api.offTime) return null;
  return (
    <div>
      <div className="flex">
        <Button
          variant="primary"
          className="rounded-r-none"
          onClick={() => {
            setError(false);
            api.startWork({ kind: 'project', projectId: project.id }).catch(() => setError(true));
          }}
        >
          <Play aria-hidden className="size-3.5" /> Start work
        </Button>
        <Button
          variant="primary"
          className="rounded-l-none border-l border-on-primary/20 px-2"
          aria-label="Choose what to work on"
          aria-haspopup="dialog"
          onClick={() => api.openStartWork({ projectId: project.id })}
        >
          <ChevronDown aria-hidden className="size-3.5" />
        </Button>
      </div>
      {error && <ErrorNotice>Couldn’t start work. Nothing changed.</ErrorNotice>}
    </div>
  );
}

/** The session running now: here, a live line; elsewhere, a quiet note. */
function Running({
  session,
  project,
  tasks,
}: {
  session: WorkSession;
  project: Project;
  tasks: readonly Task[];
}) {
  const now = useNow(true, 30_000);
  const here = session.projectId === project.id;
  if (!here) return <p className="text-sm text-fg-muted">Work is running on something else.</p>;
  const task = session.taskId ? tasks.find((t) => t.id === session.taskId) : undefined;
  const what = task ? withoutProjectPrefix(task.title, project.name) : session.intent;
  return (
    <p className="flex items-center gap-2 text-sm">
      <span aria-hidden className="size-2 rounded-full bg-work-3" />
      <span>
        <span className="font-medium">{isPaused(session) ? 'Paused' : 'Working here'}</span>
        <span className="figure ml-2 text-fg-muted">
          {formatDuration(Math.round(activeMinutes(session, now)))}
        </span>
        {what && <span className="ml-2 text-fg-muted">· {what}</span>}
      </span>
    </p>
  );
}
