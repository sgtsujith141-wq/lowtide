import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT_VERSION } from '../db/backup';
import { createDexieRepositories, type ValidatedBackup } from '../db/repositories';
import { SCHEMA_VERSION } from '../db/schema';
import { buildGrid, RHYTHM_GROUPS, type GridDay, type GridView } from '../features/rhythm/grid';
import { HABIT_CATEGORIES, type Habit, type HabitEntry } from '../types/domain';
import { recordWatch, setupTestDatabase } from './helpers';

const newDb = setupTestDatabase();

describe('Rhythm category groups', () => {
  const today = '2026-09-28';
  const habit = (name: string, category: Habit['category'], archived = false): Habit => ({
    id: name,
    name,
    category,
    unit: 'check',
    archived,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  const entry = (h: Habit, date = today): HabitEntry => ({
    id: `${h.id}-${date}`,
    habitId: h.id,
    date,
    value: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const habits = [
    habit('Coding', 'coding'),
    habit('Study', 'learning'),
    habit('Gym', 'fitness'),
    habit('Creatine', 'health'),
    habit('Side project', 'money'),
    habit('Read', 'personal'),
    habit('Old course', 'learning', true),
  ];
  const entries = [...habits.map((h) => entry(h)), entry(habits[6]!, '2026-09-01')];
  const lastDay = (view: GridView) =>
    buildGrid(today, habits, entries, view)
      .flat()
      .filter((d): d is GridDay => d !== null)
      .at(-1)!;
  const dayOf = (view: GridView, date: string) =>
    buildGrid(today, habits, entries, view)
      .flat()
      .find((d) => d?.date === date)!;

  it('defines exactly the two groups with the right categories', () => {
    expect(RHYTHM_GROUPS.map((g) => [g.id, g.label, [...g.categories]])).toEqual([
      ['coding-learning', 'Coding & learning', ['coding', 'learning']],
      ['fitness-health', 'Fitness & health', ['fitness', 'health']],
    ]);
    for (const g of RHYTHM_GROUPS)
      for (const c of g.categories) expect(HABIT_CATEGORIES).toContain(c);
  });

  it('Coding & learning counts only coding and learning habits, archived ones included', () => {
    const day = lastDay({ kind: 'group', groupId: 'coding-learning' });
    // Coding + Study + Old course (archived, still counts) = three check habits → 12 → level 4.
    expect(day.label).toMatch(
      /Coding done, Old course done, Study done \(high activity across 3 habits\)$/,
    );
    expect(day.level).toBe(4);
    expect(day.label).not.toMatch(/Gym|Creatine|Side project|Read/);
    expect(dayOf({ kind: 'group', groupId: 'coding-learning' }, '2026-09-01').label).toMatch(
      /Old course done/,
    );
  });

  it('Fitness & health counts only fitness and health habits', () => {
    const day = lastDay({ kind: 'group', groupId: 'fitness-health' });
    expect(day.label).toMatch(/Creatine done, Gym done \(strong activity across 2 habits\)$/);
    expect(day.level).toBe(3);
    expect(day.label).not.toMatch(/Coding|Study|Side project|Read|Old course/);
  });

  it('leaves overall and single-habit views unchanged', () => {
    expect(lastDay({ kind: 'overall' }).label).toMatch(/\(high activity across 7 habits\)$/);
    expect(lastDay({ kind: 'habit', habitId: 'Gym' })).toMatchObject({ level: 4 });
    expect(lastDay({ kind: 'habit', habitId: 'Gym' }).label).toMatch(/: done \(high\)$/);
  });

  it('ignores entries whose habit is unknown, e.g. protected time', () => {
    const stray = { ...entry(habits[0]!), id: 'stray', habitId: 'protected-time-id' };
    const day = buildGrid(today, habits, [stray], { kind: 'group', groupId: 'coding-learning' })
      .flat()
      .filter((d): d is GridDay => d !== null)
      .at(-1)!;
    expect(day.level).toBe(0);
  });

  it('is deterministic under input reordering', () => {
    const view: GridView = { kind: 'group', groupId: 'coding-learning' };
    expect(buildGrid(today, [...habits].reverse(), [...entries].reverse(), view)).toEqual(
      buildGrid(today, habits, entries, view),
    );
  });
});

describe('backup regression for PHASE 006 data', () => {
  it('round-trips week-ahead protected time and grouped rhythms with no format or schema change', async () => {
    const source = createDexieRepositories(newDb());
    const today = '2026-09-28';
    await source.protectedTime.create({
      title: 'Evening together',
      date: today,
      kind: 'relationship',
    });
    await source.protectedTime.create({
      title: 'Lunch with friends',
      date: '2026-10-04',
      kind: 'friends',
    });
    const coding = await source.habits.create({
      name: 'Coding',
      category: 'coding',
      unit: 'minutes',
      target: 60,
    });
    const study = await source.habits.create({
      name: 'Study session',
      category: 'learning',
      unit: 'minutes',
    });
    const gym = await source.habits.create({ name: 'Gym', category: 'fitness', unit: 'check' });
    await source.habits.setEntry(coding.id, today, 45);
    await source.habits.setEntry(study.id, '2026-09-27', 30);
    await source.habits.setEntry(gym.id, today, 1);

    const doc = await source.backup.exportBackup();
    expect(doc.formatVersion).toBe(1);
    expect(BACKUP_FORMAT_VERSION).toBe(1);
    // PHASE 006 said "no schema change"; v2 PHASE 002 then added V4 (additive only).
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(9);

    const targetDb = newDb();
    const target = createDexieRepositories(targetDb);
    await target.tasks.create({ title: 'will be replaced' });
    const inspected = target.backup.inspect(JSON.stringify(doc));
    expect(inspected.ok).toBe(true);
    await target.backup.restore((inspected as { backup: ValidatedBackup }).backup);

    const again = await target.backup.exportBackup();
    expect(again.data).toEqual(doc.data);
    const week = recordWatch(target.protectedTime.watchRange(today, '2026-10-04'));
    expect((await week.until((l) => l.length === 2)).map((e) => e.title)).toEqual([
      'Evening together',
      'Lunch with friends',
    ]);
    week.stop();
  });
});
