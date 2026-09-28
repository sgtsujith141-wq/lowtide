import { describe, expect, it } from 'vitest';
import { buildGrid, gridRange, monthLabels, type GridDay } from '../features/rhythm/grid';
import { formatValue, habitLevel, overallLevel } from '../features/rhythm/intensity';
import {
  HABIT_CATEGORIES,
  PROTECTED_TIME_KINDS,
  type Habit,
  type HabitEntry,
} from '../types/domain';

const today = '2026-09-28'; // Monday

function habit(partial: Partial<Habit> & { name: string; unit: Habit['unit'] }): Habit {
  return {
    id: partial.name,
    category: 'coding',
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}
function entry(h: Habit, date: string, value: number): HabitEntry {
  return {
    id: `${h.id}-${date}`,
    habitId: h.id,
    date,
    value,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const gym = habit({ name: 'Gym', unit: 'check', category: 'fitness' });
const coding = habit({ name: 'Coding', unit: 'minutes', target: 60 });
const dsa = habit({ name: 'DSA', unit: 'count', target: 4 });
const reading = habit({ name: 'Read', unit: 'minutes' }); // no target

describe('habitLevel', () => {
  it('is 0 with no entry', () => {
    expect(habitLevel(coding, undefined)).toBe(0);
  });

  it('is 4 for a logged check habit', () => {
    expect(habitLevel(gym, entry(gym, today, 1))).toBe(4);
  });

  it.each([
    [1, 1],
    [14, 1],
    [15, 2],
    [29, 2],
    [30, 3],
    [59, 3],
    [60, 4],
    [240, 4],
  ])('minutes against a 60 target: %i → level %i', (value, level) => {
    expect(habitLevel(coding, entry(coding, today, value))).toBe(level);
  });

  it('uses the same bands for count targets', () => {
    expect([1, 2, 3, 4, 9].map((v) => habitLevel(dsa, entry(dsa, today, v)))).toEqual([
      2, 3, 3, 4, 4,
    ]);
  });

  it('shows target-less amounts as "recorded" (2), whatever the size', () => {
    expect(habitLevel(reading, entry(reading, today, 5))).toBe(2);
    expect(habitLevel(reading, entry(reading, today, 600))).toBe(2);
  });
});

describe('overallLevel', () => {
  it.each([
    [[], 0],
    [[0, 0], 0],
    [[1], 1],
    [[2], 1],
    [[4], 2],
    [[2, 2], 2],
    [[4, 4], 3],
    [[4, 4, 3], 3],
    [[4, 4, 4], 4],
    [[4, 4, 4, 4, 4], 4],
  ] as const)('%j → %i', (levels, expected) => {
    expect(overallLevel(levels)).toBe(expected);
  });

  it('can’t be maxed out by one extreme entry', () => {
    expect(overallLevel([habitLevel(coding, entry(coding, today, 1440))])).toBe(2);
  });
});

describe('buildGrid', () => {
  const flat = (weeks: ReturnType<typeof buildGrid>) =>
    weeks.flat().filter((d): d is GridDay => d !== null);

  it('covers 26 Monday-first weeks ending today, with no future days', () => {
    const weeks = buildGrid(today, [], [], { kind: 'overall' });
    expect(weeks).toHaveLength(26);
    expect(weeks[0]?.[0]?.date).toBe(gridRange(today).start);
    expect(gridRange(today).start).toBe('2026-04-06');
    const last = weeks.at(-1)!;
    expect(last[0]?.date).toBe(today);
    expect(last.slice(1)).toEqual([null, null, null, null, null, null]);
    const days = flat(weeks);
    expect(days).toHaveLength(25 * 7 + 1);
    expect(new Set(days.map((d) => d.date)).size).toBe(days.length);
  });

  it('keeps empty days at level 0 and never invents activity', () => {
    const days = flat(buildGrid(today, [gym, coding], [], { kind: 'overall' }));
    expect(days.every((d) => d.level === 0 && d.label.endsWith('nothing recorded'))).toBe(true);
  });

  it('describes days in words, not only colour', () => {
    const entries = [entry(coding, today, 45), entry(gym, today, 1)];
    const overall = flat(buildGrid(today, [gym, coding], entries, { kind: 'overall' })).at(-1)!;
    expect(overall).toEqual({
      date: today,
      // Coding 45/60 → 3, Gym done → 4; sum 7 → band 2.
      level: 2,
      label:
        'Monday 28 September 2026: Coding 45 of 60 min, Gym done (moderate activity across 2 habits)',
    });
    const single = flat(
      buildGrid(today, [gym, coding], entries, { kind: 'habit', habitId: coding.id }),
    ).at(-1)!;
    expect(single).toMatchObject({
      level: 3,
      label: 'Monday 28 September 2026: 45 of 60 min (strong)',
    });
  });

  it('keeps archived habits’ history in their own view and in overall', () => {
    const archived = { ...gym, archived: true };
    const entries = [entry(archived, '2026-09-01', 1)];
    const single = flat(buildGrid(today, [archived], entries, { kind: 'habit', habitId: gym.id }));
    expect(single.find((d) => d.date === '2026-09-01')?.level).toBe(4);
    const overall = flat(buildGrid(today, [archived], entries, { kind: 'overall' }));
    expect(overall.find((d) => d.date === '2026-09-01')?.level).toBe(2);
  });

  it('is deterministic regardless of input order', () => {
    const entries = [entry(coding, today, 30), entry(gym, today, 1), entry(dsa, '2026-09-27', 2)];
    const a = buildGrid(today, [gym, coding, dsa], entries, { kind: 'overall' });
    const b = buildGrid(today, [dsa, coding, gym], [...entries].reverse(), { kind: 'overall' });
    expect(a).toEqual(b);
  });

  it('ignores anything that isn’t an entry of a known habit, e.g. protected time', () => {
    const protectedTimeLike = { ...entry(gym, today, 1), habitId: 'protected-time-id' };
    const days = flat(buildGrid(today, [gym], [protectedTimeLike], { kind: 'overall' }));
    expect(days.at(-1)?.level).toBe(0);
  });

  it('labels months at the week where each month starts, with stable text', () => {
    const labels = monthLabels(buildGrid(today, [], [], { kind: 'overall' })).filter(Boolean);
    expect(labels).toEqual(['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']);
  });

  it('spans a year boundary and a leap day correctly', () => {
    const weeks = buildGrid('2028-03-06', [], [], { kind: 'overall' }, 14);
    const dates = flat(weeks).map((d) => d.date);
    expect(dates).toContain('2027-12-31');
    expect(dates).toContain('2028-01-01');
    expect(dates).toContain('2028-02-29');
    expect(dates[0]).toBe('2027-12-06');
    expect(monthLabels(weeks).filter(Boolean)).toEqual(['Dec', 'Jan', 'Feb', 'Mar']);
  });
});

describe('formatValue', () => {
  it('reads naturally', () => {
    expect(formatValue(gym, 1)).toBe('done');
    expect(formatValue(coding, 45)).toBe('45 of 60 min');
    expect(formatValue(reading, 20)).toBe('20 min');
    expect(formatValue(dsa, 3)).toBe('3 of 4');
    expect(formatValue(habit({ name: 'x', unit: 'count' }), 7)).toBe('7');
  });
});

describe('relationships never become habits or squares', () => {
  it('habit categories exclude relationship-type categories; protected time keeps them', () => {
    for (const kind of [
      'relationship',
      'relationships',
      'family',
      'friends',
      'dating',
      'partner',
    ]) {
      expect(HABIT_CATEGORIES as readonly string[]).not.toContain(kind);
    }
    expect(PROTECTED_TIME_KINDS).toEqual(
      expect.arrayContaining(['relationship', 'family', 'friends']),
    );
  });
});
