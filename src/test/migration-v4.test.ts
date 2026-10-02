import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectBackup } from '../db/backup';
import { openDatabase } from '../db/database';
import {
  LEGACY_STORE_NAMES,
  STORE_NAMES,
  V4_STORE_NAMES,
  V5_STORE_NAMES,
  V6_STORE_NAMES,
  V7_STORE_NAMES,
} from '../db/migrations';
import { createDexieRepositories } from '../db/repositories';
import {
  SCHEMA_VERSION,
  STORES_V1,
  STORES_V2,
  STORES_V3,
  STORES_V4,
  aiSessionSchema,
  decisionSchema,
  ledgerEventSchema,
  milestoneSchema,
  offTimeSessionSchema,
  progressSnapshotSchema,
  projectItemSchema,
  projectSchema,
  workSessionSchema,
} from '../db/schema';
import { EVENT_TYPES, PROTECTED_TIME_KINDS } from '../types/domain';

const names: string[] = [];
afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

/** A database exactly as a V3 (v0.1 PHASE 004–006) build creates it, then seeded. */
async function createV3Database(seed: (db: Dexie) => Promise<unknown>): Promise<string> {
  const name = `lowtide-v4-migration-${crypto.randomUUID()}`;
  names.push(name);
  const v3 = new Dexie(name);
  v3.version(1).stores(STORES_V1);
  v3.version(2).stores(STORES_V2);
  v3.version(3).stores(STORES_V3);
  await v3.open();
  await seed(v3);
  v3.close();
  return name;
}

const at = '2026-09-20T08:00:00.000Z';
const id = (n: number) => `0d6f6c3e-4444-4a2b-9c3d-${String(n).padStart(12, '0')}`;

const v3Data = {
  tasks: [
    {
      id: id(1),
      title: 'Write the essay',
      status: 'todo',
      priority: 'high',
      project: 'College',
      plannedFor: '2026-09-21',
      dueAt: '2026-09-25T12:00:00.000Z',
      createdAt: at,
      updatedAt: at,
    },
    {
      id: id(2),
      title: 'Ship the landing page',
      status: 'done',
      priority: 'normal',
      project: 'Side project',
      createdAt: at,
      completedAt: at,
      updatedAt: at,
    },
  ],
  inbox: [{ id: id(3), content: 'buy stamps', createdAt: at }],
  habits: [
    {
      id: id(4),
      name: 'Coding',
      category: 'coding',
      unit: 'minutes',
      archived: false,
      createdAt: at,
    },
  ],
  habitEntries: [
    { id: id(5), habitId: id(4), date: '2026-09-19', value: 30, createdAt: at, updatedAt: at },
  ],
  hackathons: [
    {
      id: id(6),
      name: 'Autumn hack',
      eventStart: '2026-10-04',
      registrationStatus: 'registered',
      pptStatus: 'in_progress',
      buildStatus: 'not_started',
      status: 'active',
      createdAt: at,
      updatedAt: at,
    },
  ],
  protectedTime: [
    { id: id(7), title: 'Dinner together', date: '2026-09-21', kind: 'relationship' },
  ],
};

async function seedV3(db: Dexie) {
  for (const [store, records] of Object.entries(v3Data)) await db.table(store).bulkAdd(records);
}

describe('schema V3 → V4 (additive only, ADR-046)', () => {
  it('opens a real V3 database at V4 with every V3 record deep-equal', async () => {
    const name = await createV3Database(seedV3);
    const db = openDatabase(name);
    await db.open();
    // V4's upgrade runs on the way to the current schema (V5 adds a store only).
    expect(SCHEMA_VERSION).toBe(8);
    expect(db.verno).toBe(SCHEMA_VERSION);
    for (const [store, records] of Object.entries(v3Data)) {
      const stored = await db.table(store).toArray();
      expect(stored.sort((a, b) => a.id.localeCompare(b.id))).toEqual(records);
    }
    db.close();
  });

  it('creates every new store empty: no projects, events, snapshots or sessions invented', async () => {
    const name = await createV3Database(seedV3);
    const db = openDatabase(name);
    await db.open();
    for (const store of [...V4_STORE_NAMES, ...V5_STORE_NAMES])
      expect(await db.table(store).count()).toBe(0);
    db.close();
  });

  it('derives no project from task labels and converts no hackathon', async () => {
    const name = await createV3Database(seedV3);
    const db = openDatabase(name);
    await db.open();
    expect(await db.projects.count()).toBe(0);
    for (const task of await db.tasks.toArray()) expect(task).not.toHaveProperty('projectId');
    for (const h of await db.hackathons.toArray()) expect(h).not.toHaveProperty('projectId');
    expect((await db.tasks.get(id(1)))?.project).toBe('College');
    db.close();
  });

  it('leaves protected time untouched and in no V4 store', async () => {
    const name = await createV3Database(seedV3);
    const db = openDatabase(name);
    await db.open();
    expect(await db.protectedTime.toArray()).toEqual(v3Data.protectedTime);
    for (const store of V4_STORE_NAMES) {
      const text = JSON.stringify(await db.table(store).toArray());
      expect(text).not.toContain(id(7));
    }
    db.close();
  });

  it('adds the V4 indexes, queryable on upgraded data', async () => {
    const name = await createV3Database(seedV3);
    const db = openDatabase(name);
    await db.open();
    expect(db.tasks.schema.indexes.map((i) => i.name)).toContain('projectId');
    expect(db.hackathons.schema.indexes.map((i) => i.name)).toContain('projectId');
    expect(await db.tasks.where('projectId').equals(id(99)).count()).toBe(0);
    expect(Object.keys(STORES_V4)).toEqual(
      expect.arrayContaining(['tasks', 'hackathons', ...V4_STORE_NAMES]),
    );
    db.close();
  });

  it('lets the upgraded database be used through the repositories straight away', async () => {
    const name = await createV3Database(seedV3);
    const db = openDatabase(name);
    const r = createDexieRepositories(db);
    const project = await r.projects.create({ name: 'Side project' });
    const task = await r.tasks.update(id(1), { projectId: project.id });
    expect(task).toMatchObject({ project: 'College', projectId: project.id });
    db.close();
  });
});

describe('the V4 model never touches protected time', () => {
  it('has no protected-time or relationship event types', () => {
    const text = EVENT_TYPES.join(' ');
    expect(text).not.toMatch(/protected|relationship|family|friend/i);
    for (const kind of PROTECTED_TIME_KINDS) {
      expect(EVENT_TYPES.some((type) => type.startsWith(`${kind}.`))).toBe(false);
    }
  });

  it('has no V4 field that refers to protected time', () => {
    const shapes = [
      projectSchema,
      milestoneSchema,
      projectItemSchema,
      decisionSchema,
      workSessionSchema,
      offTimeSessionSchema,
      ledgerEventSchema,
      progressSnapshotSchema,
      aiSessionSchema,
    ];
    for (const schema of shapes) {
      expect(Object.keys(schema.shape).join(' ')).not.toMatch(/protected/i);
    }
  });
});

const envelope = (schemaVersion: number, data: Record<string, unknown[]>) =>
  JSON.stringify({
    format: 'lowtide-backup',
    formatVersion: 1,
    schemaVersion,
    exportedAt: at,
    data,
  });

describe('backups across schema versions', () => {
  it.each([1, 2, 3])('imports a schema-%i backup with the V4 and V5 stores empty', (version) => {
    const result = inspectBackup(envelope(version, v3Data));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backup.sourceSchemaVersion).toBe(version);
    for (const store of [...V4_STORE_NAMES, ...V5_STORE_NAMES])
      expect(result.backup.data[store]).toEqual([]);
    expect(result.backup.data.tasks).toHaveLength(2);
    expect(result.backup.data.protectedTime).toEqual(v3Data.protectedTime);
  });

  it('refuses a schema-4 backup that lacks a V4 store', () => {
    const data: Record<string, unknown[]> = { ...v3Data };
    for (const store of V4_STORE_NAMES) data[store] = [];
    delete data.events;
    expect(inspectBackup(envelope(4, data))).toMatchObject({ ok: false, problem: 'invalid-data' });
  });

  it('imports a complete schema-4 backup into V5 with college items empty', () => {
    const data: Record<string, unknown[]> = { ...v3Data };
    for (const store of V4_STORE_NAMES) data[store] = [];
    const result = inspectBackup(envelope(4, data));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.backup.data.collegeItems).toEqual([]);
    // …but a schema-4 file can't carry a V5 store.
    expect(inspectBackup(envelope(4, { ...data, collegeItems: [] }))).toMatchObject({
      ok: false,
      problem: 'invalid-data',
    });
  });

  it('refuses an unknown store, and V4 stores in an older backup', () => {
    const data: Record<string, unknown[]> = { ...v3Data, projects: [] };
    expect(inspectBackup(envelope(3, data))).toMatchObject({ ok: false, problem: 'invalid-data' });
    const full: Record<string, unknown[]> = { ...v3Data, surprise: [] };
    for (const store of V4_STORE_NAMES) full[store] = [];
    expect(inspectBackup(envelope(4, full))).toMatchObject({ ok: false, problem: 'invalid-data' });
  });

  it('lists 19 stores: six legacy, nine V4, one V5, one V6, two V7', () => {
    expect(LEGACY_STORE_NAMES).toHaveLength(6);
    expect(V4_STORE_NAMES).toHaveLength(9);
    expect(V5_STORE_NAMES).toEqual(['collegeItems']);
    expect(V6_STORE_NAMES).toEqual(['notes']);
    expect(V7_STORE_NAMES).toEqual(['spaceNodes', 'sourceRecords']);
    expect(STORE_NAMES).toEqual([
      ...LEGACY_STORE_NAMES,
      ...V4_STORE_NAMES,
      ...V5_STORE_NAMES,
      ...V6_STORE_NAMES,
      ...V7_STORE_NAMES,
    ]);
  });
});
