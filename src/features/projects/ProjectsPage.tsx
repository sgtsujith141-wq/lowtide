import { AlertOctagon, ArrowRight, Hand, Hourglass, Plus } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '../../components/layout';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import { useCreateRequest } from '../../hooks/useCreateRequest';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useNow } from '../../hooks/useNow';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import { formatDuration } from '../../lib/duration';
import { formatWhen } from '../../lib/when';
import { FOCUS_RANK, STATE_RANK } from '../home/model';
import { concise, milestoneCount, nowNext, TIER_LABEL, TIERS, tierOf, type Tier } from './display';
import { MilestoneLine, RoadmapInline } from './room/Roadmap';
import { STATE_LABEL, type ProjectSummary } from './summary';
import { useProjectSummaries } from './useProjectSummaries';

/**
 * Projects (v2 PHASE 013): the whole portfolio on one page, in the owner's
 * order of focus. No card gallery: each project is a full-width row that
 * answers what it is, its state, how far it is, where on its roadmap, what's
 * happening now and next, whether it needs you, and when it last moved.
 * The primary project reads largest; projects not current are one quiet line.
 */
export function ProjectsPage() {
  useDocumentTitle('Projects');
  const today = useToday();
  const now = useNow(true, 60_000);
  const data = useProjectSummaries(today);
  const { projects } = useRepositories();
  const all = useWatch(projects.watchAll);
  const [adding, setAdding] = useState(false);
  useCreateRequest(() => setAdding(true));
  const finished =
    all.status === 'ready'
      ? all.data.filter((p) => p.state === 'done' || p.state === 'archived')
      : [];

  const groups = new Map<Tier, ProjectSummary[]>();
  for (const s of data?.summaries ?? []) {
    const tier = tierOf(s.project);
    groups.set(tier, [...(groups.get(tier) ?? []), s]);
  }
  for (const list of groups.values()) {
    list.sort(
      (a, b) =>
        FOCUS_RANK[a.project.focus ?? 'unset'] - FOCUS_RANK[b.project.focus ?? 'unset'] ||
        STATE_RANK[a.project.state] - STATE_RANK[b.project.state] ||
        b.lastUpdate.localeCompare(a.lastUpdate) ||
        a.project.name.localeCompare(b.project.name),
    );
  }

  return (
    <>
      <PageHeader
        title="Projects"
        actions={
          <Button variant="primary" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            <Plus aria-hidden className="size-4" /> New project
          </Button>
        }
      />
      {adding && <NewProjectForm onCancel={() => setAdding(false)} />}

      {data &&
        (data.summaries.length === 0 ? (
          <p className="mt-6 text-sm text-fg-muted">No active projects yet.</p>
        ) : (
          <div className="mt-8 space-y-12">
            {TIERS.filter((t) => groups.has(t)).map((tier) => (
              <TierSection key={tier} tier={tier} summaries={groups.get(tier)!} now={now} />
            ))}
          </div>
        ))}

      {finished.length > 0 && (
        <details className="mt-14 border-t border-line pt-4">
          <summary className="cursor-pointer text-sm text-fg-muted">
            Done and archived ({finished.length})
          </summary>
          <ul className="mt-2 divide-y divide-line">
            {finished.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link to={`/projects/${p.slug}`} className="hover:underline">
                  {p.name}
                </Link>
                <span className="text-fg-muted">{STATE_LABEL[p.state]}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

const QUIET_TIERS: readonly Tier[] = ['later', 'other'];

function TierSection({
  tier,
  summaries,
  now,
}: {
  tier: Tier;
  summaries: ProjectSummary[];
  now: Date;
}) {
  const headingId = useId();
  const quiet = QUIET_TIERS.includes(tier);
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-x-10 gap-y-2 xl:grid-cols-[9rem_minmax(0,1fr)]"
    >
      <h2
        id={headingId}
        className={`text-sm font-medium xl:pt-1 ${tier === 'primary' ? 'text-projects-4' : 'text-fg-muted'}`}
      >
        {TIER_LABEL[tier]}
      </h2>
      <ul
        className={
          tier === 'supporting' || tier === 'unsorted'
            ? 'grid gap-x-12 border-t border-line 2xl:grid-cols-2'
            : 'border-t border-line'
        }
      >
        {summaries.map((s) =>
          quiet ? (
            <QuietRow key={s.project.id} summary={s} now={now} />
          ) : (
            <PortfolioRow key={s.project.id} summary={s} tier={tier} now={now} />
          ),
        )}
      </ul>
    </section>
  );
}

function PortfolioRow({
  summary: s,
  tier,
  now,
}: {
  summary: ProjectSummary;
  tier: Tier;
  now: Date;
}) {
  const { now: current, next } = nowNext(s);
  const name = s.project.name;
  const needs = [
    ...s.lanes.needs_approval.map((e) => ({ kind: 'approval' as const, title: e.title })),
    ...s.lanes.blocked.map((e) => ({ kind: 'blocker' as const, title: e.title })),
  ];
  const waiting = s.lanes.waiting.length;
  const large = tier === 'primary';
  const medium = tier === 'secondary';
  return (
    <li className={`border-b border-line ${large ? 'py-8' : medium ? 'py-7' : 'py-6'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3
          className={`font-semibold tracking-tight ${large ? 'text-[28px] leading-tight' : medium ? 'text-[22px] leading-tight' : 'text-lg'}`}
        >
          <Link to={`/projects/${s.project.slug}`} className="hover:underline">
            {name}
          </Link>
        </h3>
        <p className="text-sm text-fg-muted">
          <span
            className={
              s.project.state === 'blocked' || s.project.state === 'needs_approval'
                ? 'text-warn'
                : ''
            }
          >
            {STATE_LABEL[s.project.state]}
          </span>
        </p>
      </div>

      {s.completion ? (
        <div className={large ? 'mt-5' : 'mt-4'}>
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <MilestoneLine
                milestones={s.milestones}
                percent={s.completion.percent}
                size={large ? 'lg' : 'md'}
                label={`${name}: ${s.completion.percent}% of milestone weight done`}
              />
            </div>
            <span
              className={`figure shrink-0 font-semibold text-projects-4 ${large ? 'text-2xl' : 'text-lg'}`}
            >
              {s.completion.percent}%
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <RoadmapInline milestones={s.milestones} />
            <span className="text-xs text-fg-muted">{milestoneCount(s.milestones)}</span>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">No milestones yet, so no percentage.</p>
      )}

      <div
        className={`grid gap-x-10 gap-y-4 sm:grid-cols-2 ${large || medium ? 'mt-6 lg:grid-cols-[1fr_1fr_1.2fr_auto]' : 'mt-5 lg:grid-cols-[1fr_1fr_1.2fr_auto] 2xl:grid-cols-[1fr_1fr_auto]'}`}
      >
        <Fact label="Now" value={current} empty="Nothing in progress" />
        <Fact label="Next" value={next} empty="No next step recorded" />
        <div className={`min-w-0 ${large || medium ? '' : '2xl:col-span-2 2xl:row-start-2'}`}>
          <p className="text-xs text-fg-muted">Needs you</p>
          {needs.length === 0 ? (
            <p className="mt-0.5 text-sm text-fg-muted">
              {waiting > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <Hourglass aria-hidden className="size-3.5" /> Waiting on {waiting}
                </span>
              ) : (
                'Nothing'
              )}
            </p>
          ) : (
            <ul className="mt-0.5 space-y-1 text-sm">
              {needs.slice(0, 2).map((n) => {
                const c = concise(n.title, name);
                const Icon = n.kind === 'approval' ? Hand : AlertOctagon;
                return (
                  <li key={n.title} className="flex items-start gap-1.5">
                    <Icon
                      aria-hidden
                      className={`mt-0.5 size-3.5 shrink-0 ${n.kind === 'approval' ? 'text-warn' : 'text-danger'}`}
                    />
                    <span className="min-w-0" title={c.shortened ? c.full : undefined}>
                      <span className="sr-only">
                        {n.kind === 'approval' ? 'Approval: ' : 'Blocker: '}
                      </span>
                      {c.text}
                    </span>
                  </li>
                );
              })}
              {needs.length > 2 && (
                <li className="text-xs text-fg-muted">and {needs.length - 2} more</li>
              )}
            </ul>
          )}
        </div>
        <div className="flex items-end justify-between gap-6 sm:col-span-2 lg:col-span-1 lg:flex-col lg:items-end lg:justify-end">
          <p className="text-xs whitespace-nowrap text-fg-muted">
            {s.minutesThisWeek > 0 && (
              <span className="figure mr-3 text-fg">
                {formatDuration(s.minutesThisWeek)} this week
              </span>
            )}
            Last moved {formatWhen(s.lastUpdate, now)}
          </p>
          <Link
            to={`/projects/${s.project.slug}`}
            aria-label={`Open ${name}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-fg hover:underline"
          >
            Open <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>
      </div>
    </li>
  );
}

function Fact({
  label,
  value,
  empty,
}: {
  label: string;
  value?: string | undefined;
  empty: string;
}) {
  const c = value ? concise(value) : null;
  return (
    <div className="min-w-0">
      <p className="text-xs text-fg-muted">{label}</p>
      <p
        className={`mt-0.5 text-sm leading-snug ${c ? 'font-medium' : 'text-fg-muted'}`}
        title={c?.shortened ? c.full : undefined}
      >
        {c ? c.text : empty}
      </p>
    </div>
  );
}

/** Projects not current: one line each, still complete enough to act on. */
function QuietRow({ summary: s, now }: { summary: ProjectSummary; now: Date }) {
  const { next } = nowNext(s);
  const needs = s.lanes.needs_approval.length + s.lanes.blocked.length;
  return (
    <li className="grid gap-x-8 gap-y-1 border-b border-line py-3.5 text-sm md:grid-cols-[minmax(10rem,14rem)_7rem_minmax(0,1fr)_auto] md:items-baseline">
      <h3 className="font-medium">
        <Link to={`/projects/${s.project.slug}`} className="hover:underline">
          {s.project.name}
        </Link>
      </h3>
      <span className="text-fg-muted">{STATE_LABEL[s.project.state]}</span>
      <p className="min-w-0 truncate text-fg-muted" title={next}>
        {next ? <>Next: {concise(next, s.project.name).text}</> : 'No next step recorded'}
        {needs > 0 && <span className="ml-2 text-warn">· needs you ({needs})</span>}
      </p>
      <span className="text-xs whitespace-nowrap text-fg-muted">
        Last moved {formatWhen(s.lastUpdate, now)}
      </span>
    </li>
  );
}

function NewProjectForm({ onCancel }: { onCancel: () => void }) {
  const { projects } = useRepositories();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), objective: useId(), error: useId() };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError('Give the project a name.');
    try {
      const project = await projects.create({ name, objective, state: 'active' });
      await navigate(`/projects/${project.slug}`);
    } catch {
      setError('Couldn’t create the project. Nothing changed.');
    }
  }

  return (
    <form
      aria-label="New project"
      onSubmit={(e) => void submit(e)}
      className="mt-4 max-w-lg space-y-3 rounded-lg border border-line bg-raised p-4"
    >
      <div>
        <label htmlFor={ids.name} className={labelClass}>
          Name
        </label>
        <input
          id={ids.name}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ids.error : undefined}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor={ids.objective} className={labelClass}>
          Objective (optional): what does done mean?
        </label>
        <input
          id={ids.objective}
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          className={fieldClass}
        />
      </div>
      {error && <ErrorNotice id={ids.error}>{error}</ErrorNotice>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          Create project
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
