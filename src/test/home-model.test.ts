import { describe, expect, it } from 'vitest';
import {
  greeting,
  groupNeeds,
  pickNext,
  selectHomeProjects,
  withoutProjectPrefix,
} from '../features/home/model';
import type { ProjectSummary } from '../features/projects/summary';
import type { Project, ProjectFocus, ProjectItem, ProjectState, Task } from '../types/domain';

const T = '2026-01-10T09:00:00.000Z';
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function project(
  name: string,
  state: ProjectState = 'active',
  focus?: ProjectFocus,
  updatedAt = T,
): Project {
  return {
    id: id(),
    name,
    slug: name.toLowerCase(),
    kind: 'software',
    state,
    ...(focus ? { focus } : {}),
    createdAt: T,
    updatedAt,
    stateChangedAt: T,
  };
}

function summary(p: Project, next?: string): ProjectSummary {
  const lanes = {
    working_now: [],
    next: [],
    waiting: [],
    needs_approval: [],
    blocked: [],
    parked: [],
    done: [],
  };
  return {
    project: next ? { ...p, nextAction: next } : p,
    completion: null,
    milestones: [],
    currentMilestone: undefined,
    lanes,
    minutesThisWeek: 0,
    minutesTotal: 0,
    lastUpdate: p.updatedAt,
  };
}

describe('Home model', () => {
  it('greets by the time of day', () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe('Good morning');
    expect(greeting(new Date(2026, 0, 1, 14))).toBe('Good afternoon');
    expect(greeting(new Date(2026, 0, 1, 21))).toBe('Good evening');
    expect(greeting(new Date(2026, 0, 1, 2))).toBe('Good evening');
  });

  it('selects projects by focus, then state, then recent movement, and leaves "not current" off Home', () => {
    const s = [
      summary(project('Recent', 'active', undefined, '2026-01-12T00:00:00.000Z')),
      summary(project('Blocked', 'blocked')),
      summary(project('Second', 'active', 'secondary')),
      summary(project('Off', 'active', 'background')),
      summary(project('First', 'planning', 'primary')),
      summary(project('Support', 'active', 'supporting')),
      summary(project('Gone', 'archived', 'primary')),
    ];
    const { shown, hidden } = selectHomeProjects(s);
    expect(shown.map((x) => x.project.name)).toEqual(['First', 'Second', 'Support', 'Blocked']);
    // Live projects not shown: Recent and Off (archived ones don't count).
    expect(hidden).toBe(2);
  });

  it('with no focus set anywhere, shows the projects that need you, then the most recently moved', () => {
    const s = [
      summary(project('Old')),
      summary(project('New', 'active', undefined, '2026-01-11T00:00:00.000Z')),
      summary(project('Waiting on me', 'needs_approval')),
    ];
    expect(selectHomeProjects(s).shown.map((x) => x.project.name)).toEqual([
      'Waiting on me',
      'New',
      'Old',
    ]);
  });

  it('groups needs per project, counts deadlines, and puts what can’t move without you first', () => {
    const today = '2026-01-10';
    const engine = project('Engine', 'active', 'secondary');
    const lab = project('Lab', 'active', 'primary');
    const item = (
      projectId: string,
      kind: ProjectItem['kind'],
      lane: ProjectItem['lane'],
      title: string,
    ): ProjectItem => ({
      id: id(),
      projectId,
      kind,
      lane,
      title,
      order: 0,
      createdAt: T,
      updatedAt: T,
      laneChangedAt: T,
    });
    const task = (projectId: string | undefined, due: string): Task => ({
      id: id(),
      title: 'x',
      status: 'todo',
      priority: 'normal',
      dueAt: `${due}T23:59:00.000Z`,
      ...(projectId ? { projectId } : {}),
      createdAt: T,
      updatedAt: T,
    });
    const groups = groupNeeds({
      today,
      projects: [engine, lab],
      items: [
        item(engine.id, 'blocker', 'blocked', 'Engine: no fixtures'),
        item(engine.id, 'idea', 'next', 'Not a need'),
      ],
      dayTasks: [
        task(lab.id, '2026-01-08'),
        task(lab.id, '2026-01-09'),
        task(lab.id, today),
        task(undefined, '2026-01-01'),
      ],
      hackathons: [],
      coursework: [],
    });
    expect(groups.map((g) => g.label)).toEqual(['Engine', 'Lab', 'Tasks']);
    expect(groups[0]).toMatchObject({ urgent: true, to: '/projects/engine' });
    expect(groups[0]!.lines.map((l) => l.text)).toEqual(['No fixtures']);
    expect(groups[1]!.lines.map((l) => l.text)).toEqual(['2 overdue items', '1 item due today']);
    expect(groups[2]!.lines.map((l) => l.text)).toEqual(['1 overdue item']);
  });

  it('returns no groups when nothing needs you', () => {
    expect(
      groupNeeds({
        today: '2026-01-10',
        projects: [project('Calm')],
        items: [],
        dayTasks: [],
        hackathons: [],
        coursework: [],
      }),
    ).toEqual([]);
  });

  it('picks what’s next: today’s plan first, else the top project’s next action', () => {
    const p = project('Engine', 'active', 'primary');
    const planned: Task = {
      id: id(),
      title: 'Engine: fit the bus',
      status: 'todo',
      priority: 'normal',
      projectId: p.id,
      createdAt: T,
      updatedAt: T,
    };
    expect(pickNext([planned], [summary(p)])).toEqual({
      text: 'Fit the bus',
      context: 'Engine',
      to: '/projects/engine',
    });
    expect(pickNext([], [summary(p, 'Write the spec')])).toEqual({
      text: 'Write the spec',
      context: 'Engine',
      to: '/projects/engine',
    });
    expect(pickNext([], [summary(p)])).toBeNull();
  });

  it('drops a project name only when it prefixes the title', () => {
    expect(withoutProjectPrefix('Engine: update bio', 'Engine')).toBe('Update bio');
    expect(withoutProjectPrefix('Engine — ship', 'engine')).toBe('Ship');
    expect(withoutProjectPrefix('Update Engine bio', 'Engine')).toBe('Update Engine bio');
    expect(withoutProjectPrefix('C++ notes', 'C++')).toBe('C++ notes');
    expect(withoutProjectPrefix('C++: notes', 'C++')).toBe('Notes');
  });
});
