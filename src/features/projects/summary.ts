import { startOfWeek } from '../../lib/calendar';
import { toLocalDate } from '../../lib/time';
import type {
  LocalDate,
  Milestone,
  Project,
  ProjectItem,
  ProjectFocus,
  ProjectLane,
  ProjectState,
  Task,
  WorkSession,
} from '../../types/domain';
import { activeMinutes } from '../work/duration';
import { projectCompletion, type ProjectCompletion } from './completion';

/*
 * One project's command state, derived from its records (pure). Used by the
 * Home cards and the Command Room so both always say the same thing.
 */

export const STATE_LABEL: Record<ProjectState, string> = {
  planning: 'Planning',
  active: 'Active',
  waiting: 'Waiting',
  needs_approval: 'Needs approval',
  blocked: 'Blocked',
  parked: 'Parked',
  review: 'Review',
  done: 'Done',
  archived: 'Archived',
};

export const FOCUS_LABEL: Record<ProjectFocus, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  supporting: 'Supporting',
  background: 'Not current',
};

export const LANE_LABEL: Record<ProjectLane, string> = {
  working_now: 'Working now',
  next: 'Next',
  waiting: 'Waiting',
  needs_approval: 'Needs approval',
  blocked: 'Blocked',
  parked: 'Parked',
  done: 'Done',
};

/** Tone per state: calm by default, warm for "needs you", muted when resting. */
export const STATE_TONE: Record<ProjectState, 'calm' | 'attention' | 'quiet' | 'done'> = {
  planning: 'calm',
  active: 'calm',
  review: 'calm',
  waiting: 'quiet',
  parked: 'quiet',
  needs_approval: 'attention',
  blocked: 'attention',
  done: 'done',
  archived: 'quiet',
};

export const isLive = (p: Project) => p.state !== 'done' && p.state !== 'archived';

export interface LaneEntry {
  kind: 'item' | 'task';
  id: string;
  title: string;
  detail?: string;
}

export interface ProjectSummary {
  project: Project;
  completion: ProjectCompletion | null;
  milestones: Milestone[];
  /** Next open milestone in pipeline order. */
  currentMilestone: Milestone | undefined;
  lanes: Record<ProjectLane, LaneEntry[]>;
  minutesThisWeek: number;
  minutesTotal: number;
  /** Last meaningful change: the project's own `updatedAt` (bumped by every move). */
  lastUpdate: string;
}

const EMPTY_LANES = (): Record<ProjectLane, LaneEntry[]> => ({
  working_now: [],
  next: [],
  waiting: [],
  needs_approval: [],
  blocked: [],
  parked: [],
  done: [],
});

/**
 * Items sit in their own lane. Tasks appear by status (architecture §5.3):
 * doing → Working now, todo → Next, done → Done; dropped tasks are hidden.
 * A task an item refers to is shown once, through the item.
 */
export function summariseProject(
  project: Project,
  milestones: readonly Milestone[],
  items: readonly ProjectItem[],
  tasks: readonly Task[],
  sessions: readonly WorkSession[],
  today: LocalDate,
): ProjectSummary {
  const mine = milestones
    .filter((m) => m.projectId === project.id)
    .sort((a, b) => a.order - b.order);
  const myItems = items.filter((i) => i.projectId === project.id);
  const referenced = new Set(myItems.map((i) => i.taskId).filter(Boolean));
  const lanes = EMPTY_LANES();
  for (const item of myItems) {
    lanes[item.lane].push({
      kind: 'item',
      id: item.id,
      title: item.title,
      ...(item.waitingOn ? { detail: item.waitingOn } : {}),
    });
  }
  for (const task of tasks) {
    if (task.projectId !== project.id || referenced.has(task.id)) continue;
    const lane: ProjectLane | null =
      task.status === 'doing'
        ? 'working_now'
        : task.status === 'todo'
          ? 'next'
          : task.status === 'done'
            ? 'done'
            : null;
    if (lane) lanes[lane].push({ kind: 'task', id: task.id, title: task.title });
  }
  const weekStart = startOfWeek(today);
  let minutesThisWeek = 0;
  let minutesTotal = 0;
  for (const s of sessions) {
    if (s.projectId !== project.id || s.endedAt === undefined) continue;
    const minutes = activeMinutes(s);
    minutesTotal += minutes;
    if (s.localDate >= weekStart && s.localDate <= today) minutesThisWeek += minutes;
  }
  return {
    project,
    completion: projectCompletion(
      mine.map((m) => ({ weight: m.weight, completed: m.completedAt !== undefined })),
    ),
    milestones: mine,
    currentMilestone: mine.find((m) => m.completedAt === undefined),
    lanes,
    minutesThisWeek,
    minutesTotal,
    lastUpdate: project.updatedAt,
  };
}

/** Work minutes per day for the last `days` days ending today (for sparklines). */
export function dailyMinutes(
  sessions: readonly WorkSession[],
  projectId: string,
  days: LocalDate[],
): number[] {
  const totals = new Map(days.map((d) => [d, 0]));
  for (const s of sessions) {
    if (s.projectId !== projectId || s.endedAt === undefined || !totals.has(s.localDate)) continue;
    totals.set(s.localDate, totals.get(s.localDate)! + activeMinutes(s));
  }
  return days.map((d) => totals.get(d)!);
}

export const todayOf = (now = new Date()) => toLocalDate(now);
