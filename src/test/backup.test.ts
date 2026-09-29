import { describe, expect, it, vi } from 'vitest';
import { BACKUP_FORMAT_VERSION } from '../db/backup';
import type { LowtideDatabase } from '../db/database';
import {
  createDexieRepositories,
  type BackupData,
  type BackupDocument,
  type Repositories,
  type ValidatedBackup,
} from '../db/repositories';
import { STORE_NAMES } from '../db/migrations';
import { SCHEMA_VERSION } from '../db/schema';
import { recordWatch, setupTestDatabase, steppingClock } from './helpers';

const newDb = setupTestDatabase();

async function seed(r: Repositories) {
  const essay = await r.tasks.create({
    title: 'Essay',
    dueAt: '2026-10-02T12:00:00.000Z',
    project: 'College',
  });
  await r.tasks.planFor(essay.id, '2026-09-29');
  const done = await r.tasks.create({ title: 'Renew passport', notes: 'booked' });
  await r.tasks.complete(done.id);
  const thought = await r.inbox.capture('Call the bank\nabout the card');
  await r.inbox.convertToTask(thought.id);
  const cleared = await r.inbox.capture('just venting');
  await r.inbox.markProcessed(cleared.id);
  await r.inbox.capture('still waiting');
  const coding = await r.habits.create({
    name: 'Coding',
    category: 'coding',
    unit: 'minutes',
    target: 60,
  });
  const gym = await r.habits.create({ name: 'Gym', category: 'fitness', unit: 'check' });
  await r.habits.setEntry(coding.id, '2026-09-27', 45, 'graphs');
  await r.habits.setEntry(coding.id, '2026-09-28', 60);
  await r.habits.setEntry(gym.id, '2026-09-27', 1);
  await r.habits.archive(gym.id);
  await r.hackathons.create({
    name: 'Hackurity',
    registrationDeadline: '2026-09-30',
    eventStart: '2026-10-04',
    eventEnd: '2026-10-05',
    problemStatement: 'PS 12',
    nextAction: 'Finish PPT outline',
  });
  await r.protectedTime.create({
    title: 'Dinner together',
    date: '2026-09-28',
    kind: 'relationship',
    notes: 'no phones',
  });
}

async function readAll(db: LowtideDatabase): Promise<BackupData> {
  const data: Record<string, unknown[]> = {};
  for (const store of STORE_NAMES) data[store] = await db.table(store).toArray();
  return data as unknown as BackupData;
}

/** Same content, order-insensitive. */
function normalise(data: BackupData) {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [
      k,
      [...(v as { id: string }[])].sort((a, b) => a.id.localeCompare(b.id)),
    ]),
  );
}

async function setupSeeded() {
  const db = newDb();
  const r = createDexieRepositories(db, { clock: steppingClock() });
  await seed(r);
  return { db, r };
}

function inspectOk(r: Repositories, doc: unknown): ValidatedBackup {
  const result = r.backup.inspect(typeof doc === 'string' ? doc : JSON.stringify(doc));
  if (!result.ok)
    throw new Error(`expected ok, got ${result.problem}: ${result.issues.join(' | ')}`);
  return result.backup;
}

describe('export', () => {
  it('writes the envelope and every store', async () => {
    const { db, r } = await setupSeeded();
    const doc = await r.backup.exportBackup();
    expect(doc).toMatchObject({ format: 'lowtide-backup', formatVersion: 1, schemaVersion: 4 });
    expect(BACKUP_FORMAT_VERSION).toBe(1);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(new Date(doc.exportedAt).toISOString()).toBe(doc.exportedAt);
    expect(Object.keys(doc.data).sort()).toEqual([...STORE_NAMES].sort());
    expect(STORE_NAMES).toHaveLength(15);
    expect(Object.fromEntries(Object.entries(doc.data).map(([k, v]) => [k, v.length]))).toEqual({
      tasks: 3,
      inbox: 3,
      habits: 2,
      habitEntries: 3,
      hackathons: 1,
      protectedTime: 1,
      projects: 0,
      milestones: 0,
      projectItems: 0,
      decisions: 0,
      workSessions: 0,
      offTimeSessions: 0,
      // One task completion and three habit logs, written with their records.
      events: 4,
      progressSnapshots: 0,
      aiSessions: 0,
    });
    expect(normalise(doc.data)).toEqual(normalise(await readAll(db)));
  });

  it('is deterministic and never modifies the database', async () => {
    const { db, r } = await setupSeeded();
    const before = await readAll(db);
    const a = await r.backup.exportBackup();
    const b = await r.backup.exportBackup();
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
    expect(await readAll(db)).toEqual(before);
  });

  it('reads every store inside one read-only transaction', async () => {
    const { db, r } = await setupSeeded();
    const spy = vi.spyOn(db, 'transaction');
    await r.backup.exportBackup();
    expect(spy).toHaveBeenCalledTimes(1);
    const [mode, tables] = spy.mock.calls[0] as unknown as [string, { name: string }[]];
    expect(mode).toBe('r');
    expect(tables.map((t) => t.name).sort()).toEqual([...STORE_NAMES].sort());
  });
});

describe('round trip and replace semantics', () => {
  it('restores exactly what was exported, and removes everything else', async () => {
    const { db, r } = await setupSeeded();
    const original = await readAll(db);
    const file = JSON.stringify(await r.backup.exportBackup());

    // Diverge: new records in every kind of store, and one edited.
    await r.tasks.create({ title: 'Added after export' });
    await r.inbox.capture('new thought');
    const read = await r.habits.create({ name: 'Read', category: 'personal', unit: 'check' });
    await r.habits.setEntry(read.id, '2026-09-28', 1);
    await r.hackathons.create({ name: 'Later hackathon' });
    await r.protectedTime.create({ title: 'Walk', date: '2026-09-28', kind: 'rest' });
    const [first] = await r.tasks.listOpen();
    await r.tasks.update(first!.id, { title: 'Edited after export' });

    const open = recordWatch(r.tasks.watchOpen);
    await open.until((l) => l.some((t) => t.title === 'Added after export'));

    await r.backup.restore(inspectOk(r, file));

    expect(normalise(await readAll(db))).toEqual(normalise(original));
    // Live subscriptions see the restore without a reload.
    await open.until(
      (l) => !l.some((t) => t.title === 'Added after export') && l.some((t) => t.title === 'Essay'),
    );
    open.stop();
  });

  it('restores into an empty database and can restore an empty backup', async () => {
    const { r } = await setupSeeded();
    const file = JSON.stringify(await r.backup.exportBackup());
    const empty = newDb();
    const e = createDexieRepositories(empty);
    const emptyFile = JSON.stringify(await e.backup.exportBackup());
    await e.backup.restore(inspectOk(e, file));
    expect((await readAll(empty)).tasks).toHaveLength(3);
    await e.backup.restore(inspectOk(e, emptyFile));
    expect(Object.values(await readAll(empty)).every((list) => list.length === 0)).toBe(true);
  });
});

describe('older database schemas (compatibility fixtures, not historical files)', () => {
  const at = '2026-09-20T08:00:00.000Z';
  const base = {
    registrationStatus: 'not_registered',
    pptStatus: 'not_started',
    buildStatus: 'not_started',
    status: 'considering',
    createdAt: at,
    updatedAt: at,
  };
  const doc = (schemaVersion: number, data: Partial<Record<keyof BackupData, unknown[]>>) => ({
    format: 'lowtide-backup',
    formatVersion: 1,
    schemaVersion,
    exportedAt: at,
    data: {
      tasks: [],
      inbox: [],
      habits: [],
      habitEntries: [],
      hackathons: [],
      protectedTime: [],
      ...data,
    },
  });

  it('migrates a schema-1 snapshot: timestamp hackathon dates become LocalDates', async () => {
    const r = createDexieRepositories(newDb());
    const backup = inspectOk(
      r,
      doc(1, {
        tasks: [
          {
            id: 'aaaaaaaa-0000-4000-8000-000000000001',
            title: 'Old task',
            status: 'todo',
            priority: 'normal',
            createdAt: at,
            updatedAt: at,
          },
        ],
        hackathons: [
          {
            ...base,
            id: 'aaaaaaaa-0000-4000-8000-000000000002',
            name: 'Old',
            eventStart: '2026-10-04T12:00:00.000Z',
            eventEnd: '2026-10-05T12:00:00.000Z',
            registrationDeadline: '2026-10-01T18:29:59.000Z',
          },
        ],
      }),
    );
    expect(backup.sourceSchemaVersion).toBe(1);
    expect(backup.data.hackathons[0]).toMatchObject({
      eventStart: '2026-10-04',
      eventEnd: '2026-10-05',
      registrationDeadline: '2026-10-01',
    });
    expect(backup.data.tasks[0]).not.toHaveProperty('plannedFor');
    await r.backup.restore(backup);
  });

  it('migrates a schema-2 snapshot, keeping plannedFor and moving unreadable dates to notes', async () => {
    const r = createDexieRepositories(newDb());
    const backup = inspectOk(
      r,
      doc(2, {
        tasks: [
          {
            id: 'aaaaaaaa-0000-4000-8000-000000000003',
            title: 'Planned',
            status: 'todo',
            priority: 'high',
            plannedFor: '2026-09-29',
            createdAt: at,
            updatedAt: at,
          },
        ],
        hackathons: [
          {
            ...base,
            id: 'aaaaaaaa-0000-4000-8000-000000000004',
            name: 'Weird',
            eventStart: 'next friday',
          },
        ],
      }),
    );
    expect(backup.data.tasks[0]?.plannedFor).toBe('2026-09-29');
    expect(backup.data.hackathons[0]).not.toHaveProperty('eventStart');
    expect(backup.data.hackathons[0]?.notes).toBe(
      '[Moved by LOWTIDE upgrade] eventStart: next friday',
    );
  });

  it('does not run V3 migrations on a schema-3 snapshot', () => {
    const r = createDexieRepositories(newDb());
    const result = r.backup.inspect(
      JSON.stringify(
        doc(3, {
          hackathons: [
            {
              ...base,
              id: 'aaaaaaaa-0000-4000-8000-000000000005',
              name: 'x',
              eventStart: '2026-10-04T12:00:00.000Z',
            },
          ],
        }),
      ),
    );
    // In a V3 snapshot a timestamp is simply invalid, not something to convert.
    expect(result).toMatchObject({ ok: false, problem: 'invalid-data' });
  });
});

describe('validation rejects bad files before anything is written', () => {
  async function valid(): Promise<{ r: Repositories; db: LowtideDatabase; doc: BackupDocument }> {
    const { db, r } = await setupSeeded();
    return { db, r, doc: await r.backup.exportBackup() };
  }
  const clone = (doc: BackupDocument) => JSON.parse(JSON.stringify(doc)) as BackupDocument;

  it.each<[string, (d: BackupDocument) => unknown, string]>([
    ['invalid JSON', () => '{"format": "lowtide-backup",', 'not-json'],
    ['a non-object', () => [], 'not-lowtide'],
    ['a wrong marker', (d) => ({ ...d, format: 'something-else' }), 'not-lowtide'],
    ['a future format version', (d) => ({ ...d, formatVersion: 2 }), 'newer-format'],
    ['format version 0', (d) => ({ ...d, formatVersion: 0 }), 'invalid-data'],
    [
      'a future schema version',
      (d) => ({ ...d, schemaVersion: SCHEMA_VERSION + 1 }),
      'newer-schema',
    ],
    ['schema version 0', (d) => ({ ...d, schemaVersion: 0 }), 'invalid-data'],
    ['a bad exportedAt', (d) => ({ ...d, exportedAt: 'yesterday' }), 'invalid-data'],
    [
      'a missing store',
      (d) => ({ ...d, data: { ...d.data, habitEntries: undefined } }),
      'invalid-data',
    ],
    [
      'a malformed task',
      (d) => {
        d.data.tasks[0]!.status = 'someday' as never;
        return d;
      },
      'invalid-data',
    ],
    [
      'a task without a title',
      (d) => {
        d.data.tasks[0]!.title = '  ';
        return d;
      },
      'invalid-data',
    ],
    [
      'a malformed LocalDate',
      (d) => {
        d.data.protectedTime[0]!.date = '2026-02-30';
        return d;
      },
      'invalid-data',
    ],
    [
      'a hackathon ending before it starts',
      (d) => {
        d.data.hackathons[0]!.eventEnd = '2026-10-01';
        return d;
      },
      'invalid-data',
    ],
    [
      'an end without a start',
      (d) => {
        delete d.data.hackathons[0]!.eventStart;
        return d;
      },
      'invalid-data',
    ],
    [
      'a target on a check habit',
      (d) => {
        d.data.habits.find((h) => h.unit === 'check')!.target = 1;
        return d;
      },
      'invalid-data',
    ],
    [
      'a zero-activity entry',
      (d) => {
        d.data.habitEntries[0]!.value = 0;
        return d;
      },
      'invalid-data',
    ],
    [
      'a check entry of 2',
      (d) => {
        const gym = d.data.habits.find((h) => h.unit === 'check')!;
        d.data.habitEntries.find((e) => e.habitId === gym.id)!.value = 2;
        return d;
      },
      'invalid-data',
    ],
    [
      'duplicate ids',
      (d) => {
        d.data.tasks[1]!.id = d.data.tasks[0]!.id;
        return d;
      },
      'invalid-data',
    ],
    [
      'two entries for one habit and day',
      (d) => {
        const coding = d.data.habits.find((h) => h.name === 'Coding')!;
        const [a, b] = d.data.habitEntries.filter((e) => e.habitId === coding.id);
        b!.date = a!.date;
        return d;
      },
      'invalid-data',
    ],
    [
      'an orphan habit entry',
      (d) => {
        d.data.habitEntries[0]!.habitId = 'aaaaaaaa-0000-4000-8000-00000000dead';
        return d;
      },
      'invalid-data',
    ],
    [
      'an inbox item converted to a missing task',
      (d) => {
        const item = d.data.inbox.find((i) => i.convertedToTaskId)!;
        d.data.tasks = d.data.tasks.filter((t) => t.id !== item.convertedToTaskId);
        return d;
      },
      'invalid-data',
    ],
  ])('rejects %s', async (_, corrupt, problem) => {
    const { db, r, doc } = await valid();
    const before = await readAll(db);
    const bad = corrupt(clone(doc));
    const result = r.backup.inspect(typeof bad === 'string' ? bad : JSON.stringify(bad));
    expect(result).toMatchObject({ ok: false, problem });
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
    expect(await readAll(db)).toEqual(before);
  });
});

describe('atomic restore (ADR-033)', () => {
  it('rolls back completely when a write fails partway through', async () => {
    const { db, r } = await setupSeeded();
    const original = await readAll(db);

    // A different, genuinely valid backup...
    const other = createDexieRepositories(newDb());
    await other.tasks.create({ title: 'From the backup' });
    const gym = await other.habits.create({ name: 'Gym', category: 'fitness', unit: 'check' });
    await other.habits.setEntry(gym.id, '2026-09-01', 1);
    const valid = inspectOk(other, JSON.stringify(await other.backup.exportBackup()));
    // ...then tampered after validation so the LAST write (habit entries,
    // after every clear and every other insert) violates the unique
    // [habitId+date] index inside the transaction.
    const [entry] = valid.data.habitEntries;
    const failing = {
      ...valid,
      data: {
        ...valid.data,
        habitEntries: [entry!, { ...entry!, id: 'bbbbbbbb-0000-4000-8000-000000000001' }],
      },
    } as ValidatedBackup;

    const addSpy = vi.spyOn(db.tasks, 'bulkAdd');
    await expect(r.backup.restore(failing)).rejects.toThrow();
    expect(addSpy).toHaveBeenCalled(); // the transaction really had started writing
    expect(await readAll(db)).toEqual(original);
  });

  it('rolls back when a store write rejects in the middle of the sequence', async () => {
    const { db, r } = await setupSeeded();
    const original = await readAll(db);
    const backup = inspectOk(r, JSON.stringify(await r.backup.exportBackup()));
    await r.tasks.create({ title: 'Only in the current data' });
    const current = await readAll(db);
    vi.spyOn(db.inbox, 'bulkAdd').mockRejectedValueOnce(new Error('disk full'));

    await expect(r.backup.restore(backup)).rejects.toThrow('disk full');
    expect(await readAll(db)).toEqual(current);
    expect(current.tasks.length).toBe(original.tasks.length + 1);
  });
});
