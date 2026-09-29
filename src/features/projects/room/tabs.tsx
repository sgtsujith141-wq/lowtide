import { ArrowDown, ArrowUp, Check, GitBranch, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { Button, IconButton } from '../../../components/ui/Button';
import { ErrorNotice } from '../../../components/ui/Notice';
import { fieldClass, labelClass } from '../../../components/ui/styles';
import { useRepositories } from '../../../hooks/useRepositories';
import { useWatch } from '../../../hooks/useWatch';
import { formatFull, formatWhen } from '../../../lib/when';
import type { Milestone, Project, Task } from '../../../types/domain';
import { Timeline } from '../../activity/Timeline';

function useRun() {
  const [error, setError] = useState<string | null>(null);
  const run = async (
    action: () => Promise<unknown>,
    failure = 'That didn’t work. Nothing changed.',
  ) => {
    setError(null);
    try {
      await action();
      return true;
    } catch {
      setError(failure);
      return false;
    }
  };
  return { error, run };
}

/* Tasks ------------------------------------------------------------------ */

export function TasksTab({ project, tasks }: { project: Project; tasks: readonly Task[] }) {
  const { tasks: repo } = useRepositories();
  const open = useWatch(repo.watchOpen);
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const { error, run } = useRun();
  const ids = { title: useId(), link: useId() };
  const mine = tasks.filter((t) => t.status === 'todo' || t.status === 'doing');
  const finished = tasks.filter((t) => t.status === 'done');
  const unlinked =
    open.status === 'ready' ? open.data.filter((t) => t.projectId === undefined) : [];

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    if (await run(() => repo.create({ title, projectId: project.id }))) setTitle('');
  }

  return (
    <div className="space-y-5">
      <form onSubmit={(e) => void add(e)} className="flex max-w-lg gap-2" aria-label="Add a task">
        <label htmlFor={ids.title} className="sr-only">
          New task for {project.name}
        </label>
        <input
          id={ids.title}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`New task for ${project.name}`}
          className={fieldClass}
        />
        <Button type="submit" variant="primary">
          <Plus aria-hidden className="size-4" /> Add
        </Button>
      </form>
      {unlinked.length > 0 && (
        <div className="flex max-w-lg items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={ids.link} className={labelClass}>
              Link an existing open task
            </label>
            <select
              id={ids.link}
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className={fieldClass}
            >
              <option value="">Choose…</option>
              {unlinked.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                  {t.project ? ` (${t.project})` : ''}
                </option>
              ))}
            </select>
          </div>
          <Button
            disabled={!link}
            onClick={() =>
              void run(() => repo.update(link, { projectId: project.id })).then(
                (ok) => ok && setLink(''),
              )
            }
          >
            Link
          </Button>
        </div>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <TaskList title="Open" tasks={mine} onComplete={(t) => void run(() => repo.complete(t.id))} />
      <TaskList title="Done" tasks={finished} />
    </div>
  );
}

function TaskList({
  title,
  tasks,
  onComplete,
}: {
  title: string;
  tasks: readonly Task[];
  onComplete?: (t: Task) => void;
}) {
  return (
    <section aria-label={`${title} tasks`}>
      <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
        {title} ({tasks.length})
      </h3>
      {tasks.length === 0 ? (
        <p className="py-1 text-sm text-ink-muted">None.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 py-1.5">
              {onComplete ? (
                <IconButton
                  label={`Complete: ${t.title}`}
                  icon={<Check aria-hidden className="size-4" />}
                  onClick={() => onComplete(t)}
                />
              ) : (
                <Check aria-hidden className="size-4 text-pulse-3" />
              )}
              <span className={`text-sm ${onComplete ? '' : 'text-ink-muted'}`}>{t.title}</span>
              {t.status === 'doing' && (
                <span className="text-[10px] text-accent-ink uppercase">now</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* Milestones -------------------------------------------------------------- */

export function MilestonesTab({
  project,
  milestones,
}: {
  project: Project;
  milestones: readonly Milestone[];
}) {
  const { projects } = useRepositories();
  const [title, setTitle] = useState('');
  const [weight, setWeight] = useState('1');
  const [dueOn, setDueOn] = useState('');
  const { error, run } = useRun();
  const ids = { title: useId(), weight: useId(), due: useId() };

  async function add(event: FormEvent) {
    event.preventDefault();
    const w = Number(weight);
    if (!title.trim() || !Number.isFinite(w) || w <= 0) return;
    const ok = await run(() =>
      projects.addMilestone(project.id, { title, weight: w, ...(dueOn ? { dueOn } : {}) }),
    );
    if (ok) {
      setTitle('');
      setWeight('1');
      setDueOn('');
    }
  }

  return (
    <div className="space-y-5">
      <ol
        aria-label="Milestones"
        className="divide-y divide-line rounded-lg border border-line bg-paper-raised"
      >
        {milestones.length === 0 && (
          <li className="p-3 text-sm text-ink-muted">
            No milestones yet. Completion is shown only once there are milestones, and only from
            them.
          </li>
        )}
        {milestones.map((m, i) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <IconButton
              label={m.completedAt ? `Reopen: ${m.title}` : `Complete: ${m.title}`}
              icon={
                m.completedAt ? (
                  <RotateCcw aria-hidden className="size-4" />
                ) : (
                  <Check aria-hidden className="size-4" />
                )
              }
              onClick={() =>
                void run(() =>
                  m.completedAt ? projects.reopenMilestone(m.id) : projects.completeMilestone(m.id),
                )
              }
            />
            <span className="min-w-0 flex-1">
              <span
                className={`text-sm ${m.completedAt ? 'text-ink-muted line-through' : 'font-medium'}`}
              >
                {m.title}
              </span>
              <span className="ml-2 text-xs text-ink-muted">
                weight {m.weight}
                {m.dueOn ? ` · due ${m.dueOn}` : ''}
                {m.completedAt ? ` · done ${formatWhen(m.completedAt, new Date())}` : ''}
              </span>
            </span>
            <IconButton
              label={`Move earlier: ${m.title}`}
              icon={<ArrowUp aria-hidden className="size-4" />}
              disabled={i === 0}
              onClick={() => void run(() => projects.moveMilestone(m.id, -1))}
            />
            <IconButton
              label={`Move later: ${m.title}`}
              icon={<ArrowDown aria-hidden className="size-4" />}
              disabled={i === milestones.length - 1}
              onClick={() => void run(() => projects.moveMilestone(m.id, 1))}
            />
            <IconButton
              label={`Remove: ${m.title}`}
              icon={<Trash2 aria-hidden className="size-4" />}
              onClick={() =>
                void run(
                  () => projects.removeMilestone(m.id),
                  'Tasks or items still refer to that milestone.',
                )
              }
            />
          </li>
        ))}
      </ol>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <form
        onSubmit={(e) => void add(e)}
        aria-label="Add a milestone"
        className="grid max-w-2xl gap-3 sm:grid-cols-[1fr_6rem_10rem_auto] sm:items-end"
      >
        <div>
          <label htmlFor={ids.title} className={labelClass}>
            Milestone
          </label>
          <input
            id={ids.title}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={ids.weight} className={labelClass}>
            Weight
          </label>
          <input
            id={ids.weight}
            type="number"
            min="0.1"
            step="any"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={ids.due} className={labelClass}>
            Due (optional)
          </label>
          <input
            id={ids.due}
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            className={fieldClass}
          />
        </div>
        <Button type="submit" variant="primary">
          <Plus aria-hidden className="size-4" /> Add
        </Button>
      </form>
    </div>
  );
}

/* Docs: the decision log --------------------------------------------------- */

export function DocsTab({ project }: { project: Project }) {
  const { projects } = useRepositories();
  const watch = useMemo(() => projects.watchDecisions(project.id), [projects, project.id]);
  const decisions = useWatch(watch);
  const [title, setTitle] = useState('');
  const [decision, setDecision] = useState('');
  const [context, setContext] = useState('');
  const [supersedes, setSupersedes] = useState('');
  const { error, run } = useRun();
  const ids = { title: useId(), decision: useId(), context: useId(), supersedes: useId() };
  const list = decisions.status === 'ready' ? decisions.data : [];
  const superseded = new Set(list.map((d) => d.supersedesId).filter(Boolean));

  async function record(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !decision.trim()) return;
    const ok = await run(() =>
      projects.recordDecision(project.id, {
        title,
        decision,
        ...(context.trim() ? { context } : {}),
        ...(supersedes ? { supersedesId: supersedes } : {}),
      }),
    );
    if (ok) {
      setTitle('');
      setDecision('');
      setContext('');
      setSupersedes('');
    }
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="decisions-heading">
        <h3 id="decisions-heading" className="text-sm font-semibold">
          Decision log
        </h3>
        <p className="text-xs text-ink-muted">
          Decisions are never edited; a newer one supersedes an older one.
        </p>
        {list.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No decisions recorded yet.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {list.map((d) => (
              <li
                key={d.id}
                className={`rounded-lg border border-line bg-paper-raised p-3 ${superseded.has(d.id) ? 'opacity-60' : ''}`}
              >
                <p className="text-sm font-medium">
                  {d.title}
                  {superseded.has(d.id) && (
                    <span className="ml-2 text-xs font-normal text-ink-muted">superseded</span>
                  )}
                </p>
                <p className="mt-0.5 text-sm">{d.decision}</p>
                {d.context && <p className="mt-1 text-xs text-ink-muted">Context: {d.context}</p>}
                <p className="mt-1 text-[11px] text-ink-muted">
                  <time dateTime={d.decidedAt} title={formatFull(d.decidedAt)}>
                    {formatWhen(d.decidedAt, new Date())}
                  </time>
                  {d.origin === 'accepted-proposal'
                    ? ' · proposed by an AI client, accepted by you'
                    : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
      <form
        aria-label="Record a decision"
        onSubmit={(e) => void record(e)}
        className="max-w-2xl space-y-3 rounded-lg border border-line bg-paper-raised p-3"
      >
        <div>
          <label htmlFor={ids.title} className={labelClass}>
            Decision title
          </label>
          <input
            id={ids.title}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={ids.decision} className={labelClass}>
            What was decided
          </label>
          <textarea
            id={ids.decision}
            rows={2}
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={ids.context} className={labelClass}>
            Context (optional)
          </label>
          <input
            id={ids.context}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className={fieldClass}
          />
        </div>
        {list.length > 0 && (
          <div>
            <label htmlFor={ids.supersedes} className={labelClass}>
              Supersedes (optional)
            </label>
            <select
              id={ids.supersedes}
              value={supersedes}
              onChange={(e) => setSupersedes(e.target.value)}
              className={fieldClass}
            >
              <option value="">Nothing</option>
              {list.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <Button type="submit" variant="primary">
          Record decision
        </Button>
      </form>
      <p className="text-xs text-ink-muted">
        Documents live in the project’s workspace folder (<code>projects/{project.slug}/docs/</code>
        ) once you export the workspace.
      </p>
    </div>
  );
}

/* AI ---------------------------------------------------------------------- */

export function AiSessionsList({ project }: { project: Project }) {
  const { aiSessions } = useRepositories();
  const watch = useMemo(() => aiSessions.watchForProject(project.id), [aiSessions, project.id]);
  const sessions = useWatch(watch);
  if (sessions.status !== 'ready') return null;
  if (sessions.data.length === 0)
    return (
      <p className="text-sm text-ink-muted">
        No AI sessions have been reported for this project. LOWTIDE never invents them: a session
        appears here only when a connected, authorised AI client reports one.
      </p>
    );
  return (
    <ol className="space-y-2">
      {sessions.data.map((s) => (
        <li key={s.id} className="rounded-lg border border-line bg-paper-raised p-3 text-sm">
          <p className="font-medium">{s.client}</p>
          <p className="mt-0.5">{s.summary}</p>
          <p className="mt-1 text-[11px] text-ink-muted">
            {formatWhen(s.startedAt, new Date())} · scope {s.scope}
          </p>
        </li>
      ))}
    </ol>
  );
}

/* GitHub ------------------------------------------------------------------ */

export function GithubTab({ project }: { project: Project }) {
  return (
    <div className="max-w-xl space-y-2 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <GitBranch aria-hidden className="size-4" /> GitHub isn’t connected
      </p>
      {project.repoUrl ? (
        <p>
          Repository:{' '}
          <a
            href={project.repoUrl}
            className="text-accent-ink underline"
            rel="noreferrer"
            target="_blank"
          >
            {project.repoUrl}
          </a>
        </p>
      ) : (
        <p className="text-ink-muted">No repository set. Add one in the project details.</p>
      )}
      <p className="text-ink-muted">
        LOWTIDE fetches nothing from GitHub. A read-only, repository-scoped connection is planned
        through the local companion, with the token kept outside the browser (ADR-041).
      </p>
    </div>
  );
}

/* History ----------------------------------------------------------------- */

export function HistoryTab({ project }: { project: Project }) {
  return (
    <div>
      <p className="mb-3 text-xs text-ink-muted">
        Everything that happened in {project.name}, newest first, from the timeline ledger.
      </p>
      <Timeline projectId={project.id} limit={200} showProject={false} />
    </div>
  );
}
