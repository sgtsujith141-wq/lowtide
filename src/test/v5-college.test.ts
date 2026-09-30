import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { createDexieRepositories, InvalidInputError } from '../db/repositories';
import { SCHEMA_VERSION, STORES_V1, STORES_V2, STORES_V3, STORES_V4 } from '../db/schema';
import { recordWatch, setupTestDatabase, steppingClock } from './helpers';

const names: string[] = [];
afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

const newDb = setupTestDatabase();
const at = '2026-09-20T08:00:00.000Z';
const id = (n: number) => `0d6f6c3e-5555-4a2b-9c3d-${String(n).padStart(12, '0')}`;

describe('schema V4 → V5 (additive, ADR-051)', () => {
  it('opens a genuine V4 database with every record deep-equal and collegeItems empty', async () => {
    const name = `lowtide-v5-migration-${crypto.randomUUID()}`;
    names.push(name);
    const v4 = new Dexie(name);
    v4.version(1).stores(STORES_V1);
    v4.version(2).stores(STORES_V2);
    v4.version(3).stores(STORES_V3);
    v4.version(4).stores(STORES_V4);
    await v4.open();
    const project = {
      id: id(1),
      name: 'Engine',
      slug: 'engine',
      kind: 'software',
      state: 'active',
      createdAt: at,
      updatedAt: at,
      stateChangedAt: at,
    };
    const task = {
      id: id(2),
      title: 'Wire it',
      status: 'todo',
      priority: 'normal',
      projectId: id(1),
      createdAt: at,
      updatedAt: at,
    };
    const session = {
      id: id(3),
      kind: 'project',
      projectId: id(1),
      startedAt: at,
      endedAt: '2026-09-20T09:00:00.000Z',
      pauses: [],
      localDate: '2026-09-20',
      createdAt: at,
      updatedAt: at,
    };
    await v4.table('projects').add(project);
    await v4.table('tasks').add(task);
    await v4.table('workSessions').add(session);
    v4.close();

    const db = openDatabase(name);
    await db.open();
    expect(SCHEMA_VERSION).toBe(7);
    expect(db.verno).toBe(SCHEMA_VERSION);
    expect(await db.projects.get(id(1))).toEqual(project);
    expect(await db.tasks.get(id(2))).toEqual(task);
    expect(await db.workSessions.get(id(3))).toEqual(session);
    expect(await db.collegeItems.count()).toBe(0);
    db.close();
  });
});

describe('college items', () => {
  function setup() {
    return createDexieRepositories(newDb(), { clock: steppingClock() });
  }

  it('creates planned items and marks classes attended or missed, coursework done', async () => {
    const r = setup();
    const lecture = await r.college.create({
      kind: 'class',
      title: ' DBMS lecture ',
      date: '2026-09-28',
      course: 'DBMS',
    });
    expect(lecture).toMatchObject({ title: 'DBMS lecture', status: 'planned', course: 'DBMS' });
    expect((await r.college.update(lecture.id, { status: 'missed' })).status).toBe('missed');
    expect((await r.college.update(lecture.id, { status: 'attended' })).status).toBe('attended');
    await expect(r.college.update(lecture.id, { status: 'done' })).rejects.toBeInstanceOf(
      InvalidInputError,
    );
    const essay = await r.college.create({
      kind: 'assignment',
      title: 'Essay',
      date: '2026-10-02',
    });
    await expect(r.college.update(essay.id, { status: 'attended' })).rejects.toBeInstanceOf(
      InvalidInputError,
    );
    expect((await r.college.update(essay.id, { status: 'done', note: 'submitted' })).note).toBe(
      'submitted',
    );
  });

  it('watches a date range in order, and removes', async () => {
    const r = setup();
    await r.college.create({ kind: 'lab', title: 'B lab', date: '2026-09-29' });
    const a = await r.college.create({ kind: 'exam', title: 'A exam', date: '2026-09-29' });
    await r.college.create({ kind: 'event', title: 'Fest', date: '2026-10-15' });
    const watch = recordWatch(r.college.watchRange('2026-09-28', '2026-09-30'));
    expect((await watch.until((v) => v.length === 2)).map((c) => c.title)).toEqual([
      'A exam',
      'B lab',
    ]);
    await r.college.remove(a.id);
    expect((await watch.until((v) => v.length === 1))[0]!.title).toBe('B lab');
    watch.stop();
  });

  it('feeds the Daily Pulse college signal only when attended or done, never when missed', async () => {
    const r = setup();
    const done = await r.college.create({ kind: 'class', title: 'Went', date: '2026-09-28' });
    await r.college.update(done.id, { status: 'attended' });
    const missed = await r.college.create({ kind: 'class', title: 'Skipped', date: '2026-09-28' });
    await r.college.update(missed.id, { status: 'missed' });
    await r.college.create({ kind: 'assignment', title: 'Planned', date: '2026-09-28' });
    const watch = recordWatch(r.activity.watchSources('2026-09-28', '2026-09-28'));
    const sources = await watch.until(() => true);
    expect(sources.collegeDone.map((c) => c.title)).toEqual(['Went']);
    watch.stop();
  });

  it('rejects an invalid status in a backup, writing nothing', async () => {
    const r = setup();
    await r.college.create({ kind: 'class', title: 'DBMS', date: '2026-09-28' });
    const doc = await r.backup.exportBackup();
    doc.data.collegeItems[0]!.status = 'done';
    expect(r.backup.inspect(JSON.stringify(doc))).toMatchObject({
      ok: false,
      problem: 'invalid-data',
    });
  });
});
