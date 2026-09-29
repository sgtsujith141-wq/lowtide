import { describe, expect, it } from 'vitest';
import { progressSeries, projectCalendar, weeklyMinutes } from '../features/projects/charts';
import { summariseProject } from '../features/projects/summary';
import type {
  LedgerEvent,
  Milestone,
  ProgressSnapshot,
  Project,
  ProjectItem,
  Task,
  WorkSession,
} from '../types/domain';

const T = '2026-09-20T08:00:00.000Z';
const id = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project: Project = {
  id: id(1),
  name: 'Engine',
  slug: 'engine',
  kind: 'software',
  state: 'active',
  createdAt: T,
  updatedAt: T,
  stateChangedAt: T,
};
const milestone = (n: number, done: boolean, weight = 1): Milestone => ({
  id: id(100 + n),
  projectId: project.id,
  title: `M${n}`,
  order: n,
  weight,
  ...(done ? { completedAt: T } : {}),
  createdAt: T,
  updatedAt: T,
});
const task = (n: number, status: Task['status'], projectId = project.id): Task => ({
  id: id(200 + n),
  title: `T${n}`,
  status,
  priority: 'normal',
  projectId,
  createdAt: T,
  updatedAt: T,
});
const item = (n: number, over: Partial<ProjectItem>): ProjectItem => ({
  id: id(300 + n),
  projectId: project.id,
  kind: 'step',
  lane: 'next',
  title: `I${n}`,
  order: n,
  createdAt: T,
  updatedAt: T,
  laneChangedAt: T,
  ...over,
});
const session = (localDate: string, minutes: number, projectId = project.id): WorkSession => {
  const start = new Date(`${localDate}T09:00:00`);
  return {
    id: crypto.randomUUID(),
    kind: 'project',
    projectId,
    startedAt: start.toISOString(),
    endedAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
    pauses: [],
    localDate,
    createdAt: T,
    updatedAt: T,
  };
};

describe('project summary', () => {
  it('derives completion, current milestone, lanes and time from records only', () => {
    const s = summariseProject(
      project,
      [milestone(2, false), milestone(0, true), milestone(1, true, 2)],
      [
        item(1, { kind: 'approval', lane: 'needs_approval', title: 'Sign off' }),
        item(2, { kind: 'dependency', lane: 'waiting', title: 'Review', waitingOn: 'a teammate' }),
        item(3, { kind: 'blocker', lane: 'blocked', title: 'Stuck', taskId: id(203) }),
      ],
      [
        task(1, 'doing'),
        task(2, 'todo'),
        task(3, 'todo'),
        task(4, 'dropped'),
        task(5, 'done'),
        task(6, 'todo', id(9)),
      ],
      [session('2026-09-28', 30), session('2026-09-21', 45), session('2026-09-28', 99, id(9))],
      '2026-09-30',
    );
    expect(s.completion).toEqual({ completedWeight: 3, totalWeight: 4, percent: 75 });
    expect(s.currentMilestone?.title).toBe('M2');
    expect(s.lanes.working_now.map((e) => e.title)).toEqual(['T1']);
    // T3 is shown once, through the blocker that refers to it; dropped T4 is hidden.
    expect(s.lanes.next.map((e) => e.title)).toEqual(['T2']);
    expect(s.lanes.blocked.map((e) => e.title)).toEqual(['Stuck']);
    expect(s.lanes.waiting).toEqual([
      { kind: 'item', id: id(302), title: 'Review', detail: 'a teammate' },
    ]);
    expect(s.lanes.done.map((e) => e.title)).toEqual(['T5']);
    expect(s.minutesThisWeek).toBe(30);
    expect(s.minutesTotal).toBe(75);
  });

  it('shows no percentage without milestones', () => {
    expect(summariseProject(project, [], [], [], [], '2026-09-30').completion).toBeNull();
  });
});

describe('command room charts', () => {
  const snap = (localDate: string, done: number, total: number): ProgressSnapshot => ({
    id: crypto.randomUUID(),
    projectId: project.id,
    localDate,
    completedWeight: done,
    totalWeight: total,
    milestoneCount: total,
    completedCount: done,
    state: 'active',
    laneCounts: {
      working_now: 0,
      next: 0,
      waiting: 0,
      needs_approval: 0,
      blocked: 0,
      parked: 0,
      done: 0,
    },
    updatedAt: T,
  });

  it('carries snapshots forward and starts at the first one (no invented history)', () => {
    const series = progressSeries(
      [snap('2026-09-28', 0, 0), snap('2026-09-29', 1, 4)],
      '2026-09-30',
    );
    expect(series).toEqual([
      { date: '2026-09-28', percent: null, carried: false },
      { date: '2026-09-29', percent: 25, carried: false },
      { date: '2026-09-30', percent: 25, carried: true },
    ]);
    expect(progressSeries([], '2026-09-30')).toEqual([]);
  });

  it('buckets finished work into Monday-first weeks', () => {
    const weeks = weeklyMinutes(
      [
        session('2026-09-28', 30),
        session('2026-09-30', 15),
        session('2026-09-21', 60),
        session('2025-01-01', 99),
      ],
      '2026-09-30',
      3,
    );
    expect(weeks).toEqual([
      { weekStart: '2026-09-14', minutes: 0 },
      { weekStart: '2026-09-21', minutes: 60 },
      { weekStart: '2026-09-28', minutes: 45 },
    ]);
  });

  it('colours a project day by the higher of its work and its movement', () => {
    const event = (localDate: string, type: LedgerEvent['type']): LedgerEvent => ({
      id: crypto.randomUUID(),
      type,
      at: `${localDate}T10:00:00.000Z`,
      localDate,
      entityType: 'milestone',
      entityId: id(1),
      projectId: project.id,
      data: {},
      source: 'app',
    });
    const days = projectCalendar(
      [
        event('2026-09-28', 'milestone.completed'),
        event('2026-09-28', 'decision.recorded'),
        event('2026-09-29', 'work.started'),
      ],
      [session('2026-09-29', 200)],
    );
    expect(days.get('2026-09-28')).toMatchObject({ level: 2 });
    expect(days.get('2026-09-29')).toMatchObject({ level: 4 });
    expect(days.get('2026-09-29')!.label).toMatch(/3 h 20 m of work/);
  });
});
