import { describe, expect, it } from 'vitest';
import { createDexieRepositories, RecordNotFoundError } from '../db/repositories';
import { HABIT_CATEGORIES, PROTECTED_TIME_KINDS } from '../types/domain';
import { recordWatch, setupTestDatabase } from './helpers';

const newDb = setupTestDatabase();

describe('ProtectedTimeRepository (Dexie)', () => {
  it('creates an entry, trimmed, with blank notes omitted', async () => {
    const { protectedTime } = createDexieRepositories(newDb());
    const entry = await protectedTime.create({
      title: '  Dinner together ',
      date: '2026-09-28',
      kind: 'relationship',
      notes: '  ',
    });
    expect(entry).toEqual({
      id: expect.any(String),
      title: 'Dinner together',
      date: '2026-09-28',
      kind: 'relationship',
    });
  });

  it('rejects a blank title, an invalid date or an unknown kind', async () => {
    const db = newDb();
    const { protectedTime } = createDexieRepositories(db);
    const base = { title: 'Call home', date: '2026-09-28', kind: 'family' } as const;
    await expect(protectedTime.create({ ...base, title: ' ' })).rejects.toThrow();
    await expect(protectedTime.create({ ...base, date: '2026-09-31' })).rejects.toThrow();
    await expect(
      protectedTime.create({ ...base, kind: 'goal' as unknown as 'family' }),
    ).rejects.toThrow();
    expect(await db.protectedTime.count()).toBe(0);
  });

  it('updates fields and clears notes', async () => {
    const { protectedTime } = createDexieRepositories(newDb());
    const entry = await protectedTime.create({
      title: 'Movie night',
      date: '2026-09-28',
      kind: 'friends',
      notes: 'bring snacks',
    });
    const updated = await protectedTime.update(entry.id, {
      title: 'Movie night at home',
      kind: 'relationship',
      notes: null,
    });
    expect(updated).toEqual({
      id: entry.id,
      title: 'Movie night at home',
      date: '2026-09-28',
      kind: 'relationship',
    });
    await expect(protectedTime.update(entry.id, { title: '' })).rejects.toThrow();
    await expect(protectedTime.update(crypto.randomUUID(), { title: 'x' })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it('removes an entry', async () => {
    const db = newDb();
    const { protectedTime } = createDexieRepositories(db);
    const entry = await protectedTime.create({ title: 'Rest', date: '2026-09-28', kind: 'rest' });
    await protectedTime.remove(entry.id);
    expect(await db.protectedTime.count()).toBe(0);
    await expect(protectedTime.remove(entry.id)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('watches one day only, ordered by title, reacting to changes', async () => {
    const { protectedTime } = createDexieRepositories(newDb());
    await protectedTime.create({ title: 'Tomorrow thing', date: '2026-09-29', kind: 'personal' });
    const live = recordWatch(protectedTime.watchForDate('2026-09-28'));
    await live.until((l) => l.length === 0);

    const b = await protectedTime.create({ title: 'Walk', date: '2026-09-28', kind: 'rest' });
    await protectedTime.create({ title: 'Call home', date: '2026-09-28', kind: 'family' });
    await live.until((l) => l.map((e) => e.title).join() === 'Call home,Walk');

    await protectedTime.update(b.id, { date: '2026-09-30' });
    await live.until((l) => l.map((e) => e.title).join() === 'Call home');
    live.stop();
  });

  it('keeps relationship, family and friends as protected-time kinds, never habits', () => {
    expect(PROTECTED_TIME_KINDS).toEqual(['relationship', 'family', 'friends', 'rest', 'personal']);
    for (const kind of ['relationship', 'relationships', 'family', 'friends']) {
      expect(HABIT_CATEGORIES).not.toContain(kind);
    }
  });
});
