import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories } from '../db/repositories';
import { groupByDay, weekAhead } from '../features/today/week';
import type { ProtectedTime } from '../types/domain';
import { recordWatch, setupTestDatabase } from './helpers';

const newDb = setupTestDatabase();

describe('ProtectedTimeRepository.watchRange', () => {
  it('is inclusive at both ends, excludes outside days, and orders by date then title', async () => {
    const db = newDb();
    const { protectedTime } = createDexieRepositories(db);
    for (const [title, date] of [
      ['Before', '2026-09-27'],
      ['Start b', '2026-09-28'],
      ['Start a', '2026-09-28'],
      ['Middle', '2026-10-01'],
      ['End', '2026-10-04'],
      ['After', '2026-10-05'],
    ] as const) {
      await protectedTime.create({ title, date, kind: 'rest' });
    }
    const between = vi.spyOn(db.protectedTime, 'where');
    const live = recordWatch(protectedTime.watchRange('2026-09-28', '2026-10-04'));
    const list = await live.until((l) => l.length > 0);
    expect(list.map((e) => e.title)).toEqual(['Start a', 'Start b', 'Middle', 'End']);
    // One indexed range query on `date`, not a query per day.
    expect(between).toHaveBeenCalledTimes(1);
    expect(between).toHaveBeenCalledWith('date');
    live.stop();
  });

  it('reacts to create, moves into and out of the range, and remove', async () => {
    const { protectedTime } = createDexieRepositories(newDb());
    const outside = await protectedTime.create({
      title: 'Later',
      date: '2026-10-10',
      kind: 'personal',
    });
    const live = recordWatch(protectedTime.watchRange('2026-09-28', '2026-10-04'));
    await live.until((l) => l.length === 0);

    const inside = await protectedTime.create({
      title: 'Dinner',
      date: '2026-09-30',
      kind: 'friends',
    });
    await live.until((l) => l.map((e) => e.title).join() === 'Dinner');
    await protectedTime.update(outside.id, { date: '2026-10-04' });
    await live.until((l) => l.map((e) => e.title).join() === 'Dinner,Later');
    await protectedTime.update(inside.id, { date: '2026-10-05' });
    await live.until((l) => l.map((e) => e.title).join() === 'Later');
    await protectedTime.remove(outside.id);
    await live.until((l) => l.length === 0);
    live.stop();
  });

  it('keeps watchForDate as a one-day range', async () => {
    const { protectedTime } = createDexieRepositories(newDb());
    await protectedTime.create({ title: 'x', date: '2026-09-28', kind: 'rest' });
    await protectedTime.create({ title: 'y', date: '2026-09-29', kind: 'rest' });
    const live = recordWatch(protectedTime.watchForDate('2026-09-28'));
    expect((await live.until((l) => l.length > 0)).map((e) => e.title)).toEqual(['x']);
    live.stop();
  });
});

describe('week-ahead composition', () => {
  it('covers today plus six days with unique headings', () => {
    const days = weekAhead('2026-09-28');
    expect(days.map((d) => d.date)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(days.map((d) => d.heading)).toEqual([
      'Today',
      'Tomorrow',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(days.map((d) => d.word)).toEqual([
      'today',
      'tomorrow',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(days[3]?.short).toBe('Thu 1 Oct');
  });

  it('crosses year boundaries and leap days', () => {
    expect(weekAhead('2026-12-29').map((d) => d.date)).toEqual([
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
      '2027-01-04',
    ]);
    expect(weekAhead('2028-02-26').map((d) => d.date)).toContain('2028-02-29');
    expect(weekAhead('2027-02-26').map((d) => d.date)).not.toContain('2027-02-29');
  });

  it('groups several entries per day and leaves empty days empty', () => {
    const e = (title: string, date: string): ProtectedTime => ({
      id: title,
      title,
      date,
      kind: 'rest',
    });
    const groups = groupByDay(weekAhead('2026-09-28'), [
      e('a', '2026-09-28'),
      e('b', '2026-09-28'),
      e('c', '2026-10-04'),
    ]);
    expect(groups.map((g) => g.entries.map((x) => x.title))).toEqual([
      ['a', 'b'],
      [],
      [],
      [],
      [],
      [],
      ['c'],
    ]);
    // Plans only: nothing about completion, counts or scores exists on the model.
    expect(Object.keys(groups[0]!.entries[0]!).sort()).toEqual(['date', 'id', 'kind', 'title']);
  });
});
