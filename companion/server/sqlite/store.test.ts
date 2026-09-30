// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../src/db/database';
import { STORE_NAMES } from '../../../src/db/migrations';
import {
  createDexieRepositories,
  createRepositories,
  RecordStateError,
  type Repositories,
} from '../../../src/db/repositories';
import { asStore } from '../../../src/db/database';
import { importNotion } from '../../../src/db/import/notion/importer';
import { fixturePlan, fixtureSnapshot } from '../../../src/test/notion-fixture';
import { deterministic, scenario } from '../test-fixtures';
import { MIGRATIONS } from './migrations';
import { ConstraintError, SqliteStore } from './store';
import { TABLES } from './tables';

const opened: { close(): void }[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

function sqlite() {
  const store = new SqliteStore(':memory:');
  opened.push(store);
  return store;
}

describe('SQLite schema (companion migrations)', () => {
  it('creates one strict table per store with typed columns and records its migrations', () => {
    const store = sqlite();
    const tables = (
      store.sql.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
        sql: string;
      }[]
    ).map((t) => t.name);
    for (const spec of TABLES) expect(tables).toContain(spec.table);
    expect(TABLES.map((t) => t.store).sort()).toEqual([...STORE_NAMES].sort());
    const migrations = store.sql.prepare('SELECT id FROM companion_migrations').all() as {
      id: number;
    }[];
    expect(migrations.map((m) => m.id)).toEqual(MIGRATIONS.map((m) => m.id));
    const meta = store.sql
      .prepare("SELECT value FROM companion_meta WHERE key = 'lowtide_schema_version'")
      .get() as { value: string };
    expect(meta.value).toBe('7');
  });

  it('enforces enumerations, types and deferred references in the database itself', async () => {
    const store = sqlite();
    const at = '2026-09-28T09:00:00.000Z';
    const bad = {
      id: 'x1',
      title: 'T',
      status: 'maybe',
      priority: 'normal',
      createdAt: at,
      updatedAt: at,
    };
    await expect(store.tasks.add(bad as never)).rejects.toBeInstanceOf(ConstraintError);
    await expect(
      store.transaction('rw', [store.tasks], async () => {
        await store.tasks.add({
          id: 'x2',
          title: 'T',
          status: 'todo',
          priority: 'normal',
          projectId: 'no-such-project',
          createdAt: at,
          updatedAt: at,
        });
      }),
    ).rejects.toBeInstanceOf(ConstraintError);
    expect(await store.tasks.count()).toBe(0);
  });

  it('keeps unique indexes: one entry per habit per day, one slug per project', async () => {
    const r = createRepositories(sqlite());
    const h = await r.habits.create({ name: 'Read', category: 'personal', unit: 'check' });
    await r.habits.setEntry(h.id, '2026-09-28', 1);
    await r.habits.setEntry(h.id, '2026-09-28', 1); // an upsert, not a second row
    const p1 = await r.projects.create({ name: 'Same' });
    const p2 = await r.projects.create({ name: 'Same' });
    expect([p1.slug, p2.slug]).toEqual(['same', 'same-2']);
  });
});

describe('transactions on SQLite', () => {
  it('rolls back every write when the scope fails', async () => {
    const store = sqlite();
    const r = createRepositories(store, deterministic());
    const p = await r.projects.create({ name: 'Engine' });
    await r.projects.addMilestone(p.id, { title: 'Last' });
    const before = await store.events.count();
    await expect(r.projects.setState(p.id, 'done')).rejects.toBeInstanceOf(RecordStateError);
    expect(await store.events.count()).toBe(before);
    expect((await store.projects.get(p.id))?.state).toBe('planning');
  });

  it('never lets another operation land inside an open transaction', async () => {
    const store = sqlite();
    const at = '2026-09-28T09:00:00.000Z';
    const order: string[] = [];
    const failing = store.transaction('rw', [store.tasks], async () => {
      await store.tasks.add({
        id: 'a',
        title: 'A',
        status: 'todo',
        priority: 'normal',
        createdAt: at,
        updatedAt: at,
      });
      order.push('tx wrote');
      await Promise.resolve();
      throw new Error('nope');
    });
    const outside = store.tasks
      .add({
        id: 'b',
        title: 'B',
        status: 'todo',
        priority: 'normal',
        createdAt: at,
        updatedAt: at,
      })
      .then(() => order.push('outside wrote'));
    await expect(failing).rejects.toThrow('nope');
    await outside;
    expect(order).toEqual(['tx wrote', 'outside wrote']);
    expect((await store.tasks.toArray()).map((t) => t.id)).toEqual(['b']);
  });

  it('tells listeners which stores a commit touched', async () => {
    const store = sqlite();
    const seen: string[][] = [];
    store.onChange((changes) => seen.push([...changes].sort()));
    const r = createRepositories(store);
    await r.tasks.create({ title: 'x' });
    const t = (await store.tasks.toArray())[0]!;
    await r.tasks.complete(t.id);
    expect(seen).toEqual([['tasks'], ['events', 'tasks']]);
  });
});

describe('repository parity: Dexie and SQLite (ADR-057)', () => {
  it('produces identical records in every store from the same operations', async () => {
    const dexie = openDatabase(`parity-${crypto.randomUUID()}`);
    const onDexie = createDexieRepositories(dexie, deterministic());
    const sqliteStore = sqlite();
    const onSqlite = createRepositories(sqliteStore, deterministic());
    await scenario(onDexie);
    await scenario(onSqlite);
    // The Notion importer writes the same records on both backends.
    const importInto = (store: Parameters<typeof importNotion>[0]) => {
      let n = 0;
      return importNotion(store, fixtureSnapshot(), fixturePlan(), {
        now: new Date('2026-10-01T00:00:00.000Z'),
        newId: () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`,
      });
    };
    await importInto(asStore(dexie));
    await importInto(sqliteStore);
    const a = await onDexie.backup.exportBackup();
    const b = await onSqlite.backup.exportBackup();
    for (const store of STORE_NAMES) expect(b.data[store], store).toEqual(a.data[store]);
    for (const store of STORE_NAMES) expect(a.data[store].length, store).toBeGreaterThan(0);
    await dexie.delete();
  });

  it('answers the same live queries with the same results', async () => {
    const dexie = openDatabase(`parity-${crypto.randomUUID()}`);
    const onDexie = createDexieRepositories(dexie, deterministic());
    const onSqlite = createRepositories(sqlite(), deterministic());
    const { projectId } = await scenario(onDexie);
    await scenario(onSqlite);
    const first = <T>(watch: (next: (v: T) => void) => () => void) =>
      new Promise<T>((resolve) => {
        const stop = watch((v) => {
          stop();
          resolve(v);
        });
      });
    const pick = (r: Repositories) =>
      Promise.all([
        first(r.projects.watchAll),
        first(r.projects.watchMilestones(projectId)),
        first(r.projects.watchItems(projectId)),
        first(r.tasks.watchOpen),
        first(r.tasks.watchClosed),
        first(r.tasks.watchForDay('2026-09-29')),
        first(r.events.watchTimeline({ limit: 20 })),
        first(r.activity.watchSources('2026-09-01', '2026-10-31')),
        first(r.backup.watchCounts),
        first(r.notes.watchForProject(projectId)),
        first(r.work.watchRange('2026-09-01', '2026-10-31')),
        first(r.offTime.watchRange('2026-09-01', '2026-10-31')),
        first(r.college.watchRange('2026-09-01', '2026-10-31')),
      ]);
    expect(await pick(onSqlite)).toEqual(await pick(onDexie));
    await dexie.delete();
  });
});
