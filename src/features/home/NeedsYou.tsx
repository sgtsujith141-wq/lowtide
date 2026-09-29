import { AlertOctagon, CalendarClock, Hand, Trophy } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import { addDays } from '../../lib/calendar';
import { localDateOfDeadline } from '../../lib/time';
import type { LocalDate } from '../../types/domain';
import { hackathonsForToday } from '../hackathons/schedule';
import { isLive } from '../projects/summary';

interface Need {
  key: string;
  tone: 'approval' | 'blocked' | 'due' | 'hackathon';
  title: string;
  context: string;
  to: string;
}

const TONE = {
  approval: { icon: Hand, ring: 'border-l-work-3', label: 'Needs approval' },
  blocked: { icon: AlertOctagon, ring: 'border-l-danger', label: 'Blocked' },
  due: { icon: CalendarClock, ring: 'border-l-warn', label: 'Due' },
  hackathon: { icon: Trophy, ring: 'border-l-accent', label: 'Hackathon' },
} as const;

/**
 * Needs You: what only you can move. Open approvals, open blockers, projects
 * waiting on your approval or blocked, deadlines due or overdue, and
 * hackathon deadlines this week. Empty is good news, said plainly.
 */
export function NeedsYou({ today }: { today: LocalDate }) {
  const { projects, tasks, hackathons, college } = useRepositories();
  const watchCollege = useMemo(
    () => college.watchRange(addDays(today, -14), today),
    [college, today],
  );
  const coursework = useWatch(watchCollege);
  const all = useWatch(projects.watchAll);
  const items = useWatch(projects.watchAllItems);
  const watchDay = useMemo(() => tasks.watchForDay(today), [tasks, today]);
  const day = useWatch(watchDay);
  const hacks = useWatch(hackathons.watchAll);

  const needs = useMemo<Need[] | null>(() => {
    if (
      all.status !== 'ready' ||
      items.status !== 'ready' ||
      day.status !== 'ready' ||
      hacks.status !== 'ready' ||
      coursework.status !== 'ready'
    )
      return null;
    const byId = new Map(all.data.map((p) => [p.id, p]));
    const list: Need[] = [];
    for (const item of items.data) {
      const project = byId.get(item.projectId);
      if (!project || !isLive(project)) continue;
      if (item.lane === 'needs_approval' || item.lane === 'blocked') {
        list.push({
          key: item.id,
          tone: item.lane === 'needs_approval' ? 'approval' : 'blocked',
          title: item.title,
          context: project.name,
          to: `/projects/${project.slug}`,
        });
      }
    }
    for (const project of all.data) {
      if (project.state !== 'needs_approval' && project.state !== 'blocked') continue;
      if (list.some((n) => n.context === project.name)) continue;
      list.push({
        key: project.id,
        tone: project.state === 'needs_approval' ? 'approval' : 'blocked',
        title:
          project.state === 'needs_approval' ? 'Waiting for your approval' : 'Project is blocked',
        context: project.name,
        to: `/projects/${project.slug}`,
      });
    }
    for (const task of day.data) {
      if (!task.dueAt || localDateOfDeadline(task.dueAt) > today) continue;
      const overdue = localDateOfDeadline(task.dueAt) < today;
      list.push({
        key: task.id,
        tone: 'due',
        title: task.title,
        context: overdue ? 'Overdue' : 'Due today',
        to: '/today',
      });
    }
    for (const item of coursework.data) {
      if (item.status !== 'planned' || item.kind === 'class' || item.kind === 'lab') continue;
      list.push({
        key: item.id,
        tone: 'due',
        title: item.title,
        context: `College ${item.kind} · ${item.date < today ? 'overdue' : 'due today'}`,
        to: '/life',
      });
    }
    for (const row of hackathonsForToday(hacks.data, today).rows) {
      list.push({
        key: row.hackathon.id,
        tone: 'hackathon',
        title: row.hackathon.name,
        context: row.label,
        to: '/hackathons',
      });
    }
    return list;
  }, [all, items, day, hacks, coursework, today]);

  if (!needs) return null;
  return (
    <section aria-labelledby="needs-heading" className="mt-10">
      <h2 id="needs-heading" className="font-serif text-lg font-semibold tracking-tight">
        Needs you
        {needs.length > 0 && (
          <span className="ml-2 rounded-full bg-work-1 px-2 py-0.5 align-middle font-sans text-xs font-semibold text-warn">
            {needs.length}
          </span>
        )}
      </h2>
      {needs.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">Nothing is waiting on you.</p>
      ) : (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {needs.map((need) => {
            const tone = TONE[need.tone];
            const Icon = tone.icon;
            return (
              <li key={need.key}>
                <Link
                  to={need.to}
                  className={`flex items-start gap-3 rounded-lg border border-l-4 border-line ${tone.ring} bg-paper-raised px-3 py-2.5 hover:border-line-strong`}
                >
                  <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                  <span className="min-w-0">
                    <span className="block text-sm leading-snug font-medium">{need.title}</span>
                    <span className="block text-xs text-ink-muted">
                      <span className="sr-only">{tone.label}: </span>
                      {need.context}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
