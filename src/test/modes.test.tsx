import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

async function setup(seed?: (r: Repositories) => Promise<unknown>, path = '/more') {
  const db = newDb();
  const repositories = createDexieRepositories(db);
  await seed?.(repositories);
  return { db, repositories, ...(await renderApp(path, repositories)) };
}

const workBar = () => screen.findByRole('region', { name: 'Work session' }, { timeout: 3000 });

describe('Work Mode', () => {
  it('starts general work, pauses, resumes and finishes from the global bar', async () => {
    const { user, repositories } = await setup();
    await user.click(screen.getByRole('button', { name: 'Start Work' }));
    const form = screen.getByRole('form', { name: 'Start work' });
    await user.type(within(form).getByRole('textbox', { name: 'Intent (optional)' }), 'Inbox zero');
    await user.click(within(form).getByRole('button', { name: 'Start' }));

    const bar = await workBar();
    expect(within(bar).getByText('Working')).toBeInTheDocument();
    expect(await within(bar).findByText(/General work: Inbox zero/)).toBeInTheDocument();
    expect(within(bar).getByLabelText('Session time')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Work' })).toBeDisabled();

    await user.click(within(bar).getByRole('button', { name: 'Pause' }));
    expect(await within(bar).findByText('Paused')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Resume' }));
    expect(await within(bar).findByText('Working')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Finish' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Work session' })).not.toBeInTheDocument(),
    );

    const watch = await new Promise<unknown[]>((resolve) => {
      const stop = repositories.events.watchRecent()((events) => {
        stop();
        resolve(events);
      });
    });
    expect((watch as { type: string }[]).map((e) => e.type).reverse()).toEqual([
      'work.started',
      'work.paused',
      'work.resumed',
      'work.finished',
    ]);
  });

  it('works on a project task, taking the project from the task', async () => {
    const { user, repositories } = await setup(async (r) => {
      const p = await r.projects.create({ name: 'Engine', state: 'active' });
      await r.tasks.create({ title: 'Wire the bus', projectId: p.id });
    });
    await user.click(screen.getByRole('button', { name: 'Start Work' }));
    const form = screen.getByRole('form', { name: 'Start work' });
    await user.click(within(form).getByRole('radio', { name: 'Project + task' }));
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Project' }), 'Engine');
    await user.selectOptions(
      await within(form).findByRole('combobox', { name: 'Task' }),
      'Wire the bus',
    );
    await user.click(within(form).getByRole('button', { name: 'Start' }));
    const bar = await workBar();
    expect(await within(bar).findByText(/Engine › Wire the bus/)).toBeInTheDocument();
    const [session] = await new Promise<{ kind: string; projectId?: string }[]>((resolve) => {
      const stop = repositories.work.watchRange(
        '2000-01-01',
        '2100-01-01',
      )((s) => {
        stop();
        resolve(s);
      });
    });
    expect(session).toMatchObject({ kind: 'task' });
    expect(session!.projectId).toBeDefined();
  });

  it('asks for a project before starting project work', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Start Work' }));
    const form = screen.getByRole('form', { name: 'Start work' });
    await user.click(within(form).getByRole('radio', { name: 'Project' }));
    expect(within(form).getByText('No active projects yet.')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Start' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Choose a project.');
  });

  it('keeps a running session across a reload (read back from storage)', async () => {
    const { db, unmount } = await setup(async (r) => {
      await r.work.start({ kind: 'college', intent: 'Essay' });
    }, '/');
    expect(await within(await workBar()).findByText(/College \/ study: Essay/)).toBeInTheDocument();
    unmount();
    // A fresh app over the same database, as after a page reload.
    await renderApp('/', createDexieRepositories(db));
    expect(await within(await workBar()).findByText(/College \/ study: Essay/)).toBeInTheDocument();
  });
});

describe('Sleep Mode (ADR-042)', () => {
  it('won’t begin while work is running, and says why', async () => {
    const { user } = await setup((r) => r.work.start({ kind: 'general' }));
    await workBar();
    await user.click(screen.getByRole('button', { name: 'Sleep Mode' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Finish the work session first, then Sleep Mode can begin.',
    );
    expect(screen.queryByRole('region', { name: 'Off time' })).not.toBeInTheDocument();
  });

  it('dims the app without replacing it, keeps navigation, and ends with Wake up', async () => {
    const { user, container } = await setup();
    await user.click(screen.getByRole('button', { name: 'Sleep Mode' }));
    const bar = await screen.findByRole('region', { name: 'Off time' });
    expect(within(bar).getByText('Sleep Mode')).toBeInTheDocument();
    expect(within(bar).getByText(/not a sleep measurement/)).toBeInTheDocument();
    expect(container.querySelector('[data-mode="sleep"]')).not.toBeNull();
    // Still the normal app: navigation and content remain.
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'More' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('data-dimmable');

    await user.click(within(bar).getByRole('button', { name: 'Wake up' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Off time' })).not.toBeInTheDocument(),
    );
    expect(container.querySelector('[data-mode="sleep"]')).toBeNull();
  });
});
