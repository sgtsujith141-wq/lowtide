import { describe, expect, it } from 'vitest';
import {
  createDexieRepositories,
  InvalidInputError,
  RecordNotFoundError,
} from '../db/repositories';
import { recordWatch, setupTestDatabase, steppingClock } from './helpers';

const newDb = setupTestDatabase();

function setup() {
  const db = newDb();
  return { db, r: createDexieRepositories(db, { clock: steppingClock() }) };
}

describe('SPACE (ADR-062)', () => {
  it('keeps six top-level sections, created once', async () => {
    const { r } = setup();
    const first = await r.space.ensureRoots();
    const again = await r.space.ensureRoots();
    expect(first.map((n) => [n.key, n.title, n.order])).toEqual([
      ['projects', 'Projects', 0],
      ['hackathons', 'Hackathons', 1],
      ['college', 'College', 2],
      ['ideas', 'Ideas', 3],
      ['personal', 'Personal', 4],
      ['archive', 'Archive', 5],
    ]);
    expect(again.map((n) => n.id)).toEqual(first.map((n) => n.id));
    expect((await r.space.getByKey('archive'))?.id).toBe(first[5]!.id);
  });

  it('nests pages in order and refuses to move a page inside itself', async () => {
    const { r } = setup();
    const [projects] = await r.space.ensureRoots();
    const a = await r.space.create({ parentId: projects!.id, title: ' Plan ', body: '# Plan' });
    const b = await r.space.create({ parentId: projects!.id, title: 'Research' });
    const child = await r.space.create({ parentId: a.id, title: 'Detail' });
    expect([a.order, b.order, child.order]).toEqual([0, 1, 0]);
    expect(a).toMatchObject({
      title: 'Plan',
      kind: 'page',
      bodyFormat: 'markdown',
      archived: false,
    });
    await expect(r.space.move(a.id, child.id)).rejects.toBeInstanceOf(InvalidInputError);
    await expect(r.space.move(a.id, a.id)).rejects.toBeInstanceOf(InvalidInputError);
    const moved = await r.space.move(child.id, b.id);
    expect(moved.parentId).toBe(b.id);
    const watch = recordWatch(r.space.watchChildren(projects!.id));
    const kids = await watch.until((v) => v.length === 2);
    watch.stop();
    expect(kids.map((k) => k.title)).toEqual(['Plan', 'Research']);
    await expect(
      r.space.create({ parentId: crypto.randomUUID(), title: 'x' }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('holds tables with typed cells and rejects mismatched ones', async () => {
    const { r } = setup();
    const table = await r.space.create({
      title: 'Parts',
      table: {
        columns: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'qty', name: 'Qty', type: 'number' },
          { id: 'ok', name: 'OK', type: 'boolean' },
        ],
        rows: [{ id: 'r1', cells: { name: 'Bolt', qty: 4, ok: true } }],
      },
    });
    expect(table.kind).toBe('table');
    await expect(
      r.space.update(table.id, {
        table: { columns: table.table!.columns, rows: [{ id: 'r1', cells: { qty: 'four' } }] },
      }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    await expect(
      r.space.create({ title: 'Bad', kind: 'page', table: { columns: [], rows: [] } }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('archives and restores without deleting, and finds pages by what they link to', async () => {
    const { r } = setup();
    const project = await r.projects.create({ name: 'Engine' });
    const page = await r.space.create({
      title: 'Engine notes',
      links: [{ type: 'project', id: project.id }],
    });
    expect((await r.space.archive(page.id)).archived).toBe(true);
    expect((await r.space.restore(page.id)).archived).toBe(false);
    const linked = recordWatch(r.space.watchLinked('project', project.id));
    expect((await linked.until((v) => v.length > 0)).map((n) => n.id)).toEqual([page.id]);
    linked.stop();
    const updated = await r.space.update(page.id, { body: 'Hello', icon: '📄' });
    expect(updated).toMatchObject({ body: 'Hello', bodyFormat: 'markdown', icon: '📄' });
    const cleared = await r.space.update(page.id, { body: null, icon: null });
    expect(cleared.body).toBeUndefined();
    expect(cleared.bodyFormat).toBeUndefined();
    expect(cleared.icon).toBeUndefined();
  });

  it('writes no ledger events: knowledge is not activity', async () => {
    const { db, r } = setup();
    const [projects] = await r.space.ensureRoots();
    const page = await r.space.create({ parentId: projects!.id, title: 'Notes' });
    await r.space.update(page.id, { body: 'x' });
    await r.space.archive(page.id);
    expect(await db.events.count()).toBe(0);
  });
});
