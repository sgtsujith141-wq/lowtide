import { addDays, daysBetween, eachDay, startOfWeek } from '../../lib/calendar';
import { formatDuration } from '../../lib/duration';
import { localDateOfDeadline } from '../../lib/time';
import type {
  CollegeItem,
  Hackathon,
  LocalDate,
  Milestone,
  OffTimeSession,
  Project,
  ProtectedTime,
  Task,
  WorkSession,
} from '../../types/domain';
import { activeMinutes } from '../work/duration';

/*
 * The combined calendar (ADR-053), built from records only (pure). Protected
 * time appears here as your own plan; it is never sent to AI context.
 */

export const CALENDAR_KINDS = [
  'dayoff',
  'protected',
  'college',
  'hackathon',
  'milestone',
  'deadline',
  'planned',
  'work',
] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export const KIND_LABEL: Record<CalendarKind, string> = {
  dayoff: 'Day off',
  protected: 'Protected time',
  college: 'College',
  hackathon: 'Hackathon',
  milestone: 'Milestone',
  deadline: 'Deadline',
  planned: 'Planned',
  work: 'Work',
};

export interface CalendarEntry {
  key: string;
  kind: CalendarKind;
  title: string;
  detail?: string;
  to?: string;
}

export interface CalendarSources {
  college: readonly CollegeItem[];
  hackathons: readonly Hackathon[];
  milestones: readonly Milestone[];
  projects: readonly Project[];
  tasks: readonly Task[];
  protectedTime: readonly ProtectedTime[];
  offTime: readonly OffTimeSession[];
  work: readonly WorkSession[];
}

/** The Monday-first 6-week block shown for the month containing `day`. */
export function monthBlock(day: LocalDate): { start: LocalDate; end: LocalDate; month: string } {
  const first = `${day.slice(0, 7)}-01`;
  const start = startOfWeek(first);
  return { start, end: addDays(start, 41), month: day.slice(0, 7) };
}

export function shiftMonth(day: LocalDate, delta: number): LocalDate {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1 + delta;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`;
}

const ORDER = new Map(CALENDAR_KINDS.map((k, i) => [k, i]));

export function buildCalendar(
  sources: CalendarSources,
  start: LocalDate,
  end: LocalDate,
): Map<LocalDate, CalendarEntry[]> {
  const days = new Map<LocalDate, CalendarEntry[]>();
  const add = (date: LocalDate | undefined, entry: CalendarEntry) => {
    if (!date || date < start || date > end) return;
    const list = days.get(date);
    if (list) list.push(entry);
    else days.set(date, [entry]);
  };

  for (const o of sources.offTime) {
    if (o.kind === 'day_off')
      add(o.localDate, { key: o.id, kind: 'dayoff', title: 'Day off', to: '/life' });
  }
  for (const p of sources.protectedTime) {
    add(p.date, { key: p.id, kind: 'protected', title: p.title, to: '/today' });
  }
  for (const c of sources.college) {
    if (c.status === 'cancelled') continue;
    add(c.date, {
      key: c.id,
      kind: 'college',
      title: c.title,
      detail: [c.kind, c.course, c.status !== 'planned' ? c.status : undefined]
        .filter(Boolean)
        .join(' · '),
      to: '/life',
    });
  }
  for (const h of sources.hackathons) {
    if (h.status === 'dropped') continue;
    if (h.registrationDeadline && h.registrationStatus === 'not_registered') {
      add(h.registrationDeadline, {
        key: `${h.id}-reg`,
        kind: 'hackathon',
        title: `${h.name}: registration due`,
        to: '/hackathons',
      });
    }
    if (h.eventStart) {
      const last = h.eventEnd ?? h.eventStart;
      const length = daysBetween(h.eventStart, last) + 1;
      eachDay(h.eventStart, last).forEach((date, i) =>
        add(date, {
          key: `${h.id}-${date}`,
          kind: 'hackathon',
          title: h.name,
          ...(length > 1 ? { detail: `day ${i + 1} of ${length}` } : {}),
          to: '/hackathons',
        }),
      );
    }
  }
  const projects = new Map(sources.projects.map((p) => [p.id, p]));
  for (const m of sources.milestones) {
    if (!m.dueOn || m.completedAt) continue;
    const project = projects.get(m.projectId);
    add(m.dueOn, {
      key: m.id,
      kind: 'milestone',
      title: m.title,
      ...(project ? { detail: project.name, to: `/projects/${project.slug}` } : {}),
    });
  }
  for (const t of sources.tasks) {
    if (t.status !== 'todo' && t.status !== 'doing') continue;
    if (t.dueAt)
      add(localDateOfDeadline(t.dueAt), {
        key: `${t.id}-due`,
        kind: 'deadline',
        title: t.title,
        to: '/tasks',
      });
    if (t.plannedFor && (!t.dueAt || localDateOfDeadline(t.dueAt) !== t.plannedFor))
      add(t.plannedFor, { key: `${t.id}-plan`, kind: 'planned', title: t.title, to: '/today' });
  }
  const worked = new Map<LocalDate, number>();
  for (const s of sources.work) {
    if (!s.endedAt) continue;
    worked.set(s.localDate, (worked.get(s.localDate) ?? 0) + activeMinutes(s));
  }
  for (const [date, minutes] of worked) {
    if (minutes > 0)
      add(date, { key: `work-${date}`, kind: 'work', title: `Worked ${formatDuration(minutes)}` });
  }

  for (const list of days.values())
    list.sort((a, b) => ORDER.get(a.kind)! - ORDER.get(b.kind)! || a.title.localeCompare(b.title));
  return days;
}
