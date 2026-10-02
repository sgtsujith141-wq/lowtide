import { RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import { formatFull, formatWhen } from '../../lib/when';
import type { Task } from '../../types/domain';
import { NewTaskForm } from './NewTaskForm';
import { orderOpenTasks } from './order';
import { TaskEditor } from './TaskEditor';
import { TaskRow } from './TaskRow';

type Transition = 'complete' | 'drop' | 'reopen';

const FAILED: Record<Transition, string> = {
  complete: 'Couldn’t mark that task done. Nothing changed.',
  drop: 'Couldn’t drop that task. Nothing changed.',
  reopen: 'Couldn’t reopen that task. Nothing changed.',
};

const DONE: Record<Transition, (title: string) => string> = {
  complete: (t) => `Done: ${t}`,
  drop: (t) => `Dropped: ${t}. You can reopen it under Finished.`,
  reopen: (t) => `Reopened: ${t}`,
};

function focusEditButton(id: string) {
  requestAnimationFrame(() =>
    document.querySelector<HTMLButtonElement>(`[data-task-edit="${CSS.escape(id)}"]`)?.focus(),
  );
}

export function TasksPage() {
  useDocumentTitle('Tasks');
  const { tasks } = useRepositories();
  const open = useWatch(tasks.watchOpen);
  const closed = useWatch(tasks.watchClosed);
  const today = useToday();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const openTasks = useMemo(
    () => (open.status === 'ready' ? orderOpenTasks(open.data) : []),
    [open],
  );
  const closedTasks = useMemo(() => (closed.status === 'ready' ? closed.data : []), [closed]);
  const projects = useMemo(() => {
    const names = [...openTasks, ...closedTasks].flatMap((t) => (t.project ? [t.project] : []));
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [openTasks, closedTasks]);

  async function transition(task: Task, kind: Transition) {
    setBusyId(task.id);
    setError(null);
    try {
      await tasks[kind](task.id);
      setAnnouncement(DONE[kind](task.title));
    } catch {
      setError(FAILED[kind]);
    } finally {
      setBusyId(null);
    }
  }

  const now = new Date();

  return (
    <>
      <h1 className="text-page font-semibold">Tasks</h1>
      <NewTaskForm projects={projects} onCreated={(title) => setAnnouncement(`Added: ${title}`)} />

      {error && <ErrorNotice>{error}</ErrorNotice>}
      {(open.status === 'error' || closed.status === 'error') && (
        <ErrorNotice>Couldn’t read your tasks. Try reloading.</ErrorNotice>
      )}

      <section aria-labelledby="open-heading" className="mt-6">
        <h2 id="open-heading" className="border-b border-line pb-2 text-section font-semibold">
          Open{open.status === 'ready' && openTasks.length > 0 ? ` · ${openTasks.length}` : ''}
        </h2>
        {open.status === 'ready' && openTasks.length === 0 && (
          <p className="py-3 text-sm text-fg-muted">No open tasks.</p>
        )}
        <ul>
          {openTasks.map((task) =>
            editingId === task.id ? (
              <li key={task.id} className="border-b border-line">
                <TaskEditor
                  task={task}
                  projects={projects}
                  onClose={(saved) => {
                    setEditingId(null);
                    if (saved) setAnnouncement(`Saved: ${task.title}`);
                    focusEditButton(task.id);
                  }}
                />
              </li>
            ) : (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                busy={busyId === task.id}
                onComplete={() => void transition(task, 'complete')}
                onDrop={() => void transition(task, 'drop')}
                onEdit={() => setEditingId(task.id)}
              />
            ),
          )}
        </ul>
      </section>

      {closedTasks.length > 0 && (
        <details className="group mt-6">
          <summary className="cursor-pointer text-sm font-medium text-fg-muted select-none hover:text-fg">
            Finished · {closedTasks.length}
          </summary>
          <ul className="mt-1.5 border-t border-line">
            {closedTasks.map((task) => (
              <li
                key={task.id}
                className="flex items-center gap-3 border-b border-line py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={`break-words ${task.status === 'done' ? 'text-fg-muted line-through decoration-line-strong' : 'text-fg-muted'}`}
                  >
                    {task.title}
                  </span>
                  <span className="ml-1 text-xs whitespace-nowrap text-fg-muted">
                    {' '}
                    {task.status === 'done' ? 'Done' : 'Dropped'}{' '}
                    <time dateTime={task.updatedAt} title={formatFull(task.updatedAt)}>
                      {formatWhen(task.completedAt ?? task.updatedAt, now)}
                    </time>
                  </span>
                </span>
                <Button
                  variant="ghost"
                  onClick={() => void transition(task, 'reopen')}
                  disabled={busyId === task.id}
                  aria-label={`Reopen: ${task.title}`}
                >
                  <RotateCcw aria-hidden className="size-3.5" />
                  Reopen
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Announcer message={announcement} />
    </>
  );
}
