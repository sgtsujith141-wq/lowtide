// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import type { AuditEntry } from '../../src/db/companion/wire';
import { createRepositories } from '../../src/db/repositories';
import { mcpClient, startTestCompanion, type TestCompanion } from './test-fixtures';

const running: TestCompanion[] = [];
afterEach(async () => {
  for (const t of running.splice(0)) await t.close();
});

async function start() {
  const t = await startTestCompanion();
  running.push(t);
  return t;
}

const repos = (t: TestCompanion) =>
  createRepositories(t.companion.store, { watch: t.companion.store.watch });

async function audit(t: TestCompanion): Promise<AuditEntry[]> {
  return (await (await t.owner('/api/ai/audit?limit=500')).json()) as AuditEntry[];
}

describe('SPACE over MCP (v2 PHASE 014)', () => {
  it('saves a note at a path, making the project folder and its slot, attributed and audited', async () => {
    const t = await start();
    const ai = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'project', access: 'write', label: 'Claude' }),
    );

    const eventsBefore = (await repos(t).backup.exportBackup()).data.events.length;
    const empty = await ai.call('get_space_tree');
    expect(empty.json).toMatchObject({
      tree: [],
      note: expect.stringMatching(/no SPACE pages yet/),
    });

    const made = await ai.call('create_space_page', {
      path: 'Projects / Engine / Architecture / Storage Engine',
      markdown: '# Storage\n\n- Local first\n- [ ] Pick a format',
    });
    expect(made.isError, made.text).toBe(false);
    const id = (made.json as { id: string }).id;

    const r = repos(t);
    const page = (await r.space.get(id))!;
    const slot = (await r.space.get(page.parentId!))!;
    expect(slot).toMatchObject({
      title: 'Architecture',
      key: `project:${t.projectId}:architecture`,
    });
    expect(page.blocks!.map((b) => [b.type, b.text])).toEqual([
      ['heading1', 'Storage'],
      ['bullet', 'Local first'],
      ['check', 'Pick a format'],
    ]);
    expect(page.blocks!.every((b) => b.by?.client === 'Claude')).toBe(true);
    expect(page.edits?.at(-1)).toMatchObject({
      kind: 'created',
      by: 'ai-client',
      client: 'Claude',
    });

    // The same path again adds to the page instead of making a second one.
    const again = await ai.call('create_space_page', {
      path: 'Architecture / Storage Engine',
      markdown: 'More detail.',
    });
    expect(again.json).toMatchObject({ id, appended: true });
    expect((await r.space.get(id))!.blocks!.at(-1)!.text).toBe('More detail.');

    const read = await ai.call('get_space_page', { page: 'Architecture / Storage Engine' });
    expect(read.json).toMatchObject({
      id,
      title: 'Storage Engine',
      path: 'Projects / Engine / Architecture / Storage Engine',
      lastEditedBy: 'Claude',
      markdown: expect.stringContaining('- [ ] Pick a format'),
    });

    const block = (read.json as { blocks: { id: string; type: string }[] }).blocks.find(
      (b) => b.type === 'check',
    )!;
    expect(
      (await ai.call('update_space_block', { page: id, block: block.id, checked: true })).isError,
    ).toBe(false);
    expect((await r.space.get(id))!.blocks!.find((b) => b.id === block.id)!.checked).toBe(true);

    expect((await ai.call('search_space', { query: 'local first' })).json).toEqual([
      expect.objectContaining({ id, location: 'Projects / Engine / Architecture' }),
    ]);

    const log = await audit(t);
    expect(
      log.some(
        (e) =>
          e.operation === 'create_space_page' && e.entityType === 'spaceNode' && e.result === 'ok',
      ),
    ).toBe(true);
    expect(log.some((e) => e.operation === 'update_space_block' && e.client === 'Claude')).toBe(
      true,
    );
    // Knowledge, not activity: no ledger event.
    expect((await r.backup.exportBackup()).data.events.length).toBe(eventsBefore);
  });

  it('links, adds table rows, makes subpages and archives, but never a maintained section', async () => {
    const t = await start();
    const ai = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'project', access: 'write' }),
    );
    const r = repos(t);
    const folder = await r.space.ensureProjectSpace(t.projectId, 'tables');
    const table = await r.space.create({
      parentId: folder.id,
      title: 'Leads',
      table: {
        columns: [
          { id: 'c1', name: 'Name', type: 'text' },
          { id: 'c2', name: 'Size', type: 'number' },
          { id: 'c3', name: 'Warm', type: 'boolean' },
        ],
        rows: [],
      },
    });
    const row = await ai.call('add_space_table_row', {
      table: table.id,
      cells: { Name: 'Acme', Size: '12', Warm: true },
    });
    expect(row.isError, row.text).toBe(false);
    expect((await r.space.get(table.id))!.table!.rows[0]!.cells).toEqual({
      c1: 'Acme',
      c2: 12,
      c3: true,
    });
    expect(
      (await ai.call('add_space_table_row', { table: table.id, cells: { Size: 'big' } })).text,
    ).toMatch(/takes a number/);

    const sub = await ai.call('create_space_subpage', {
      parent: folder.id,
      title: 'Notes on leads',
      markdown: 'x',
    });
    const subId = (sub.json as { id: string }).id;
    expect(
      (await ai.call('link_space_entity', { page: subId, type: 'project', id: 'engine' })).isError,
    ).toBe(false);
    expect((await r.space.get(subId))!.links).toEqual([
      { type: 'project', id: t.projectId, label: 'Engine' },
    ]);

    // "Put this idea in … Ideas and park it": a real home in SPACE and a parked idea, linked.
    const idea = await ai.call('create_space_page', {
      path: 'Ideas / Referral loop',
      markdown: 'Reward both sides.',
    });
    const parked = await ai.call('park_item', { title: 'Referral loop' });
    expect(parked.json).toMatchObject({ title: 'Referral loop', lane: 'parked' });
    const ideaId = (idea.json as { id: string }).id;
    const itemId = (parked.json as { id: string }).id;
    expect(
      (await ai.call('link_space_entity', { page: ideaId, type: 'projectItem', id: itemId }))
        .isError,
    ).toBe(false);
    expect((await r.space.get(ideaId))!.links).toEqual([
      { type: 'projectItem', id: itemId, label: 'Referral loop' },
    ]);
    expect((await r.space.get((await r.space.get(ideaId))!.parentId!))!.title).toBe('Ideas');

    expect((await ai.call('archive_space_page', { page: folder.id })).text).toMatch(/maintains/);
    expect((await ai.call('archive_space_page', { page: subId })).isError).toBe(false);
    expect((await r.space.get(subId))!.archived).toBe(true);
  });

  it('keeps each connection to its part of SPACE: its project, the workspace, Personal only when allowed', async () => {
    const t = await start();
    const r = repos(t);
    const side = await r.projects.create({ name: 'Side quest' });
    const sideSlot = await r.space.ensureProjectSpace(side.id, 'planning');
    const sidePage = await r.space.create({
      parentId: sideSlot.id,
      title: 'Secret plan',
      blocks: [{ type: 'paragraph', text: 'hidden words' }],
    });
    const roots = await r.space.ensureRoots();
    const personal = roots.find((n) => n.key === 'personal')!;
    const diary = await r.space.create({
      parentId: personal.id,
      title: 'Diary',
      blocks: [{ type: 'paragraph', text: 'private words' }],
    });

    const project = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'project', access: 'write' }),
    );
    expect((await project.call('get_space_page', { page: sidePage.id })).isError).toBe(true);
    expect((await project.call('search_space', { query: 'hidden words' })).json).toEqual([]);
    expect(
      (await project.call('append_space_blocks', { page: sidePage.id, markdown: 'x' })).isError,
    ).toBe(true);
    expect(
      (await project.call('link_space_entity', { page: 'x', type: 'project', id: 'side-quest' }))
        .isError,
    ).toBe(true);

    const workspace = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'workspace', access: 'write' }),
    );
    expect((await workspace.call('get_space_page', { page: sidePage.id })).isError).toBe(false);
    expect((await workspace.call('get_space_page', { page: diary.id })).isError).toBe(true);
    expect((await workspace.call('search_space', { query: 'private words' })).json).toEqual([]);
    expect(
      (await workspace.call('create_space_page', { path: 'Personal / Sneaky', markdown: 'x' }))
        .isError,
    ).toBe(true);

    const global = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'global', access: 'read' }),
    );
    expect((await global.call('get_space_page', { page: diary.id })).isError).toBe(true);
    const trusted = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'global', access: 'read', sensitive: ['personalSpace'] }),
    );
    expect((await trusted.call('get_space_page', { page: diary.id })).json).toMatchObject({
      title: 'Diary',
    });

    const reader = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'project', access: 'read' }),
    );
    const listed = ((await reader.request('tools/list')).result!.tools as { name: string }[]).map(
      (x) => x.name,
    );
    expect(listed).toContain('get_space_page');
    expect(listed).not.toContain('create_space_page');
    expect((await audit(t)).filter((e) => e.result === 'refused').length).toBeGreaterThanOrEqual(5);
  });
});
