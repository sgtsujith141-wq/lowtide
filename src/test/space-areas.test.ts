import { describe, expect, it } from 'vitest';
import { createDexieRepositories } from '../db/repositories';
import { SPACE_ROOTS } from '../types/domain';
import { setupTestDatabase } from './helpers';

const newDb = setupTestDatabase();
const at = '2026-10-01T08:00:00.000Z';

describe('SPACE Areas (ADR-071)', () => {
  it('adds Areas beside an existing tree without touching the other sections', async () => {
    const db = newDb();
    const r = createDexieRepositories(db);
    // A V10 tree: the seven sections that existed before Areas, with their stored orders.
    const older = SPACE_ROOTS.filter((root) => root.key !== 'areas');
    for (const [order, root] of older.entries()) {
      await db.spaceNodes.add({
        id: crypto.randomUUID(),
        kind: 'section',
        title: root.title,
        key: root.key,
        order,
        archived: false,
        links: [],
        externalLinks: [],
        attachments: [],
        createdAt: at,
        updatedAt: at,
      });
    }
    const before = await db.spaceNodes.toArray();

    const roots = await r.space.ensureRoots();
    expect(roots.map((n) => n.key)).toEqual(SPACE_ROOTS.map((root) => root.key));
    const areas = roots.find((n) => n.key === 'areas')!;
    expect(areas).toMatchObject({ kind: 'section', title: 'Areas', archived: false });
    expect(areas).not.toHaveProperty('parentId');

    const after = await db.spaceNodes.toArray();
    expect(after).toHaveLength(before.length + 1);
    for (const node of before) expect(await db.spaceNodes.get(node.id)).toEqual(node);

    // Idempotent: a second call makes nothing new.
    await r.space.ensureRoots();
    expect(await db.spaceNodes.count()).toBe(after.length);
  });

  it('holds folders, pages and databases like any other section', async () => {
    const r = createDexieRepositories(newDb());
    const areas = (await r.space.ensureRoots()).find((n) => n.key === 'areas')!;
    const folder = await r.space.create({ parentId: areas.id, kind: 'section', title: 'Track' });
    const page = await r.space.create({ parentId: areas.id, title: 'Plan', body: '# Plan' });
    const table = await r.space.create({
      parentId: folder.id,
      title: 'Log',
      table: { columns: [{ id: 'n', name: 'Name', type: 'text' }], rows: [] },
    });
    expect([folder.parentId, page.parentId, table.parentId]).toEqual([
      areas.id,
      areas.id,
      folder.id,
    ]);
  });
});
