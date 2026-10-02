import { Check, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Drawer } from '../../../components/layout';
import { Button } from '../../../components/ui/Button';
import { ErrorNotice } from '../../../components/ui/Notice';
import { useRepositories } from '../../../hooks/useRepositories';
import { useWatch } from '../../../hooks/useWatch';
import { formatFull, formatWhen } from '../../../lib/when';
import type { Milestone, Task } from '../../../types/domain';

/*
 * The roadmap (v2 PHASE 013): milestones in order, done ✓ ── current ● ──
 * upcoming ○. Progress is milestone weight only (ADR-038).
 */

type Step = 'done' | 'current' | 'upcoming';
const stepOf = (m: Milestone, current: Milestone | undefined): Step =>
  m.completedAt ? 'done' : m.id === current?.id ? 'current' : 'upcoming';
const STEP_WORD: Record<Step, string> = { done: 'done', current: 'current', upcoming: 'upcoming' };

/**
 * The completion line: one bar, a tick at each milestone boundary (by
 * weight), so the distance left reads as stages, not just a number.
 */
export function MilestoneLine({
  milestones,
  percent,
  label,
  size = 'md',
}: {
  milestones: readonly Milestone[];
  percent: number;
  label: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const total = milestones.reduce((s, m) => s + m.weight, 0);
  const ticks = milestones
    .slice(0, -1)
    .map((_, i) => (milestones.slice(0, i + 1).reduce((s, m) => s + m.weight, 0) / total) * 100);
  const height = size === 'lg' ? 'h-2.5' : size === 'sm' ? 'h-1' : 'h-1.5';
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={`relative ${height} w-full overflow-hidden rounded-full bg-grid-0`}
    >
      <div
        className="h-full rounded-full bg-projects-3 transition-[width] duration-700 ease-[var(--ease-tide)]"
        style={{ width: `${percent}%` }}
      />
      {ticks.map((at) => (
        <span
          key={at}
          aria-hidden
          className="absolute inset-y-0 w-0.5 bg-canvas"
          style={{ left: `calc(${at}% - 1px)` }}
        />
      ))}
    </div>
  );
}

/**
 * The full roadmap rail: vertical on narrow screens, horizontal from xl.
 * Each milestone opens its details; the current one is unmistakable.
 */
export function Roadmap({
  milestones,
  onOpen,
}: {
  milestones: readonly Milestone[];
  onOpen: (m: Milestone) => void;
}) {
  const current = milestones.find((m) => !m.completedAt);
  return (
    <ol aria-label="Roadmap" className="flex flex-col xl:flex-row">
      {milestones.map((m, i) => {
        const step = stepOf(m, current);
        const last = i === milestones.length - 1;
        const lit = step === 'done';
        return (
          <li
            key={m.id}
            className="min-w-0 xl:flex-1"
            aria-current={step === 'current' || undefined}
          >
            <button
              type="button"
              onClick={() => onOpen(m)}
              className="group flex w-full gap-3 rounded-md text-left xl:flex-col xl:gap-2.5"
            >
              <span aria-hidden className="flex shrink-0 flex-col items-center xl:flex-row">
                <Node step={step} />
                {!last && (
                  <span
                    className={`min-h-5 w-0.5 flex-1 xl:h-0.5 xl:min-h-0 xl:w-auto ${lit ? 'bg-projects-3' : 'bg-line-strong'}`}
                  />
                )}
              </span>
              <span className={`min-w-0 pb-4 xl:pr-5 xl:pb-0 ${last ? 'pb-0' : ''}`}>
                {step === 'current' && (
                  <span className="block text-xs font-medium text-projects-4">Current</span>
                )}
                <span
                  className={`block text-sm leading-snug group-hover:underline xl:line-clamp-3 ${
                    step === 'current'
                      ? 'font-semibold text-fg'
                      : step === 'done'
                        ? 'text-fg-muted'
                        : 'text-fg-muted'
                  }`}
                >
                  {m.title}
                </span>
                <span className="sr-only">
                  {` (${STEP_WORD[step]}${m.weight !== 1 ? `, weight ${m.weight}` : ''})`}
                </span>
                {m.dueOn && step !== 'done' && (
                  <span className="mt-0.5 block text-xs text-fg-muted">Due {m.dueOn}</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Node({ step }: { step: Step }) {
  if (step === 'done')
    return (
      <span className="grid size-5 place-items-center rounded-full bg-projects-3 text-canvas">
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  if (step === 'current')
    return (
      <span className="lt-current grid size-5 place-items-center rounded-full border-2 border-projects-3 bg-canvas">
        <span className="size-2 rounded-full bg-projects-3" />
      </span>
    );
  return <span className="size-5 rounded-full border-2 border-line-strong bg-canvas" />;
}

/**
 * A compact, read-only rail for portfolio rows: wraps instead of scrolling,
 * so it never forces the page wider.
 */
export function RoadmapInline({ milestones }: { milestones: readonly Milestone[] }) {
  const current = milestones.find((m) => !m.completedAt);
  return (
    <ol aria-label="Milestones" className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-xs">
      {milestones.map((m, i) => {
        const step = stepOf(m, current);
        return (
          <li key={m.id} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && (
              <span
                aria-hidden
                className={`h-px w-3 ${step === 'upcoming' && !milestones[i - 1]!.completedAt ? 'bg-line-strong' : 'bg-projects-3'}`}
              />
            )}
            <span
              className={`inline-flex min-w-0 items-center gap-1 ${
                step === 'current'
                  ? 'font-semibold text-fg'
                  : step === 'done'
                    ? 'text-fg-muted'
                    : 'text-fg-muted'
              }`}
            >
              {step === 'done' ? (
                <Check aria-hidden className="size-3 shrink-0 text-projects-4" strokeWidth={3} />
              ) : (
                <span
                  aria-hidden
                  className={`size-2 shrink-0 rounded-full ${step === 'current' ? 'bg-projects-3 ring-2 ring-projects-3/30' : 'border border-fg-subtle'}`}
                />
              )}
              <span className="max-w-[16rem] truncate" title={m.title}>
                {m.title}
              </span>
              <span className="sr-only">{` (${STEP_WORD[step]})`}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One milestone in full: where it stands, its weight and dates, the tasks
 * under it, and where it came from. Complete or reopen it here.
 */
export function MilestoneDrawer({
  milestone,
  milestones,
  tasks,
  onClose,
}: {
  milestone: Milestone | null;
  milestones: readonly Milestone[];
  tasks: readonly Task[];
  onClose: () => void;
}) {
  const { projects, space } = useRepositories();
  const live = milestone ? (milestones.find((m) => m.id === milestone.id) ?? milestone) : null;
  const liveId = live?.id;
  const watch = useMemo(
    () => (liveId ? space.watchSources('milestone', liveId) : null),
    [space, liveId],
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <Drawer open={live !== null} onClose={onClose} title={live?.title ?? 'Milestone'}>
      {live && watch && (
        <MilestoneDetail
          milestone={live}
          milestones={milestones}
          tasks={tasks.filter((t) => t.milestoneId === live.id)}
          watch={watch}
          error={error}
          onToggle={() => {
            setError(null);
            (live.completedAt
              ? projects.reopenMilestone(live.id)
              : projects.completeMilestone(live.id)
            ).catch(() => setError('That didn’t work. Nothing changed.'));
          }}
        />
      )}
    </Drawer>
  );
}

function MilestoneDetail({
  milestone: m,
  milestones,
  tasks,
  watch,
  error,
  onToggle,
}: {
  milestone: Milestone;
  milestones: readonly Milestone[];
  tasks: readonly Task[];
  watch: ReturnType<ReturnType<typeof useRepositories>['space']['watchSources']>;
  error: string | null;
  onToggle: () => void;
}) {
  const sources = useWatch(watch);
  const current = milestones.find((x) => !x.completedAt);
  const step = stepOf(m, current);
  const position = milestones.findIndex((x) => x.id === m.id) + 1;
  const total = milestones.reduce((s, x) => s + x.weight, 0);
  const canonical =
    sources.status === 'ready' ? sources.data.find((s) => s.role === 'canonical') : undefined;
  const now = new Date();
  return (
    <div className="space-y-6 text-sm">
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2">
        <dt className="text-fg-muted">Stage</dt>
        <dd>
          {position} of {milestones.length}
        </dd>
        <dt className="text-fg-muted">Status</dt>
        <dd className={step === 'current' ? 'font-medium text-projects-4' : ''}>
          {step === 'done' ? 'Done' : step === 'current' ? 'Current' : 'Upcoming'}
        </dd>
        <dt className="text-fg-muted">Weight</dt>
        <dd>
          {m.weight} of {total} ({Math.round((m.weight / total) * 100)}% of the project)
        </dd>
        {m.dueOn && (
          <>
            <dt className="text-fg-muted">Due</dt>
            <dd>{m.dueOn}</dd>
          </>
        )}
        {m.completedAt && (
          <>
            <dt className="text-fg-muted">{canonical ? 'Recorded done' : 'Completed'}</dt>
            <dd>
              <time dateTime={m.completedAt} title={formatFull(m.completedAt)}>
                {canonical ? 'by ' : ''}
                {formatWhen(m.completedAt, now)}
              </time>
            </dd>
          </>
        )}
      </dl>
      {m.notes && <p className="whitespace-pre-wrap">{m.notes}</p>}

      <section aria-label="Tasks under this milestone">
        <h3 className="text-xs font-semibold text-fg-muted">Tasks under it</h3>
        {tasks.length === 0 ? (
          <p className="mt-1 text-fg-muted">None linked.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-1.5">
                {t.status === 'done' ? (
                  <Check aria-hidden className="size-3.5 text-projects-4" />
                ) : (
                  <span aria-hidden className="size-2 rounded-full border border-fg-subtle" />
                )}
                <span className={t.status === 'done' ? 'text-fg-muted' : ''}>{t.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canonical && (
        <section aria-label="Source">
          <h3 className="text-xs font-semibold text-fg-muted">Source</h3>
          <p className="mt-1">
            Reconciled from {canonical.system === 'notion' ? 'Notion' : canonical.system}:{' '}
            <span className="text-fg-muted">“{canonical.originalTitle}”</span>
          </p>
          {canonical.path && canonical.path.length > 0 && (
            <p className="text-xs text-fg-muted">{canonical.path.join(' / ')}</p>
          )}
          <p className="mt-1 text-xs text-fg-muted">
            Brought in{' '}
            <time dateTime={canonical.importedAt} title={formatFull(canonical.importedAt)}>
              {formatWhen(canonical.importedAt, now)}
            </time>
            . Not counted as activity.
          </p>
        </section>
      )}

      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Button variant={m.completedAt ? 'quiet' : 'primary'} onClick={onToggle}>
        {m.completedAt ? (
          <>
            <RotateCcw aria-hidden className="size-3.5" /> Reopen milestone
          </>
        ) : (
          <>
            <Check aria-hidden className="size-3.5" /> Complete milestone
          </>
        )}
      </Button>
    </div>
  );
}
