import { describe, expect, it } from 'vitest';
import {
  createDexieRepositories,
  InvalidInputError,
  RecordNotFoundError,
  RecordStateError,
} from '../db/repositories';
import { recordWatch, setupTestDatabase, steppingClock } from './helpers';

const newDb = setupTestDatabase();
const day = '2026-09-28';

function setup() {
  const db = newDb();
  return { db, ...createDexieRepositories(db, { clock: steppingClock() }) };
}

describe('HabitRepository: habits', () => {
  it('creates an active habit, trimmed, with an optional target', async () => {
    const { habits } = setup();
    const coding = await habits.create({
      name: ' Coding ',
      category: 'coding',
      unit: 'minutes',
      target: 60,
    });
    expect(coding).toEqual({
      id: expect.any(String),
      name: 'Coding',
      category: 'coding',
      unit: 'minutes',
      target: 60,
      archived: false,
      createdAt: '2026-09-28T09:00:00.000Z',
    });
    const gym = await habits.create({ name: 'Gym', category: 'fitness', unit: 'check' });
    expect(gym).not.toHaveProperty('target');
  });

  it('rejects blank names, unknown categories and invalid targets', async () => {
    const { db, habits } = setup();
    await expect(habits.create({ name: ' ', category: 'coding', unit: 'check' })).rejects.toThrow();
    await expect(
      habits.create({ name: 'x', category: 'relationships' as never, unit: 'check' }),
    ).rejects.toThrow();
    await expect(
      habits.create({ name: 'x', category: 'health', unit: 'check', target: 1 }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    for (const target of [0, -5, Number.NaN, Infinity]) {
      await expect(
        habits.create({ name: 'x', category: 'coding', unit: 'minutes', target }),
      ).rejects.toBeInstanceOf(InvalidInputError);
    }
    await expect(
      habits.create({ name: 'x', category: 'coding', unit: 'count', target: 2.5 }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(await db.habits.count()).toBe(0);
  });

  it('updates name, category and target, and clears the target with null', async () => {
    const { habits } = setup();
    const h = await habits.create({ name: 'DSA', category: 'coding', unit: 'count', target: 3 });
    const updated = await habits.update(h.id, {
      name: 'LeetCode / DSA',
      category: 'learning',
      target: null,
    });
    expect(updated).toMatchObject({ name: 'LeetCode / DSA', category: 'learning', unit: 'count' });
    expect(updated).not.toHaveProperty('target');
    await expect(habits.update(h.id, { target: -1 })).rejects.toBeInstanceOf(InvalidInputError);
    await expect(habits.update(crypto.randomUUID(), { name: 'x' })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it('archives and restores without touching entries; archived habits can’t be logged', async () => {
    const { db, habits } = setup();
    const gym = await habits.create({ name: 'Gym', category: 'fitness', unit: 'check' });
    await habits.setEntry(gym.id, day, 1);

    expect((await habits.archive(gym.id)).archived).toBe(true);
    expect(await db.habitEntries.count()).toBe(1);
    await expect(habits.setEntry(gym.id, '2026-09-29', 1)).rejects.toBeInstanceOf(RecordStateError);

    const entries = recordWatch(habits.watchEntries('2026-09-01', '2026-09-30'));
    expect((await entries.until((l) => l.length === 1))[0]?.habitId).toBe(gym.id);
    entries.stop();

    expect((await habits.restore(gym.id)).archived).toBe(false);
    await habits.setEntry(gym.id, '2026-09-29', 1);
    expect(await db.habitEntries.count()).toBe(2);
  });

  it('watchAll emits every habit, archived included, oldest first, and reacts', async () => {
    const { habits } = setup();
    const live = recordWatch(habits.watchAll);
    await live.until((l) => l.length === 0);
    const a = await habits.create({ name: 'A', category: 'coding', unit: 'check' });
    await habits.create({ name: 'B', category: 'learning', unit: 'check' });
    await habits.archive(a.id);
    const list = await live.until((l) => l.length === 2 && l[0]?.archived === true);
    expect(list.map((h) => h.name)).toEqual(['A', 'B']);
    live.stop();
  });
});

describe('HabitRepository: entries', () => {
  it('logs check, count and minutes habits', async () => {
    const { habits } = setup();
    const gym = await habits.create({ name: 'Gym', category: 'fitness', unit: 'check' });
    const dsa = await habits.create({ name: 'DSA', category: 'coding', unit: 'count' });
    const coding = await habits.create({ name: 'Coding', category: 'coding', unit: 'minutes' });
    expect((await habits.setEntry(gym.id, day, 1)).value).toBe(1);
    expect((await habits.setEntry(dsa.id, day, 3)).value).toBe(3);
    const entry = await habits.setEntry(coding.id, day, 45, '  graphs  ');
    expect(entry).toMatchObject({ habitId: coding.id, date: day, value: 45, note: 'graphs' });
  });

  it('upserts: a second log for the same habit and day updates the one entry', async () => {
    const { db, habits } = setup();
    const coding = await habits.create({ name: 'Coding', category: 'coding', unit: 'minutes' });
    const first = await habits.setEntry(coding.id, day, 30);
    const second = await habits.setEntry(coding.id, day, 45);
    expect(second).toMatchObject({ id: first.id, createdAt: first.createdAt, value: 45 });
    expect(second.updatedAt > first.updatedAt).toBe(true);
    expect(await db.habitEntries.count()).toBe(1);
  });

  it('the unique [habitId+date] index rejects a second raw entry for the same day', async () => {
    const { db, habits } = setup();
    const gym = await habits.create({ name: 'Gym', category: 'fitness', unit: 'check' });
    const entry = await habits.setEntry(gym.id, day, 1);
    await expect(db.habitEntries.add({ ...entry, id: crypto.randomUUID() })).rejects.toThrow();
  });

  it('rejects values that don’t fit the unit, writing nothing', async () => {
    const { db, habits } = setup();
    const gym = await habits.create({ name: 'Gym', category: 'fitness', unit: 'check' });
    const dsa = await habits.create({ name: 'DSA', category: 'coding', unit: 'count' });
    const coding = await habits.create({ name: 'Coding', category: 'coding', unit: 'minutes' });
    for (const [habit, value] of [
      [gym, 0],
      [gym, 2],
      [dsa, 0],
      [dsa, -1],
      [dsa, 1.5],
      [coding, 0],
      [coding, -10],
      [coding, 1441],
      [coding, Number.NaN],
    ] as const) {
      await expect(habits.setEntry(habit.id, day, value)).rejects.toBeInstanceOf(InvalidInputError);
    }
    await expect(habits.setEntry(gym.id, '2026-02-30', 1)).rejects.toThrow();
    await expect(habits.setEntry(crypto.randomUUID(), day, 1)).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    expect(await db.habitEntries.count()).toBe(0);
  });

  it('clearing removes the entry; clearing again is harmless', async () => {
    const { db, habits } = setup();
    const gym = await habits.create({ name: 'Gym', category: 'fitness', unit: 'check' });
    await habits.setEntry(gym.id, day, 1);
    await habits.clearEntry(gym.id, day);
    expect(await db.habitEntries.count()).toBe(0);
    await expect(habits.clearEntry(gym.id, day)).resolves.toBeUndefined();
    await expect(habits.clearEntry(crypto.randomUUID(), day)).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it('keeps different days and different habits independent', async () => {
    const { db, habits } = setup();
    const a = await habits.create({ name: 'A', category: 'coding', unit: 'minutes' });
    const b = await habits.create({ name: 'B', category: 'learning', unit: 'minutes' });
    await habits.setEntry(a.id, day, 10);
    await habits.setEntry(a.id, '2026-09-29', 20);
    await habits.setEntry(b.id, day, 30);
    await habits.clearEntry(a.id, day);
    const rest = await db.habitEntries.toArray();
    expect(rest.map((e) => [e.habitId === a.id ? 'A' : 'B', e.date, e.value]).sort()).toEqual([
      ['A', '2026-09-29', 20],
      ['B', day, 30],
    ]);
  });

  it('watchEntries returns only the range, inclusive, and reacts to set/update/clear', async () => {
    const { habits } = setup();
    const h = await habits.create({ name: 'A', category: 'coding', unit: 'minutes' });
    await habits.setEntry(h.id, '2026-08-31', 5); // before range
    await habits.setEntry(h.id, '2026-10-01', 5); // after range
    const live = recordWatch(habits.watchEntries('2026-09-01', '2026-09-30'));
    await live.until((l) => l.length === 0);
    await habits.setEntry(h.id, '2026-09-01', 10);
    await habits.setEntry(h.id, '2026-09-30', 20);
    await live.until((l) => l.length === 2);
    await habits.setEntry(h.id, '2026-09-30', 25);
    await live.until((l) => l.some((e) => e.value === 25));
    await habits.clearEntry(h.id, '2026-09-01');
    await live.until((l) => l.length === 1);
    live.stop();
  });
});
