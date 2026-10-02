import { ChevronDown, Play } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { ErrorNotice } from '../../../components/ui/Notice';
import { useNow } from '../../../hooks/useNow';
import { useRepositories } from '../../../hooks/useRepositories';
import { formatDuration } from '../../../lib/duration';
import type { Project, Task, WorkSession } from '../../../types/domain';
import { withoutProjectPrefix } from '../../home/model';
import { consumeModeFocus, requestModeFocus } from '../../modes/focus-intent';
import { useModes } from '../../modes/useModes';
import { activeMinutes, isPaused } from '../../work/duration';
import type { ProjectSummary } from '../summary';

/*
 * Start Work from a project (v2 PHASE 013, ADR-049): one press starts general
 * work on this project; "Choose" picks what it's for (the item in progress or
 * an open task). While work runs anywhere, the room says so instead.
 */

type Choice =
  { kind: 'general' } | { kind: 'task'; taskId: string } | { kind: 'intent'; intent: string };

export function StartWork({ summary, tasks }: { summary: ProjectSummary; tasks: readonly Task[] }) {
  const project = summary.project;
  const { work } = useRepositories();
  const modes = useModes();
  const [error, setError] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const panelId = useId();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!choosing) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setChoosing(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [choosing]);

  if (!modes.ready || project.state === 'archived') return null;
  if (modes.work) return <Running session={modes.work} project={project} tasks={tasks} />;
  if (modes.offTime) return null;

  function start(choice: Choice) {
    setError(false);
    setChoosing(false);
    requestModeFocus();
    work
      .start({
        kind: 'project',
        projectId: project.id,
        ...(choice.kind === 'task' ? { taskId: choice.taskId } : {}),
        ...(choice.kind === 'intent' ? { intent: choice.intent } : {}),
      })
      .catch(() => {
        consumeModeFocus();
        setError(true);
      });
  }

  const now = summary.lanes.working_now[0];
  const open = tasks.filter((t) => t.status === 'todo' || t.status === 'doing');
  const nowTask = now?.kind === 'task' ? open.find((t) => t.id === now.id) : undefined;

  return (
    <div ref={wrap} className="relative">
      <div className="flex">
        <Button
          variant="primary"
          className="rounded-r-none"
          onClick={() => start({ kind: 'general' })}
        >
          <Play aria-hidden className="size-3.5" /> Start work
        </Button>
        <Button
          variant="primary"
          className="rounded-l-none border-l border-on-primary/20 px-2"
          aria-label="Choose what to work on"
          aria-expanded={choosing}
          aria-controls={panelId}
          onClick={() => setChoosing((v) => !v)}
        >
          <ChevronDown aria-hidden className="size-3.5" />
        </Button>
      </div>
      <div
        id={panelId}
        hidden={!choosing}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setChoosing(false);
        }}
        className="lt-pop absolute right-0 z-20 mt-1.5 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-line bg-raised p-1.5 shadow-[var(--lt-shadow)]"
      >
        <p className="px-2 pt-1 pb-1.5 text-xs text-fg-muted">Work on {project.name}</p>
        <ul role="list" className="max-h-72 overflow-y-auto">
          <Option label="General project work" onPick={() => start({ kind: 'general' })} />
          {now && (
            <Option
              label={withoutProjectPrefix(now.title, project.name)}
              hint="In progress now"
              onPick={() =>
                start(
                  nowTask
                    ? { kind: 'task', taskId: nowTask.id }
                    : { kind: 'intent', intent: now.title },
                )
              }
            />
          )}
          {open
            .filter((t) => t.id !== nowTask?.id)
            .slice(0, 12)
            .map((t) => (
              <Option
                key={t.id}
                label={withoutProjectPrefix(t.title, project.name)}
                hint="Task"
                onPick={() => start({ kind: 'task', taskId: t.id })}
              />
            ))}
        </ul>
      </div>
      {error && <ErrorNotice>Couldn’t start work. Nothing changed.</ErrorNotice>}
    </div>
  );
}

function Option({ label, hint, onPick }: { label: string; hint?: string; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover"
      >
        <span className="min-w-0">{label}</span>
        {hint && <span className="shrink-0 text-xs text-fg-muted">{hint}</span>}
      </button>
    </li>
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
    <p role="status" className="flex items-center gap-2 text-sm">
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
