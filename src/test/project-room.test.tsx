import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

async function room(seed: (r: Repositories) => Promise<unknown>, slug = 'engine') {
  const repositories = createDexieRepositories(newDb());
  await seed(repositories);
  const rendered = await renderApp(`/projects/${slug}`, repositories);
  await screen.findByRole('tablist', { name: 'Project sections' }, { timeout: 5000 });
  // The Overview renders once every live query has answered.
  await screen.findByRole('region', { name: 'At a glance' }, { timeout: 5000 });
  return { repositories, ...rendered };
}

const engine = (r: Repositories) => r.projects.create({ name: 'Engine', state: 'active' });

describe('Projects page', () => {
  it('creates a project and opens its command room', async () => {
    const repositories = createDexieRepositories(newDb());
    const { user } = await renderApp('/projects', repositories);
    expect(await screen.findByText(/No active projects/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New project' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Tide Engine');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tide Engine' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('says so for an unknown project', async () => {
    await renderApp('/projects/nope', createDexieRepositories(newDb()));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Project not found' }),
    ).toBeInTheDocument();
  });
});

describe('Project Command Room', () => {
  it('shows no percentage without milestones, then a milestone-derived one', async () => {
    const { user } = await room(engine);
    expect(
      screen.getByRole('img', { name: 'No milestones yet, so no percentage' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Milestones' }));
    const form = screen.getByRole('form', { name: 'Add a milestone' });
    for (const [title, weight] of [
      ['Scope', '1'],
      ['Build', '3'],
    ]) {
      await user.clear(within(form).getByRole('textbox', { name: 'Milestone' }));
      await user.type(within(form).getByRole('textbox', { name: 'Milestone' }), title!);
      await user.clear(within(form).getByRole('spinbutton', { name: 'Weight' }));
      await user.type(within(form).getByRole('spinbutton', { name: 'Weight' }), weight!);
      await user.click(within(form).getByRole('button', { name: 'Add' }));
      await screen.findByRole('button', { name: `Complete: ${title}` });
    }
    await user.click(screen.getByRole('button', { name: 'Complete: Scope' }));
    await screen.findByRole('button', { name: 'Reopen: Scope' });
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(
      await screen.findByRole('img', { name: '25% complete by milestone weight' }),
    ).toBeInTheDocument();
    const pipeline = screen.getByRole('list', { name: 'Milestone pipeline' });
    expect(within(pipeline).getByText(/Scope/)).toHaveTextContent('Scope (done)');
    expect(within(pipeline).getByText(/Build/)).toHaveTextContent('Build (current)');
  });

  it('puts board items in their lanes; approvals and blockers leave only by resolving', async () => {
    const { user } = await room(async (r) => {
      const p = await engine(r);
      await r.projects.addItem(p.id, { kind: 'approval', title: 'Sign off copy' });
      await r.projects.addItem(p.id, { kind: 'step', title: 'Write loader' });
      await r.tasks.create({ title: 'Refactor scheduler', projectId: p.id });
    });
    const lane = (name: string) => screen.getByRole('region', { name });
    expect(within(lane('Needs approval')).getByText('Sign off copy')).toBeInTheDocument();
    expect(within(lane('Next')).getByText('Write loader')).toBeInTheDocument();
    expect(within(lane('Next')).getByText('Refactor scheduler')).toBeInTheDocument();
    // An open approval has no Move control.
    expect(
      within(lane('Needs approval')).queryByRole('combobox', { name: /Move/ }),
    ).not.toBeInTheDocument();

    await user.selectOptions(
      within(lane('Next')).getByRole('combobox', { name: 'Move Write loader to' }),
      'Parked',
    );
    expect(await within(lane('Parked')).findByText('Write loader')).toBeInTheDocument();
    await user.click(
      within(lane('Needs approval')).getByRole('button', { name: 'Approve: Sign off copy' }),
    );
    expect(await within(lane('Done')).findByText('Sign off copy')).toBeInTheDocument();
  });

  it('adds a waiting item that says who it waits on', async () => {
    const { user } = await room(engine);
    await user.click(screen.getByRole('button', { name: 'Add to the board' }));
    const form = screen.getByRole('form', { name: 'Add to the board' });
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Kind' }), 'Waiting on');
    await user.type(within(form).getByRole('textbox', { name: 'Title' }), 'Design review');
    await user.type(within(form).getByRole('textbox', { name: /Waiting on/ }), 'a teammate');
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    const waiting = screen.getByRole('region', { name: 'Waiting' });
    expect(await within(waiting).findByText('Design review')).toBeInTheDocument();
    expect(within(waiting).getByText('on a teammate')).toBeInTheDocument();
  });

  it('refuses Done while milestones are open, and explains how to proceed', async () => {
    const { user } = await room(async (r) => {
      const p = await engine(r);
      await r.projects.addMilestone(p.id, { title: 'Last bit' });
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Project state' }), 'Done');
    expect(await screen.findByRole('alert')).toHaveTextContent(/record a decision in Docs/);
  });

  it('records immutable decisions in Docs, with supersession', async () => {
    const { user } = await room(engine);
    await user.click(screen.getByRole('tab', { name: 'Docs' }));
    const form = screen.getByRole('form', { name: 'Record a decision' });
    await user.type(within(form).getByRole('textbox', { name: 'Decision title' }), 'Storage');
    await user.type(
      within(form).getByRole('textbox', { name: 'What was decided' }),
      'IndexedDB first',
    );
    await user.click(within(form).getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByText('IndexedDB first')).toBeInTheDocument();
    await user.type(within(form).getByRole('textbox', { name: 'Decision title' }), 'Storage');
    await user.type(
      within(form).getByRole('textbox', { name: 'What was decided' }),
      'SQLite later',
    );
    await user.selectOptions(
      within(form).getByRole('combobox', { name: 'Supersedes (optional)' }),
      'Storage',
    );
    await user.click(within(form).getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByText('SQLite later')).toBeInTheDocument();
    expect(await screen.findByText('superseded')).toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys and is honest about AI and GitHub', async () => {
    const { user } = await room(engine);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Overview', 'Tasks', 'Milestones', 'Docs', 'AI', 'GitHub', 'History']);
    screen.getByRole('tab', { name: 'Overview' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'History' })).toHaveFocus();
    await user.click(screen.getByRole('tab', { name: 'AI' }));
    // The AI tab reads AI sessions live, so its text arrives after the first render.
    expect(await screen.findByText(/LOWTIDE never invents them/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'GitHub' }));
    expect(screen.getByText('GitHub isn’t connected')).toBeInTheDocument();
    expect(screen.getByText(/fetches nothing from GitHub/)).toBeInTheDocument();
  });

  it('adds and completes a project task from the Tasks tab', async () => {
    const { user, repositories } = await room(engine);
    await user.click(screen.getByRole('tab', { name: 'Tasks' }));
    await user.type(screen.getByRole('textbox', { name: 'New task for Engine' }), 'Write docs');
    await user.click(
      within(screen.getByRole('form', { name: 'Add a task' })).getByRole('button', { name: 'Add' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Complete: Write docs' }));
    const done = await screen.findByRole('region', { name: 'Done tasks' });
    expect(await within(done).findByText('Write docs')).toBeInTheDocument();
    await vi.waitFor(async () => {
      const closed = await new Promise<{ title: string; projectId?: string }[]>((resolve) => {
        const stop = repositories.tasks.watchClosed((t) => {
          stop();
          resolve(t);
        });
      });
      expect(closed[0]).toMatchObject({ title: 'Write docs' });
      expect(closed[0]!.projectId).toBeDefined();
    });
  });
});
