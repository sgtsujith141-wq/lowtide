import { describe, expect, it } from 'vitest';
import { activityLine } from '../features/projects/activity';
import {
  byRoadmap,
  concise,
  healthOf,
  milestoneCount,
  nowNext,
  tierOf,
} from '../features/projects/display';
import { summariseProject } from '../features/projects/summary';
import type { LedgerEvent, Milestone, Project, ProjectItem, Task } from '../types/domain';

const at = '2026-03-02T10:00:00.000Z';
const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'Engine',
  slug: 'engine',
  kind: 'software',
  state: 'active',
  createdAt: at,
  updatedAt: at,
  stateChangedAt: at,
  ...over,
});
const milestone = (order: number, title: string, done = false): Milestone => ({
  id: `m${order}`,
  projectId: 'p1',
  title,
  order,
  weight: 1,
  ...(done ? { completedAt: at } : {}),
  createdAt: at,
  updatedAt: at,
});
const task = (id: string, title: string, status: Task['status']): Task => ({
  id,
  title,
  status,
  priority: 'normal',
  projectId: 'p1',
  createdAt: at,
  updatedAt: at,
});
const item = (id: string, kind: ProjectItem['kind'], lane: ProjectItem['lane'], title: string) =>
  ({
    id,
    projectId: 'p1',
    kind,
    lane,
    title,
    order: 0,
    createdAt: at,
    updatedAt: at,
    laneChangedAt: at,
  }) as ProjectItem;
const summary = (p: Project, ms: Milestone[] = [], tasks: Task[] = [], items: ProjectItem[] = []) =>
  summariseProject(p, ms, items, tasks, [], '2026-03-02');

describe('concise display text (deterministic, no AI)', () => {
  it('says known imported phrasings plainly and keeps the original', () => {
    const c = concise(
      'Blocked: Not listed in either portfolio (Plan A / Plan B) - confirm its position',
    );
    expect(c).toEqual({
      text: 'Portfolio position needs confirmation',
      full: 'Blocked: Not listed in either portfolio (Plan A / Plan B) - confirm its position',
      shortened: true,
    });
    expect(concise('CONFLICT: Team HQ lists Other Thing as SECONDARY instead.').text).toBe(
      'Priority recorded differently in Team HQ',
    );
  });

  it('drops the project’s name, labels and parentheticals, then the trailing clause', () => {
    expect(concise('Engine: wire the bus', 'Engine').text).toBe('Wire the bus');
    expect(concise('Note: check the queue (see the spec)').text).toBe('Check the queue');
    expect(
      concise(
        'Finish the scheduler and the queue for every brand at once - then measure what happened afterwards',
      ).text,
    ).toBe('Finish the scheduler and the queue for every brand at once');
  });

  it('cuts very long text at a word boundary, and leaves short text alone', () => {
    const long = concise('word '.repeat(40).trim());
    expect(long.text.length).toBeLessThanOrEqual(64);
    expect(long.text.endsWith('…')).toBe(true);
    expect(concise('Ship v1')).toEqual({ text: 'Ship v1', full: 'Ship v1', shortened: false });
  });
});

describe('now and next', () => {
  const ms = [milestone(0, 'Scope', true), milestone(1, 'Foundation'), milestone(2, 'Launch')];

  it('reads the current milestone as now and the following one as next', () => {
    expect(nowNext(summary(project(), ms))).toEqual({ now: 'Foundation', next: 'Launch' });
  });

  it('prefers work in progress, never repeats itself, and drops the project name', () => {
    const s = summary(project(), ms, [
      task('t1', 'Engine: launch', 'doing'),
      task('t2', 'Engine: foundation', 'doing'),
    ]);
    // In roadmap order, the item matching the current stage leads.
    expect(nowNext(s)).toEqual({ now: 'Foundation', next: undefined });
  });

  it('orders board entries by the roadmap', () => {
    const s = summary(project(), ms, [
      task('a', 'Engine: launch', 'todo'),
      task('b', 'Unrelated chore', 'todo'),
      task('c', 'Engine: foundation', 'todo'),
    ]);
    expect(byRoadmap(s.lanes.next, ms, 'Engine').map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('falls back to the recorded next action', () => {
    expect(nowNext(summary(project({ nextAction: 'Call the printer' })))).toEqual({
      now: undefined,
      next: 'Call the printer',
    });
  });
});

describe('portfolio tiers and health', () => {
  it('places projects by focus, splitting "not current" into later and other by state', () => {
    expect(tierOf(project({ focus: 'primary' }))).toBe('primary');
    expect(tierOf(project({ focus: 'background', state: 'planning' }))).toBe('later');
    expect(tierOf(project({ focus: 'background', state: 'parked' }))).toBe('later');
    expect(tierOf(project({ focus: 'background', state: 'active' }))).toBe('other');
    expect(tierOf(project())).toBe('unsorted');
  });

  it('says health in words, never as a score', () => {
    expect(healthOf(summary(project())).text).toBe('Nothing blocked or waiting on you');
    const blocked = summary(project(), [], [], [item('i', 'blocker', 'blocked', 'No fixtures')]);
    expect(healthOf(blocked)).toEqual({ text: 'Needs you: 1 blocker', tone: 'attention' });
    expect(milestoneCount(ms3())).toBe('1 of 3 milestones');
  });
});

const ms3 = () => [milestone(0, 'A', true), milestone(1, 'B'), milestone(2, 'C')];

describe('activity lines', () => {
  const event = (over: Partial<LedgerEvent>): LedgerEvent => ({
    id: 'e',
    type: 'task.completed',
    at,
    localDate: '2026-03-02',
    entityType: 'task',
    entityId: 'x',
    projectId: 'p1',
    data: {},
    source: 'app',
    ...over,
  });

  it('keeps only meaningful events and leads with who did it', () => {
    expect(
      activityLine({ event: event({ type: 'work.started' }) }, 'Engine', new Map()),
    ).toBeNull();
    expect(
      activityLine({ event: event({}), title: 'Engine: ship it' }, 'Engine', new Map()),
    ).toMatchObject({ who: 'You', text: 'Completed: Ship it' });
  });

  it('cuts an AI session’s summary to one line and names the client', () => {
    const line = activityLine(
      {
        event: event({ type: 'ai.session.completed', source: 'ai-client', actor: 'Claude' }),
        title: 'A very long summary '.repeat(10),
      },
      'Engine',
      new Map(),
    )!;
    expect(line.who).toBe('Claude');
    expect(line.text.length).toBeLessThanOrEqual(82);
  });
});
