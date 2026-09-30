import { describe, expect, it } from 'vitest';
import { DATABASE_NAME, SCHEMA_VERSION } from '../db/schema';
import { openDatabase } from '../db/database';
import { setupTestDatabase } from './helpers';

const newDb = setupTestDatabase();

describe('LowtideDatabase', () => {
  it('uses the production name by default', () => {
    expect(openDatabase().name).toBe(DATABASE_NAME);
  });

  it('opens at the declared schema version with every store', async () => {
    const db = newDb();
    await db.open();
    expect(db.verno).toBe(SCHEMA_VERSION);
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'aiSessions',
      'collegeItems',
      'decisions',
      'events',
      'habitEntries',
      'habits',
      'hackathons',
      'inbox',
      'milestones',
      'notes',
      'offTimeSessions',
      'progressSnapshots',
      'projectItems',
      'projects',
      'protectedTime',
      'sourceRecords',
      'spaceNodes',
      'tasks',
      'workSessions',
    ]);
  });

  it('allows only one entry per habit per day', async () => {
    const db = newDb();
    const entry = {
      habitId: crypto.randomUUID(),
      date: '2026-09-28',
      value: 1,
      createdAt: '2026-09-28T09:00:00.000Z',
      updatedAt: '2026-09-28T09:00:00.000Z',
    };
    await db.habitEntries.add({ id: crypto.randomUUID(), ...entry });
    await expect(db.habitEntries.add({ id: crypto.randomUUID(), ...entry })).rejects.toThrow(
      /ConstraintError|uniqueness/i,
    );
    await db.habitEntries.add({ id: crypto.randomUUID(), ...entry, date: '2026-09-29' });
    expect(await db.habitEntries.count()).toBe(2);
  });

  it('persists data across a close and reopen', async () => {
    const db = newDb();
    await db.inbox.add({
      id: crypto.randomUUID(),
      content: 'remember the thing',
      createdAt: '2026-09-28T09:00:00.000Z',
    });
    db.close();
    const reopened = openDatabase(db.name);
    expect(await reopened.inbox.count()).toBe(1);
    reopened.close();
  });
});
