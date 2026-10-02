import { ArrowLeft, Pencil } from 'lucide-react';
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Link, useParams } from 'react-router';
import { ContributionGrid } from '../../components/shared/ContributionGrid';
import { Drawer } from '../../components/layout';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass, tabClass } from '../../components/ui/styles';
import { useCountUp } from '../../hooks/useCountUp';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useNow } from '../../hooks/useNow';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import { startOfWeek } from '../../lib/calendar';
import { formatFull, formatWhen } from '../../lib/when';
import {
  PROJECT_FOCUS,
  PROJECT_STATES,
  type Milestone,
  type Project,
  type ProjectFocus,
  type ProjectState,
} from '../../types/domain';
import { activityLine } from './activity';
import { progressSeries, projectCalendar, weeklyMinutes } from './charts';
import { concise, healthOf, milestoneCount, nowNext } from './display';
import { ContextPanel } from './room/ContextPanel';
import { DocsPreview } from './room/DocsPreview';
import { Lanes } from './room/Lanes';
import { ProjectActivity } from './room/ProjectActivity';
import { MilestoneDrawer, MilestoneLine, Roadmap } from './room/Roadmap';
import { StartWork } from './room/StartWork';
import { AiSessionsList, DocsTab, HistoryTab, MilestonesTab, TasksTab } from './room/tabs';
import { ProgressHistory, TimeInvested } from './room/visuals';
import { WorkPlane } from './room/WorkPlane';
import { FOCUS_LABEL, STATE_LABEL, summariseProject, type ProjectSummary } from './summary';
import { activeMinutes } from '../work/duration';

const TABS = ['Overview', 'Work', 'Tasks', 'Milestones', 'Docs', 'AI', 'History'] as const;
type Tab = (typeof TABS)[number];

/** Weeks of project activity on the gold grid: about six months. */
const GRID_WEEKS = 26;

/**
 * The Project Command Room (v2 PHASE 013). Entering a project opens its
 * operating room: what it is, its state and priority, how far it is by
 * milestone weight, the roadmap with the current stage marked, and Start
 * Work, before any tabs. Below: the work plane, what needs you, the project
 * summary, progress and time from real records, its own activity grid and a
 * timeline of what actually moved it.
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
        <h1 className="text-page font-semibold">Project not found</h1>
        <p className="mt-2 text-sm">
          <Link to="/projects" className="text-accent-ink underline underline-offset-2">
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
  const [openMilestone, setOpenMilestone] = useState<Milestone | null>(null);

  if (
    milestones.status !== 'ready' ||
    items.status !== 'ready' ||
    tasks.status !== 'ready' ||
    snapshots.status !== 'ready' ||
    sessions.status !== 'ready' ||
    ledger.status !== 'ready'
  )
    return <h1 className="sr-only">Project</h1>;

  const summary = summariseProject(
    project,
    milestones.data,
    items.data,
    tasks.data,
    sessions.data,
    today,
  );

  return (
    <>
      <p className="text-sm">
        <Link to="/projects" className="inline-flex items-center gap-1 text-fg-muted hover:text-fg">
          <ArrowLeft aria-hidden className="size-3.5" /> Projects
        </Link>
      </p>

      <Hero summary={summary} tasks={tasks.data} />

      <section aria-label="Progress" className="mt-8">
        <Progress summary={summary} />
        {summary.milestones.length > 0 && (
          <div className="mt-8">
            <h2 className="sr-only">Roadmap</h2>
            <Roadmap milestones={summary.milestones} onOpen={setOpenMilestone} />
          </div>
        )}
      </section>

      <SummaryStrip summary={summary} ledger={ledger.data} />

      <SubNav tab={tab} onChange={setTab}>
        {tab === 'Overview' ? (
          <div className="grid gap-x-14 gap-y-12 2xl:grid-cols-[minmax(0,1.65fr)_minmax(22rem,1fr)]">
            <div className="min-w-0 space-y-12">
              <section aria-labelledby="work-heading">
                <h2 id="work-heading" className="mb-4 text-section font-semibold">
                  Work
                </h2>
                <WorkPlane summary={summary} items={items.data} onOpenWork={() => setTab('Work')} />
              </section>
            </div>
            <aside aria-label="Progress and time" className="min-w-0 space-y-10">
              <section aria-labelledby="history-heading">
                <h2 id="history-heading" className="mb-3 text-section font-semibold">
                  Progress over time
                </h2>
                <ProgressHistory
                  points={progressSeries(snapshots.data, today)}
                  current={summary.completion?.percent ?? null}
                  today={today}
                />
              </section>
              <section aria-labelledby="time-heading">
                <h2 id="time-heading" className="mb-3 text-section font-semibold">
                  Time invested
                </h2>
                {sessions.data.some((s) => s.endedAt) ? (
                  <TimeInvested
                    weeks={weeklyMinutes(sessions.data, today)}
                    thisWeek={sessions.data
                      .filter((s) => s.endedAt && s.localDate >= startOfWeek(today))
                      .reduce((sum, s) => sum + activeMinutes(s), 0)}
                    total={sessions.data
                      .filter((s) => s.endedAt)
                      .reduce((sum, s) => sum + activeMinutes(s), 0)}
                  />
                ) : (
                  <p className="text-sm text-fg-muted">No work sessions on this project yet.</p>
                )}
              </section>
            </aside>
            <section aria-labelledby="activity-heading" className="2xl:col-span-2">
              <h2 id="activity-heading" className="mb-4 text-section font-semibold">
                Activity
              </h2>
              <div className="grid gap-x-14 gap-y-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <ContributionGrid
                    label={`${project.name} activity, last 6 months`}
                    today={today}
                    weeks={GRID_WEEKS}
                    size="lg"
                    minCell={10}
                    days={projectCalendar(ledger.data, sessions.data)}
                    palette="projects"
                    emptyLabel="no project activity"
                  />
                  <p className="mt-2 text-xs text-fg-muted">
                    Work sessions and project changes recorded in LOWTIDE. Imported plans never
                    colour a square.
                  </p>
                </div>
                <div className="min-w-0">
                  <ProjectActivity project={project} sessions={sessions.data} today={today} />
                </div>
              </div>
            </section>
          </div>
        ) : tab === 'Work' ? (
          <Lanes
            projectId={project.id}
            lanes={summary.lanes}
            items={items.data}
            tasks={tasks.data}
          />
        ) : tab === 'Tasks' ? (
          <TasksTab project={project} tasks={tasks.data} />
        ) : tab === 'Milestones' ? (
          <MilestonesTab project={project} milestones={milestones.data} />
        ) : tab === 'Docs' ? (
          <div className="space-y-12">
            <section aria-labelledby="space-docs">
              <h2 id="space-docs" className="mb-4 text-section font-semibold">
                Documents
              </h2>
              <DocsPreview project={project} />
            </section>
            <DocsTab project={project} />
          </div>
        ) : tab === 'AI' ? (
          <div className="space-y-6">
            <ContextPanel project={project} />
            <section aria-label="AI sessions">
              <h3 className="mb-2 text-sm font-semibold">AI sessions</h3>
              <AiSessionsList project={project} />
            </section>
          </div>
        ) : (
          <HistoryTab project={project} />
        )}
      </SubNav>

      <MilestoneDrawer
        milestone={openMilestone}
        milestones={summary.milestones}
        tasks={tasks.data}
        onClose={() => setOpenMilestone(null)}
      />
    </>
  );
}

/** Name, identity, state and priority, and Start Work. */
function Hero({
  summary,
  tasks,
}: {
  summary: ProjectSummary;
  tasks: Parameters<typeof StartWork>[0]['tasks'];
}) {
  const project = summary.project;
  const identity = project.objective ?? project.phase;
  return (
    <header className="mt-3 flex flex-wrap items-start justify-between gap-x-10 gap-y-5">
      <div className="min-w-0 max-w-4xl">
        <h1 className="text-[34px] leading-[1.1] font-semibold tracking-tight sm:text-[40px]">
          {project.name}
        </h1>
        {identity && (
          <p
            className="mt-2 line-clamp-2 text-[15px] leading-relaxed text-fg-muted"
            title={identity}
          >
            {identity}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StateControl project={project} />
          <FocusControl project={project} />
        </div>
      </div>
      <StartWork summary={summary} tasks={tasks} />
    </header>
  );
}

/** The large milestone-derived figure and its line. */
function Progress({ summary }: { summary: ProjectSummary }) {
  const percent = summary.completion?.percent ?? 0;
  const shown = useCountUp(percent);
  if (!summary.completion)
    return (
      <p className="text-sm text-fg-muted">
        No milestones yet. Progress comes only from milestones.
      </p>
    );
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-10">
      <p className="shrink-0">
        <span className="figure text-[64px] leading-none font-semibold text-projects-4" aria-hidden>
          {shown}
          <span className="text-[32px]">%</span>
        </span>
        <span className="mt-1 block text-sm text-fg-muted">
          {milestoneCount(summary.milestones)}
          {summary.milestones.some((m) => m.weight !== 1) ? ', by weight' : ''}
        </span>
      </p>
      <div className="min-w-0 flex-1 lg:pb-7">
        <MilestoneLine
          milestones={summary.milestones}
          percent={percent}
          size="lg"
          label={`${summary.project.name}: ${percent}% of milestone weight done`}
        />
      </div>
    </div>
  );
}

/** The living summary: five facts, no prose. */
function SummaryStrip({
  summary,
  ledger,
}: {
  summary: ProjectSummary;
  ledger: Parameters<typeof projectCalendar>[0];
}) {
  const project = summary.project;
  const now = useNow(true, 60_000);
  const [editing, setEditing] = useState(false);
  const { next } = nowNext(summary);
  const health = healthOf(summary);
  const lastEvent = ledger
    .map((event) => activityLine({ event }, project.name, new Map()))
    .find((l) => l !== null);
  const phase = summary.currentMilestone?.title ?? project.phase;
  const nextAction = project.nextAction ?? next;
  return (
    <section aria-labelledby="summary-heading" className="mt-10 border-y border-line py-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="summary-heading" className="text-xs font-semibold text-fg-muted">
          Project summary
        </h2>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
        >
          <Pencil aria-hidden className="size-3" /> Edit details
        </button>
      </div>
      <dl className="mt-3 grid gap-x-10 gap-y-4 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryFact label="Objective" value={project.objective} empty="Not set" />
        <SummaryFact
          label={summary.currentMilestone ? 'Current stage' : 'Current phase'}
          value={phase}
          empty="Not set"
        />
        <div className="min-w-0">
          <dt className="text-xs text-fg-muted">Last meaningful change</dt>
          <dd className="mt-0.5 text-sm leading-snug">
            {lastEvent ? (
              <>
                {lastEvent.text}{' '}
                <time
                  dateTime={lastEvent.entry.event.at}
                  title={formatFull(lastEvent.entry.event.at)}
                  className="text-fg-muted"
                >
                  · {formatWhen(lastEvent.entry.event.at, now)}
                </time>
              </>
            ) : (
              <>
                Record updated{' '}
                <time dateTime={summary.lastUpdate} title={formatFull(summary.lastUpdate)}>
                  {formatWhen(summary.lastUpdate, now)}
                </time>
              </>
            )}
          </dd>
        </div>
        <SummaryFact label="Next meaningful action" value={nextAction} empty="Not set" />
        <div className="min-w-0">
          <dt className="text-xs text-fg-muted">Health</dt>
          <dd
            className={`mt-0.5 text-sm leading-snug ${health.tone === 'attention' ? 'font-medium text-warn' : health.tone === 'quiet' ? 'text-fg-muted' : ''}`}
          >
            {health.text}
          </dd>
        </div>
      </dl>
      <Drawer open={editing} onClose={() => setEditing(false)} title="Project details">
        {editing && <DetailsForm project={project} onDone={() => setEditing(false)} />}
      </Drawer>
    </section>
  );
}

function SummaryFact({
  label,
  value,
  empty,
}: {
  label: string;
  value?: string | undefined;
  empty: string;
}) {
  const c = value ? concise(value, undefined, 90) : null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd
        className={`mt-0.5 text-sm leading-snug ${c ? '' : 'text-fg-muted'}`}
        title={c?.shortened ? c.full : undefined}
      >
        {c ? c.text : empty}
      </dd>
    </div>
  );
}

/** The restrained sub-navigation, with an underline that glides to the current tab. */
function SubNav({
  tab,
  onChange,
  children,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  children: React.ReactNode;
}) {
  const baseId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = refs.current[TABS.indexOf(tab)];
    if (el) setBar({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab]);

  function onKey(event: KeyboardEvent, index: number) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? TABS.length - 1
          : (index + delta + TABS.length) % TABS.length;
    onChange(TABS[next]!);
    refs.current[next]?.focus();
  }

  return (
    <div className="mt-10">
      <div
        role="tablist"
        aria-label="Project sections"
        className="relative flex overflow-x-auto border-b border-line"
      >
        {TABS.map((t, i) => (
          <button
            key={t}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`${baseId}-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => onChange(t)}
            onKeyDown={(e) => onKey(e, i)}
            className={`${tabClass(tab === t)} ${bar ? 'border-transparent' : ''}`}
          >
            {t}
          </button>
        ))}
        {bar && (
          <span
            aria-hidden
            className="absolute bottom-0 h-0.5 bg-fg transition-[left,width] duration-300 ease-[var(--ease-tide)]"
            style={{ left: bar.left, width: bar.width }}
          />
        )}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${tab}`}
        className="pt-8"
      >
        {children}
      </div>
    </div>
  );
}

const chipSelect =
  'h-7 cursor-pointer appearance-none rounded-full border border-line-strong bg-raised pr-7 pl-3 text-xs font-medium text-fg hover:bg-hover bg-[length:12px] bg-[right_0.6rem_center] bg-no-repeat';
const chevron = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
};

/** Project state as a compact control; Done is refused while milestones are open. */
function StateControl({ project }: { project: Project }) {
  const { projects } = useRepositories();
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const attention = project.state === 'blocked' || project.state === 'needs_approval';
  return (
    <span className="inline-flex flex-col">
      <label htmlFor={id} className="sr-only">
        Project state
      </label>
      <select
        id={id}
        value={project.state}
        style={chevron}
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
        className={`${chipSelect} ${attention ? 'border-warn/60 text-warn' : ''}`}
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

/** Portfolio focus (ADR-064): a viewing priority, not project movement. */
function FocusControl({ project }: { project: Project }) {
  const { projects } = useRepositories();
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <span className="inline-flex flex-col">
      <label htmlFor={id} className="sr-only">
        Focus
      </label>
      <select
        id={id}
        value={project.focus ?? ''}
        style={chevron}
        onChange={(e) => {
          setError(null);
          projects
            .setFocus(project.id, (e.target.value || null) as ProjectFocus | null)
            .catch(() => setError('Couldn’t change the focus. Nothing changed.'));
        }}
        className={`${chipSelect} ${project.focus === 'primary' ? 'border-projects-3/70 text-projects-4' : ''}`}
      >
        <option value="">Focus: not set</option>
        {PROJECT_FOCUS.map((f) => (
          <option key={f} value={f}>
            {FOCUS_LABEL[f]}
          </option>
        ))}
      </select>
      {error && <ErrorNotice>{error}</ErrorNotice>}
    </span>
  );
}

/** Objective, phase, next action and repository, edited in a side panel. */
function DetailsForm({ project, onDone }: { project: Project; onDone: () => void }) {
  const { projects } = useRepositories();
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
      onDone();
    } catch {
      setError('Couldn’t save. Nothing changed.');
    }
  }

  const field = (key: keyof typeof draft, id: string, label: string, long = false) => (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {long ? (
        <textarea
          id={id}
          rows={3}
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          className={fieldClass}
        />
      ) : (
        <input
          id={id}
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          className={fieldClass}
        />
      )}
    </div>
  );

  return (
    <form aria-label="Project details" onSubmit={(e) => void save(e)} className="grid gap-4">
      {field('objective', ids.objective, 'Objective', true)}
      {field('phase', ids.phase, 'Current phase', true)}
      {field('nextAction', ids.next, 'Next meaningful action', true)}
      {field('repoUrl', ids.repo, 'Repository URL (informational)')}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          Save
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
