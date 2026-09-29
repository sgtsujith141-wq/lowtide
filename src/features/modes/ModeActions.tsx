import { Moon, Play, Search } from 'lucide-react';
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import { RecordStateError } from '../../db/repositories';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import type { WorkKind } from '../../types/domain';
import { consumeModeFocus, requestModeFocus } from './focus-intent';
import { useModes } from './useModes';

const KINDS: { kind: WorkKind | 'project-task'; label: string }[] = [
  { kind: 'general', label: 'General work' },
  { kind: 'college', label: 'College / study' },
  { kind: 'project', label: 'Project' },
  { kind: 'project-task', label: 'Project + task' },
];

/**
 * Start Work, Sleep Mode and Ask LOWTIDE, side by side. Start Work opens an
 * inline panel (no modal), so the page stays visible and nothing traps focus.
 */
export function ModeActions({ onAsk }: { onAsk?: () => void }) {
  const { offTime, work } = useRepositories();
  const modes = useModes();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<'work-running' | 'failed' | null>(null);
  const panelId = useId();
  const startButton = useRef<HTMLButtonElement>(null);

  async function sleep() {
    setError(null);
    requestModeFocus();
    try {
      await offTime.start('sleep');
    } catch (e) {
      consumeModeFocus();
      setError(e instanceof RecordStateError && modes.work ? 'work-running' : 'failed');
    }
  }

  function closePanel() {
    setOpen(false);
    startButton.current?.focus();
  }

  const busy = modes.work !== undefined || modes.offTime !== undefined;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button
          ref={startButton}
          variant="primary"
          aria-expanded={open}
          aria-controls={panelId}
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
          className="h-10 px-4"
        >
          <Play aria-hidden className="size-4" /> Start Work
        </Button>
        <Button
          onClick={() => void sleep()}
          disabled={modes.offTime !== undefined}
          className="h-10 px-4"
        >
          <Moon aria-hidden className="size-4" /> Sleep Mode
        </Button>
        {onAsk && (
          <Button onClick={onAsk} className="h-10 px-4">
            <Search aria-hidden className="size-4" /> Ask LOWTIDE
          </Button>
        )}
      </div>
      {modes.work && (
        <p className="mt-1.5 text-xs text-ink-muted">
          A work session is running (see the bar above).
        </p>
      )}
      {error === 'work-running' && modes.work && (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-danger">
            Finish the work session first, then Sleep Mode can begin.
          </span>
          <Button
            onClick={() => {
              const id = modes.work?.id;
              if (id)
                void work.finish(id).then(
                  () => setError(null),
                  () => setError('failed'),
                );
            }}
          >
            Finish work session
          </Button>
        </div>
      )}
      {error === 'failed' && (
        <ErrorNotice>Couldn’t do that. Nothing changed; try again.</ErrorNotice>
      )}
      <div id={panelId} hidden={!open || busy}>
        {open && !busy && <StartWorkForm onStarted={() => setOpen(false)} onCancel={closePanel} />}
      </div>
    </div>
  );
}

function StartWorkForm({ onStarted, onCancel }: { onStarted: () => void; onCancel: () => void }) {
  const { work, projects, tasks } = useRepositories();
  const allProjects = useWatch(projects.watchAll);
  const [kind, setKind] = useState<(typeof KINDS)[number]['kind']>('general');
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [intent, setIntent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const watchTasks = useMemo(
    () => (projectId ? projects.watchTasks(projectId) : tasks.watchOpen),
    [projectId, projects, tasks],
  );
  const taskList = useWatch(watchTasks);
  const ids = { intent: useId(), project: useId(), task: useId() };
  const needsProject = kind === 'project' || kind === 'project-task';
  const active =
    allProjects.status === 'ready'
      ? allProjects.data.filter((p) => p.state !== 'done' && p.state !== 'archived')
      : [];
  const openTasks =
    taskList.status === 'ready'
      ? taskList.data.filter((t) => t.status === 'todo' || t.status === 'doing')
      : [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (needsProject && !projectId) return setError('Choose a project.');
    if (kind === 'project-task' && !taskId) return setError('Choose a task.');
    requestModeFocus();
    try {
      await work.start({
        kind: kind === 'project-task' ? 'task' : kind,
        ...(needsProject ? { projectId } : {}),
        ...(kind === 'project-task' ? { taskId } : {}),
        intent,
      });
      onStarted();
    } catch {
      consumeModeFocus();
      setError('Couldn’t start work. Is another session or off time running?');
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      aria-label="Start work"
      className="mt-3 max-w-md space-y-3 rounded-lg border border-line bg-paper-raised p-3"
    >
      <fieldset>
        <legend className={labelClass}>What kind of work?</legend>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <label
              key={k.kind}
              className={`cursor-pointer rounded-full border px-3 py-1 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                kind === k.kind
                  ? 'border-work-3 bg-work-1 font-medium'
                  : 'border-line text-ink-muted hover:border-line-strong'
              }`}
            >
              <input
                type="radio"
                name="work-kind"
                value={k.kind}
                checked={kind === k.kind}
                onChange={() => setKind(k.kind)}
                className="sr-only"
              />
              {k.label}
            </label>
          ))}
        </div>
      </fieldset>
      {needsProject && (
        <div>
          <label htmlFor={ids.project} className={labelClass}>
            Project
          </label>
          <select
            id={ids.project}
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setTaskId('');
            }}
            className={fieldClass}
          >
            <option value="">Choose…</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {active.length === 0 && (
            <p className="mt-1 text-xs text-ink-muted">No active projects yet.</p>
          )}
        </div>
      )}
      {kind === 'project-task' && projectId && (
        <div>
          <label htmlFor={ids.task} className={labelClass}>
            Task
          </label>
          <select
            id={ids.task}
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            className={fieldClass}
          >
            <option value="">Choose…</option>
            {openTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          {openTasks.length === 0 && (
            <p className="mt-1 text-xs text-ink-muted">This project has no open tasks.</p>
          )}
        </div>
      )}
      <div>
        <label htmlFor={ids.intent} className={labelClass}>
          Intent (optional)
        </label>
        <input
          id={ids.intent}
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="What are you about to do?"
          className={fieldClass}
        />
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          <Play aria-hidden className="size-4" /> Start
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
