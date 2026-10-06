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
    expect(meta.value).toBe('11');
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

describe('companion migration 4 (schema V8)', () => {
  it('adds the focus column to a database created before V8, keeping its projects', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { DatabaseSync } = await import('node:sqlite');
    const dir = mkdtempSync(join(tmpdir(), 'lowtide-v8-'));
    try {
      const file = join(dir, 'old.sqlite');
      const first = new SqliteStore(file);
      const p = await createRepositories(first).projects.create({ name: 'Engine' });
      first.close();
      // Make it look like a pre-V8 database: no focus column, migration 4 not run.
      const raw = new DatabaseSync(file);
      raw.exec('ALTER TABLE projects DROP COLUMN focus');
      raw.exec('DELETE FROM companion_migrations WHERE id = 4');
      raw.close();
      const reopened = new SqliteStore(file);
      const columns = (
        reopened.sql.prepare('PRAGMA table_info(projects)').all() as { name: string }[]
      ).map((c) => c.name);
      expect(columns).toContain('focus');
      const r = createRepositories(reopened);
      expect((await r.projects.get(p.id))?.name).toBe('Engine');
      expect((await r.projects.setFocus(p.id, 'secondary')).focus).toBe('secondary');
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('companion migration 5 (schema V9)', () => {
  it('adds SPACE blocks, revision and edits to an older database, keeping its pages', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { DatabaseSync } = await import('node:sqlite');
    const dir = mkdtempSync(join(tmpdir(), 'lowtide-v9-'));
    try {
      const file = join(dir, 'old.sqlite');
      const first = new SqliteStore(file);
      const page = await createRepositories(first).space.create({
        title: 'Plan',
        body: '# Plan\n\nShip it.',
      });
      first.close();
      // A pre-V9 database: none of the three columns, migration 5 not run.
      const raw = new DatabaseSync(file);
      raw.exec('UPDATE space_nodes SET blocks = NULL, revision = NULL, edits = NULL');
      for (const c of ['blocks', 'revision', 'edits']) {
        raw.exec(`ALTER TABLE space_nodes DROP COLUMN ${c}`);
      }
      raw.exec('DELETE FROM companion_migrations WHERE id = 5');
      raw.close();
      const reopened = new SqliteStore(file);
      const columns = (
        reopened.sql.prepare('PRAGMA table_info(space_nodes)').all() as { name: string }[]
      ).map((c) => c.name);
      expect(columns).toEqual(expect.arrayContaining(['blocks', 'revision', 'edits']));
      const r = createRepositories(reopened);
      const kept = await r.space.get(page.id);
      expect(kept).toMatchObject({ title: 'Plan', body: '# Plan\n\nShip it.' });
      expect(kept).not.toHaveProperty('blocks');
      const saved = await r.space.appendBlocks(page.id, [{ type: 'paragraph', text: 'More' }]);
      expect(saved.blocks?.map((b) => b.text)).toEqual(['Plan', 'Ship it.', 'More']);
      expect(saved.body).toBe('# Plan\n\nShip it.');
      expect(saved.revision).toBe(1);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('domain schema V10 (v2.1, companion migration 6)', () => {
  it('adds the v2.1 columns to an older database, keeping every record, and runs once', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { DatabaseSync } = await import('node:sqlite');
    const dir = mkdtempSync(join(tmpdir(), 'lowtide-v10-'));
    try {
      const file = join(dir, 'old.sqlite');
      const first = new SqliteStore(file);
      const r0 = createRepositories(first);
      const project = await r0.projects.create({ name: 'Engine' });
      const milestone = await r0.projects.addMilestone(project.id, { title: 'Foundation' });
      const task = await r0.tasks.create({ title: 'Ship', projectId: project.id });
      first.close();
      // A V9 database: none of the new columns, migration 6 not run.
      const raw = new DatabaseSync(file);
      const drops: [string, string][] = [
        ['tasks', 'parent_id'],
        ['hackathons', 'archived_at'],
        ['hackathons', 'pinned_at'],
        ['projects', 'description'],
        ['projects', 'pinned_at'],
        ['milestones', 'archived_at'],
        ['space_nodes', 'description'],
        ['space_nodes', 'pinned_at'],
      ];
      raw.exec('DROP INDEX tasks_parent_id');
      for (const [table, column] of drops) raw.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      raw.exec('DELETE FROM companion_migrations WHERE id = 6');
      raw.close();

      const reopened = new SqliteStore(file);
      for (const [table, column] of drops) {
        const columns = (
          reopened.sql.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        ).map((c) => c.name);
        expect(columns, table).toContain(column);
      }
      const r = createRepositories(reopened);
      expect(await r.projects.get(project.id)).toMatchObject({ name: 'Engine' });
      const sub = await r.tasks.create({ title: 'Docs', parentId: task.id });
      expect(sub).toMatchObject({ parentId: task.id, projectId: project.id });
      expect((await r.projects.archiveMilestone(milestone.id)).archivedAt).toBeDefined();
      expect((await r.projects.setPinned(project.id, true)).pinnedAt).toBeDefined();
      reopened.close();
      // A copy was kept before the upgrade touched the data.
      const { readdirSync } = await import('node:fs');
      const copies = readdirSync(join(dir, 'checkpoints')).filter((f) => f.endsWith('.sqlite'));
      expect(copies).toEqual([expect.stringMatching(/before-upgrade-6\.sqlite$/)]);
      // Applying migrations again changes nothing.
      const again = new SqliteStore(file);
      const ids = (
        again.sql.prepare('SELECT id FROM companion_migrations ORDER BY id').all() as {
          id: number;
        }[]
      ).map((m) => m.id);
      expect(ids).toEqual(MIGRATIONS.map((m) => m.id));
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds hackathon kind and selection to a V10 database (migration 8), once, keeping every hackathon', async () => {
    const { mkdtempSync, readdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { DatabaseSync } = await import('node:sqlite');
    const dir = mkdtempSync(join(tmpdir(), 'lowtide-v11-'));
    try {
      const file = join(dir, 'old.sqlite');
      const first = new SqliteStore(file);
      const h = await createRepositories(first).hackathons.create({
        name: 'Night CTF',
        eventStart: '2026-10-10',
        registrationStatus: 'registered',
        nextAction: 'Register',
      });
      first.close();
      // A V10 database: neither column, migration 8 not run.
      const raw = new DatabaseSync(file);
      for (const c of ['kind', 'selection']) raw.exec(`ALTER TABLE hackathons DROP COLUMN ${c}`);
      raw.exec('DELETE FROM companion_migrations WHERE id = 8');
      raw.close();

      const reopened = new SqliteStore(file);
      const columns = (
        reopened.sql.prepare('PRAGMA table_info(hackathons)').all() as { name: string }[]
      ).map((c) => c.name);
      expect(columns).toEqual(expect.arrayContaining(['kind', 'selection']));
      const r = createRepositories(reopened);
      expect(await reopened.hackathons.get(h.id)).toEqual(h);
      const ctf = await r.hackathons.update(h.id, { kind: 'ctf', selection: 'shortlisted' });
      expect(ctf).toMatchObject({ kind: 'ctf', selection: 'shortlisted', nextAction: 'Register' });
      // The new columns carry their own CHECK constraints.
      expect(() =>
        reopened.sql.exec(`UPDATE hackathons SET kind = 'ideathon' WHERE id = '${h.id}'`),
      ).toThrow(/CHECK/);
      expect(() =>
        reopened.sql.exec(`UPDATE hackathons SET selection = 'maybe' WHERE id = '${h.id}'`),
      ).toThrow(/CHECK/);
      reopened.close();
      const copies = readdirSync(join(dir, 'checkpoints')).filter((f) => f.endsWith('.sqlite'));
      expect(copies).toEqual([expect.stringMatching(/before-upgrade-8\.sqlite$/)]);

      const again = new SqliteStore(file);
      const ids = (
        again.sql.prepare('SELECT id FROM companion_migrations ORDER BY id').all() as {
          id: number;
        }[]
      ).map((m) => m.id);
      expect(ids).toEqual(MIGRATIONS.map((m) => m.id));
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs the v2.1 SPACE operations on SQLite as on Dexie', async () => {
    const r = createRepositories(sqlite());
    const roots = await r.space.ensureRoots();
    const ideas = roots.find((n) => n.key === 'ideas')!;
    const folder = await r.space.create({ parentId: ideas.id, kind: 'section', title: 'Research' });
    const table = await r.space.create({
      parentId: folder.id,
      title: 'Tracker',
      table: { columns: [{ id: 'n', name: 'Name', type: 'text' }], rows: [] },
    });
    await r.space.addColumn(table.id, { name: 'Done', type: 'boolean' });
    let n = await r.space.addRow(table.id, { n: 'Alpha' });
    const row = n.table!.rows[0]!;
    n = await r.space.updateRow(table.id, row.id, { [n.table!.columns[1]!.id]: true });
    expect(n.table!.rows[0]!.cells).toMatchObject({ n: 'Alpha' });
    await r.space.saveView(table.id, { name: 'Open', type: 'list' });
    const copy = await r.space.duplicateTree(folder.id, { deep: true });
    const all = await new Promise<{ parentId?: string; title: string }[]>((resolve) => {
      const stop = r.space.watchAll((v) => {
        queueMicrotask(() => stop());
        resolve(v);
      });
    });
    expect(all.filter((x) => x.parentId === copy.id).map((x) => x.title)).toEqual(['Tracker']);
    await r.space.ensureSystemPages({ title: 'Guide', markdown: '# Guide' });
    expect(await r.space.getByKey('lowtide:guide')).toMatchObject({ title: 'Guide' });
  });
});

describe('a running work session across a companion restart (v2 PHASE 015)', () => {
  it('comes back exactly as it was, paused state and all', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'lowtide-restart-'));
    try {
      const file = join(dir, 'data.sqlite');
      const first = new SqliteStore(file);
      const r1 = createRepositories(first);
      const p = await r1.projects.create({ name: 'Engine' });
      const started = await r1.work.start({ kind: 'project', projectId: p.id, intent: 'Wire it' });
      await r1.work.pause(started.id);
      first.close();
      const again = new SqliteStore(file);
      const r2 = createRepositories(again, { watch: again.watch });
      const active = await new Promise<unknown>((resolve) => {
        const stop = r2.work.watchActive((s) => {
          stop();
          resolve(s);
        });
      });
      expect(active).toMatchObject({
        id: started.id,
        projectId: p.id,
        intent: 'Wire it',
        pauses: [expect.objectContaining({ at: expect.any(String) })],
      });
      expect((active as { endedAt?: string }).endedAt).toBeUndefined();
      expect((await r2.work.resume(started.id)).pauses[0]!.resumedAt).toBeDefined();
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
