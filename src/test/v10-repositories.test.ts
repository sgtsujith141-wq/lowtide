import { describe, expect, it } from 'vitest';
import {
  createDexieRepositories,
  InvalidInputError,
  RecordStateError,
  SpaceConflictError,
  type Repositories,
} from '../db/repositories';
import type { Watch } from '../db/repositories';
import { setupTestDatabase } from './helpers';

const newDb = setupTestDatabase();

function setup() {
  const db = newDb();
  return { db, r: createDexieRepositories(db) };
}

const once = <T>(watch: Watch<T>) =>
  new Promise<T>((resolve) => {
    const stop = watch((v) => {
      queueMicrotask(() => stop());
      resolve(v);
    });
  });

async function project(r: Repositories, name = 'Engine') {
  return r.projects.create({ name });
}

describe('schema V10: subtasks', () => {
  it('makes a subtask in its parent’s project, one level deep', async () => {
    const { r } = setup();
    const p = await project(r);
    const parent = await r.tasks.create({ title: 'Ship v1', projectId: p.id });
    const child = await r.tasks.create({ title: 'Write the README', parentId: parent.id });
    expect(child).toMatchObject({ parentId: parent.id, projectId: p.id, status: 'todo' });
    await expect(r.tasks.create({ title: 'Too deep', parentId: child.id })).rejects.toThrow(
      InvalidInputError,
    );
    const other = await project(r, 'Other');
    await expect(
      r.tasks.create({ title: 'Elsewhere', parentId: parent.id, projectId: other.id }),
    ).rejects.toThrow(/same project/);
    // A task with subtasks can't become one.
    const lone = await r.tasks.create({ title: 'Lone', projectId: p.id });
    await expect(r.tasks.update(parent.id, { parentId: lone.id })).rejects.toThrow(/with subtasks/);
    const detached = await r.tasks.update(child.id, { parentId: null });
    expect(detached).not.toHaveProperty('parentId');
  });

  it('starts and stops a task without completing anything', async () => {
    const { r, db } = setup();
    const t = await r.tasks.create({ title: 'Refactor' });
    expect((await r.tasks.setDoing(t.id, true)).status).toBe('doing');
    expect((await r.tasks.setDoing(t.id, false)).status).toBe('todo');
    await r.tasks.complete(t.id);
    await expect(r.tasks.setDoing(t.id, true)).rejects.toThrow(RecordStateError);
    expect((await db.events.toArray()).map((e) => e.type)).toEqual(['task.completed']);
  });
});

describe('schema V10: milestones archive and reorder', () => {
  it('archives a milestone out of the roadmap and progress, and restores it last', async () => {
    const { r, db } = setup();
    const p = await project(r);
    const a = await r.projects.addMilestone(p.id, { title: 'A' });
    const b = await r.projects.addMilestone(p.id, { title: 'B' });
    const c = await r.projects.addMilestone(p.id, { title: 'C' });
    await r.projects.completeMilestone(a.id);
    await r.projects.archiveMilestone(b.id);
    const live = await once(r.projects.watchMilestones(p.id));
    expect(live.map((m) => [m.title, m.order])).toEqual([
      ['A', 0],
      ['C', 1],
    ]);
    expect((await once(r.projects.watchArchivedMilestones(p.id))).map((m) => m.title)).toEqual([
      'B',
    ]);
    // Progress counts only live milestones: 1 of 2.
    const snapshot = (await db.progressSnapshots.toArray()).at(-1)!;
    expect(snapshot).toMatchObject({ milestoneCount: 2, completedCount: 1 });
    // Done needs only live milestones finished.
    await r.projects.completeMilestone(c.id);
    expect((await r.projects.setState(p.id, 'done')).state).toBe('done');
    await r.projects.restoreMilestone(b.id);
    expect((await once(r.projects.watchMilestones(p.id))).map((m) => [m.title, m.order])).toEqual([
      ['A', 0],
      ['C', 1],
      ['B', 2],
    ]);
  });

  it('reorders the whole roadmap exactly as given, or not at all', async () => {
    const { r } = setup();
    const p = await project(r);
    const [a, b, c] = [
      await r.projects.addMilestone(p.id, { title: 'A' }),
      await r.projects.addMilestone(p.id, { title: 'B' }),
      await r.projects.addMilestone(p.id, { title: 'C' }),
    ];
    const ordered = await r.projects.reorderMilestones(p.id, [c.id, a.id, b.id]);
    expect(ordered.map((m) => m.title)).toEqual(['C', 'A', 'B']);
    await expect(r.projects.reorderMilestones(p.id, [a.id, b.id])).rejects.toThrow(
      InvalidInputError,
    );
    const first = await r.projects.addMilestone(p.id, { title: 'Zero', position: 0 });
    expect(first.order).toBe(0);
    expect((await once(r.projects.watchMilestones(p.id))).map((m) => m.title)).toEqual([
      'Zero',
      'C',
      'A',
      'B',
    ]);
  });
});

describe('schema V10: descriptions and pins', () => {
  it('keeps a project’s description, and pins without moving it', async () => {
    const { r } = setup();
    const p = await r.projects.create({
      name: 'Media Engine',
      description: 'An AI media-production engine.',
      focus: 'secondary',
    });
    expect(p).toMatchObject({ state: 'planning', focus: 'secondary' });
    const pinned = await r.projects.setPinned(p.id, true);
    expect(pinned.pinnedAt).toBeDefined();
    expect(pinned.updatedAt).toBe(p.updatedAt);
    expect(await r.projects.setPinned(p.id, false)).not.toHaveProperty('pinnedAt');
    const edited = await r.projects.update(p.id, { description: '' });
    expect(edited).not.toHaveProperty('description');
  });

  it('archives, restores and pins hackathons', async () => {
    const { r } = setup();
    const h = await r.hackathons.create({ name: 'Build Night' });
    const archived = await r.hackathons.archive(h.id);
    expect(archived.archivedAt).toBeDefined();
    expect(await r.hackathons.restore(h.id)).not.toHaveProperty('archivedAt');
    expect((await r.hackathons.setPinned(h.id, true)).pinnedAt).toBeDefined();
  });
});

describe('schema V10: SPACE structure', () => {
  async function tree(r: Repositories) {
    const [, , , ideas] = await r.space.ensureRoots();
    const folder = await r.space.create({
      parentId: ideas!.id,
      kind: 'section',
      title: 'Research',
    });
    const page = await r.space.create({
      parentId: folder.id,
      title: 'Notes',
      blocks: [{ type: 'paragraph', text: 'First' }],
    });
    const sub = await r.space.create({ parentId: page.id, title: 'Detail', blocks: [] });
    return { ideas: ideas!, folder, page, sub };
  }

  it('makes real folders, and moves only where it makes sense', async () => {
    const { r } = setup();
    const { ideas, folder, page } = await tree(r);
    expect(folder).toMatchObject({ kind: 'section' });
    expect(folder).not.toHaveProperty('key');
    const table = await r.space.create({
      parentId: ideas.id,
      title: 'Leads',
      table: { columns: [{ id: 'n', name: 'Name', type: 'text' }], rows: [] },
    });
    await expect(r.space.move(page.id, table.id)).rejects.toThrow(/database can’t hold/);
    await expect(r.space.move(folder.id, page.id)).rejects.toThrow(/inside itself/);
    const [projects] = await r.space.ensureRoots();
    await expect(r.space.move(projects!.id, folder.id)).rejects.toThrow(/in its place/);
    await expect(r.space.move(page.id, null)).rejects.toThrow(/choose a folder/);
    const moved = await r.space.move(page.id, ideas.id, 0);
    expect(moved).toMatchObject({ parentId: ideas.id, order: 0 });
  });

  it('duplicates a folder with everything in it, without history', async () => {
    const { r } = setup();
    const { folder } = await tree(r);
    const copy = await r.space.duplicateTree(folder.id, { deep: true });
    expect(copy.title).toBe('Research (copy)');
    const all = await once(r.space.watchAll);
    const inside = all.filter((n) => n.parentId === copy.id);
    expect(inside.map((n) => n.title)).toEqual(['Notes']);
    expect(all.filter((n) => n.parentId === inside[0]!.id).map((n) => n.title)).toEqual(['Detail']);
    expect(inside[0]!.edits).toHaveLength(1);
  });

  it('pins without a revision, and deletes only what was archived first', async () => {
    const { r } = setup();
    const { folder, page, sub } = await tree(r);
    const pinned = await r.space.setPinned(page.id, true);
    expect(pinned.pinnedAt).toBeDefined();
    expect(pinned.revision).toBe(page.revision);
    await expect(r.space.deletePermanently(folder.id)).rejects.toThrow(/Archive it first/);
    await r.space.archive(folder.id);
    expect(await r.space.deletePermanently(folder.id)).toBe(3);
    expect(await r.space.get(sub.id)).toBeUndefined();
    const roots = await r.space.ensureRoots();
    await r.space.archive(roots[0]!.id);
    await expect(r.space.deletePermanently(roots[0]!.id)).rejects.toThrow(/maintains/);
  });
});

describe('schema V10: SPACE blocks', () => {
  it('inserts, moves, replaces and removes blocks, refusing stale writes', async () => {
    const { r } = setup();
    const [, , , ideas] = await r.space.ensureRoots();
    const page = await r.space.create({
      parentId: ideas!.id,
      title: 'Doc',
      blocks: [
        { id: 'a', type: 'paragraph', text: 'A' },
        { id: 'b', type: 'paragraph', text: 'B' },
        { id: 'c', type: 'paragraph', text: 'C' },
      ],
    });
    const text = (n: { blocks?: { text?: string }[] }) => n.blocks!.map((b) => b.text);
    let n = await r.space.insertBlocks(page.id, 'a', [{ type: 'heading2', text: 'Mid' }]);
    expect(text(n)).toEqual(['A', 'Mid', 'B', 'C']);
    n = await r.space.moveBlock(page.id, 'c', null);
    expect(text(n)).toEqual(['C', 'A', 'Mid', 'B']);
    n = await r.space.replaceBlocks(page.id, 'a', 'b', [{ type: 'paragraph', text: 'New' }]);
    expect(text(n)).toEqual(['C', 'New']);
    n = await r.space.deleteBlocks(page.id, ['c']);
    expect(text(n)).toEqual(['New']);
    await expect(
      r.space.insertBlocks(page.id, null, [{ type: 'paragraph', text: 'Late' }], {
        baseRevision: 0,
      }),
    ).rejects.toThrow(SpaceConflictError);
    n = await r.space.insertBlocks(page.id, null, [{ type: 'paragraph', text: 'Top' }], {
      baseRevision: n.revision!,
    });
    expect(text(n)).toEqual(['Top', 'New']);
  });
});

describe('schema V10: SPACE databases', () => {
  async function database(r: Repositories) {
    const [, , , ideas] = await r.space.ensureRoots();
    return r.space.create({
      parentId: ideas!.id,
      title: 'Tracker',
      table: {
        columns: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'score', name: 'Score', type: 'text' },
        ],
        rows: [{ id: 'r1', cells: { name: 'Alpha', score: '3' } }],
      },
    });
  }

  it('adds, converts and removes properties, keeping every value or refusing', async () => {
    const { r } = setup();
    const t = await database(r);
    let n = await r.space.addColumn(t.id, {
      name: 'Stage',
      type: 'status',
      options: [{ name: 'Todo' }, { name: 'Done' }],
    });
    const stage = n.table!.columns.at(-1)!;
    n = await r.space.updateColumn(t.id, 'score', { type: 'number' });
    expect(n.table!.rows[0]!.cells.score).toBe(3);
    await r.space.updateRow(t.id, 'r1', { name: 'Not a number' });
    await expect(r.space.updateColumn(t.id, 'name', { type: 'number' })).rejects.toThrow(
      /can’t become number/,
    );
    await expect(r.space.addColumn(t.id, { name: 'score', type: 'text' })).rejects.toThrow(
      /already a property/,
    );
    n = await r.space.saveView(t.id, {
      name: 'Board',
      type: 'board',
      groupBy: stage.id,
      sorts: [{ column: 'score', dir: 'desc' }],
    });
    expect(n.table!.views).toHaveLength(1);
    n = await r.space.removeColumn(t.id, 'score');
    expect(n.table!.rows[0]!.cells).not.toHaveProperty('score');
    expect(n.table!.views![0]!.sorts).toEqual([]);
  });

  it('records who made and changed each row, and puts a deleted row back where it was', async () => {
    const { r } = setup();
    const t = await database(r);
    let n = await r.space.addRow(t.id, { name: 'Beta' });
    const beta = n.table!.rows.at(-1)!;
    expect(beta).toMatchObject({ createdBy: 'owner', updatedBy: 'owner' });
    n = await r.space.deleteRow(t.id, 'r1');
    expect(n.table!.rows.map((x) => x.id)).toEqual([beta.id]);
    n = await r.space.addRow(t.id, { name: 'Alpha' }, { rowId: 'r1', index: 0 });
    expect(n.table!.rows.map((x) => x.id)).toEqual(['r1', beta.id]);
  });

  it('never stores a value in a computed property', async () => {
    const { r } = setup();
    const t = await database(r);
    await r.space.addColumn(t.id, { id: 'made', name: 'Created', type: 'createdTime' });
    await expect(r.space.updateRow(t.id, 'r1', { made: 'yesterday' })).rejects.toThrow(/computed/);
    await expect(
      r.space.addColumn(t.id, {
        name: 'Count',
        type: 'rollup',
        rollup: { relation: 'name', fn: 'count' },
      }),
    ).rejects.toThrow(/needs a relation/);
  });
});

describe('schema V10: templates and LOWTIDE’s own pages', () => {
  const guide = { title: 'Claude Operating Guide', markdown: '# Guide\n\nRead this first.' };

  it('makes the Templates folder once, and keeps the guide as written', async () => {
    const { r } = setup();
    await r.space.ensureSystemPages(guide);
    await r.space.ensureSystemPages(guide);
    const all = await once(r.space.watchAll);
    const templates = all.find((n) => n.key === 'lowtide:templates')!;
    const inside = all.filter((n) => n.parentId === templates.id);
    expect(inside.map((n) => n.title)).toContain('Decision Record');
    expect(inside).toHaveLength(7);
    const page = all.find((n) => n.key === 'lowtide:guide')!;
    expect(page.revision).toBe(0);
    await r.space.ensureSystemPages({ ...guide, markdown: '# Guide\n\nUpdated.' });
    const after = (await r.space.getByKey('lowtide:guide'))!;
    expect(after.revision).toBe(1);
    expect(after.blocks!.map((b) => b.text)).toEqual(['Guide', 'Updated.']);
  });

  it('applies a template as a fresh page, and a database template without its rows', async () => {
    const { r } = setup();
    await r.space.ensureSystemPages(guide);
    const all = await once(r.space.watchAll);
    const research = all.find((n) => n.title === 'Research Note')!;
    const [, , , ideas] = await r.space.ensureRoots();
    const page = await r.space.applyTemplate(research.id, ideas!.id, 'Compression libraries');
    expect(page).toMatchObject({ title: 'Compression libraries', revision: 0, kind: 'page' });
    expect(page.blocks!.map((b) => b.text)).toEqual(research.blocks!.map((b) => b.text));
    expect(page.blocks![0]!.id).not.toBe(research.blocks![0]!.id);
    const db = await r.space.create({
      parentId: ideas!.id,
      title: 'Bug tracker',
      table: {
        columns: [{ id: 'n', name: 'Name', type: 'text' }],
        rows: [{ id: 'x', cells: { n: 'A bug' } }],
        views: [{ id: 'v', name: 'All', type: 'table' }],
      },
    });
    const fresh = await r.space.applyTemplate(db.id, ideas!.id);
    expect(fresh.table).toMatchObject({ rows: [], views: [{ name: 'All' }] });
  });
});
