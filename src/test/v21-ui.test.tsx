import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDexieRepositories } from '../db/repositories';
import type { Milestone, SpaceNode, Task } from '../types/domain';
import { CLAUDE_GUIDE } from '../features/space/guide';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

function setup() {
  const db = newDb();
  return { db, r: createDexieRepositories(db) };
}

const once = <T,>(watch: (cb: (v: T) => void) => () => void) =>
  new Promise<T>((resolve) => {
    const stop = watch((v) => {
      queueMicrotask(() => stop());
      resolve(v);
    });
  });

describe('v2.1 creation and editing in the app', () => {
  it('adds subtasks from the task editor and shows them under their parent', async () => {
    const { r } = setup();
    const parent = await r.tasks.create({ title: 'Ship v1' });
    const { user } = await renderApp('/tasks', r);
    await user.click(await screen.findByRole('button', { name: 'Edit: Ship v1' }));
    const panel = screen.getByRole('region', { name: 'Subtasks of Ship v1' });
    await user.type(
      within(panel).getByRole('textbox', { name: 'Add a subtask' }),
      'Write docs{Enter}',
    );
    expect(await within(panel).findByText('Write docs')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Complete: Write docs' }));
    await waitFor(async () =>
      expect(
        (await once<Task[]>(r.tasks.watchAll)).find((t) => t.title === 'Write docs'),
      ).toMatchObject({
        parentId: parent.id,
        status: 'done',
      }),
    );
    expect(within(panel).getByRole('heading')).toHaveTextContent('Subtasks · 1 of 1 done');
  });

  it('builds the roadmap from the Command Room: add, rename, archive and restore', async () => {
    const { r } = setup();
    const p = await r.projects.create({ name: 'Engine', state: 'active' });
    await r.projects.addMilestone(p.id, { title: 'Scope' });
    const { user } = await renderApp('/projects/engine', r);
    await user.click(await screen.findByRole('button', { name: 'Milestone' }, { timeout: 10_000 }));
    const form = await screen.findByRole('form', { name: 'Add a milestone' });
    const field = within(form).getByLabelText('Milestone');
    await waitFor(() => expect(field).toHaveFocus());
    await user.type(field, 'Build{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Rename: Scope' }));
    const rename = screen.getByLabelText('New name for Scope');
    await user.clear(rename);
    await user.type(rename, 'Discovery{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Archive: Build' }));
    await waitFor(async () => {
      const live = await once<Milestone[]>(r.projects.watchMilestones(p.id));
      expect(live.map((m) => m.title)).toEqual(['Discovery']);
    });
    await user.click(screen.getByText(/Archived milestones · 1/));
    await user.click(screen.getByRole('button', { name: 'Restore Build' }));
    await waitFor(async () =>
      expect(
        (await once<Milestone[]>(r.projects.watchMilestones(p.id))).map((m) => m.title),
      ).toEqual(['Discovery', 'Build']),
    );
  });

  it('links the Command Room to the project’s one SPACE folder', async () => {
    const { r } = setup();
    const p = await r.projects.create({ name: 'Engine', state: 'active' });
    const folder = await r.space.ensureProjectSpace(p.id);
    const { user } = await renderApp('/projects/engine', r);
    await user.click(await screen.findByRole('tab', { name: 'Docs' }, { timeout: 10_000 }));
    expect(await screen.findByRole('link', { name: /Open in SPACE/ })).toHaveAttribute(
      'href',
      `/space/${folder.id}`,
    );
  });

  it('starts a page from a template', async () => {
    const { r } = setup();
    await r.space.ensureRoots();
    await r.space.ensureSystemPages(CLAUDE_GUIDE);
    const { user } = await renderApp('/', r);
    await user.click(screen.getByRole('button', { name: 'New' }));
    await user.click(screen.getByRole('menuitem', { name: 'SPACE page' }));
    const form = await screen.findByRole('form', { name: 'New page' });
    await user.selectOptions(within(form).getByLabelText('Start from'), 'Decision Record');
    await user.type(within(form).getByLabelText('Title'), 'Pick a database');
    await user.click(within(form).getByRole('button', { name: 'Create page' }));
    await waitFor(async () => {
      const page = (await once<SpaceNode[]>(r.space.watchAll)).find(
        (n) => n.title === 'Pick a database',
      );
      expect(page?.blocks?.map((b) => b.text)).toContain('Options');
    });
  });
});
