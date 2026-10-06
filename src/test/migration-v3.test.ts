import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { migrateHackathonToV3 } from '../db/migrations';
import {
  hackathonSchema,
  habitEntrySchema,
  habitSchema,
  SCHEMA_VERSION,
  STORES_V1,
  STORES_V2,
  taskSchema,
} from '../db/schema';

const names: string[] = [];
afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

/** A database exactly as a V2 (PHASE 002/003) build creates it, then seeded. */
async function createV2Database(seed: (db: Dexie) => Promise<unknown>): Promise<string> {
  const name = `lowtide-v3-migration-${crypto.randomUUID()}`;
  names.push(name);
  const v2 = new Dexie(name);
  v2.version(1).stores(STORES_V1);
  v2.version(2).stores(STORES_V2);
  await v2.open();
  await seed(v2);
  v2.close();
  return name;
}

const at = '2026-09-20T08:00:00.000Z';
const base = {
  registrationStatus: 'not_registered',
  pptStatus: 'not_started',
  buildStatus: 'not_started',
  status: 'considering',
  createdAt: at,
  updatedAt: at,
};
const legacy = {
  ...base,
  id: '0d6f6c3e-2222-4a2b-9c3d-000000000001',
  name: 'Legacy timestamps',
  registrationDeadline: '2026-10-01T18:29:59.000Z',
  eventStart: '2026-10-04T12:00:00.000Z',
  eventEnd: '2026-10-05T12:00:00.000Z',
  notes: 'bring charger',
};
const noDates = { ...base, id: '0d6f6c3e-2222-4a2b-9c3d-000000000002', name: 'No dates yet' };
const alreadyLocal = {
  ...base,
  id: '0d6f6c3e-2222-4a2b-9c3d-000000000003',
  name: 'Already local',
  eventStart: '2026-11-07',
};
const malformed = {
  ...base,
  id: '0d6f6c3e-2222-4a2b-9c3d-000000000004',
  name: 'Malformed',
  registrationDeadline: 'next friday',
  eventStart: '2026-10-10T12:00:00.000Z',
  eventEnd: 20261011,
};
const task = {
  id: '0d6f6c3e-2222-4a2b-9c3d-000000000010',
  title: 'Planned in V2',
  status: 'todo',
  priority: 'normal',
  plannedFor: '2026-09-28',
  dueAt: '2026-10-02T12:00:00.000Z',
  createdAt: at,
  updatedAt: at,
};
const habit = {
  id: '0d6f6c3e-2222-4a2b-9c3d-000000000020',
  name: 'Coding',
  category: 'coding',
  unit: 'minutes',
  target: 60,
  archived: false,
  createdAt: at,
};
const entry = {
  id: '0d6f6c3e-2222-4a2b-9c3d-000000000021',
  habitId: habit.id,
  date: '2026-09-27',
  value: 45,
  createdAt: at,
  updatedAt: at,
};

describe('schema V2 → V3 migration (hackathon dates become LocalDate)', () => {
  it('rewrites legacy timestamp dates and keeps every other store intact', async () => {
    const name = await createV2Database(async (db) => {
      await db.table('hackathons').bulkAdd([legacy, noDates, alreadyLocal, malformed]);
      await db.table('tasks').add(task);
      await db.table('habits').add(habit);
      await db.table('habitEntries').add(entry);
      await db.table('protectedTime').add({
        id: '0d6f6c3e-2222-4a2b-9c3d-000000000030',
        title: 'Call home',
        date: '2026-09-28',
        kind: 'family',
      });
    });

    const db = openDatabase(name);
    await db.open();
    // V3's rewrite runs on the way to the current schema (V4 adds stores only).
    expect(SCHEMA_VERSION).toBe(11);
    expect(db.verno).toBe(SCHEMA_VERSION);

    const migrated = await db.hackathons.get(legacy.id);
    expect(migrated).toEqual({
      ...legacy,
      registrationDeadline: '2026-10-01',
      eventStart: '2026-10-04',
      eventEnd: '2026-10-05',
    });
    expect(await db.hackathons.get(noDates.id)).toEqual(noDates);
    expect(await db.hackathons.get(alreadyLocal.id)).toEqual(alreadyLocal);
    for (const h of await db.hackathons.toArray())
      expect(() => hackathonSchema.parse(h)).not.toThrow();

    expect(taskSchema.parse(await db.tasks.get(task.id))).toEqual(task);
    expect(habitSchema.parse(await db.habits.get(habit.id))).toEqual(habit);
    expect(habitEntrySchema.parse(await db.habitEntries.get(entry.id))).toEqual(entry);
    expect(await db.protectedTime.count()).toBe(1);
    db.close();
  });

  it('moves malformed values into notes instead of discarding them', async () => {
    const name = await createV2Database((db) => db.table('hackathons').add(malformed));
    const db = openDatabase(name);
    const record = await db.hackathons.get(malformed.id);
    expect(record).toMatchObject({ eventStart: '2026-10-10' });
    expect(record).not.toHaveProperty('registrationDeadline');
    expect(record).not.toHaveProperty('eventEnd');
    expect(record?.notes).toBe(
      '[Moved by LOWTIDE upgrade] registrationDeadline: next friday\n[Moved by LOWTIDE upgrade] eventEnd: 20261011',
    );
    db.close();
  });

  it('keeps the hackathon indexes, now queryable by LocalDate', async () => {
    const name = await createV2Database((db) =>
      db.table('hackathons').bulkAdd([legacy, alreadyLocal]),
    );
    const db = openDatabase(name);
    await db.open();
    // V3's indexes, plus V4's projectId.
    expect(db.hackathons.schema.indexes.map((i) => i.name).sort()).toEqual([
      'eventStart',
      'projectId',
      'registrationDeadline',
      'status',
    ]);
    const inOctober = await db.hackathons
      .where('eventStart')
      .between('2026-10-01', '2026-10-31', true, true)
      .toArray();
    expect(inOctober.map((h) => h.name)).toEqual(['Legacy timestamps']);
    expect(await db.hackathons.where('registrationDeadline').equals('2026-10-01').count()).toBe(1);
    db.close();
  });
});

describe('migrateHackathonToV3 (pure)', () => {
  it('leaves absent fields absent and valid LocalDates untouched', () => {
    expect(migrateHackathonToV3(noDates)).toEqual(noDates);
    expect(migrateHackathonToV3(alreadyLocal)).toEqual(alreadyLocal);
  });

  it('takes the UTC date component of timestamps, including offset forms', () => {
    const out = migrateHackathonToV3({
      ...base,
      eventStart: '2026-10-04T01:00:00+05:30', // 3 Oct 19:30 UTC
      registrationDeadline: '2026-10-01T23:59Z',
    });
    expect(out).toMatchObject({ eventStart: '2026-10-03', registrationDeadline: '2026-10-01' });
  });

  it('moves impossible dates and an end without a valid start into notes', () => {
    const out = migrateHackathonToV3({ ...base, eventStart: '2026-02-30', eventEnd: '2026-03-02' });
    expect(out).not.toHaveProperty('eventStart');
    expect(out).not.toHaveProperty('eventEnd');
    expect(out.notes).toBe(
      '[Moved by LOWTIDE upgrade] eventStart: 2026-02-30\n[Moved by LOWTIDE upgrade] eventEnd: 2026-03-02',
    );
  });

  it('moves an end before the start into notes, keeping the start', () => {
    const out = migrateHackathonToV3({
      ...base,
      eventStart: '2026-10-05',
      eventEnd: '2026-10-04T12:00:00.000Z',
    });
    expect(out).toMatchObject({
      eventStart: '2026-10-05',
      notes: '[Moved by LOWTIDE upgrade] eventEnd: 2026-10-04',
    });
    expect(out).not.toHaveProperty('eventEnd');
  });

  it('does not mutate its input', () => {
    const input = { ...legacy };
    migrateHackathonToV3(input);
    expect(input).toEqual(legacy);
  });
});
