import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import type { SpaceNode } from '../types/domain';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

async function setup(path = '/', seed?: (r: Repositories) => Promise<unknown>) {
  const db = newDb();
  const repositories = createDexieRepositories(db);
  await repositories.space.ensureRoots();
  await seed?.(repositories);
  const rendered = await renderApp(path, repositories);
  /** Opens ⌘K and runs a command by its label. */
  const run = async (label: string) => {
    await rendered.user.keyboard('{Control>}k{/Control}');
    const search = await screen.findByRole('search');
    await rendered.user.type(
      within(search).getByRole('textbox', { name: 'Search LOWTIDE' }),
      label,
    );
    await rendered.user.click(
      within(search).getByRole('button', { name: new RegExp(`${label}$`) }),
    );
  };
  return { ...rendered, repositories, db, run };
}

const allNodes = (r: Repositories) =>
  new Promise<SpaceNode[]>((resolve) => {
    const stop = r.space.watchAll((v) => {
      queueMicrotask(() => stop());
      resolve(v);
    });
  });

describe('Creating things (v2.1): one New menu, the palette and short forms', () => {
  it('offers every kind of thing in the palette beside the mode actions', async () => {
    const { user } = await setup();
    await user.keyboard('{Control>}k{/Control}');
    const actions = within(await screen.findByRole('search')).getByRole('list', {
      name: 'Actions',
    });
    expect(
      within(actions)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      'ActionStart work',
      'ActionSleep mode',
      'CreateNew task',
      'CreateNew project',
      'CreateNew page',
      'CreateNew folder',
      'CreateNew database',
      'CreateNew hackathon',
      'CreateNew idea',
      'CreateNew decision',
    ]);
  });

  it('has a visible New button with every kind in its menu, by keyboard too', async () => {
    const { user } = await setup();
    const button = screen.getByRole('button', { name: 'New' });
    await user.click(button);
    const menu = screen.getByRole('menu', { name: 'New' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual([
      'Task',
      'Project',
      'SPACE page',
      'SPACE folder',
      'SPACE database',
      'Hackathon',
      'Idea',
      'Decision',
    ]);
    expect(within(menu).getByRole('menuitem', { name: 'Task' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Project' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('creates a project in planning with its SPACE folder and opens its Command Room', async () => {
    const { user, run, repositories } = await setup();
    await run('New project');
    const form = await screen.findByRole('form', { name: 'New project' });
    await user.type(within(form).getByLabelText('Name'), 'Guardian');
    await user.type(within(form).getByLabelText('Purpose'), 'Keeps an eye on things.');
    expect(within(form).getByLabelText('State')).toHaveValue('planning');
    expect(within(form).getByLabelText('Create its SPACE folder')).toBeChecked();
    await user.click(within(form).getByRole('button', { name: 'Create project' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Guardian' }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    const all = await new Promise<{ id: string; description?: string; state: string }[]>(
      (resolve) => {
        const stop = repositories.projects.watchAll((v) => {
          queueMicrotask(() => stop());
          resolve(v);
        });
      },
    );
    expect(all[0]).toMatchObject({ state: 'planning', description: 'Keeps an eye on things.' });
    expect(await repositories.space.getByKey(`project:${all[0]!.id}`)).toBeDefined();
  });

  it('defaults a new task to the project you are in', async () => {
    let projectId = '';
    const { user, run, db } = await setup('/projects/engine', async (r) => {
      projectId = (await r.projects.create({ name: 'Engine', state: 'active' })).id;
    });
    await screen.findByRole('heading', { level: 1, name: 'Engine' }, { timeout: 10_000 });
    await run('New task');
    const form = await screen.findByRole('form', { name: 'New task' });
    expect(within(form).getByLabelText('Project')).toHaveValue(projectId);
    await user.type(within(form).getByLabelText('Title'), 'Wire the bus');
    await user.click(within(form).getByRole('button', { name: 'Add task' }));
    await waitFor(async () =>
      expect(await db.tasks.toArray()).toMatchObject([{ title: 'Wire the bus', projectId }]),
    );
  });

  it('makes a real folder where you are in SPACE', async () => {
    let ideasId = '';
    const { user, run, repositories } = await setup('/space', async (r) => {
      ideasId = (await r.space.getByKey('ideas'))!.id;
    });
    await screen.findByRole('button', { name: 'Pages' }, { timeout: 10_000 });
    await run('New folder');
    const form = await screen.findByRole('form', { name: 'New folder' });
    expect(within(form).getByLabelText('In')).toHaveValue(ideasId);
    await user.type(within(form).getByLabelText('Folder name'), 'Research');
    await user.click(within(form).getByRole('button', { name: 'Create folder' }));
    await waitFor(async () => {
      const made = (await allNodes(repositories)).find((n) => n.title === 'Research');
      expect(made).toMatchObject({ kind: 'section', parentId: ideasId });
      expect(made).not.toHaveProperty('key');
    });
  });

  it('adds a hackathon with just a name and a date, and opens it', async () => {
    const { user, run } = await setup();
    await run('New hackathon');
    const form = await screen.findByRole('form', { name: 'Add hackathon' });
    await user.type(within(form).getByLabelText('Name'), 'Build Night');
    await user.type(within(form).getByLabelText('Event starts'), '2026-11-04');
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    expect(
      await screen.findByRole('dialog', { name: 'Build Night' }, { timeout: 10_000 }),
    ).toBeInTheDocument();
  });

  it('records a decision only with a project, a title and the decision', async () => {
    const { user, run, db } = await setup('/', (r) => r.projects.create({ name: 'Atlas' }));
    await run('New decision');
    const form = await screen.findByRole('form', { name: 'New decision' });
    await user.type(within(form).getByLabelText('Title'), 'Transport');
    await user.click(within(form).getByRole('button', { name: 'Record decision' }));
    expect(within(form).getByRole('alert')).toHaveTextContent(/give the decision a title/);
    await user.type(within(form).getByLabelText('Decision'), 'Streamable HTTP');
    await user.click(within(form).getByRole('button', { name: 'Record decision' }));
    await waitFor(async () => expect(await db.decisions.count()).toBe(1));
  });
});
