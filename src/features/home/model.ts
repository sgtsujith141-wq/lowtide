import { localDateOfDeadline } from '../../lib/time';
import type {
  CollegeItem,
  Hackathon,
  LocalDate,
  Project,
  ProjectFocus,
  ProjectItem,
  ProjectState,
  Task,
} from '../../types/domain';
import { hackathonsForToday } from '../hackathons/schedule';
import { isLive, type ProjectSummary } from '../projects/summary';

/*
 * Home v3 (v2 PHASE 012): what Home shows, decided from records. Pure, so
 * every rule here is tested without rendering.
 */

/** "Good morning" before noon, "Good afternoon" until 18:00, then "Good evening". */
export function greeting(now: Date): string {
  const h = now.getHours();
  return h < 5
    ? 'Good evening'
    : h < 12
      ? 'Good morning'
      : h < 18
        ? 'Good afternoon'
        : 'Good evening';
}

const FOCUS_RANK: Record<ProjectFocus | 'unset', number> = {
  primary: 0,
  secondary: 1,
  supporting: 2,
  unset: 3,
  background: 4,
};

const STATE_RANK: Record<ProjectState, number> = {
  needs_approval: 0,
  blocked: 1,
  active: 2,
  review: 3,
  waiting: 4,
  planning: 5,
  parked: 6,
  done: 7,
  archived: 8,
};

export const HOME_PROJECT_LIMIT = 4;

/**
 * Projects for Home's Project Command, most important first: the owner's
 * focus (primary, secondary, supporting, then unset), then state (needing you
 * first), then the most recent movement. Projects marked "not current"
 * (`background`) stay on Projects, not Home. At most `limit` are shown;
 * `hidden` counts the live projects left for View all.
 */
export function selectHomeProjects(
  summaries: readonly ProjectSummary[],
  limit = HOME_PROJECT_LIMIT,
): { shown: ProjectSummary[]; hidden: number } {
  const live = summaries.filter((s) => isLive(s.project));
  const candidates = live
    .filter((s) => s.project.focus !== 'background')
    .sort(
      (a, b) =>
        FOCUS_RANK[a.project.focus ?? 'unset'] - FOCUS_RANK[b.project.focus ?? 'unset'] ||
        STATE_RANK[a.project.state] - STATE_RANK[b.project.state] ||
        b.lastUpdate.localeCompare(a.lastUpdate) ||
        a.project.name.localeCompare(b.project.name),
    );
  const shown = candidates.slice(0, limit);
  return { shown, hidden: live.length - shown.length };
}

export type NeedKind = 'approval' | 'blocker' | 'overdue' | 'due' | 'hackathon' | 'college';

export interface NeedLine {
  key: string;
  kind: NeedKind;
  text: string;
}

/** One owner of things that need you: a project, a hackathon, college or loose tasks. */
export interface NeedGroup {
  key: string;
  label: string;
  to: string;
  /** Approvals and blockers, by title; overdue work as one counted line. */
  lines: NeedLine[];
  /** Whether something here can't move without you (an approval or a blocker). */
  urgent: boolean;
}

export interface NeedsInput {
  today: LocalDate;
  projects: readonly Project[];
  items: readonly ProjectItem[];
  /** Open tasks for today (planned, or due on or before today). */
  dayTasks: readonly Task[];
  hackathons: readonly Hackathon[];
  coursework: readonly CollegeItem[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Needs You, grouped by what it belongs to. Approvals and blockers are
 * listed by name (they can't move without you); overdue and due-today
 * deadlines are counted per project rather than listed one by one; a
 * hackathon appears when a registration deadline or the event is within a
 * week; college assignments, exams and events that are due or overdue are
 * counted. Groups that can't move without you come first, then by project
 * focus.
 */
export function groupNeeds(input: NeedsInput): NeedGroup[] {
  const { today } = input;
  const live = new Map(input.projects.filter(isLive).map((p) => [p.id, p]));
  const groups = new Map<string, NeedGroup & { rank: number }>();
  const projectGroup = (project: Project) => {
    let group = groups.get(project.id);
    if (!group) {
      group = {
        key: project.id,
        label: project.name,
        to: `/projects/${project.slug}`,
        lines: [],
        urgent: false,
        rank: FOCUS_RANK[project.focus ?? 'unset'],
      };
      groups.set(project.id, group);
    }
    return group;
  };

  for (const item of input.items) {
    const project = live.get(item.projectId);
    if (!project) continue;
    if (item.lane !== 'needs_approval' && item.lane !== 'blocked') continue;
    const group = projectGroup(project);
    group.urgent = true;
    group.lines.push({
      key: item.id,
      kind: item.lane === 'needs_approval' ? 'approval' : 'blocker',
      text: withoutProjectPrefix(item.title, project.name),
    });
  }
  for (const project of live.values()) {
    if (project.state !== 'needs_approval' && project.state !== 'blocked') continue;
    const group = projectGroup(project);
    if (group.lines.some((l) => l.kind === 'approval' || l.kind === 'blocker')) continue;
    group.urgent = true;
    group.lines.push({
      key: `${project.id}-state`,
      kind: project.state === 'needs_approval' ? 'approval' : 'blocker',
      text: project.state === 'needs_approval' ? 'Waiting for your approval' : 'Project is blocked',
    });
  }

  // Deadlines: counted per project (or as loose tasks), never one line each.
  const deadlines = new Map<string, { overdue: number; due: number; project?: Project }>();
  for (const task of input.dayTasks) {
    if (!task.dueAt) continue;
    const day = localDateOfDeadline(task.dueAt);
    if (day > today) continue;
    const project = task.projectId ? live.get(task.projectId) : undefined;
    const key = project?.id ?? 'tasks';
    const entry = deadlines.get(key) ?? { overdue: 0, due: 0, ...(project ? { project } : {}) };
    if (day < today) entry.overdue += 1;
    else entry.due += 1;
    deadlines.set(key, entry);
  }
  for (const [key, { overdue, due, project }] of deadlines) {
    const group = project
      ? projectGroup(project)
      : (groups.get('tasks') ??
        (groups
          .set('tasks', {
            key: 'tasks',
            label: 'Tasks',
            to: '/today',
            lines: [],
            urgent: false,
            rank: 3,
          })
          .get('tasks') as NeedGroup & { rank: number }));
    if (overdue)
      group.lines.push({
        key: `${key}-overdue`,
        kind: 'overdue',
        text: `${plural(overdue, 'overdue item')}`,
      });
    if (due)
      group.lines.push({
        key: `${key}-due`,
        kind: 'due',
        text: `${plural(due, 'item')} due today`,
      });
  }

  for (const row of hackathonsForToday(input.hackathons, today).rows) {
    groups.set(`h-${row.hackathon.id}`, {
      key: `h-${row.hackathon.id}`,
      label: row.hackathon.name,
      to: '/hackathons',
      lines: [{ key: row.hackathon.id, kind: 'hackathon', text: row.label }],
      urgent: false,
      rank: 3,
    });
  }

  const coursework = input.coursework.filter(
    (c) => c.status === 'planned' && c.kind !== 'class' && c.kind !== 'lab' && c.date <= today,
  );
  if (coursework.length) {
    const overdue = coursework.filter((c) => c.date < today).length;
    const due = coursework.length - overdue;
    groups.set('college', {
      key: 'college',
      label: 'College',
      to: '/life',
      lines: [
        ...(overdue
          ? [
              {
                key: 'college-overdue',
                kind: 'college' as const,
                text: `${plural(overdue, 'overdue item')}`,
              },
            ]
          : []),
        ...(due
          ? [
              {
                key: 'college-due',
                kind: 'college' as const,
                text: `${plural(due, 'item')} due today`,
              },
            ]
          : []),
      ],
      urgent: false,
      rank: 3,
    });
  }

  return [...groups.values()]
    .filter((g) => g.lines.length > 0)
    .sort(
      (a, b) =>
        Number(b.urgent) - Number(a.urgent) || a.rank - b.rank || a.label.localeCompare(b.label),
    )
    .map((g) => ({ key: g.key, label: g.label, to: g.to, lines: g.lines, urgent: g.urgent }));
}

/**
 * What to work on next, from records: today's plan first (a task planned for
 * today that isn't done), otherwise the next action of the highest-focus
 * project that has one.
 */
export function pickNext(
  planned: readonly Task[],
  projects: readonly ProjectSummary[],
): { text: string; context?: string; to: string } | null {
  const task = planned.find((t) => t.status !== 'done' && t.status !== 'dropped');
  if (task) {
    const project = projects.find((p) => p.project.id === task.projectId)?.project;
    return {
      text: withoutProjectPrefix(task.title, project?.name),
      ...(project ? { context: project.name } : {}),
      to: project ? `/projects/${project.slug}` : '/today',
    };
  }
  const ordered = selectHomeProjects(projects, Infinity).shown;
  for (const s of ordered) {
    const next = s.lanes.working_now[0]?.title ?? s.project.nextAction ?? s.lanes.next[0]?.title;
    if (next)
      return {
        text: withoutProjectPrefix(next, s.project.name),
        context: s.project.name,
        to: `/projects/${s.project.slug}`,
      };
  }
  return null;
}

/**
 * A title without its project's name in front ("Engine: write scripts" under
 * Engine reads "write scripts"). Presentation only; the record is unchanged.
 */
export function withoutProjectPrefix(text: string, projectName: string | undefined): string {
  if (!projectName) return text;
  const prefix = new RegExp(
    `^${projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:\u2013\u2014-]\\s*`,
    'i',
  );
  const stripped = text.replace(prefix, '');
  return stripped ? stripped.charAt(0).toUpperCase() + stripped.slice(1) : text;
}
