import { describe, expect, it } from 'vitest';
import type { ActivitySources } from '../db/repositories';
import {
  gridDays,
  offTimeLevel,
  projectLevel,
  summariseDays,
  workLevel,
} from '../features/pulse/days';
import { activeMinutes, clock, isPaused } from '../features/work/duration';
import type { Habit, HabitEntry, OffTimeSession, WorkSession } from '../types/domain';

const at = (local: string) => new Date(local).toISOString(); // local wall time → instant
const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

function session(over: Partial<WorkSession>): WorkSession {
  return {
    id: id(1),
    kind: 'general',
    startedAt: at('2026-09-28T09:00:00'),
    endedAt: at('2026-09-28T10:00:00'),
    pauses: [],
    localDate: '2026-09-28',
    createdAt: at('2026-09-28T09:00:00'),
    updatedAt: at('2026-09-28T10:00:00'),
    ...over,
  };
}

const empty: ActivitySources = {
  habits: [],
  habitEntries: [],
  workSessions: [],
  offTimeSessions: [],
  completedTasks: [],
  milestones: [],
  decisions: [],
  resolvedItems: [],
};

describe('active minutes', () => {
  it('subtracts pauses and counts an open session up to now', () => {
    const s = session({
      pauses: [{ at: at('2026-09-28T09:20:00'), resumedAt: at('2026-09-28T09:35:00') }],
    });
    expect(activeMinutes(s)).toBe(45);
    const open = session({ endedAt: undefined as never, pauses: [] });
    delete (open as Partial<WorkSession>).endedAt;
    expect(activeMinutes(open, new Date(at('2026-09-28T09:30:00')))).toBe(30);
  });

  it('stops counting during an open pause', () => {
    const paused = session({ pauses: [{ at: at('2026-09-28T09:10:00') }] });
    delete (paused as Partial<WorkSession>).endedAt;
    expect(isPaused(paused)).toBe(true);
    expect(activeMinutes(paused, new Date(at('2026-09-28T11:00:00')))).toBe(10);
  });

  it('formats a clock', () => {
    expect(clock(65_000)).toBe('1:05');
    expect(clock(3_725_000)).toBe('1:02:05');
  });
});

describe('day summaries from records (ADR-037)', () => {
  const habits: Habit[] = [
    {
      id: id(10),
      name: 'Read',
      category: 'personal',
      unit: 'check',
      archived: false,
      createdAt: at('2026-01-01T00:00:00'),
    },
    {
      id: id(11),
      name: 'Gym',
      category: 'fitness',
      unit: 'check',
      archived: false,
      createdAt: at('2026-01-01T00:00:00'),
    },
    {
      id: id(12),
      name: 'Budget',
      category: 'money',
      unit: 'check',
      archived: false,
      createdAt: at('2026-01-01T00:00:00'),
    },
  ];
  const entry = (habitId: string, date: string, n: number): HabitEntry => ({
    id: id(100 + n),
    habitId,
    date,
    value: 1,
    createdAt: at(`${date}T08:00:00`),
    updatedAt: at(`${date}T08:00:00`),
  });

  it('turns real records into signals and a pulse, ignoring money', () => {
    const sources: ActivitySources = {
      ...empty,
      habits,
      habitEntries: [
        entry(id(10), '2026-09-28', 1),
        entry(id(11), '2026-09-28', 2),
        entry(id(12), '2026-09-28', 3),
      ],
      workSessions: [
        session({ id: id(1) }),
        session({
          id: id(2),
          kind: 'college',
          startedAt: at('2026-09-28T14:00:00'),
          endedAt: at('2026-09-28T14:40:00'),
        }),
      ],
      completedTasks: [
        {
          id: id(20),
          title: 't',
          status: 'done',
          priority: 'normal',
          createdAt: at('2026-09-01T00:00:00'),
          completedAt: at('2026-09-28T18:00:00'),
          updatedAt: at('2026-09-28T18:00:00'),
        },
      ],
    };
    const d = summariseDays(sources, '2026-09-27', '2026-09-28').get('2026-09-28')!;
    expect(d.workMinutes).toBe(60);
    expect(d.collegeMinutes).toBe(40);
    expect(d.tasksCompleted).toBe(1);
    expect(d.routines.map((r) => r.name)).toEqual(['Budget', 'Gym', 'Read']);
    expect(d.signals).toMatchObject({
      workMinutes: 60,
      collegeMinutes: 40,
      progressMoves: 1,
      personalRoutines: 1,
      movementRoutines: 1,
      workRoutines: 0,
      collegeRoutines: 0,
    });
    // work 1 + college 1 + progress 1 + personal 1 + movement 1 = 5 → strong
    expect(d.pulse).toMatchObject({ total: 5, level: 3 });
  });

  it('counts an off-time window on the day it ended, and a declared day off', () => {
    const off: OffTimeSession[] = [
      {
        id: id(30),
        kind: 'sleep',
        localDate: '2026-09-27',
        startedAt: at('2026-09-27T23:00:00'),
        endedAt: at('2026-09-28T06:30:00'),
        createdAt: at('2026-09-27T23:00:00'),
        updatedAt: at('2026-09-28T06:30:00'),
      },
      {
        id: id(31),
        kind: 'day_off',
        localDate: '2026-09-28',
        createdAt: at('2026-09-20T10:00:00'),
        updatedAt: at('2026-09-20T10:00:00'),
      },
    ];
    const days = summariseDays({ ...empty, offTimeSessions: off }, '2026-09-27', '2026-09-28');
    expect(days.get('2026-09-27')).toBeUndefined();
    const d = days.get('2026-09-28')!;
    expect(d.offTimeMinutes).toBe(450);
    expect(d.dayOff).toBe(true);
    expect(d.pulse).toMatchObject({ level: 3, dayOffApplied: true });
  });

  it('never counts an unfinished session or anything outside the range', () => {
    const open = session({ id: id(3) });
    delete (open as Partial<WorkSession>).endedAt;
    const days = summariseDays(
      { ...empty, workSessions: [open, session({ id: id(4), localDate: '2026-09-01' })] },
      '2026-09-27',
      '2026-09-28',
    );
    expect(days.size).toBe(0);
  });

  it('gives each themed grid its own capped level and a text label', () => {
    const sources: ActivitySources = {
      ...empty,
      habits,
      habitEntries: [entry(id(11), '2026-09-28', 2)],
      workSessions: [session({ endedAt: at('2026-09-28T21:00:00') })],
    };
    const days = summariseDays(sources, '2026-09-28', '2026-09-28');
    const work = gridDays(days, 'work').get('2026-09-28')!;
    expect(work.level).toBe(4);
    expect(work.label).toMatch(/12 h of work/);
    expect(gridDays(days, 'gym').get('2026-09-28')!.level).toBe(4);
    expect(gridDays(days, 'personal').has('2026-09-28')).toBe(false);
    expect(gridDays(days, 'sleep').has('2026-09-28')).toBe(false);
    const pulse = gridDays(days, 'pulse').get('2026-09-28')!;
    expect(pulse.label).toMatch(/pulse: 12 h work, 1 routine/);
  });

  it('bands work, projects and off time without rewarding excess', () => {
    expect([0, 1, 29, 30, 89, 90, 179, 180, 900].map(workLevel)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
    expect([0, 1, 2, 3, 4, 5, 50].map(projectLevel)).toEqual([0, 1, 2, 3, 3, 4, 4]);
    expect([0, 60, 180, 300, 420, 900].map(offTimeLevel)).toEqual([0, 1, 2, 3, 4, 4]);
  });
});
