import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { createDexieRepositories } from '../db/repositories';
import { SCHEMA_VERSION, STORES_V1, taskSchema } from '../db/schema';

const names: string[] = [];
afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

/** Creates a database exactly as a V1 (PHASE 000/001) build would, seeded with data. */
async function createV1Database(seed: (db: Dexie) => Promise<unknown>): Promise<string> {
  const name = `lowtide-migration-${crypto.randomUUID()}`;
  names.push(name);
  const v1 = new Dexie(name);
  v1.version(1).stores(STORES_V1);
  await v1.open();
  await seed(v1);
  v1.close();
  return name;
}

const v1Task = {
  id: '0d6f6c3e-1111-4a2b-9c3d-000000000001',
  title: 'Written by PHASE 001',
  notes: 'multi\nline',
  status: 'todo',
  priority: 'high',
  dueAt: '2026-10-02T12:00:00.000Z',
  project: 'Home',
  createdAt: '2026-09-20T08:00:00.000Z',
  updatedAt: '2026-09-21T08:00:00.000Z',
};
const v1DoneTask = {
  ...v1Task,
  id: '0d6f6c3e-1111-4a2b-9c3d-000000000002',
  status: 'done',
  completedAt: '2026-09-22T08:00:00.000Z',
};
const v1Inbox = {
  id: '0d6f6c3e-1111-4a2b-9c3d-000000000003',
  content: 'old thought',
  createdAt: '2026-09-20T08:00:00.000Z',
};

describe('schema V1 → V2 migration', () => {
  it('opens a V1 database at V2 and keeps every V1 record unchanged and valid', async () => {
    const name = await createV1Database(async (db) => {
      await db.table('tasks').bulkAdd([v1Task, v1DoneTask]);
      await db.table('inbox').add(v1Inbox);
    });

    const db = openDatabase(name);
    await db.open();
    expect(SCHEMA_VERSION).toBe(2);
    expect(db.verno).toBe(2);

    const stored = await db.tasks.get(v1Task.id);
    expect(stored).toEqual(v1Task);
    expect(stored).not.toHaveProperty('plannedFor');
    expect(taskSchema.parse(stored)).toEqual(v1Task);
    expect(taskSchema.parse(await db.tasks.get(v1DoneTask.id))).toEqual(v1DoneTask);
    expect(await db.inbox.get(v1Inbox.id)).toEqual(v1Inbox);
    db.close();
  });

  it('lets migrated tasks use the new plannedFor index', async () => {
    const name = await createV1Database((db) => db.table('tasks').add(v1Task));
    const db = openDatabase(name);
    const { tasks } = createDexieRepositories(db);

    expect(await db.tasks.where('plannedFor').equals('2026-09-28').count()).toBe(0);
    const planned = await tasks.planFor(v1Task.id, '2026-09-28');

    expect(planned).toMatchObject({ plannedFor: '2026-09-28', dueAt: v1Task.dueAt });
    expect((await db.tasks.where('plannedFor').equals('2026-09-28').toArray())[0]?.id).toBe(
      v1Task.id,
    );
    db.close();
  });

  it('keeps the tasks store V1 indexes and adds only plannedFor', async () => {
    const name = await createV1Database(async () => {});
    const db = openDatabase(name);
    await db.open();
    const indexes = db.tasks.schema.indexes.map((i) => i.name).sort();
    expect(indexes).toEqual(['createdAt', 'dueAt', 'plannedFor', 'status']);
    db.close();
  });
});
