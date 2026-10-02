import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { Button, IconButton } from '../../../components/ui/Button';
import { ErrorNotice } from '../../../components/ui/Notice';
import { fieldClass, labelClass } from '../../../components/ui/styles';
import { useRepositories } from '../../../hooks/useRepositories';
import { useWatch } from '../../../hooks/useWatch';
import { formatFull, formatWhen } from '../../../lib/when';
import {
  NOTE_KINDS,
  type Milestone,
  type NoteKind,
  type Project,
  type Task,
} from '../../../types/domain';
import { Timeline } from '../../activity/Timeline';
import { useModeApi } from '../../modes/mode-context';

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
  const modes = useModeApi();
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
      <TaskList
        title="Open"
        tasks={mine}
        onComplete={(t) => void run(() => repo.complete(t.id))}
        onStart={
          modes.work || modes.offTime
            ? undefined
            : (t) => modes.openStartWork({ projectId: project.id, taskId: t.id })
        }
      />
      <TaskList title="Done" tasks={finished} />
    </div>
  );
}

function TaskList({
  title,
  tasks,
  onComplete,
  onStart,
}: {
  title: string;
  tasks: readonly Task[];
  onComplete?: (t: Task) => void;
  /** Offers Work Mode on the task (the chooser opens with it chosen). */
  onStart?: ((t: Task) => void) | undefined;
}) {
  return (
    <section aria-label={`${title} tasks`}>
      <h3 className="text-xs font-semibold text-fg-muted">
        {title} ({tasks.length})
      </h3>
      {tasks.length === 0 ? (
        <p className="py-1 text-sm text-fg-muted">None.</p>
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
              <span className={`text-sm ${onComplete ? '' : 'text-fg-muted'}`}>{t.title}</span>
              {t.status === 'doing' && <span className="text-[10px] text-accent-ink">Now</span>}
              {onStart && (
                <IconButton
                  label={`Start work on: ${t.title}`}
                  icon={<Play aria-hidden className="size-3.5" />}
                  onClick={() => onStart(t)}
                  className="ml-auto"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* Milestones -------------------------------------------------------------- */

/** The add-milestone field, so “+ Milestone” elsewhere can bring you here. */
export const ADD_MILESTONE_FIELD = 'add-milestone-title';

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
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const { error, run } = useRun();
  const ids = { title: ADD_MILESTONE_FIELD, weight: useId(), due: useId(), rename: useId() };
  const watchArchived = useMemo(
    () => projects.watchArchivedMilestones(project.id),
    [projects, project.id],
  );
  const archived = useWatch(watchArchived);

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
      <ol aria-label="Milestones" className="divide-y divide-line border-y border-line">
        {milestones.length === 0 && (
          <li className="p-3 text-sm text-fg-muted">No milestones yet.</li>
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
              {renaming?.id === m.id ? (
                <form
                  className="inline-flex max-w-full items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const next = renaming.title.trim();
                    if (!next) return;
                    void run(() => projects.updateMilestone(m.id, { title: next })).then(
                      (ok) => ok && setRenaming(null),
                    );
                  }}
                >
                  <label htmlFor={ids.rename} className="sr-only">
                    New name for {m.title}
                  </label>
                  <input
                    id={ids.rename}
                    autoFocus
                    value={renaming.title}
                    onChange={(e) => setRenaming({ id: m.id, title: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                    className="h-7 min-w-0 rounded-md border border-line-strong bg-surface px-2 text-sm"
                  />
                  <Button size="sm" type="submit">
                    Save
                  </Button>
                </form>
              ) : (
                <span
                  className={`text-sm ${m.completedAt ? 'text-fg-muted line-through' : 'font-medium'}`}
                >
                  {m.title}
                </span>
              )}
              <span className="ml-2 text-xs text-fg-muted">
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
              label={`Rename: ${m.title}`}
              icon={<Pencil aria-hidden className="size-4" />}
              onClick={() => setRenaming({ id: m.id, title: m.title })}
            />
            <IconButton
              label={`Archive: ${m.title}`}
              icon={<Archive aria-hidden className="size-4" />}
              onClick={() => void run(() => projects.archiveMilestone(m.id))}
            />
            <IconButton
              label={`Remove: ${m.title}`}
              icon={<Trash2 aria-hidden className="size-4" />}
              onClick={() =>
                void run(
                  () => projects.removeMilestone(m.id),
                  'Tasks or items still refer to that milestone. Archive it instead.',
                )
              }
            />
          </li>
        ))}
      </ol>
      {archived.status === 'ready' && archived.data.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-fg-muted select-none hover:text-fg">
            Archived milestones · {archived.data.length}
          </summary>
          <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
            {archived.data.map((m) => (
              <li key={m.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 text-fg-muted">{m.title}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void run(() => projects.restoreMilestone(m.id))}
                >
                  <ArchiveRestore aria-hidden className="size-3.5" />
                  Restore {m.title}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
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
        <p className="text-xs text-fg-muted">
          Decisions are never edited; a newer one supersedes an older one.
        </p>
        {list.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">No decisions recorded yet.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {list.map((d) => (
              <li
                key={d.id}
                className={`border-b border-line py-4 first:pt-0 ${superseded.has(d.id) ? 'opacity-60' : ''}`}
              >
                <p className="text-sm font-medium">
                  {d.title}
                  {superseded.has(d.id) && (
                    <span className="ml-2 text-xs font-normal text-fg-muted">superseded</span>
                  )}
                </p>
                <p className="mt-0.5 text-sm">{d.decision}</p>
                {d.context && <p className="mt-1 text-xs text-fg-muted">Context: {d.context}</p>}
                <p className="mt-1 text-[11px] text-fg-muted">
                  <time dateTime={d.decidedAt} title={formatFull(d.decidedAt)}>
                    {formatWhen(d.decidedAt, new Date())}
                  </time>
                  {d.origin === 'accepted-proposal'
                    ? ' · proposed by an AI client, accepted by you'
                    : d.origin === 'ai-client'
                      ? ` · recorded by ${d.client ?? 'an AI client'}`
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
        className="max-w-2xl space-y-3 rounded-lg border border-line bg-raised p-4"
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
      <Notes project={project} />
      <p className="text-xs text-fg-muted">
        Notes and decisions also appear in the project’s workspace folder (
        <code>projects/{project.slug}/</code>): kept up to date by the companion, or in a workspace
        export.
      </p>
    </div>
  );
}

const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  note: 'Note',
  research: 'Research',
  handoff: 'Handoff',
  summary: 'Summary',
};

/** Project notes (ADR-056): yours and AI clients', newest first. Markdown, shown as written. */
function Notes({ project }: { project: Project }) {
  const { notes } = useRepositories();
  const watch = useMemo(() => notes.watchForProject(project.id), [notes, project.id]);
  const list = useWatch(watch);
  const [kind, setKind] = useState<NoteKind>('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const { error, run } = useRun();
  const ids = { kind: useId(), title: useId(), body: useId(), heading: useId() };

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    const ok = await run(() => notes.create(project.id, { kind, title, body }));
    if (ok) {
      setTitle('');
      setBody('');
    }
  }

  const items = list.status === 'ready' ? list.data : [];
  return (
    <section aria-labelledby={ids.heading} className="space-y-3">
      <h3 id={ids.heading} className="text-sm font-semibold">
        Notes
      </h3>
      {list.status === 'ready' && items.length === 0 && (
        <p className="text-sm text-fg-muted">No notes yet.</p>
      )}
      {items.length > 0 && (
        <ol className="space-y-2">
          {items.map((n) => (
            <li key={n.id} className="border-b border-line py-4 first:pt-0">
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  {n.title}{' '}
                  <span className="text-xs font-normal text-fg-muted">
                    {NOTE_KIND_LABEL[n.kind]} ·{' '}
                    {n.author === 'ai-client' ? `by ${n.client ?? 'an AI client'}` : 'by you'} ·{' '}
                    <time dateTime={n.createdAt} title={formatFull(n.createdAt)}>
                      {formatWhen(n.createdAt, new Date())}
                    </time>
                  </span>
                </summary>
                <pre className="mt-2 font-sans text-sm whitespace-pre-wrap">{n.body}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}
      <form
        aria-label="Add a note"
        onSubmit={(e) => void add(e)}
        className="max-w-2xl space-y-3 rounded-lg border border-line bg-raised p-4"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label htmlFor={ids.title} className={labelClass}>
              Note title
            </label>
            <input
              id={ids.title}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor={ids.kind} className={labelClass}>
              Kind
            </label>
            <select
              id={ids.kind}
              value={kind}
              onChange={(e) => setKind(e.target.value as NoteKind)}
              className={fieldClass}
            >
              {NOTE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {NOTE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor={ids.body} className={labelClass}>
            Text (Markdown)
          </label>
          <textarea
            id={ids.body}
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={fieldClass}
          />
        </div>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <Button type="submit" variant="primary">
          Add note
        </Button>
      </form>
    </section>
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
      <p className="text-sm text-fg-muted">
        No AI sessions yet. Only a connected AI client can report one.
      </p>
    );
  return (
    <ol className="space-y-2">
      {sessions.data.map((s) => (
        <li key={s.id} className="border-b border-line py-4 text-sm first:pt-0">
          <p className="font-medium">{s.client}</p>
          <p className="mt-0.5">{s.summary}</p>
          {s.result && <p className="mt-1 text-xs">Result: {s.result}</p>}
          {s.nextAction && <p className="mt-0.5 text-xs">Next: {s.nextAction}</p>}
          {s.commits?.length ? (
            <p className="mt-0.5 font-mono text-[11px] text-fg-muted">{s.commits.join(' ')}</p>
          ) : null}
          {s.handoff && (
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer text-fg-muted">Handoff</summary>
              <pre className="mt-1 font-sans whitespace-pre-wrap">{s.handoff}</pre>
            </details>
          )}
          <p className="mt-1 text-[11px] text-fg-muted">
            {formatWhen(s.startedAt, new Date())} · scope {s.scope}
          </p>
        </li>
      ))}
    </ol>
  );
}

/* History ----------------------------------------------------------------- */

export function HistoryTab({ project }: { project: Project }) {
  return (
    <div className="grid gap-x-14 gap-y-10 2xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,1fr)]">
      <section aria-labelledby="ledger-heading">
        <h2 id="ledger-heading" className="text-section font-semibold">
          Timeline
        </h2>
        <p className="mt-1 mb-4 text-xs text-fg-muted">
          Everything that happened in {project.name}, newest first, from the timeline ledger.
        </p>
        <Timeline projectId={project.id} limit={200} showProject={false} />
      </section>
      <Provenance project={project} />
    </div>
  );
}

const ENTITY_WORD: Partial<Record<string, [string, string]>> = {
  project: ['project record', 'project records'],
  milestone: ['milestone', 'milestones'],
  task: ['task', 'tasks'],
  projectItem: ['board item', 'board items'],
  decision: ['decision', 'decisions'],
};

/**
 * The import and reconciliation trail: what was brought in from another
 * system and when, grouped by run. An audit record, never activity: none of
 * it colours a square or appears in the timeline.
 */
function Provenance({ project }: { project: Project }) {
  const { space } = useRepositories();
  const watch = useMemo(() => space.watchProjectSources(project.id), [space, project.id]);
  const sources = useWatch(watch);
  if (sources.status !== 'ready' || sources.data.length === 0) return null;
  const runs = new Map<string, typeof sources.data>();
  for (const s of sources.data) {
    const key = s.importedAt.slice(0, 10);
    runs.set(key, [...(runs.get(key) ?? []), s]);
  }
  const now = new Date();
  return (
    <section aria-labelledby="provenance-heading">
      <h2 id="provenance-heading" className="text-section font-semibold">
        Imported and reconciled
      </h2>
      <p className="mt-1 mb-4 text-xs text-fg-muted">
        Records brought in from Notion, read-only. Not counted as activity.
      </p>
      <ol className="space-y-5">
        {[...runs].map(([dayKey, list]) => {
          const counts = new Map<string, number>();
          for (const s of list.filter((s) => s.role === 'canonical')) {
            counts.set(s.entityType, (counts.get(s.entityType) ?? 0) + 1);
          }
          const onlyMilestones = counts.size === 1 && counts.has('milestone');
          const milestones = list.filter(
            (s) => s.entityType === 'milestone' && s.role === 'canonical',
          );
          return (
            <li key={dayKey} className="border-l border-line pl-4">
              <p className="text-sm font-medium">
                <time dateTime={list[0]!.importedAt} title={formatFull(list[0]!.importedAt)}>
                  {formatWhen(list[0]!.importedAt, now)}
                </time>
                {onlyMilestones
                  ? ' · Milestones reconciled from Notion'
                  : ' · Imported from Notion'}
              </p>
              <p className="mt-0.5 text-sm text-fg-muted">
                {[...counts]
                  .map(([type, n]) => {
                    const word = ENTITY_WORD[type] ?? [type, type];
                    return `${n} ${n === 1 ? word[0] : word[1]}`;
                  })
                  .join(', ') || 'Provenance links only'}
              </p>
              {milestones.length > 0 && (
                <details className="mt-1 text-xs text-fg-muted">
                  <summary className="cursor-pointer hover:text-fg">Source rows</summary>
                  <ul className="mt-1 space-y-0.5">
                    {milestones.map((m) => (
                      <li key={m.id}>{m.originalTitle}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
