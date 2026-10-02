import {
  AlertOctagon,
  CalendarClock,
  GraduationCap,
  Hand,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import { addDays } from '../../lib/calendar';
import type { LocalDate } from '../../types/domain';
import { groupNeeds, type NeedKind } from './model';

const KIND: Record<NeedKind, { icon: LucideIcon; tint: string; label: string }> = {
  approval: { icon: Hand, tint: 'text-warn', label: 'Needs approval' },
  blocker: { icon: AlertOctagon, tint: 'text-danger', label: 'Blocked' },
  overdue: { icon: CalendarClock, tint: 'text-warn', label: 'Overdue' },
  due: { icon: CalendarClock, tint: 'text-fg-muted', label: 'Due today' },
  hackathon: { icon: Trophy, tint: 'text-accent-ink', label: 'Hackathon' },
  college: { icon: GraduationCap, tint: 'text-college-4', label: 'College' },
};

/**
 * Needs You (v2 PHASE 012), grouped by what each thing belongs to:
 * approvals and blockers by name, deadlines counted per project. Hidden when
 * nothing needs you.
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

  const groups = useMemo(() => {
    if (
      all.status !== 'ready' ||
      items.status !== 'ready' ||
      day.status !== 'ready' ||
      hacks.status !== 'ready' ||
      coursework.status !== 'ready'
    )
      return null;
    return groupNeeds({
      today,
      projects: all.data,
      items: items.data,
      dayTasks: day.data,
      hackathons: hacks.data,
      coursework: coursework.data,
    });
  }, [all, items, day, hacks, coursework, today]);

  if (!groups || groups.length === 0) return null;
  return (
    <section aria-labelledby="needs-heading" className="mt-12">
      <h2 id="needs-heading" className="flex items-baseline gap-2 text-section font-semibold">
        Needs you
        <span className="figure text-sm font-semibold text-warn">{groups.length}</span>
      </h2>
      <ul className="mt-3 grid gap-x-10 border-t border-line md:grid-cols-2 2xl:grid-cols-3">
        {groups.map((group) => (
          <li key={group.key} className="border-b border-line">
            <Link
              to={group.to}
              className="-mx-2 block rounded-md px-2 py-3 transition-colors duration-150 hover:bg-hover"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${group.urgent ? 'bg-danger' : 'bg-fg-subtle'}`}
                />
                {group.label}
              </span>
              <ul className="mt-1 space-y-0.5 pl-3.5">
                {group.lines.slice(0, 3).map((line) => {
                  const kind = KIND[line.kind];
                  const Icon = kind.icon;
                  return (
                    <li key={line.key} className="flex items-start gap-2 text-sm leading-snug">
                      <Icon aria-hidden className={`mt-0.5 size-3.5 shrink-0 ${kind.tint}`} />
                      <span className="min-w-0">
                        {(line.kind === 'approval' ||
                          line.kind === 'blocker' ||
                          line.kind === 'hackathon') && (
                          <span className={`${kind.tint} mr-1.5 text-xs`}>{kind.label}</span>
                        )}
                        {line.text}
                      </span>
                    </li>
                  );
                })}
                {group.lines.length > 3 && (
                  <li className="text-xs text-fg-subtle">+{group.lines.length - 3} more</li>
                )}
              </ul>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
