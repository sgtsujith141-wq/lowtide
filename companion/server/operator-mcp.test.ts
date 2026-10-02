// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import type { AiChange, AuditEntry, Checkpoint } from '../../src/db/companion/wire';
import { createRepositories } from '../../src/db/repositories';
import { mcpClient, startTestCompanion, type TestCompanion } from './test-fixtures';
import { TOOLS } from './tools';
import { matrixTools } from './tools/matrix';

/*
 * v2.1 operator parity, through the real MCP protocol: the thirty things the
 * owner asks Claude to do, end to end, with live updates, audit, undo, dry
 * runs, idempotency and the permission limits that must hold.
 */

const running: TestCompanion[] = [];
afterEach(async () => {
  for (const t of running.splice(0)) await t.close();
});

async function start(file = false) {
  const t = await startTestCompanion(file ? ({ database: undefined } as never) : {});
  running.push(t);
  return t;
}

async function operator(t: TestCompanion) {
  const { PRESET } = await import('../../src/db/companion/wire');
  return mcpClient(
    t.companion.url,
    await t.grant({
      scope: 'global',
      access: 'write',
      capabilities: PRESET.full.capabilities,
      sensitive: PRESET.full.sensitive,
      preset: 'full',
      label: 'Claude',
      clientKind: 'claude',
    }),
  );
}

/** The owner's live event stream: resolves with the first change after `trigger`. */
async function nextChange(t: TestCompanion, trigger: () => Promise<unknown>): Promise<string[]> {
  const response = await t.owner('/api/events');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Wait for the hello before acting.
  while (!buffer.includes('event: hello')) buffer += decoder.decode((await reader.read()).value);
  buffer = '';
  const started = Date.now();
  await trigger();
  try {
    while (Date.now() - started < 5000) {
      buffer += decoder.decode((await reader.read()).value);
      const m = /event: change\ndata: (.*)\n/.exec(buffer);
      if (m) return (JSON.parse(m[1]!) as { stores: string[] }).stores;
    }
    throw new Error('no change event');
  } finally {
    await reader.cancel();
  }
}

const json = <T>(r: { json: unknown; isError: boolean; text: string }) => {
  if (r.isError) throw new Error(r.text);
  return r.json as T;
};

describe('v2.1: what Claude can do without the owner (MCP, real protocol)', () => {
  it('runs the thirty owner workflows end to end', async () => {
    const t = await start();
    const claude = await operator(t);
    const r = createRepositories(t.companion.store, { watch: t.companion.store.watch });

    // 1–2. Create a project with its SPACE home, from a brief.
    const brief = json<{
      project: { id: string; slug: string; state: string };
      space: { id: string };
      milestones: { id: string; title: string }[];
      pages: { id: string; title: string }[];
      tasks: { id: string }[];
      decisions: { id: string }[];
    }>(
      await claude.call('create_project_from_brief', {
        name: 'Media Engine',
        description: 'An AI media-production engine.',
        overview: '## What it is\nAn engine that turns briefs into finished media.',
        planning: '## Steps\n- [ ] Pipeline\n- [ ] Renderer',
        milestones: ['Pipeline', 'Renderer', 'Publishing', 'Launch'],
        tasks: [{ title: 'Choose a render library', milestone: 'Renderer' }],
        decisions: [{ title: 'Local first', decision: 'Everything runs on this computer.' }],
      }),
    );
    expect(brief.project.state).toBe('planning');
    expect(brief.milestones).toHaveLength(4);
    expect(brief.pages.map((p) => p.title)).toEqual(expect.arrayContaining(['Overview', 'Plan']));
    const project = brief.project.slug;
    // Idempotent: asking again returns the same project.
    const again = json<{ existing: boolean }>(
      await claude.call('create_project', { name: 'media engine' }),
    );
    expect(again.existing).toBe(true);
    expect((await r.projects.get(brief.project.id))?.description).toBe(
      'An AI media-production engine.',
    );

    // 3–6. Folders, subfolders, pages, documentation.
    json(
      await claude.call('create_space_folder', { path: 'Projects / Media Engine / Engineering' }),
    );
    const sub = json<{ id: string; created: string[] }>(
      await claude.call('create_space_folder', {
        path: 'Projects / Media Engine / Engineering / Security Research',
      }),
    );
    expect(sub.created).toHaveLength(1);
    expect((await r.space.get(sub.id))?.kind).toBe('section');
    const notes = json<{ id: string }>(
      await claude.call('create_space_page', {
        path: 'Projects / Media Engine / Engineering / Security Research / Threat notes',
        markdown: '# Threats\n- Supply chain\n- Secrets in logs',
      }),
    );
    const page = json<{ revision: number; blocks: { id: string }[] }>(
      await claude.call('get_space_page', { page: notes.id }),
    );
    json(
      await claude.call('insert_space_blocks', {
        page: notes.id,
        after: page.blocks[0]!.id,
        markdown: 'Reviewed weekly.',
        baseRevision: page.revision,
      }),
    );
    // A stale revision is refused, never overwritten.
    const stale = await claude.call('insert_space_blocks', {
      page: notes.id,
      after: 'top',
      markdown: 'Late',
      baseRevision: page.revision,
    });
    expect(stale).toMatchObject({ isError: true, text: expect.stringMatching(/changed since/) });

    // 7–9. Tasks, milestones, reordering.
    const task = json<{ id: string }>(
      await claude.call('create_task', {
        title: 'Write the threat model',
        project,
        milestone: 'Pipeline',
        due: '2026-11-01',
      }),
    );
    expect(
      json<{ existing: boolean }>(
        await claude.call('create_task', { title: 'write the threat model', project }),
      ).existing,
    ).toBe(true);
    const subtask = json<{ parent: string }>(
      await claude.call('create_task', { title: 'List assets', parent: task.id }),
    );
    expect(subtask.parent).toBe(task.id);
    json(await claude.call('create_milestone', { project, title: 'Beta', position: 4 }));
    const ordered = json<{ title: string }[]>(
      await claude.call('reorder_milestones', {
        project,
        order: ['Renderer', 'Pipeline', 'Publishing', 'Beta', 'Launch'],
      }),
    );
    expect(ordered.map((m) => m.title)).toEqual([
      'Renderer',
      'Pipeline',
      'Publishing',
      'Beta',
      'Launch',
    ]);

    // 10. Decisions (and superseding).
    const sup = json<{ supersedes: string }>(
      await claude.call('supersede_decision', {
        decision: 'Local first',
        newDecision: 'Local first, with an optional render farm.',
      }),
    );
    expect(sup.supersedes).toBe(brief.decisions[0]!.id);

    // 11–14. Blockers, approvals.
    const blocker = json<{ id: string }>(
      await claude.call('create_blocker', { project, title: 'GPU access' }),
    );
    json(await claude.call('resolve_blocker', { item: blocker.id }));
    const approval = json<{ id: string }>(
      await claude.call('request_approval', { project, title: 'Spend on GPUs?' }),
    );
    json(await claude.call('resolve_approval', { item: approval.id }));

    // 15–16. Park and resume an idea.
    const idea = json<{ id: string; lane: string }>(
      await claude.call('park_item', { project, title: 'Voice cloning' }),
    );
    expect(idea.lane).toBe('parked');
    expect(json<{ lane: string }>(await claude.call('resume_item', { item: idea.id })).lane).toBe(
      'next',
    );

    // 17–18. Hackathons and their stages.
    const hack = json<{ id: string; start: string; nextAction: string }>(
      await claude.call('create_hackathon', {
        name: 'Build Night',
        start: '2026-11-04',
        nextAction: 'Research the problem statement',
      }),
    );
    expect(hack).toMatchObject({
      start: '2026-11-04',
      nextAction: 'Research the problem statement',
    });
    expect(
      json<{ research: string }>(
        await claude.call('update_hackathon_stage', {
          hackathon: 'Build Night',
          stage: 'research',
          state: 'active',
        }),
      ).research,
    ).toBe('in_progress');

    // 19–22. A database: properties, rows, a relation and rollup, views and queries.
    const db = json<{ id: string }>(
      await claude.call('create_space_table', {
        parent: 'Projects / Media Engine / Engineering',
        title: 'Render jobs',
        properties: [
          { name: 'Job', type: 'text' },
          { name: 'Status', type: 'status', options: ['Queued', 'Done'] },
          { name: 'Minutes', type: 'number' },
        ],
      }),
    );
    json(
      await claude.call('add_space_table_column', {
        table: db.id,
        property: { name: 'Tasks', type: 'link', targets: ['task'] },
      }),
    );
    json(
      await claude.call('add_space_table_column', {
        table: db.id,
        property: {
          name: 'Tasks done',
          type: 'rollup',
          rollup: { relation: 'Tasks', fn: 'countDone' },
        },
      }),
    );
    json(
      await claude.call('add_space_table_column', {
        table: db.id,
        property: {
          name: 'Long',
          type: 'formula',
          formula: 'if(prop("Minutes") > 30, "long", "short")',
        },
      }),
    );
    json(
      await claude.call('add_space_table_rows', {
        table: db.id,
        rows: [
          { Job: 'Trailer', Status: 'Queued', Minutes: 45, Tasks: [`task:${task.id}`] },
          { Job: 'Teaser', Status: 'Rendering', Minutes: 12 },
        ],
      }),
    );
    json(
      await claude.call('save_space_view', {
        table: db.id,
        name: 'Board',
        type: 'board',
        groupBy: 'Status',
      }),
    );
    const queried = json<{
      total: number;
      rows: Record<string, unknown>[];
      groups: { group: string }[];
    }>(
      await claude.call('query_space_table', {
        table: db.id,
        view: 'Board',
        sorts: [{ property: 'Minutes', dir: 'desc' }],
      }),
    );
    expect(queried.rows.map((x) => x.Job)).toEqual(['Trailer', 'Teaser']);
    expect(queried.rows[0]).toMatchObject({ Long: 'long', 'Tasks done': 0 });
    // A new select value became an option, so the board has its column.
    expect(queried.groups.map((g) => g.group)).toEqual(['Queued', 'Done', 'Rendering']);
    json(await claude.call('complete_task', { task: task.id }));
    const after = json<{ rows: Record<string, unknown>[] }>(
      await claude.call('query_space_table', {
        table: db.id,
        filters: [{ property: 'Job', op: 'is', value: 'Trailer' }],
      }),
    );
    expect(after.rows[0]).toMatchObject({ 'Tasks done': 1 });

    // 23. Link entities.
    json(await claude.call('link_space_entity', { page: notes.id, type: 'task', id: task.id }));
    expect(
      json<{ id: string }[]>(await claude.call('get_backlinks', { type: 'task', id: task.id })).map(
        (x) => x.id,
      ),
    ).toContain(notes.id);

    // 24–25. Move pages; archive and restore.
    json(
      await claude.call('move_space_item', {
        page: notes.id,
        to: 'Projects / Media Engine / Engineering',
      }),
    );
    expect((await r.space.get(notes.id))?.parentId).not.toBe(sub.id);
    json(await claude.call('archive_space_item', { page: notes.id }));
    expect((await r.space.get(notes.id))?.archived).toBe(true);
    json(await claude.call('restore_space_item', { page: notes.id }));

    // 26. Archive and restore the project.
    json(await claude.call('archive_project', { project }));
    expect((await r.projects.get(brief.project.id))?.state).toBe('archived');
    json(await claude.call('restore_project', { project }));
    json(
      await claude.call('update_project', {
        project,
        state: 'active',
        nextAction: 'Render the trailer',
      }),
    );

    // 27. A session handoff, written into SPACE.
    const doc = json<{ page: { id: string } }>(
      await claude.call('document_project_session', {
        project,
        summary: 'Set up the engine’s workspace.',
        changes: ['Created the project', 'Added the render jobs database'],
        commits: ['abc1234'],
        tests: 'MCP workflow test passing',
        nextAction: 'Render the trailer',
      }),
    );
    expect((await r.space.get(doc.page.id))?.title).toMatch(/Set up the engine/);

    // 28. Read the resulting context.
    const context = await claude.call('get_context', { project });
    expect(context.text).toMatch(/Render the trailer/);
    const found = json<{ type: string }[]>(
      await claude.call('search_lowtide', { query: 'threat' }),
    );
    expect(found.map((x) => x.type)).toEqual(expect.arrayContaining(['task', 'page']));

    // 29. Everything is audited and reviewable.
    const audit = (await (await t.owner('/api/ai/audit?limit=500')).json()) as AuditEntry[];
    expect(audit.filter((e) => e.result === 'ok').length).toBeGreaterThan(40);
    const changes = (await (await t.owner('/api/ai/changes?limit=500')).json()) as AiChange[];
    expect(changes.map((c) => c.summary)).toEqual(
      expect.arrayContaining([
        'Created project Media Engine with its SPACE folder and 4 milestones',
        'Created folder Projects / Media Engine / Engineering / Security Research',
      ]),
    );
    expect(changes.every((c) => c.client === 'Claude')).toBe(true);

    // 30. Live updates reach the app.
    const stores = await nextChange(t, () =>
      claude.call('create_task', { title: 'Storyboard', project }),
    );
    expect(stores).toContain('tasks');
  });

  it('lets the owner undo AI changes, but never over a later edit', async () => {
    const t = await start();
    const claude = await operator(t);
    const r = createRepositories(t.companion.store, { watch: t.companion.store.watch });
    const roots = await r.space.ensureRoots();
    const ideas = roots.find((n) => n.key === 'ideas')!;
    const a = await r.space.create({ parentId: ideas.id, title: 'Draft', blocks: [] });
    const folder = await r.space.create({ parentId: ideas.id, kind: 'section', title: 'Later' });
    json(await claude.call('move_space_item', { page: a.id, to: folder.id }));
    json(await claude.call('rename_space_item', { page: a.id, title: 'Draft v2' }));
    const list = (await (await t.owner('/api/ai/changes')).json()) as AiChange[];
    const rename = list.find((c) => c.summary.startsWith('Renamed'))!;
    const move = list.find((c) => c.summary.startsWith('Moved'))!;
    expect(rename.revertible && move.revertible).toBe(true);
    // The owner edits the page after Claude renamed it: the rename can't be undone blindly.
    await r.space.update(a.id, { title: 'Owner’s title' });
    const refused = await t.owner(`/api/ai/changes/${rename.id}/revert`, { method: 'POST' });
    expect(refused.status).toBe(409);
    // The move is still exactly as Claude left it, so it can be undone.
    expect((await t.owner(`/api/ai/changes/${move.id}/revert`, { method: 'POST' })).status).toBe(
      200,
    );
    expect((await r.space.get(a.id))?.parentId).toBe(ideas.id);
    const again = await t.owner(`/api/ai/changes/${move.id}/revert`, { method: 'POST' });
    expect(again.status).toBe(409);
  });

  it('previews structural changes without making them, and checkpoints big ones', async () => {
    const t = await start(true);
    const claude = await operator(t);
    const r = createRepositories(t.companion.store, { watch: t.companion.store.watch });
    const roots = await r.space.ensureRoots();
    const ideas = roots.find((n) => n.key === 'ideas')!;
    const pages = [];
    for (let i = 0; i < 10; i++)
      pages.push(await r.space.create({ parentId: ideas.id, title: `Old ${i}`, blocks: [] }));
    const preview = json<{ dryRun: boolean; wouldDo: string[] }>(
      await claude.call('organize_space', {
        dryRun: true,
        operations: [
          { op: 'createFolder', path: 'Ideas / Archive pile' },
          { op: 'move', page: pages[0]!.id, to: 'Ideas / Archive pile' },
          { op: 'archive', page: pages[1]!.id },
        ],
      }),
    );
    expect(preview.dryRun).toBe(true);
    expect(preview.wouldDo).toEqual([
      'Created folder Ideas / Archive pile',
      expect.stringMatching(/^Moved page “Old 0” to Ideas \/ Archive pile/),
      'Archived page “Old 1”',
    ]);
    expect((await r.space.get(pages[1]!.id))?.archived).toBe(false);
    expect(await r.space.getByKey('nothing')).toBeUndefined();
    const before = (await (await t.owner('/api/checkpoints')).json()) as Checkpoint[];
    json(await claude.call('archive_space_items', { pages: pages.map((p) => p.id) }));
    const after = (await (await t.owner('/api/checkpoints')).json()) as Checkpoint[];
    expect(after.length).toBe(before.length + 1);
    expect(after[0]!.name).toBe('Before Claude archive_space_items');
    // The owner can roll back to it.
    expect(
      (await t.owner(`/api/checkpoints/${after[0]!.id}/restore`, { method: 'POST' })).status,
    ).toBe(200);
    expect((await r.space.get(pages[0]!.id))?.archived).toBe(false);
  });

  it('keeps permissions real: refusals say what, why and the permission needed', async () => {
    const t = await start();
    const reader = await mcpClient(
      t.companion.url,
      await t.grant({
        scope: 'workspace',
        access: 'read',
        preset: 'read',
        capabilities: undefined,
      } as never),
    );
    const refused = await reader.call('create_project', { name: 'Guardian' });
    expect(refused).toMatchObject({
      isError: true,
      text: 'Cannot create Project. Grant lacks projects.create.',
    });
    const projectOp = await mcpClient(
      t.companion.url,
      await t.grant({
        scope: 'project',
        access: 'write',
        preset: 'project',
        capabilities: (await import('../../src/db/companion/wire')).PRESET.project.capabilities,
      }),
    );
    expect((await projectOp.call('create_project', { name: 'Other' })).text).toBe(
      'Cannot create Project. Grant lacks projects.create.',
    );
    expect((await projectOp.call('create_task', { title: 'In scope' })).isError).toBe(false);
    expect((await projectOp.call('get_routines')).text).toMatch(
      /Only a global connection can reach private life data/,
    );
    const operatorNoLife = await mcpClient(
      t.companion.url,
      await t.grant({
        scope: 'workspace',
        access: 'write',
        preset: 'workspace',
        capabilities: (await import('../../src/db/companion/wire')).PRESET.workspace.capabilities,
      }),
    );
    expect((await operatorNoLife.call('capture_inbox', { content: 'x' })).isError).toBe(true);
    expect((await operatorNoLife.call('get_space_tree', { under: 'Personal' })).isError).toBe(true);
  });

  it('never reaches Protected Time, even as a full operator', async () => {
    const t = await start();
    const r = createRepositories(t.companion.store, { watch: t.companion.store.watch });
    await r.protectedTime.create({
      title: 'Dinner with family zq9',
      date: '2026-10-03',
      kind: 'family',
    });
    const claude = await operator(t);
    const names = TOOLS.map((x) => x.name);
    expect(names.some((n) => /protect/i.test(n))).toBe(false);
    for (const [tool, args] of [
      ['search_lowtide', { query: 'zq9' }],
      ['get_context', {}],
      ['get_recent_activity', {}],
      ['search_space', { query: 'zq9' }],
    ] as const) {
      const out = await claude.call(tool, args);
      expect(out.text, tool).not.toMatch(/zq9/);
    }
  });

  it('resolves names, refuses ambiguity with candidates, and describes itself', async () => {
    const t = await start();
    const claude = await operator(t);
    json(await claude.call('create_project', { name: 'Atlas' }));
    json(await claude.call('create_project', { name: 'Atlas Mobile' }));
    const ambiguous = await claude.call('create_task', { title: 'x', project: 'atl' });
    expect(ambiguous).toMatchObject({
      isError: true,
      text: expect.stringMatching(/matches 2 projects; name one by id/),
    });
    expect((await claude.call('create_task', { title: 'Exact', project: 'Atlas' })).isError).toBe(
      false,
    );
    const caps = json<{
      connection: { preset: string };
      entities: { entity: string }[];
      rules: string[];
    }>(await claude.call('get_lowtide_capabilities'));
    expect(caps.connection.preset).toBe('full');
    expect(caps.entities.map((e) => e.entity)).toEqual(
      expect.arrayContaining([
        'Projects',
        'Tasks',
        'SPACE folders',
        'SPACE database rows',
        'Protected Time',
      ]),
    );
    expect(caps.rules.join(' ')).toMatch(/Protected Time is never available/);
  });

  it('gives SPACE context with a project’s, and undoes a state change the owner rejects', async () => {
    const t = await start();
    const claude = await operator(t);
    const made = json<{ project: { slug: string; id: string } }>(
      await claude.call('create_project', { name: 'Harbor', template: 'software' }),
    );
    const context = await claude.call('get_context', {
      project: made.project.slug,
      space: 'Projects / Harbor / Overview / Overview',
    });
    expect(context.text).toMatch(/## SPACE: Projects \/ Harbor \/ Overview \/ Overview/);
    expect(context.text).toMatch(/What it is/);
    json(await claude.call('update_project', { project: 'Harbor', state: 'active' }));
    const changes = (await (await t.owner('/api/ai/changes')).json()) as AiChange[];
    const change = changes.find((c) => c.summary === 'Updated Harbor: state')!;
    expect(change.revertible).toBe(true);
    expect((await t.owner(`/api/ai/changes/${change.id}/revert`, { method: 'POST' })).status).toBe(
      200,
    );
    const r = createRepositories(t.companion.store, { watch: t.companion.store.watch });
    expect((await r.projects.get(made.project.id))?.state).toBe('planning');
  });

  it('names only tools that exist in its capability matrix', () => {
    const names = new Set(TOOLS.map((x) => x.name));
    expect(matrixTools().filter((n) => !names.has(n))).toEqual([]);
  });
});
