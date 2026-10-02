import { describe, expect, it } from 'vitest';
import { asStore } from '../db/database';
import { importNotion } from '../db/import/notion/importer';
import { createDexieRepositories, SpaceConflictError } from '../db/repositories';
import { SPACE_EDIT_BATCH_MS, withEdit } from '../db/repositories/dexie-space-repository';
import { SCHEMA_VERSION } from '../db/schema';
import { fixturePlan, fixtureSnapshot, ID } from './notion-fixture';
import { setupTestDatabase, steppingClock } from './helpers';

const newDb = setupTestDatabase();

describe('schema V9: SPACE blocks, revisions and history (ADR-067)', () => {
  it('creates a page with blocks, revision 0 and a "created" entry, and writes no ledger event', async () => {
    const db = newDb();
    const r = createDexieRepositories(db, { clock: steppingClock() });
    expect(SCHEMA_VERSION).toBe(9);
    const page = await r.space.create({
      title: 'Plan',
      blocks: [
        { type: 'heading1', text: 'Plan' },
        { type: 'paragraph', text: 'Ship it.' },
      ],
    });
    expect(page.revision).toBe(0);
    expect(page.blocks?.every((b) => typeof b.id === 'string' && !b.by)).toBe(true);
    expect(page.edits).toEqual([expect.objectContaining({ kind: 'created', by: 'app', count: 1 })]);
    expect(await db.events.count()).toBe(0);
  });

  it('saves against a revision and refuses a stale one, so nothing is silently overwritten', async () => {
    const r = createDexieRepositories(newDb(), { clock: steppingClock() });
    const page = await r.space.create({
      title: 'Plan',
      blocks: [{ type: 'paragraph', text: 'A' }],
    });
    const block = page.blocks![0]!;
    const saved = await r.space.saveContent(page.id, { blocks: [{ ...block, text: 'B' }] }, 0);
    expect(saved.revision).toBe(1);
    await expect(
      r.space.saveContent(page.id, { blocks: [{ ...block, text: 'C' }] }, 0),
    ).rejects.toBeInstanceOf(SpaceConflictError);
    expect((await r.space.get(page.id))?.blocks?.[0]?.text).toBe('B');
  });

  it('batches one author’s edits into one history entry, and starts a new one for someone else', async () => {
    const at = (m: number) =>
      new Date(Date.parse('2026-01-01T10:00:00.000Z') + m * 60_000).toISOString();
    let edits = withEdit(undefined, 'edited', at(0), 'app', undefined);
    edits = withEdit(edits, 'edited', at(5), 'app', undefined);
    edits = withEdit(edits, 'edited', at(9), 'ai-client', 'Claude');
    edits = withEdit(
      edits,
      'edited',
      at(9 + SPACE_EDIT_BATCH_MS / 60_000 + 1),
      'ai-client',
      'Claude',
    );
    expect(edits.map((e) => [e.by, e.client, e.count])).toEqual([
      ['app', undefined, 2],
      ['ai-client', 'Claude', 1],
      ['ai-client', 'Claude', 1],
    ]);
  });

  it('appends to an imported page by parsing its body first, keeping the original body', async () => {
    const db = newDb();
    let n = 0;
    await importNotion(asStore(db), fixtureSnapshot(), fixturePlan(), {
      now: new Date('2026-02-10T12:00:00.000Z'),
      newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    });
    const source = await db.sourceRecords
      .where('[system+sourceId+entityType]')
      .equals(['notion', ID.plan, 'spaceNode'])
      .first();
    const before = (await db.spaceNodes.get(source!.entityId))!;
    expect(before.blocks).toBeUndefined();
    const ai = createDexieRepositories(db, { source: 'ai-client', actor: 'Claude' });
    const after = await ai.space.appendBlocks(before.id, [{ type: 'paragraph', text: 'Added' }]);
    expect(after.body).toBe(before.body);
    expect(after.source).toEqual(before.source);
    const last = after.blocks!.at(-1)!;
    expect(last).toMatchObject({ text: 'Added', by: { client: 'Claude' } });
    expect(after.blocks!.length).toBeGreaterThan(1);
    expect(after.edits?.at(-1)).toMatchObject({
      kind: 'edited',
      by: 'ai-client',
      client: 'Claude',
    });
  });

  it('edits one block, and refuses to edit imported content kept as it was', async () => {
    const r = createDexieRepositories(newDb());
    const page = await r.space.create({
      title: 'Mixed',
      blocks: [
        { type: 'paragraph', text: 'Old' },
        { type: 'fallback', text: '<synced_block>x</synced_block>' },
      ],
    });
    const [para, fallback] = page.blocks!;
    const updated = await r.space.updateBlock(page.id, para!.id, { text: 'New', type: 'heading2' });
    expect(updated.blocks![0]).toMatchObject({ type: 'heading2', text: 'New' });
    await expect(r.space.updateBlock(page.id, fallback!.id, { text: 'no' })).rejects.toThrow(
      /can’t be edited/,
    );
  });

  it('edits table cells and adds rows with type checks', async () => {
    const r = createDexieRepositories(newDb());
    const table = await r.space.create({
      title: 'Leads',
      table: {
        columns: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'n', name: 'Count', type: 'number' },
        ],
        rows: [{ id: 'r1', cells: { name: 'A' } }],
      },
    });
    const set = await r.space.setCell(table.id, 'r1', 'n', 3);
    expect(set.table!.rows[0]!.cells).toEqual({ name: 'A', n: 3 });
    await expect(r.space.setCell(table.id, 'r1', 'n', 'three')).rejects.toThrow(/wrong kind/);
    const added = await r.space.addRow(table.id, { name: 'B' });
    expect(added.table!.rows).toHaveLength(2);
    expect((await r.space.setCell(table.id, 'r1', 'n', null)).table!.rows[0]!.cells).toEqual({
      name: 'A',
    });
    expect(added.edits?.at(-1)).toMatchObject({ kind: 'table' });
  });

  it('links once, duplicates a page after itself, archives and restores with history', async () => {
    const r = createDexieRepositories(newDb(), { clock: steppingClock() });
    const project = await r.projects.create({ name: 'Engine' });
    const page = await r.space.create({
      title: 'Notes',
      blocks: [{ type: 'paragraph', text: 'x' }],
    });
    await r.space.addLink(page.id, { type: 'project', id: project.id });
    const twice = await r.space.addLink(page.id, { type: 'project', id: project.id });
    expect(twice.links).toHaveLength(1);
    const copy = await r.space.duplicate(page.id);
    expect(copy).toMatchObject({ title: 'Notes (copy)', order: page.order + 1 });
    expect(copy.blocks![0]!.id).not.toBe(page.blocks![0]!.id);
    await r.space.archive(page.id);
    const back = await r.space.restore(page.id);
    expect(back.edits!.map((e) => e.kind)).toEqual(['created', 'linked', 'archived', 'restored']);
  });

  it('makes a project’s SPACE folder and slots only when first needed, once', async () => {
    const db = newDb();
    const r = createDexieRepositories(db);
    const project = await r.projects.create({ name: 'Engine' });
    expect(await db.spaceNodes.count()).toBe(0);
    const slot = await r.space.ensureProjectSpace(project.id, 'architecture');
    expect(slot).toMatchObject({
      title: 'Architecture',
      key: `project:${project.id}:architecture`,
    });
    const again = await r.space.ensureProjectSpace(project.id, 'architecture');
    expect(again.id).toBe(slot.id);
    const folder = await r.space.getByKey(`project:${project.id}`);
    expect(folder).toMatchObject({ title: 'Engine', links: [{ type: 'project', id: project.id }] });
    // Projects root, the folder and one slot: nothing else.
    expect(await db.spaceNodes.count()).toBe(3);
  });
});
