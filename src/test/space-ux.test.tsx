import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import type { SpaceNode } from '../types/domain';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

/*
 * SPACE, made obvious (v2.1): where to create, where to type, folders that
 * look like folders, the Trash, pins, import and export.
 */

const newDb = setupTestDatabase();

async function seed() {
  const db = newDb();
  await db.open();
  const r = createDexieRepositories(db);
  const roots = await r.space.ensureRoots();
  const ideas = roots.find((n) => n.key === 'ideas')!;
  const folder = await r.space.create({ parentId: ideas.id, kind: 'section', title: 'Research' });
  const page = await r.space.create({
    parentId: folder.id,
    title: 'Notes',
    blocks: [{ type: 'paragraph', text: 'Start here' }],
  });
  return { r, ideas, folder, page };
}

async function open(r: Repositories, path: string) {
  const rendered = await renderApp(path, r);
  await screen.findByRole('button', { name: 'Pages' }, { timeout: 10_000 });
  return rendered;
}

const latest = async (r: Repositories, id: string) => (await r.space.get(id))!;
const all = (r: Repositories) =>
  new Promise<SpaceNode[]>((resolve) => {
    const stop = r.space.watchAll((v) => {
      queueMicrotask(() => stop());
      resolve(v);
    });
  });

describe('SPACE usability (v2.1)', () => {
  it('shows a folder as a folder: what is inside, grouped, and obvious ways to add', async () => {
    const { r, folder } = await seed();
    const { user } = await open(r, `/space/${folder.id}`);
    expect(await screen.findByRole('textbox', { name: 'Folder name' })).toHaveValue('Research');
    expect(screen.getByRole('region', { name: 'Pages' })).toHaveTextContent('Notes');
    for (const name of ['Page', 'Folder', 'Database', 'Import', 'Export'])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Folder' }));
    const form = await screen.findByRole('form', { name: 'New folder' });
    expect(within(form).getByLabelText('In')).toHaveValue(folder.id);
    await user.type(within(form).getByLabelText('Folder name'), 'Sources');
    await user.click(within(form).getByRole('button', { name: 'Create folder' }));
    await waitFor(async () =>
      expect((await all(r)).find((n) => n.title === 'Sources')).toMatchObject({
        kind: 'section',
        parentId: folder.id,
      }),
    );
  });

  it('opens a new page ready to type: an empty title and a visible hint', async () => {
    const { r, folder } = await seed();
    const page = await r.space.create({ parentId: folder.id, title: 'Untitled', blocks: [] });
    await open(r, `/space/${page.id}`);
    const title = await screen.findByRole('textbox', { name: 'Page title' });
    await waitFor(() => expect(title).toHaveFocus());
    expect(title).toHaveTextContent('');
    const body = screen.getByRole('textbox', { name: 'Text' });
    expect(body).toHaveAttribute('data-placeholder', 'Start writing, or press / for blocks');
    expect(body.className).toMatch(/(^|\s)empty:before:content-\[attr\(data-placeholder\)\]/);
    // Clicking the empty canvas puts the cursor in the page.
    fireEvent.click(screen.getByTestId('page-canvas-end'));
    await waitFor(() => expect(body).toHaveFocus());
  });

  it('adds a simple table, a subpage and a bookmark from the slash menu', async () => {
    const { r, page } = await seed();
    const { user } = await open(r, `/space/${page.id}`);
    const first = await screen.findByRole('textbox', { name: 'Text' }, { timeout: 10_000 });
    await user.click(first);
    await user.keyboard('{End}{Enter}/simple{Enter}');
    const grid = await screen.findByRole('group', { name: 'Simple table' });
    await user.type(within(grid).getByLabelText('Header, column 1'), 'Name');
    await user.click(within(grid).getByRole('button', { name: /Row/ }));
    await waitFor(
      async () => {
        const blocks = (await latest(r, page.id)).blocks ?? [];
        expect(blocks.find((b) => b.type === 'grid')?.rows).toEqual([
          ['Name', ''],
          ['', ''],
          ['', ''],
        ]);
      },
      { timeout: 5000 },
    );
    const after = screen.getAllByRole('textbox', { name: 'Text' }).at(-1)!;
    await user.click(after);
    await user.keyboard('/bookmark{Enter}');
    const form = await screen.findByRole('form', { name: 'Bookmark' });
    await user.type(within(form).getByLabelText('Link'), 'example.com/docs');
    await user.type(within(form).getByLabelText('Title (optional)'), 'Docs');
    await user.click(within(form).getByRole('button', { name: 'Save bookmark' }));
    expect(await screen.findByRole('link', { name: 'Docs' })).toHaveAttribute(
      'href',
      'https://example.com/docs',
    );
    const last = screen.getAllByRole('textbox', { name: 'Text' }).at(-1)!;
    await user.click(last);
    await user.keyboard('/page{Enter}');
    await waitFor(async () =>
      expect(
        (await all(r)).find((n) => n.parentId === page.id && n.title === 'Untitled'),
      ).toBeDefined(),
    );
  });

  it('links a page inline with [[, making it when it doesn’t exist yet', async () => {
    const { r, page } = await seed();
    const { user } = await open(r, `/space/${page.id}`);
    const first = await screen.findByRole('textbox', { name: 'Text' }, { timeout: 10_000 });
    await user.click(first);
    await user.keyboard('{End} see [[[[Reading list'); // [[ in user-event is one '['
    expect(
      await screen.findByRole('option', { name: /Create “Reading list”/ }),
    ).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(
      async () => {
        const made = (await all(r)).find((n) => n.title === 'Reading list');
        expect(made?.parentId).toBe(page.id);
        const text = (await latest(r, page.id)).blocks?.[0]?.text;
        expect(text).toBe(`Start here see [Reading list](space:${made!.id}) `);
      },
      { timeout: 5000 },
    );
  });

  it('keeps archived pages in the Trash to restore, or delete for good after asking', async () => {
    const { r, folder, page } = await seed();
    const { user } = await open(r, `/space/${page.id}`);
    await user.click(await screen.findByRole('button', { name: 'Page options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await waitFor(async () => expect((await latest(r, page.id)).archived).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Pages' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Pages' })).getByRole('button', {
        name: 'Trash',
      }),
    );
    const trash = await screen.findByRole('dialog', { name: 'Trash' });
    await user.click(within(trash).getByRole('button', { name: 'Restore Notes' }));
    await waitFor(async () => expect((await latest(r, page.id)).archived).toBe(false));
    await r.space.archive(folder.id);
    await user.click(await within(trash).findByRole('button', { name: 'Delete forever…' }));
    expect(within(trash).getByRole('alert')).toHaveTextContent(
      'Delete “Research” and the 1 pages inside for good?',
    );
    await user.click(within(trash).getByRole('button', { name: 'Delete forever' }));
    await waitFor(async () => expect(await r.space.get(page.id)).toBeUndefined());
    expect(await r.space.get(folder.id)).toBeUndefined();
  });

  it('pins from a page’s options, and shows pinned pages first in the tree', async () => {
    const { r, page } = await seed();
    const { user } = await open(r, `/space/${page.id}`);
    await user.click(await screen.findByRole('button', { name: 'Page options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Pin' }));
    await user.click(screen.getByRole('button', { name: 'Pages' }));
    const sheet = await screen.findByRole('dialog', { name: 'Pages' });
    expect(await within(sheet).findByRole('list', { name: 'Pinned pages' })).toHaveTextContent(
      'Notes',
    );
  });

  it('opens a row’s options with a right click', async () => {
    const { r, page } = await seed();
    const { user } = await open(r, `/space/${page.id}`);
    await user.click(screen.getByRole('button', { name: 'Pages' }));
    const sheet = await screen.findByRole('dialog', { name: 'Pages' });
    fireEvent.contextMenu(within(sheet).getByRole('treeitem', { name: 'Notes' }));
    const menu = within(sheet).getByRole('menu', { name: 'Options for Notes' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual([
      'New page inside',
      'New folder inside',
      'New database inside',
      'Rename',
      'Pin',
      'Duplicate',
      'Move to…',
      'Export',
      'Archive',
    ]);
  });

  it('imports a CSV file as a database, and exports a page as Markdown', async () => {
    const { r, folder, page } = await seed();
    const created = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    const { user } = await open(r, `/space/${folder.id}`);
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    const input = within(
      await screen.findByRole('dialog', { name: 'Import into SPACE' }),
    ).getByLabelText('Choose a file');
    await user.upload(
      input,
      new File(['Name,Stage\nAlpha,Done\n"Beta, two",Todo\n'], 'leads.csv', { type: 'text/csv' }),
    );
    await waitFor(async () => {
      const db = (await all(r)).find((n) => n.title === 'leads');
      expect(db?.table?.columns.map((c) => c.name)).toEqual(['Name', 'Stage']);
      expect(db?.table?.rows.map((x) => x.cells.c1)).toEqual(['Alpha', 'Beta, two']);
    });
    await r.space.get(page.id);
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(created).toHaveBeenCalled();
  });

  it('explains SPACE in a short guide', async () => {
    const { r } = await seed();
    const { user } = await open(r, '/space');
    await user.click(screen.getByRole('button', { name: 'How SPACE works' }));
    const guide = await screen.findByRole('dialog', { name: 'How SPACE works' });
    expect(guide).toHaveTextContent(/\+ New/);
    expect(guide).toHaveTextContent(/Claude can create, write and reorganise SPACE/);
  });
});
