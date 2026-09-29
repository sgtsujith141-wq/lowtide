import { ArrowLeft, Clock, Pencil, Play } from 'lucide-react';
import { useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ContributionGrid } from '../../components/shared/ContributionGrid';
import { Chip, Stat } from '../../components/shared/visuals';
import { formatDuration } from '../../lib/duration';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import { formatWhen } from '../../lib/when';
import { PROJECT_STATES, type Project, type ProjectState } from '../../types/domain';
import { Timeline } from '../activity/Timeline';
import { consumeModeFocus, requestModeFocus } from '../modes/focus-intent';
import { useModes } from '../modes/useModes';
import { progressSeries, projectCalendar, weeklyMinutes } from './charts';
import { ContextPanel } from './room/ContextPanel';
import { Lanes } from './room/Lanes';
import {
  AiSessionsList,
  DocsTab,
  GithubTab,
  HistoryTab,
  MilestonesTab,
  TasksTab,
} from './room/tabs';
import { CompletionRing, MilestonePipeline, ProgressChart, TimeChart } from './room/visuals';
import { STATE_LABEL, STATE_TONE, summariseProject } from './summary';

const TABS = ['Overview', 'Tasks', 'Milestones', 'Docs', 'AI', 'GitHub', 'History'] as const;
type Tab = (typeof TABS)[number];

/**
 * The Project Command Room: answers at a glance how far along a project is,
 * what's happening now and next, what waits, what needs you, what's blocked
 * or parked, what's done, where the time goes, and whether it has moved.
 */
export function ProjectRoom() {
  const { slug = '' } = useParams();
  const { projects } = useRepositories();
  const watch = useMemo(() => projects.watchBySlug(slug), [projects, slug]);
  const project = useWatch(watch);
  useDocumentTitle(project.status === 'ready' && project.data ? project.data.name : 'Project');

  if (project.status === 'loading') return <h1 className="sr-only">Project</h1>;
  if (project.status === 'error' || !project.data)
    return (
      <>
        <h1 className="font-serif text-xl font-semibold">Project not found</h1>
        <p className="mt-2 text-sm">
          <Link to="/projects" className="text-accent-ink hover:underline">
            Back to projects
          </Link>
        </p>
      </>
    );
  return <Room project={project.data} />;
}

function Room({ project }: { project: Project }) {
  const today = useToday();
  const { projects, work, events } = useRepositories();
  const w = useMemo(
    () => ({
      milestones: projects.watchMilestones(project.id),
      items: projects.watchItems(project.id),
      tasks: projects.watchTasks(project.id),
      snapshots: projects.watchSnapshots(project.id),
      sessions: work.watchForProject(project.id),
      events: events.watchRecent({ projectId: project.id }),
    }),
    [projects, work, events, project.id],
  );
  const milestones = useWatch(w.milestones);
  const items = useWatch(w.items);
  const tasks = useWatch(w.tasks);
  const snapshots = useWatch(w.snapshots);
  const sessions = useWatch(w.sessions);
  const ledger = useWatch(w.events);
  const [tab, setTab] = useState<Tab>('Overview');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();

  const ready =
    milestones.status === 'ready' &&
    items.status === 'ready' &&
    tasks.status === 'ready' &&
    snapshots.status === 'ready' &&
    sessions.status === 'ready' &&
    ledger.status === 'ready';

  const summary = ready
    ? summariseProject(project, milestones.data, items.data, tasks.data, sessions.data, today)
    : null;

  function onTabKey(event: KeyboardEvent, index: number) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? TABS.length - 1
          : (index + delta + TABS.length) % TABS.length;
    setTab(TABS[next]!);
    tabRefs.current[next]?.focus();
  }

  return (
    <>
      <p className="text-sm">
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
        >
          <ArrowLeft aria-hidden className="size-3.5" /> Projects
        </Link>
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">{project.name}</h1>
        <Chip tone={STATE_TONE[project.state]}>{STATE_LABEL[project.state]}</Chip>
        {project.phase && <span className="text-sm text-ink-muted">Phase: {project.phase}</span>}
        <StartHere project={project} />
        <StateSelect project={project} />
      </div>

      <div
        role="tablist"
        aria-label="Project sections"
        className="relative mt-5 flex gap-1 overflow-x-auto border-b border-line"
      >
        {TABS.map((t, i) => (
          <button
            key={t}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`${baseId}-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm ${
              tab === t
                ? 'border-projects-3 font-semibold text-ink'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${tab}`}
        className="pt-5"
      >
        {!summary || !ready ? null : tab === 'Overview' ? (
          <div className="space-y-8">
            <section aria-label="At a glance" className="flex flex-wrap items-center gap-6">
              <CompletionRing
                percent={summary.completion?.percent ?? null}
                label={
                  summary.completion
                    ? `${summary.completion.percent}% complete by milestone weight`
                    : 'No milestones yet, so no percentage'
                }
              />
              <div className="min-w-0 flex-1 space-y-3">
                <ProjectSummaryCard project={project} />
                <div className="flex flex-wrap gap-6">
                  <Stat value={formatDuration(summary.minutesThisWeek)} label="this week" />
                  <Stat value={formatDuration(summary.minutesTotal)} label="all time" />
                  <Stat
                    value={`${summary.milestones.filter((m) => m.completedAt).length}/${summary.milestones.length}`}
                    label="milestones"
                  />
                  <Stat
                    value={
                      <span className="text-base font-normal">
                        {formatWhen(summary.lastUpdate, new Date())}
                      </span>
                    }
                    label="last moved"
                  />
                </div>
              </div>
            </section>

            {summary.milestones.length > 0 && (
              <section aria-labelledby={`${baseId}-pipeline`}>
                <h2 id={`${baseId}-pipeline`} className="mb-2 text-sm font-medium text-ink-muted">
                  Milestones
                </h2>
                <MilestonePipeline milestones={summary.milestones} />
              </section>
            )}

            <section aria-labelledby={`${baseId}-lanes`}>
              <h2 id={`${baseId}-lanes`} className="mb-2 text-sm font-medium text-ink-muted">
                Command board
              </h2>
              <Lanes
                projectId={project.id}
                lanes={summary.lanes}
                items={items.data}
                tasks={tasks.data}
              />
            </section>

            <div className="grid gap-4 md:grid-cols-2">
              <section
                aria-labelledby={`${baseId}-progress`}
                className="rounded-lg border border-line bg-paper-raised p-3"
              >
                <h2 id={`${baseId}-progress`} className="mb-2 text-sm font-medium">
                  Progress over time
                </h2>
                <ProgressChart points={progressSeries(snapshots.data, today)} />
              </section>
              <section
                aria-labelledby={`${baseId}-time`}
                className="rounded-lg border border-line bg-paper-raised p-3"
              >
                <h2
                  id={`${baseId}-time`}
                  className="mb-2 flex items-center gap-1.5 text-sm font-medium"
                >
                  <Clock aria-hidden className="size-3.5" /> Time invested
                </h2>
                <TimeChart weeks={weeklyMinutes(sessions.data, today)} />
              </section>
            </div>

            <section
              aria-labelledby={`${baseId}-calendar`}
              className="rounded-lg border border-line bg-paper-raised p-3"
            >
              <h2 id={`${baseId}-calendar`} className="mb-1 text-sm font-medium">
                Project activity
              </h2>
              <ContributionGrid
                label={`${project.name} activity, last 12 months`}
                today={today}
                days={projectCalendar(ledger.data, sessions.data)}
                palette="projects"
              />
            </section>

            <section aria-labelledby={`${baseId}-recent`}>
              <h2 id={`${baseId}-recent`} className="mb-3 text-sm font-medium text-ink-muted">
                Recent activity
              </h2>
              <Timeline projectId={project.id} limit={10} showProject={false} />
            </section>
          </div>
        ) : tab === 'Tasks' ? (
          <TasksTab project={project} tasks={tasks.data} />
        ) : tab === 'Milestones' ? (
          <MilestonesTab project={project} milestones={milestones.data} />
        ) : tab === 'Docs' ? (
          <DocsTab project={project} />
        ) : tab === 'AI' ? (
          <div className="space-y-6">
            <ContextPanel project={project} />
            <section aria-label="AI sessions">
              <h3 className="mb-2 text-sm font-semibold">AI sessions</h3>
              <AiSessionsList project={project} />
            </section>
          </div>
        ) : tab === 'GitHub' ? (
          <GithubTab project={project} />
        ) : (
          <HistoryTab project={project} />
        )}
      </div>
    </>
  );
}

/** Starts a project work session from the room (ADR-049); hidden while any mode runs. */
function StartHere({ project }: { project: Project }) {
  const { work } = useRepositories();
  const modes = useModes();
  const [error, setError] = useState(false);
  if (!modes.ready || modes.work || modes.offTime || project.state === 'archived') return null;
  return (
    <span>
      <Button
        onClick={() => {
          setError(false);
          requestModeFocus();
          work.start({ kind: 'project', projectId: project.id }).catch(() => {
            consumeModeFocus();
            setError(true);
          });
        }}
      >
        <Play aria-hidden className="size-3.5" /> Start work here
      </Button>
      {error && <ErrorNotice>Couldn’t start work. Nothing changed.</ErrorNotice>}
    </span>
  );
}

function StateSelect({ project }: { project: Project }) {
  const { projects } = useRepositories();
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <span className="ml-auto flex flex-col items-end">
      <label htmlFor={id} className="sr-only">
        Project state
      </label>
      <select
        id={id}
        value={project.state}
        onChange={(e) => {
          setError(null);
          projects
            .setState(project.id, e.target.value as ProjectState)
            .catch((err: unknown) =>
              setError(
                err instanceof Error && /milestone/.test(err.message)
                  ? 'Open milestones remain. Complete them, or record a decision in Docs first.'
                  : 'That state change isn’t allowed.',
              ),
            );
        }}
        className="h-8 rounded-md border border-line bg-paper-raised px-2 text-sm"
      >
        {PROJECT_STATES.map((s) => (
          <option key={s} value={s}>
            {STATE_LABEL[s]}
          </option>
        ))}
      </select>
      {error && <ErrorNotice>{error}</ErrorNotice>}
    </span>
  );
}

/** Objective, phase, next action and repository: compact, editable in place. */
function ProjectSummaryCard({ project }: { project: Project }) {
  const { projects } = useRepositories();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    objective: project.objective ?? '',
    phase: project.phase ?? '',
    nextAction: project.nextAction ?? '',
    repoUrl: project.repoUrl ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const ids = { objective: useId(), phase: useId(), next: useId(), repo: useId() };

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await projects.update(project.id, draft);
      setEditing(false);
    } catch {
      setError('Couldn’t save. Nothing changed.');
    }
  }

  if (!editing)
    return (
      <div className="text-sm">
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[7rem_1fr]">
          <dt className="text-ink-muted">Objective</dt>
          <dd>{project.objective ?? <span className="text-ink-faint">Not set</span>}</dd>
          <dt className="text-ink-muted">Next action</dt>
          <dd className="font-medium">
            {project.nextAction ?? <span className="font-normal text-ink-faint">Not set</span>}
          </dd>
        </dl>
        <button
          type="button"
          onClick={() => {
            setDraft({
              objective: project.objective ?? '',
              phase: project.phase ?? '',
              nextAction: project.nextAction ?? '',
              repoUrl: project.repoUrl ?? '',
            });
            setEditing(true);
          }}
          className="mt-1 inline-flex items-center gap-1 text-xs text-accent-ink hover:underline"
        >
          <Pencil aria-hidden className="size-3" /> Edit details
        </button>
      </div>
    );

  const field = (key: keyof typeof draft, id: string, label: string) => (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        className={fieldClass}
      />
    </div>
  );

  return (
    <form
      aria-label="Project details"
      onSubmit={(e) => void save(e)}
      className="grid max-w-xl gap-3 rounded-lg border border-line bg-paper-raised p-3"
    >
      {field('objective', ids.objective, 'Objective')}
      {field('phase', ids.phase, 'Current phase')}
      {field('nextAction', ids.next, 'Next meaningful action')}
      {field('repoUrl', ids.repo, 'Repository URL (informational)')}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          Save
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
