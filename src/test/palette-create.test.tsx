import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories } from '../db/repositories';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

async function palette(path: string) {
  const db = newDb();
  const repositories = createDexieRepositories(db);
  await repositories.space.ensureRoots();
  const rendered = await renderApp(path, repositories);
  const run = async (label: string) => {
    await rendered.user.keyboard('{Control>}k{/Control}');
    const search = await screen.findByRole('search');
    await rendered.user.type(
      within(search).getByRole('textbox', { name: 'Search LOWTIDE' }),
      'new',
    );
    await rendered.user.click(
      within(search).getByRole('button', { name: new RegExp(`${label}$`) }),
    );
  };
  return { ...rendered, repositories, db, run };
}

describe('Command palette: create commands (v2 PHASE 016)', () => {
  it('lists the create commands beside the mode actions', async () => {
    const { user } = await palette('/');
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
      'CreateNew SPACE page',
      'CreateNew project',
      'CreateNew hackathon',
    ]);
  });

  it('opens the task form, focused, without creating anything', async () => {
    const { run, db } = await palette('/');
    await run('New task');
    await vi.waitFor(() => expect(screen.getByRole('textbox', { name: 'New task' })).toHaveFocus());
    expect(await db.tasks.count()).toBe(0);
  });

  it('opens the new project form, even from the Projects page itself', async () => {
    const { run, user, db } = await palette('/projects');
    await run('New project');
    const form = await screen.findByRole('form', { name: 'New project' });
    await user.click(within(form).getByRole('button', { name: /Cancel/ }));
    await run('New project');
    expect(await screen.findByRole('form', { name: 'New project' })).toBeInTheDocument();
    expect(await db.projects.count()).toBe(0);
  });

  it('opens the add hackathon form', async () => {
    const { run } = await palette('/');
    await run('New hackathon');
    expect(await screen.findByRole('form', { name: 'Add hackathon' })).toBeInTheDocument();
  });

  it('creates a SPACE page in Ideas and opens it', async () => {
    const { run, repositories } = await palette('/');
    await run('New SPACE page');
    await screen.findByRole('article', { name: 'Untitled' }, { timeout: 10_000 });
    const ideas = (await repositories.space.getByKey('ideas'))!;
    const nodes = await new Promise<{ parentId?: string; title: string }[]>((resolve) => {
      const stop = repositories.space.watchAll((v) => {
        stop();
        resolve(v);
      });
    });
    expect(nodes.filter((n) => n.title === 'Untitled').map((n) => n.parentId)).toEqual([ideas.id]);
  });
});
