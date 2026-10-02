import { AlertOctagon, ArrowRight, Check, Hand, Hourglass } from 'lucide-react';
import { Link } from 'react-router';
import { Chip, ProgressBar } from '../../components/shared/visuals';
import { formatDuration } from '../../lib/duration';
import { formatWhen } from '../../lib/when';
import type { Milestone } from '../../types/domain';
import { FOCUS_LABEL, STATE_LABEL, STATE_TONE, type ProjectSummary } from '../projects/summary';
import { selectHomeProjects, withoutProjectPrefix } from './model';

/**
 * Project Command (v2 PHASE 012): the projects that matter now, as a
 * portfolio list. Each row reads left to right: what it is and its state,
 * how far it is (by milestone weight, or plainly "no milestones" instead of
 * a made-up percentage), what's happening now and next, and anything waiting
 * on you. Projects marked "not current" stay on Projects.
 */
export function ProjectCommand({
  summaries,
  now,
}: {
  summaries: readonly ProjectSummary[];
  now: Date;
}) {
  const { shown, hidden } = selectHomeProjects(summaries);
  return (
    <section aria-labelledby="projects-heading" className="mt-12">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="projects-heading" className="text-section font-semibold">
          Projects
        </h2>
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 text-sm text-fg-muted transition-colors hover:text-fg"
        >
          View all projects{hidden > 0 ? ` (${hidden} more)` : ''}
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">
          No active projects.{' '}
          <Link to="/projects" className="text-accent-ink underline underline-offset-2">
            Start one
          </Link>
        </p>
      ) : (
        <ul aria-label="Projects in focus" className="mt-3 border-t border-line">
          {shown.map((s) => (
            <ProjectRow key={s.project.id} summary={s} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectRow({ summary: s, now }: { summary: ProjectSummary; now: Date }) {
  const name = s.project.name;
  const focusTitle = s.lanes.working_now[0]?.title;
  const focus = focusTitle ? withoutProjectPrefix(focusTitle, name) : undefined;
  const nextTitle = s.project.nextAction ?? s.lanes.next[0]?.title;
  const next = nextTitle ? withoutProjectPrefix(nextTitle, name) : undefined;
  const approvals = s.lanes.needs_approval;
  const blocked = s.lanes.blocked;
  const waiting = s.lanes.waiting;
  return (
    <li className="grid gap-x-8 gap-y-3 border-b border-line py-5 lg:grid-cols-[minmax(12rem,1fr)_minmax(14rem,1.2fr)_minmax(16rem,1.6fr)_minmax(10rem,0.9fr)]">
      {/* What it is */}
      <div className="min-w-0">
        <h3 className="text-[15px] leading-snug font-semibold">
          <Link to={`/projects/${s.project.slug}`} className="hover:underline">
            {s.project.name}
          </Link>
        </h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Chip tone={STATE_TONE[s.project.state]}>{STATE_LABEL[s.project.state]}</Chip>
          {s.project.focus && s.project.focus !== 'background' && (
            <span className="text-xs text-fg-muted">{FOCUS_LABEL[s.project.focus]}</span>
          )}
        </div>
      </div>

      {/* How far */}
      <div className="min-w-0">
        {s.completion ? (
          <>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <ProgressBar
                  percent={s.completion.percent}
                  label={`${s.project.name}: ${s.completion.percent}% of milestones`}
                />
              </div>
              <span className="figure w-10 text-right text-sm font-semibold text-projects-4">
                {s.completion.percent}%
              </span>
            </div>
            <Pipeline milestones={s.milestones} current={s.currentMilestone} />
          </>
        ) : (
          <p className="text-sm text-fg-muted">No milestones yet</p>
        )}
      </div>

      {/* Now and next */}
      <dl className="min-w-0 space-y-1.5 text-sm">
        {focus && (
          <div className="flex gap-3">
            <dt className="w-10 shrink-0 text-xs leading-5 text-fg-muted">Now</dt>
            <dd className="min-w-0 leading-snug">{focus}</dd>
          </div>
        )}
        {next && (
          <div className="flex gap-3">
            <dt className="w-10 shrink-0 text-xs leading-5 text-fg-muted">Next</dt>
            <dd className="min-w-0 leading-snug">{next}</dd>
          </div>
        )}
        {!focus && !next && (
          <div className="flex gap-3">
            <dt className="sr-only">Next</dt>
            <dd className="text-fg-muted">No next step recorded</dd>
          </div>
        )}
      </dl>

      {/* What it needs, and when it last moved */}
      <div className="min-w-0 space-y-1.5 text-sm">
        {approvals.length > 0 && (
          <p className="flex items-start gap-1.5 text-warn">
            <Hand aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {approvals.length === 1
              ? `Needs your approval: ${approvals[0]!.title}`
              : `${approvals.length} approvals need you`}
          </p>
        )}
        {blocked.length > 0 && (
          <p className="flex items-start gap-1.5 text-danger">
            <AlertOctagon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span className="line-clamp-3 min-w-0">
              <span className="font-medium">Blocked:</span> {blocked[0]!.title}
            </span>
          </p>
        )}
        {waiting.length > 0 && (
          <p className="flex items-start gap-1.5 text-fg-muted">
            <Hourglass aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Waiting: {waiting[0]!.title}
            {waiting.length > 1 && ` +${waiting.length - 1}`}
          </p>
        )}
        {s.minutesThisWeek > 0 && (
          <p className="figure text-fg">{formatDuration(s.minutesThisWeek)} this week</p>
        )}
        <p className="text-xs text-fg-subtle">Moved {formatWhen(s.lastUpdate, now)}</p>
      </div>
    </li>
  );
}

/** Milestones in order: done (check), the current one (filled), the rest (open). */
function Pipeline({
  milestones,
  current,
}: {
  milestones: readonly Milestone[];
  current: Milestone | undefined;
}) {
  const shown = milestones.slice(0, 5);
  return (
    <ol
      aria-label="Milestones"
      className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs"
    >
      {shown.map((m, i) => {
        const done = m.completedAt !== undefined;
        const isCurrent = current?.id === m.id;
        return (
          <li key={m.id} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className="h-px w-3 bg-line-strong" />}
            <span
              className={`inline-flex items-center gap-1 ${
                done ? 'text-fg-muted' : isCurrent ? 'font-medium text-fg' : 'text-fg-subtle'
              }`}
            >
              {done ? (
                <Check aria-hidden className="size-3 text-projects-4" />
              ) : (
                <span
                  aria-hidden
                  className={`size-2 rounded-full ${isCurrent ? 'bg-projects-3' : 'border border-fg-subtle'}`}
                />
              )}
              {m.title}
              <span className="sr-only">
                {done ? ' (done)' : isCurrent ? ' (current)' : ' (upcoming)'}
              </span>
            </span>
          </li>
        );
      })}
      {milestones.length > shown.length && (
        <li className="text-fg-subtle">+{milestones.length - shown.length}</li>
      )}
    </ol>
  );
}
