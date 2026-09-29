import { describe, expect, it } from 'vitest';
import { hackathonStages } from '../features/hackathons/progress';
import { projectCompletion } from '../features/projects/completion';
import {
  bandPulse,
  dailyPulse,
  EMPTY_PULSE_SIGNALS,
  type PulseSignals,
} from '../features/pulse/daily-pulse';
import { CATEGORY_PRESET, routineSignals } from '../features/rhythm/presets';
import { HABIT_CATEGORIES } from '../types/domain';

const day = (signals: Partial<PulseSignals>) => dailyPulse({ ...EMPTY_PULSE_SIGNALS, ...signals });

describe('Daily Pulse v1 (ADR-037)', () => {
  it('bands points 0 · 1 · 2–3 · 4–5 · 6+', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(bandPulse)).toEqual([0, 1, 2, 2, 3, 3, 4, 4, 4]);
  });

  it('is 0 for a day with no signals', () => {
    expect(day({})).toEqual({
      level: 0,
      total: 0,
      dayOffApplied: false,
      points: { work: 0, progress: 0, college: 0, personal: 0, movement: 0, recovery: 0 },
    });
  });

  it('scores each signal at its documented points', () => {
    expect(day({ workMinutes: 24 }).points.work).toBe(0);
    expect(day({ workMinutes: 25 }).points.work).toBe(1);
    expect(day({ workRoutines: 1 }).points.work).toBe(1);
    expect(day({ workMinutes: 90 }).points.work).toBe(2);
    expect(day({ progressMoves: 1 }).points.progress).toBe(1);
    expect(day({ collegeMinutes: 25 }).points.college).toBe(1);
    expect(day({ collegeRoutines: 1 }).points.college).toBe(1);
    expect(day({ personalRoutines: 1 }).points.personal).toBe(1);
    expect(day({ personalRoutines: 2 }).points.personal).toBe(2);
    expect(day({ movementRoutines: 1 }).points.movement).toBe(1);
    expect(day({ offTimeCompleted: true }).points.recovery).toBe(1);
  });

  it('never rewards more hours or more of anything past each cap', () => {
    expect(day({ workMinutes: 12 * 60 })).toEqual(day({ workMinutes: 90 }));
    expect(day({ progressMoves: 40 })).toEqual(day({ progressMoves: 1 }));
    expect(day({ personalRoutines: 9 })).toEqual(day({ personalRoutines: 2 }));
    expect(day({ movementRoutines: 3 })).toEqual(day({ movementRoutines: 1 }));
    expect(day({ collegeMinutes: 600, collegeRoutines: 4 })).toEqual(day({ collegeMinutes: 25 }));
  });

  it('reaches high without the gym', () => {
    const noGym = day({
      workMinutes: 120,
      progressMoves: 2,
      personalRoutines: 2,
      offTimeCompleted: true,
    });
    expect(noGym.points.movement).toBe(0);
    expect(noGym.level).toBe(4);
  });

  it('lets a declared day off be strong or high on rest alone', () => {
    expect(day({ dayOff: true }).level).toBe(1);
    expect(day({ dayOff: true, personalRoutines: 1 }).level).toBe(2);
    expect(day({ dayOff: true, offTimeCompleted: true })).toMatchObject({
      level: 3,
      dayOffApplied: true,
    });
    expect(day({ dayOff: true, offTimeCompleted: true, movementRoutines: 1 }).level).toBe(4);
    // Without the declaration the same rest is only light.
    expect(day({ offTimeCompleted: true }).level).toBe(1);
  });

  it('never lowers a day off that had work in it', () => {
    const worked = day({ dayOff: true, workMinutes: 90, progressMoves: 1, personalRoutines: 2 });
    expect(worked.level).toBe(3);
    expect(worked.dayOffApplied).toBe(false);
  });

  it('treats nonsense amounts as nothing, never as more', () => {
    expect(
      day({ workMinutes: Number.NaN, progressMoves: -3, personalRoutines: Infinity }).level,
    ).toBe(0);
  });

  it('has no protected-time, inbox or money signal', () => {
    expect(Object.keys(EMPTY_PULSE_SIGNALS).sort()).toEqual([
      'collegeMinutes',
      'collegeRoutines',
      'dayOff',
      'movementRoutines',
      'offTimeCompleted',
      'personalRoutines',
      'progressMoves',
      'workMinutes',
      'workRoutines',
    ]);
  });
});

describe('grid presets (ADR-045)', () => {
  it('maps every existing category, leaving money unmapped', () => {
    expect(Object.keys(CATEGORY_PRESET).sort()).toEqual([...HABIT_CATEGORIES].sort());
    expect(CATEGORY_PRESET).toEqual({
      coding: 'work',
      learning: 'college',
      fitness: 'gym',
      health: 'personal',
      personal: 'personal',
      money: null,
    });
  });

  it('counts routines at level 1 or more by preset, ignoring money and level 0', () => {
    expect(
      routineSignals([
        { category: 'coding', level: 4 },
        { category: 'learning', level: 1 },
        { category: 'fitness', level: 0 },
        { category: 'health', level: 2 },
        { category: 'personal', level: 4 },
        { category: 'money', level: 4 },
      ]),
    ).toEqual({ workRoutines: 1, collegeRoutines: 1, movementRoutines: 0, personalRoutines: 2 });
  });
});

describe('project completion (ADR-038)', () => {
  it('shows nothing without milestones', () => {
    expect(projectCompletion([])).toBeNull();
  });

  it('uses weight 1 by default and weighs milestones, not counts', () => {
    expect(projectCompletion([{ completed: true }, { completed: false }])).toEqual({
      completedWeight: 1,
      totalWeight: 2,
      percent: 50,
    });
    expect(
      projectCompletion([
        { completed: true, weight: 3 },
        { completed: false, weight: 1 },
      ])?.percent,
    ).toBe(75);
  });

  it('can go down when a milestone is added', () => {
    const before = projectCompletion([{ completed: true }, { completed: false }])!;
    const after = projectCompletion([
      { completed: true },
      { completed: false },
      { completed: false },
    ])!;
    expect(after.percent).toBeLessThan(before.percent);
  });

  it('reads 100 only when every milestone is done, despite float rounding', () => {
    expect(
      projectCompletion([
        { completed: true, weight: 0.1 },
        { completed: true, weight: 0.2 },
      ])?.percent,
    ).toBe(100);
    expect(
      projectCompletion([
        { completed: true, weight: 999 },
        { completed: false, weight: 1 },
      ])?.percent,
    ).toBe(99);
  });

  it('rejects weights that are not above 0', () => {
    for (const weight of [0, -1, Number.NaN, Infinity]) {
      expect(() => projectCompletion([{ completed: false, weight }])).toThrow(RangeError);
    }
  });
});

describe('hackathon stages (ADR-039, ADR-053)', () => {
  it('derives seven stages only from the hackathon’s own fields', () => {
    expect(
      hackathonStages({
        registrationStatus: 'registered',
        problemStatement: 'Smart irrigation',
        pptStatus: 'in_progress',
        buildStatus: 'not_started',
      }),
    ).toEqual([
      { key: 'registration', state: 'done' },
      { key: 'problem', state: 'done' },
      { key: 'research', state: 'done' },
      { key: 'ppt', state: 'active' },
      { key: 'build', state: 'todo' },
      { key: 'testing', state: 'todo' },
      { key: 'submission', state: 'todo' },
    ]);
  });

  it('puts research between knowing the problem and starting work, and drops an unneeded PPT', () => {
    const stages = hackathonStages({
      registrationStatus: 'waitlisted',
      problemStatement: 'PS 4',
      pptStatus: 'not_needed',
      buildStatus: 'not_started',
    });
    expect(stages.map((s) => s.key)).not.toContain('ppt');
    expect(stages.find((s) => s.key === 'registration')?.state).toBe('active');
    expect(stages.find((s) => s.key === 'research')?.state).toBe('active');
  });

  it('marks testing active at demo-ready and everything done once submitted', () => {
    const demo = hackathonStages({
      registrationStatus: 'registered',
      pptStatus: 'submitted',
      buildStatus: 'demo_ready',
    });
    expect(demo.find((s) => s.key === 'testing')?.state).toBe('active');
    expect(demo.find((s) => s.key === 'problem')?.state).toBe('todo'); // no problem recorded
    const done = hackathonStages({
      registrationStatus: 'registered',
      problemStatement: 'x',
      pptStatus: 'submitted',
      buildStatus: 'submitted',
    });
    expect(done.every((s) => s.state === 'done')).toBe(true);
  });
});
