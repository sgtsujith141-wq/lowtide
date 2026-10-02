import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import type { SpaceNode } from '../types/domain';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

interface Seeded {
  r: Repositories;
  engine: SpaceNode;
  plan: SpaceNode;
  notes: SpaceNode;
  table: SpaceNode;
  projectId: string;
}

async function seed(): Promise<Seeded> {
  const db = newDb();
  await db.open();
  const r = createDexieRepositories(db);
  const project = await r.projects.create({ name: 'Engine', state: 'active' });
  const planning = await r.space.ensureProjectSpace(project.id, 'planning');
  const engine = (await r.space.getByKey(`project:${project.id}`))!;
  const plan = await r.space.create({
    parentId: planning.id,
    title: 'Master plan',
    body: '<callout icon="💡">\n\tRead first.\n</callout>\n# Goals\n- Ship v1\n<table>\n<tr><td>Phase</td><td>Done</td></tr>\n<tr><td>Zero</td><td>Yes</td></tr>\n</table>\n<synced_block>\n\tKept as is\n</synced_block>',
    bodyFormat: 'notion',
  });
  // As the Notion importer leaves a page: its provenance on the node.
  await db.spaceNodes.update(plan.id, {
    source: {
      system: 'notion',
      sourceId: 'a0000000000000000000000000000002',
      originalTitle: 'Master plan',
      path: ['HQ'],
      importedAt: '2026-01-01T00:00:00.000Z',
    },
  });
  const notes = await r.space.create({
    parentId: engine.id,
    title: 'Scratch notes',
    blocks: [{ type: 'paragraph', text: 'Start here' }],
  });
  const table = await r.space.create({
    parentId: planning.id,
    title: 'Leads',
    table: {
      columns: [
        { id: 'name', name: 'Name', type: 'text' },
        { id: 'size', name: 'Size', type: 'number' },
        {
          id: 'stage',
          name: 'Stage',
          type: 'select',
          options: [{ name: 'Cold' }, { name: 'Warm' }],
        },
      ],
      rows: [
        { id: 'r1', cells: { name: 'Beta', size: 5, stage: 'Cold' } },
        { id: 'r2', cells: { name: 'Alpha', size: 20, stage: 'Warm' } },
      ],
    },
  });
  return { r, engine, plan, notes, table, projectId: project.id };
}

async function open(s: Seeded, path: string) {
  const rendered = await renderApp(path, s.r);
  // At this width the tree is a sheet; the Pages button means SPACE is ready.
  await screen.findByRole('button', { name: 'Pages' }, { timeout: 10_000 });
  return rendered;
}

const latest = async (r: Repositories, id: string) => (await r.space.get(id))!;

describe('SPACE (v2 PHASE 014)', () => {
  it('shows the real hierarchy as a keyboard tree on a phone-width screen, in a drawer', async () => {
    const s = await seed();
    const { user } = await renderApp(`/space/${s.plan.id}`, s.r);
    // No three panes at this width: the tree opens as a sheet.
    await user.click(await screen.findByRole('button', { name: 'Pages' }, { timeout: 10_000 }));
    const sheet = await screen.findByRole('dialog', { name: 'Pages' });
    const tree = within(sheet).getByRole('tree', { name: 'SPACE' });
    const active = within(tree).getByRole('treeitem', { selected: true });
    expect(active).toHaveAccessibleName('Master plan');
    expect(active).toHaveAttribute('aria-level', '4');
    // Its ancestors are open: Projects / Engine / Planning.
    for (const name of ['Projects', 'Engine', 'Planning']) {
      expect(within(tree).getByRole('treeitem', { name })).toHaveAttribute('aria-expanded', 'true');
    }
    // Arrow keys move and fold.
    const planning = within(tree).getByRole('treeitem', { name: 'Planning' });
    planning.focus();
    await user.keyboard('{ArrowLeft}');
    expect(planning).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{ArrowRight}');
    expect(planning).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(within(tree).getByRole('treeitem', { name: 'Master plan' })).toHaveFocus(),
    );
    // Filtering keeps the path to what matches.
    await user.type(within(sheet).getByRole('searchbox', { name: 'Filter pages' }), 'scratch');
    expect(
      within(tree)
        .getAllByRole('treeitem')
        .map((t) => t.getAttribute('aria-label')),
    ).toEqual(['Projects', 'Engine', 'Scratch notes']);
  });

  it('renders imported Notion content cleanly, keeping what it can’t edit, with its provenance', async () => {
    const s = await seed();
    await open(s, `/space/${s.plan.id}`);
    const page = await screen.findByRole('article', { name: 'Master plan' }, { timeout: 10_000 });
    expect(within(page).getByRole('textbox', { name: 'Callout' })).toHaveTextContent('Read first.');
    expect(within(page).getByRole('textbox', { name: 'Heading 1' })).toHaveTextContent('Goals');
    expect(within(page).getByRole('textbox', { name: 'Bullet list' })).toHaveTextContent('Ship v1');
    // An imported table becomes a simple table you can edit; its cells are kept.
    const grid = within(page).getByRole('group', { name: 'Simple table' });
    expect(
      within(grid)
        .getAllByRole('textbox')
        .map((c) => (c as HTMLInputElement).value),
    ).toEqual(['Phase', 'Done', 'Zero', 'Yes']);
    expect(
      within(page).getByRole('group', { name: 'Imported content kept as it was' }),
    ).toHaveTextContent('Kept as is');
    expect(screen.getByRole('navigation', { name: 'Breadcrumbs' })).toHaveTextContent(
      'SPACE/Projects/Engine/Planning/Master plan',
    );
    expect(within(page).getByText('Imported from Notion')).toBeInTheDocument();
    // Opening it changes nothing: the original body stays, no blocks are written.
    const stored = await latest(s.r, s.plan.id);
    expect(stored.blocks).toBeUndefined();
    expect(stored.revision).toBe(0);
  });

  it('edits like a document: Enter splits, Markdown shortcuts turn blocks, and it autosaves', async () => {
    const s = await seed();
    const { user } = await open(s, `/space/${s.notes.id}`);
    const first = await screen.findByRole('textbox', { name: 'Text' }, { timeout: 10_000 });
    await user.click(first);
    await user.keyboard('{End} and more{Enter}# Big idea');
    await waitFor(
      async () => {
        const stored = await latest(s.r, s.notes.id);
        expect(stored.blocks?.map((b) => [b.type, b.text])).toEqual([
          ['paragraph', 'Start here and more'],
          ['heading1', 'Big idea'],
        ]);
      },
      { timeout: 5000 },
    );
    expect((await latest(s.r, s.notes.id)).edits?.at(-1)).toMatchObject({
      kind: 'edited',
      by: 'app',
    });
  });

  it('offers a short slash menu and inserts what is chosen', async () => {
    const s = await seed();
    const { user } = await open(s, `/space/${s.notes.id}`);
    const first = await screen.findByRole('textbox', { name: 'Text' }, { timeout: 10_000 });
    await user.click(first);
    await user.keyboard('{End}{Enter}/check');
    const menu = await screen.findByRole('listbox', { name: 'Insert a block' });
    expect(
      within(menu)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Checklist[] ']);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('textbox', { name: 'Checklist' })).toBeInTheDocument();
    await user.keyboard('Do it{Enter}{Enter}/link proj');
    await user.keyboard('{Enter}');
    const picker = await screen.findByRole('dialog', { name: 'Link project' });
    await user.keyboard('Eng{Enter}');
    expect(picker).not.toBeInTheDocument();
    await waitFor(
      async () => {
        const stored = await latest(s.r, s.notes.id);
        expect(stored.blocks?.some((b) => b.type === 'link' && b.link?.id === s.projectId)).toBe(
          true,
        );
      },
      { timeout: 5000 },
    );
  });

  it('shows an AI client’s write live, and never overwrites unsaved local text with it', async () => {
    const s = await seed();
    const { user } = await open(s, `/space/${s.notes.id}`);
    await screen.findByRole('textbox', { name: 'Text' }, { timeout: 10_000 });
    // Live, with nothing unsaved here: the page simply updates, attributed.
    await s.r.space.appendBlocks(s.notes.id, [{ type: 'paragraph', text: 'From elsewhere' }]);
    expect(await screen.findByText('From elsewhere')).toBeInTheDocument();
    // Unsaved local text, then a write from elsewhere: a calm choice, nothing lost.
    await user.click(screen.getAllByRole('textbox', { name: 'Text' })[0]!);
    await user.keyboard('{End} mine');
    await s.r.space.appendBlocks(s.notes.id, [{ type: 'paragraph', text: 'Theirs' }]);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/changed elsewhere|changed this page/);
    expect(alert).toHaveTextContent('Nothing has been overwritten');
    await user.click(within(alert).getByRole('button', { name: 'Save mine as a copy' }));
    await waitFor(async () => {
      const all = await new Promise<SpaceNode[]>((resolve) => {
        const stop = s.r.space.watchAll((n) => {
          stop();
          resolve(n);
        });
      });
      const copy = all.find((n) => n.title === 'Scratch notes (your version)');
      expect(copy?.blocks?.[0]?.text).toBe('Start here mine');
    });
    expect((await latest(s.r, s.notes.id)).blocks?.at(-1)?.text).toBe('Theirs');
  });

  it('sorts, filters and edits a table in place, and adds rows', async () => {
    const s = await seed();
    const { user } = await open(s, `/space/${s.table.id}`);
    const grid = await screen.findByRole('table', { name: 'Leads' }, { timeout: 10_000 });
    const names = () =>
      within(grid)
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[0]!.textContent);
    expect(names()).toEqual(['Beta', 'Alpha']);
    await user.click(within(grid).getByRole('button', { name: 'Name' }));
    expect(names()).toEqual(['Alpha', 'Beta']);
    await user.click(within(grid).getByRole('button', { name: 'Size' }));
    await user.click(within(grid).getByRole('button', { name: 'Size' }));
    expect(names()).toEqual(['Alpha', 'Beta']);
    await user.type(screen.getByRole('searchbox', { name: 'Filter rows' }), 'bet');
    expect(names()).toEqual(['Beta']);
    expect(screen.getByText('1 of 2 rows')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Filter rows' }));
    const beta = within(grid)
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('Beta'))!;
    await user.selectOptions(within(beta).getByRole('combobox', { name: /Stage/ }), 'Warm');
    await waitFor(async () =>
      expect(
        (await latest(s.r, s.table.id)).table!.rows.find((r) => r.id === 'r1')!.cells.stage,
      ).toBe('Warm'),
    );
    await user.click(within(grid).getByRole('button', { name: /Edit Size, row Beta/ }));
    await user.keyboard('{Control>}a{/Control}7{Enter}');
    await waitFor(async () =>
      expect(
        (await latest(s.r, s.table.id)).table!.rows.find((r) => r.id === 'r1')!.cells.size,
      ).toBe(7),
    );
    await user.click(screen.getByRole('button', { name: 'Add row' }));
    await waitFor(async () => expect((await latest(s.r, s.table.id)).table!.rows).toHaveLength(3));
  });

  it('shows links and backlinks in the inspector, without copying anything into text', async () => {
    const s = await seed();
    await s.r.space.appendBlocks(s.notes.id, [
      { type: 'paragraph', text: 'See [the plan](space:' + s.plan.id + ')' },
    ]);
    const { user } = await open(s, `/space/${s.plan.id}`);
    await user.click(await screen.findByRole('button', { name: 'Details' }, { timeout: 10_000 }));
    const sheet = await screen.findByRole('dialog', { name: 'Details' });
    const refs = within(sheet).getByRole('region', { name: 'Referenced by' });
    expect(refs).toHaveTextContent('1 page');
    expect(within(refs).getByRole('link', { name: 'Scratch notes' })).toHaveAttribute(
      'href',
      `/space/${s.notes.id}`,
    );
    expect(within(sheet).getByRole('region', { name: 'Project' })).toHaveTextContent('Engine');
    expect(within(sheet).getByRole('link', { name: /Open Command Room/ })).toHaveAttribute(
      'href',
      '/projects/engine',
    );
    expect(within(sheet).getByRole('button', { name: /Start work/ })).toBeInTheDocument();
    // While work on the project runs, the inspector says so instead.
    await s.r.work.start({ kind: 'project', projectId: s.projectId });
    expect(await within(sheet).findByRole('button', { name: /Working now/ })).toBeInTheDocument();
  });

  it('finds pages by their content with ⌘P, and SPACE pages from the global ⌘K', async () => {
    const s = await seed();
    const { user } = await open(s, '/space');
    await user.keyboard('{Control>}p{/Control}');
    const find = await screen.findByRole('dialog', { name: 'Find in SPACE' });
    await user.keyboard('ship v1');
    const results = within(find).getByRole('listbox', { name: 'Results' });
    expect(within(results).getByRole('option')).toHaveTextContent(
      /Master plan.*Projects \/ Engine \/ Planning/,
    );
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('article', { name: 'Master plan' })).toBeInTheDocument();

    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('search');
    await user.type(within(palette).getByRole('textbox', { name: 'Search LOWTIDE' }), 'leads');
    expect(
      await within(palette).findByRole('link', { name: /SPACE database.*Leads/ }),
    ).toHaveAttribute('href', `/space/${s.table.id}`);
  });

  it('creates, renames, archives and restores pages from the tree, with history', async () => {
    const s = await seed();
    const { user } = await open(s, `/space/${s.notes.id}`);
    await user.click(await screen.findByRole('button', { name: 'Pages' }, { timeout: 10_000 }));
    const sheet = await screen.findByRole('dialog', { name: 'Pages' });
    // The + beside a folder offers a page, a folder or a database.
    await user.click(within(sheet).getByRole('button', { name: 'Add inside Engine' }));
    await user.click(within(sheet).getByRole('menuitem', { name: 'Page' }));
    const form = await screen.findByRole('form', { name: 'New page' });
    expect(within(form).getByLabelText('In')).toHaveValue(s.engine.id);
    await user.click(within(form).getByRole('button', { name: 'Create page' }));
    expect(
      await screen.findByRole('article', { name: 'Untitled' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Pages' }));
    const tree = within(await screen.findByRole('dialog', { name: 'Pages' })).getByRole('tree');
    const item = within(tree).getByRole('treeitem', { name: 'Untitled' });
    item.focus();
    await user.keyboard('{F2}');
    const input = within(tree).getByRole('textbox', { name: 'New name' });
    await user.clear(input);
    await user.type(input, 'Ideas list{Enter}');
    expect(await within(tree).findByRole('treeitem', { name: 'Ideas list' })).toBeInTheDocument();
    await user.click(within(tree).getByRole('button', { name: 'Options for Ideas list' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await waitFor(() =>
      expect(within(tree).queryByRole('treeitem', { name: 'Ideas list' })).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('checkbox', { name: 'Show archived' }));
    expect(
      within(tree).getByRole('treeitem', { name: 'Ideas list (archived)' }),
    ).toBeInTheDocument();
    await user.click(within(tree).getByRole('button', { name: 'Options for Ideas list' }));
    await user.click(screen.getByRole('menuitem', { name: 'Restore' }));
    const all = await new Promise<SpaceNode[]>((resolve) => {
      const stop = s.r.space.watchAll((n) => {
        stop();
        resolve(n);
      });
    });
    await waitFor(async () => {
      const page = (await s.r.space.get(all.find((n) => n.title === 'Ideas list')!.id))!;
      expect(page.edits?.map((e) => e.kind)).toEqual([
        'created',
        'renamed',
        'archived',
        'restored',
      ]);
    });
  });

  it('keeps long table text readable: wide columns, a fixed first column, full text on request', async () => {
    const s = await seed();
    const long = 'A long description that keeps going. '.repeat(6).trim();
    await s.r.space.setCell(s.table.id, 'r1', 'name', long);
    const { user } = await open(s, `/space/${s.table.id}`);
    const grid = await screen.findByRole('table', { name: 'Leads' }, { timeout: 10_000 });
    const [first, second] = within(grid).getAllByRole('columnheader');
    expect(first!.style.minWidth).toBe('22rem');
    expect(second!.style.minWidth).toBe('6rem');
    expect(first!.className).toMatch(/sticky/);
    const cell = within(grid).getAllByRole('cell')[0]!;
    expect(cell.className).toMatch(/line-clamp-3/);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rows' }), 'Show full text');
    expect(within(grid).getAllByRole('cell')[0]!.className).not.toMatch(/line-clamp/);
    // Nothing about the table itself changed.
    expect((await latest(s.r, s.table.id)).table!.rows[0]!.cells.name).toBe(long);
  });

  it('labels code and Mermaid blocks and copies them exactly, without redrawing them', async () => {
    const s = await seed();
    const page = await s.r.space.create({
      parentId: s.engine.id,
      title: 'Diagrams',
      blocks: [
        { type: 'code', language: 'mermaid', text: 'graph TD\n  A-->B' },
        { type: 'code', language: 'ts', text: 'const x = 1;' },
      ],
    });
    const { user } = await open(s, `/space/${page.id}`);
    // user-event installs its own clipboard; watch what reaches it.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    const article = await screen.findByRole('article', { name: 'Diagrams' }, { timeout: 10_000 });
    expect(within(article).getByText('Mermaid diagram source')).toBeInTheDocument();
    expect(within(article).getByText('ts')).toBeInTheDocument();
    await user.click(within(article).getAllByRole('button', { name: 'Copy' })[0]!);
    expect(writeText).toHaveBeenCalledWith('graph TD\n  A-->B');
    expect(await within(article).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('opens SPACE on recent, project and idea pages, all from real data', async () => {
    const s = await seed();
    const ideas = (await s.r.space.ensureRoots()).find((n) => n.key === 'ideas')!;
    await s.r.space.create({ parentId: ideas.id, title: 'Half-formed thought', blocks: [] });
    const { user } = await open(s, '/space');
    const projects = await screen.findByRole('region', { name: 'Projects' });
    expect(within(projects).getByRole('button', { name: /Engine/ })).toHaveTextContent(/pages?$/);
    expect(
      within(screen.getByRole('region', { name: 'Ideas' })).getByRole('button', {
        name: /Half-formed thought/,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Recently opened' })).not.toBeInTheDocument();
    await user.click(
      within(screen.getByRole('region', { name: 'Recently updated' })).getByRole('button', {
        name: /Scratch notes/,
      }),
    );
    await screen.findByRole('article', { name: 'Scratch notes' }, { timeout: 10_000 });
    await user.click(screen.getAllByRole('link', { name: 'SPACE' })[0]!);
    const opened = await screen.findByRole('region', { name: 'Recently opened' });
    expect(within(opened).getByRole('button', { name: 'Scratch notes' })).toBeInTheDocument();
  });

  it('keeps the tree reachable by Tab while an archived page is open', async () => {
    const s = await seed();
    await s.r.space.archive(s.notes.id);
    const { user } = await open(s, `/space/${s.notes.id}`);
    await user.click(screen.getByRole('button', { name: 'Pages' }));
    const tree = within(await screen.findByRole('dialog', { name: 'Pages' })).getByRole('tree');
    const tabbable = within(tree)
      .getAllByRole('treeitem')
      .filter((t) => t.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
  });
});
