import { AlertOctagon, Clock, Hand, Hourglass, Target } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Chip, ProgressBar, Sparkline } from '../../components/shared/visuals';
import { formatDuration } from '../../lib/duration';
import { formatWhen } from '../../lib/when';
import { STATE_LABEL, STATE_TONE, type ProjectSummary } from './summary';

/** One live project as a compact, visual command card (Home and Projects). */
export function ProjectCard({
  summary: s,
  spark,
  headingLevel = 3,
}: {
  summary: ProjectSummary;
  spark: number[];
  /** 3 under a section heading (Home), 2 directly under the page title (Projects). */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const focus = s.lanes.working_now[0];
  const next = s.project.nextAction ?? s.lanes.next[0]?.title;
  const waiting = s.lanes.waiting;
  const approvals = s.lanes.needs_approval;
  const blocked = s.lanes.blocked;
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-paper-raised p-4">
      <div className="flex items-start justify-between gap-2">
        <Heading className="min-w-0 font-medium leading-snug">
          <Link to={`/projects/${s.project.slug}`} className="hover:underline">
            {s.project.name}
          </Link>
        </Heading>
        <Chip tone={STATE_TONE[s.project.state]}>{STATE_LABEL[s.project.state]}</Chip>
      </div>

      {s.completion ? (
        <div>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-ink-muted">
              {s.currentMilestone ? `Now: ${s.currentMilestone.title}` : 'All milestones done'}
            </span>
            <span className="font-semibold tabular-nums">{s.completion.percent}%</span>
          </div>
          <ProgressBar
            percent={s.completion.percent}
            label={`${s.project.name}: ${s.completion.percent}% of milestones`}
          />
        </div>
      ) : (
        <p className="text-xs text-ink-muted">No milestones yet</p>
      )}

      <dl className="space-y-1 text-sm">
        {focus && (
          <Row icon={<Target aria-hidden className="size-3.5 text-accent" />} term="Now">
            {focus.title}
          </Row>
        )}
        {next && (
          <Row
            icon={
              <span aria-hidden className="text-ink-faint">
                →
              </span>
            }
            term="Next"
          >
            {next}
          </Row>
        )}
        {waiting.length > 0 && (
          <Row icon={<Hourglass aria-hidden className="size-3.5 text-ink-muted" />} term="Waiting">
            {waiting[0]!.title}
            {waiting.length > 1 && <span className="text-ink-muted"> +{waiting.length - 1}</span>}
          </Row>
        )}
        {approvals.length > 0 && (
          <Row icon={<Hand aria-hidden className="size-3.5 text-warn" />} term="Needs approval">
            <span className="text-warn">
              {approvals.length} {approvals.length === 1 ? 'approval' : 'approvals'}
            </span>
          </Row>
        )}
        {blocked.length > 0 && (
          <Row icon={<AlertOctagon aria-hidden className="size-3.5 text-danger" />} term="Blocked">
            <span className="text-danger">{blocked[0]!.title}</span>
          </Row>
        )}
      </dl>

      <div className="mt-auto flex items-end justify-between gap-3 border-t border-line pt-2 text-xs text-ink-muted">
        <span className="flex items-center gap-1">
          <Clock aria-hidden className="size-3" /> {formatDuration(s.minutesThisWeek)} this week
        </span>
        <Sparkline values={spark} label={`${s.project.name}: work minutes, last 14 days`} />
      </div>
      <p className="-mt-2 text-[11px] text-ink-muted">
        Moved {formatWhen(s.lastUpdate, new Date())}
      </p>
    </li>
  );
}

function Row({ icon, term, children }: { icon: ReactNode; term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="sr-only">{term}</dt>
      <dd className="flex min-w-0 items-start gap-2 leading-snug">
        <span className="mt-1 grid w-3.5 shrink-0 place-items-center">{icon}</span>
        <span className="min-w-0">{children}</span>
      </dd>
    </div>
  );
}
