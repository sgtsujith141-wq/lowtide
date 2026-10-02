import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Drawer } from '../../../components/layout';
import { useRepositories } from '../../../hooks/useRepositories';
import { useWatch } from '../../../hooks/useWatch';
import { addDays } from '../../../lib/calendar';
import { fromLocalDate } from '../../../lib/time';
import { formatFull } from '../../../lib/when';
import type { LocalDate, Project, WorkSession } from '../../../types/domain';
import { activityLine, type ActivityLine } from '../activity';

/*
 * Project activity (v2 PHASE 013): only events that mean the project moved,
 * grouped by day, each led by who did it. Work starts, pauses and resumes are
 * noise here; a finished session reads as the time worked. AI summaries are
 * cut to one line; the full record opens on click.
 */

function dayHeading(date: LocalDate, today: LocalDate): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  return format(
    fromLocalDate(date),
    date.slice(0, 4) === today.slice(0, 4) ? 'EEE d MMM' : 'd MMM yyyy',
  );
}

export function ProjectActivity({
  project,
  sessions,
  today,
  limit = 12,
}: {
  project: Project;
  sessions: readonly WorkSession[];
  today: LocalDate;
  limit?: number;
}) {
  const { events } = useRepositories();
  const watch = useMemo(
    () => events.watchTimeline({ projectId: project.id, limit: limit * 3 }),
    [events, project.id, limit],
  );
  const entries = useWatch(watch);
  const [open, setOpen] = useState<ActivityLine | null>(null);
  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  if (entries.status !== 'ready') return null;
  const lines = entries.data
    .map((e) => activityLine(e, project.name, byId))
    .filter((l): l is ActivityLine => l !== null)
    .slice(0, limit);
  if (lines.length === 0) return <p className="text-sm text-fg-muted">Nothing recorded yet.</p>;
  const days = new Map<LocalDate, ActivityLine[]>();
  for (const l of lines)
    days.set(l.entry.event.localDate, [...(days.get(l.entry.event.localDate) ?? []), l]);
  return (
    <>
      <div className="space-y-5">
        {[...days].map(([date, list]) => (
          <section key={date} aria-label={dayHeading(date, today)}>
            <h3 className="text-xs font-semibold text-fg-muted">{dayHeading(date, today)}</h3>
            <ul className="mt-1.5 divide-y divide-line">
              {list.map((l) => (
                <li key={l.entry.event.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(l)}
                    className="grid w-full grid-cols-[6.5rem_minmax(0,1fr)_auto] items-baseline gap-3 py-2 text-left text-sm hover:bg-hover/60"
                  >
                    <span className="truncate text-xs font-medium text-fg-muted">{l.who}</span>
                    <span className="truncate">{l.text}</span>
                    <time dateTime={l.entry.event.at} className="text-xs text-fg-muted">
                      {format(new Date(l.entry.event.at), 'HH:mm')}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <Drawer open={open !== null} onClose={() => setOpen(null)} title={open?.text ?? 'Event'}>
        {open && <EventDetail line={open} />}
      </Drawer>
    </>
  );
}

function EventDetail({ line }: { line: ActivityLine }) {
  const { event, title } = line.entry;
  const { aiSessions } = useRepositories();
  const watch = useMemo(
    () => (event.projectId ? aiSessions.watchForProject(event.projectId) : null),
    [aiSessions, event.projectId],
  );
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-fg-muted">Who</dt>
        <dd>{line.who}</dd>
        <dt className="text-fg-muted">When</dt>
        <dd>{formatFull(event.at)}</dd>
      </dl>
      {title && (
        <section aria-label="Full record">
          <h3 className="text-xs font-semibold text-fg-muted">Full record</h3>
          <p className="mt-1 whitespace-pre-wrap">{title}</p>
        </section>
      )}
      {event.type === 'ai.session.completed' && watch && (
        <AiSessionDetail watch={watch} id={event.entityId} />
      )}
    </div>
  );
}

function AiSessionDetail({
  watch,
  id,
}: {
  watch: ReturnType<ReturnType<typeof useRepositories>['aiSessions']['watchForProject']>;
  id: string;
}) {
  const sessions = useWatch(watch);
  const s = sessions.status === 'ready' ? sessions.data.find((x) => x.id === id) : undefined;
  if (!s) return null;
  return (
    <section aria-label="AI session" className="space-y-1.5">
      <h3 className="text-xs font-semibold text-fg-muted">Session</h3>
      <p className="whitespace-pre-wrap">{s.summary}</p>
      {s.result && <p>Result: {s.result}</p>}
      {s.nextAction && <p>Next: {s.nextAction}</p>}
      {s.commits?.length ? (
        <p className="font-mono text-xs text-fg-muted">{s.commits.join(' ')}</p>
      ) : null}
    </section>
  );
}
