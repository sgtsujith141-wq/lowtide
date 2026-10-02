import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import type { SpaceTable } from '../types/domain';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

const stage = {
  id: 'stage',
  name: 'Stage',
  type: 'status' as const,
  options: [{ name: 'Todo' }, { name: 'Done' }],
};

async function seed(table: Partial<SpaceTable> = {}) {
  const db = newDb();
  await db.open();
  const r = createDexieRepositories(db);
  const roots = await r.space.ensureRoots();
  const ideas = roots.find((n) => n.key === 'ideas')!;
  const node = await r.space.create({
    parentId: ideas.id,
    title: 'Tracker',
    table: {
      columns: [{ id: 'name', name: 'Name', type: 'text' }, stage, ...(table.columns ?? [])],
      rows: table.rows ?? [
        { id: 'a', cells: { name: 'Alpha', stage: 'Todo' } },
        { id: 'b', cells: { name: 'Beta', stage: 'Done' } },
      ],
    },
  });
  return { r, node };
}

async function open(r: Repositories, id: string) {
  const rendered = await renderApp(`/space/${id}`, r);
  await screen.findByRole('tablist', { name: 'Views' }, { timeout: 10_000 });
  return rendered;
}

const latest = async (r: Repositories, id: string) => (await r.space.get(id))!.table!;

describe('SPACE databases (v2.1)', () => {
  it('draws a big board column 50 cards at a time', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      id: `r${i}`,
      cells: { name: `Card ${i + 1}`, stage: 'Todo' },
    }));
    const db = newDb();
    await db.open();
    const r = createDexieRepositories(db);
    const ideas = (await r.space.ensureRoots()).find((n) => n.key === 'ideas')!;
    const node = await r.space.create({
      parentId: ideas.id,
      title: 'Big board',
      table: {
        columns: [{ id: 'name', name: 'Name', type: 'text' }, stage],
        rows,
        views: [{ id: 'v', name: 'Board', type: 'board', groupBy: 'stage' }],
      },
    });
    const { user } = await open(r, node.id);
    const todo = await screen.findByRole('region', { name: 'Todo' });
    expect(within(todo).getAllByRole('listitem')).toHaveLength(50);
    await user.click(within(todo).getByRole('button', { name: 'Show 10 more (10 hidden)' }));
    expect(within(todo).getAllByRole('listitem')).toHaveLength(60);
    expect(within(todo).queryByRole('button', { name: /Show .* more/ })).toBeNull();
  });

  it('adds a property, and refuses a type change that would lose values', async () => {
    const { r, node } = await seed();
    const { user } = await open(r, node.id);
    await user.click(screen.getByRole('button', { name: 'Property' }));
    const form = await screen.findByRole('form', { name: 'New property' });
    await user.type(within(form).getByLabelText('Name'), 'Due');
    await user.selectOptions(within(form).getByLabelText('Type'), 'Date');
    await user.click(within(form).getByRole('button', { name: 'Add property' }));
    await waitFor(async () =>
      expect((await latest(r, node.id)).columns.map((c) => [c.name, c.type])).toContainEqual([
        'Due',
        'date',
      ]),
    );
    expect(await screen.findByRole('button', { name: 'Due' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Options for Name' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit property…' }));
    const edit = await screen.findByRole('form', { name: 'Edit property Name' });
    await user.selectOptions(within(edit).getByLabelText('Type'), 'Number');
    await user.click(within(edit).getByRole('button', { name: 'Save property' }));
    expect(await within(edit).findByText(/can’t become number/)).toBeInTheDocument();
    expect((await latest(r, node.id)).columns[0]!.type).toBe('text');
  });

  it('shows a board grouped by status, and moves and adds cards', async () => {
    const { r, node } = await seed();
    const { user } = await open(r, node.id);
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Board view' }));
    expect(await screen.findByRole('tab', { name: 'Board', selected: true })).toBeInTheDocument();
    const todo = screen.getByRole('region', { name: 'Todo' });
    expect(within(todo).getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Done' })).getByRole('button', { name: 'Beta' }),
    ).toBeInTheDocument();
    await user.selectOptions(within(todo).getByLabelText('Move Alpha to'), 'Done');
    await waitFor(async () =>
      expect((await latest(r, node.id)).rows.find((x) => x.id === 'a')!.cells.stage).toBe('Done'),
    );
    await user.click(
      within(screen.getByRole('region', { name: 'Todo' })).getByRole('button', {
        name: 'Add to Todo',
      }),
    );
    await waitFor(async () => {
      const rows = (await latest(r, node.id)).rows;
      expect(rows).toHaveLength(3);
      expect(rows.at(-1)!.cells.stage).toBe('Todo');
    });
    expect((await latest(r, node.id)).views).toMatchObject([{ type: 'board', groupBy: 'stage' }]);
  });

  it('shows a list, grouped when asked', async () => {
    const { r, node } = await seed();
    await r.space.saveView(node.id, { name: 'All', type: 'list', groupBy: 'stage' });
    await open(r, node.id);
    const done = await screen.findByRole('region', { name: 'Done' });
    expect(within(done).getByRole('button', { name: 'Beta' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Todo' })).getByRole('button', { name: 'Alpha' }),
    ).toBeInTheDocument();
  });

  it('places rows on a calendar by their date, and lists undated ones', async () => {
    const { r, node } = await seed({
      columns: [{ id: 'due', name: 'Due', type: 'date' }],
      rows: [
        { id: 'a', cells: { name: 'Alpha', due: '2026-11-04' } },
        { id: 'b', cells: { name: 'Beta' } },
      ],
    });
    const { user } = await open(r, node.id);
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Calendar view' }));
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    const day = screen.getByRole('gridcell', { name: '4 November' });
    expect(within(day).getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'No date' })).getByRole('button', { name: 'Beta' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'December 2026' })).toBeInTheDocument();
  });

  it('saves filters and sorts in a view, without copying rows', async () => {
    const { r, node } = await seed();
    const { user } = await open(r, node.id);
    await user.click(screen.getByRole('button', { name: 'View options' }));
    const form = await screen.findByRole('form', { name: 'View options' });
    await user.click(within(form).getByRole('button', { name: 'Add filter' }));
    await user.selectOptions(within(form).getByLabelText('Filter 1 property'), 'Stage');
    await user.selectOptions(within(form).getByLabelText('Filter 1 condition'), 'is');
    await user.type(within(form).getByLabelText('Filter 1 value'), 'Done');
    await user.click(within(form).getByRole('button', { name: 'Add sort' }));
    await user.selectOptions(within(form).getByLabelText('Sort 1 direction'), 'Descending');
    await user.click(within(form).getByRole('button', { name: 'Save view' }));
    await waitFor(async () =>
      expect((await latest(r, node.id)).views).toMatchObject([
        {
          name: 'Table',
          type: 'table',
          filters: [{ column: 'stage', op: 'is', value: 'Done' }],
          sorts: [{ column: 'name', dir: 'desc' }],
        },
      ]),
    );
    expect(await screen.findByText('1 of 2 rows')).toBeInTheDocument();
    const grid = screen.getByRole('table', { name: 'Tracker' });
    expect(within(grid).queryByText('Alpha')).not.toBeInTheDocument();
    expect((await latest(r, node.id)).rows).toHaveLength(2);
  });

  it('links records through a relation, rolls them up, and computes formulas', async () => {
    const db = newDb();
    await db.open();
    const r = createDexieRepositories(db);
    const p = await r.projects.create({ name: 'Engine' });
    const done = await r.tasks.create({ title: 'Ship it', projectId: p.id });
    await r.tasks.complete(done.id);
    const todo = await r.tasks.create({ title: 'Write docs', projectId: p.id });
    const roots = await r.space.ensureRoots();
    const node = await r.space.create({
      parentId: roots.find((n) => n.key === 'ideas')!.id,
      title: 'Tracker',
      table: {
        columns: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'min', name: 'Minutes', type: 'number' },
          { id: 'tasks', name: 'Tasks', type: 'link', targets: ['task'] },
          {
            id: 'n',
            name: 'Done tasks',
            type: 'rollup',
            rollup: { relation: 'tasks', fn: 'countDone' },
          },
          {
            id: 'f',
            name: 'Size',
            type: 'formula',
            formula: 'if(prop("Minutes") > 30, "long", "short")',
          },
        ],
        rows: [
          {
            id: 'a',
            cells: {
              name: 'Alpha',
              min: 45,
              tasks: [{ type: 'task', id: done.id, label: 'Ship it' }],
            },
          },
        ],
      },
    });
    const { user } = await open(r, node.id);
    const grid = screen.getByRole('table', { name: 'Tracker' });
    expect(await within(grid).findByLabelText('Done tasks, row Alpha: 1')).toBeInTheDocument();
    expect(within(grid).getByLabelText('Size, row Alpha: long')).toBeInTheDocument();
    expect(within(grid).getByRole('link', { name: 'Ship it' })).toBeInTheDocument();
    await user.click(within(grid).getByRole('button', { name: 'Edit Tasks, row Alpha' }));
    const sheet = await screen.findByRole('dialog', { name: 'Tasks, row Alpha' });
    await user.click(within(sheet).getByRole('button', { name: 'Link Write docs (Engine)' }));
    await waitFor(async () =>
      expect((await latest(r, node.id)).rows[0]!.cells.tasks).toEqual([
        { type: 'task', id: done.id, label: 'Ship it' },
        { type: 'task', id: todo.id, label: 'Write docs' },
      ]),
    );
    await r.tasks.complete(todo.id);
    expect(await within(grid).findByLabelText('Done tasks, row Alpha: 2')).toBeInTheDocument();
  });

  it('edits a row in its details and deletes it after a confirmation', async () => {
    const { r, node } = await seed();
    const { user } = await open(r, node.id);
    await user.click(screen.getByRole('button', { name: 'Open Alpha' }));
    const sheet = await screen.findByRole('dialog', { name: 'Alpha' });
    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Alpha two');
    await user.tab();
    await waitFor(async () =>
      expect((await latest(r, node.id)).rows[0]!.cells.name).toBe('Alpha two'),
    );
    await user.selectOptions(within(sheet).getByRole('combobox', { name: 'Stage' }), 'Done');
    await waitFor(async () => expect((await latest(r, node.id)).rows[0]!.cells.stage).toBe('Done'));
    await user.click(within(sheet).getByRole('button', { name: 'Delete row…' }));
    await user.click(within(sheet).getByRole('button', { name: 'Delete row' }));
    await waitFor(async () =>
      expect((await latest(r, node.id)).rows.map((x) => x.id)).toEqual(['b']),
    );
  });

  it('adds a new choice from a select cell', async () => {
    const { r, node } = await seed();
    const { user } = await open(r, node.id);
    const grid = screen.getByRole('table', { name: 'Tracker' });
    await user.selectOptions(
      within(grid).getByRole('combobox', { name: 'Stage, row Alpha' }),
      'New option…',
    );
    await user.type(
      within(grid).getByRole('textbox', { name: 'New option for Stage' }),
      'Blocked{Enter}',
    );
    await waitFor(async () => {
      const t = await latest(r, node.id);
      expect(t.columns[1]!.options!.map((o) => o.name)).toEqual(['Todo', 'Done', 'Blocked']);
      expect(t.rows[0]!.cells.stage).toBe('Blocked');
    });
  });
});
