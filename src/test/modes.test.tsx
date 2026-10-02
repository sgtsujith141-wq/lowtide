import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import type { LedgerEvent, WorkSession } from '../types/domain';
import { expectFocus, setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

afterEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
});

async function setup(seed?: (r: Repositories) => Promise<unknown>, path = '/more') {
  const db = newDb();
  await db.open();
  const repositories = createDexieRepositories(db);
  const seeded = await seed?.(repositories);
  return { db, repositories, seeded, ...(await renderApp(path, repositories)) };
}

const once = <T,>(watch: (cb: (v: T) => void) => () => void) =>
  new Promise<T>((resolve) => {
    const stop = watch((v) => {
      stop();
      resolve(v);
    });
  });

const events = async (r: Repositories) =>
  ((await once<LedgerEvent[]>(r.events.watchRecent({ includePrivate: true }))) as LedgerEvent[])
    .map((e) => e.type)
    .reverse();

const workMode = () => screen.findByRole('region', { name: 'Work Mode' }, { timeout: 5000 });
/** Start Work, once the modes have loaded (it's disabled for that moment). */
const startWork = async () => {
  const button = await screen.findByRole('button', { name: 'Start Work' }, { timeout: 10_000 });
  await vi.waitFor(() => expect(button).toBeEnabled());
  return button;
};
const chooser = () => screen.findByRole('dialog', { name: 'Start work' }, { timeout: 5000 });

describe('Work Mode (v2 PHASE 015)', () => {
  it('starts from a fast keyboard chooser into a focused surface, with focus on Pause', async () => {
    const { user, repositories } = await setup();
    await user.click(await startWork());
    const dialog = await chooser();
    expect(within(dialog).getByRole('group', { name: 'General' })).toBeInTheDocument();
    await user.keyboard('study');
    expect(
      within(dialog)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['College / study']);
    await user.keyboard('{Enter}');
    const focus = await workMode();
    expect(within(focus).getByRole('heading', { name: 'College / study' })).toBeInTheDocument();
    expect(within(focus).getByRole('timer')).toHaveTextContent(/^00:00:0\d$/);
    expect(within(focus).getByText(/^working since /)).toBeInTheDocument();
    await expectFocus(() => within(focus).getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('status', { hidden: true })).toBeTruthy();
    expect(await events(repositories)).toEqual(['work.started']);
  });

  it('pauses and resumes visibly, announcing each change once', async () => {
    const { user } = await setup((r) => r.work.start({ kind: 'general' }));
    await user.click(await screen.findByRole('button', { name: /Working · General work/ }));
    const focus = await workMode();
    await user.click(within(focus).getByRole('button', { name: 'Pause' }));
    expect(await within(focus).findByText(/^paused at /)).toBeInTheDocument();
    expect(within(focus).getByRole('timer')).toHaveAccessibleName(/paused$/);
    await vi.waitFor(() =>
      expect(screen.getAllByRole('status').some((s) => s.textContent === 'Paused')).toBe(true),
    );
    await user.click(within(focus).getByRole('button', { name: 'Resume' }));
    expect(await within(focus).findByText(/^working since /)).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(screen.getAllByRole('status').some((s) => s.textContent === 'Resumed')).toBe(true),
    );
  });

  it('folds into a compact bar to use LOWTIDE, and opens again from it', async () => {
    const { user } = await setup((r) => r.work.start({ kind: 'general', intent: 'Inbox zero' }));
    await user.click(await screen.findByRole('button', { name: /Working · General work/ }));
    await user.click(within(await workMode()).getByRole('button', { name: /Back to LOWTIDE/ }));
    const bar = await screen.findByRole('region', { name: 'Work session' });
    expect(bar).toHaveTextContent(/General work · Inbox zero/);
    expect(screen.queryByRole('region', { name: 'Work Mode' })).not.toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: /Open Work Mode/ }));
    expect(await workMode()).toBeInTheDocument();
  });

  it('finishes with a light summary; a note is optional and kept as the outcome', async () => {
    const { user, repositories } = await setup((r) => r.work.start({ kind: 'general' }));
    await user.click(await screen.findByRole('button', { name: /Working · General work/ }));
    await user.click(within(await workMode()).getByRole('button', { name: 'Finish' }));
    const summary = await screen.findByRole('dialog', { name: 'Work finished' });
    expect(within(summary).getByText(/^Worked \d+m$/)).toBeInTheDocument();
    await expectFocus(() => within(summary).getByRole('button', { name: 'Done' }));
    await user.type(
      within(summary).getByRole('textbox', { name: 'What changed? (optional)' }),
      'Cleared it',
    );
    await user.click(within(summary).getByRole('button', { name: 'Done' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Work finished' })).not.toBeInTheDocument(),
    );
    const [session] = await once<WorkSession[]>(
      repositories.work.watchRange('2000-01-01', '2100-01-01'),
    );
    expect(session).toMatchObject({ outcome: 'Cleared it' });
    expect(session!.endedAt).toBeDefined();
    expect(await events(repositories)).toEqual(['work.started', 'work.finished']);
  });

  it('offers the room’s project first, and a task when started from that task', async () => {
    const { user, repositories } = await setup(async (r) => {
      const p = await r.projects.create({ name: 'Engine', state: 'active' });
      await r.tasks.create({ title: 'Engine: wire the bus', projectId: p.id });
      await r.tasks.create({ title: 'Write docs', projectId: p.id });
    }, '/projects/engine');
    await user.click(
      await screen.findByRole('button', { name: 'Choose what to work on' }, { timeout: 10_000 }),
    );
    let dialog = await chooser();
    await vi.waitFor(() =>
      expect(within(within(dialog).getAllByRole('group')[0]!).getAllByRole('option')).toHaveLength(
        3,
      ),
    );
    const groups = within(dialog).getAllByRole('group');
    expect(groups[0]).toHaveAccessibleName('Engine');
    expect(
      within(groups[0]!)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['EngineProject', 'Wire the busEngine · task', 'Write docsEngine · task']);
    expect(within(groups[0]!).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('tab', { name: 'Tasks' }));
    await user.click(await screen.findByRole('button', { name: 'Start work on: Write docs' }));
    dialog = await chooser();
    await vi.waitFor(
      () =>
        expect(within(dialog).getByRole('option', { selected: true })).toHaveTextContent(
          'Write docs',
        ),
      { timeout: 5000 },
    );
    await user.keyboard('{Enter}');
    await workMode();
    const active = await once<WorkSession | undefined>(repositories.work.watchActive);
    expect(active).toMatchObject({ kind: 'task' });
    // The room shows it live.
    await user.click(within(await workMode()).getByRole('button', { name: /Back to LOWTIDE/ }));
    expect(await screen.findByText('Working here')).toBeInTheDocument();
  });

  it('offers a SPACE page’s project first from the shortcut, and recent work first from Home', async () => {
    const db = newDb();
    await db.open();
    const r = createDexieRepositories(db);
    const p = await r.projects.create({ name: 'Engine', state: 'active' });
    const slot = await r.space.ensureProjectSpace(p.id, 'notes');
    const page = await r.space.create({ parentId: slot.id, title: 'Notes', blocks: [] });
    const other = await r.projects.create({ name: 'Atlas', state: 'active' });
    const done = await r.work.start({ kind: 'project', projectId: other.id });
    await r.work.finish(done.id);

    const { user, unmount } = await renderApp(`/space/${page.id}`, r);
    await screen.findByRole('button', { name: 'Pages' }, { timeout: 10_000 });
    await user.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}');
    let dialog = await chooser();
    expect(within(dialog).getAllByRole('group')[0]).toHaveAccessibleName('Engine');
    await user.keyboard('{Escape}');
    unmount();

    await renderApp('/', r);
    await user.click(await startWork());
    dialog = await chooser();
    await vi.waitFor(() =>
      expect(within(dialog).getAllByRole('group')[0]).toHaveAccessibleName('Recent'),
    );
    const groups = within(dialog).getAllByRole('group');
    expect(within(groups[0]!).getAllByRole('option')[0]).toHaveTextContent('Atlas');
  });

  it('keeps the running session, and Work Mode itself, across a reload', async () => {
    const { db, user, unmount } = await setup(
      (r) => r.work.start({ kind: 'college', intent: 'Essay' }),
      '/',
    );
    await user.click(await screen.findByRole('button', { name: /Working · College \/ study/ }));
    expect(await workMode()).toHaveTextContent('Essay');
    unmount();
    // A fresh app over the same database and tab, as after a page reload.
    await renderApp('/', createDexieRepositories(db));
    expect(
      within(await workMode()).getByRole('heading', { name: 'College / study' }),
    ).toBeInTheDocument();
  });
});

describe('Sleep Mode (v2 PHASE 015)', () => {
  it('covers the whole screen with a dormant timer and Wake up; the app beneath is inert', async () => {
    const { user, container, repositories } = await setup();
    await user.click(screen.getByRole('button', { name: 'Sleep Mode' }));
    const dormant = await screen.findByRole('dialog', { name: 'Off time' });
    expect(within(dormant).getByRole('timer')).toHaveTextContent(/^\d\d:\d\d:\d\d$/);
    expect(within(dormant).getByText(/^started /)).toBeInTheDocument();
    expect(within(dormant).queryByText(/sleep measurement/)).not.toBeInTheDocument();
    await expectFocus(() => within(dormant).getByRole('button', { name: 'Wake up' }));
    const frame = container.querySelector('[data-mode="sleep"]')!;
    expect(frame).toHaveAttribute('inert');
    expect(frame.contains(screen.getByRole('navigation', { name: 'Main', hidden: true }))).toBe(
      true,
    );
    expect(document.documentElement.style.overflow).toBe('hidden');

    await user.click(within(dormant).getByRole('button', { name: 'Wake up' }));
    const toast = await screen.findByRole('status', { name: 'Off time ended' }, { timeout: 3000 });
    expect(toast).toHaveTextContent(/Off time\s*0m.*→/);
    expect(screen.queryByRole('dialog', { name: 'Off time' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-mode="sleep"]')).toBeNull();
    await expectFocus(() => screen.getByRole('main'));
    expect(await events(repositories)).toEqual(['offtime.started', 'offtime.ended']);
  });

  it('asks before stopping running work: go back, or finish it and sleep', async () => {
    const { user, repositories } = await setup((r) => r.work.start({ kind: 'general' }));
    await screen.findByRole('button', { name: /Working · General work/ });
    await user.click(screen.getByRole('button', { name: 'Sleep Mode' }));
    let ask = await screen.findByRole('dialog', { name: 'Work is still running' });
    expect(ask).toHaveTextContent('General work');
    expect(ask).toHaveTextContent(/\d+m/);
    await user.click(within(ask).getByRole('button', { name: 'Go back' }));
    expect(screen.queryByRole('dialog', { name: 'Off time' })).not.toBeInTheDocument();
    expect(await once<WorkSession | undefined>(repositories.work.watchActive)).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Sleep Mode' }));
    ask = await screen.findByRole('dialog', { name: 'Work is still running' });
    await user.click(within(ask).getByRole('button', { name: 'Finish work & sleep' }));
    expect(await screen.findByRole('dialog', { name: 'Off time' })).toBeInTheDocument();
    expect(await events(repositories)).toEqual([
      'work.started',
      'work.finished',
      'offtime.started',
    ]);
  });

  it('wakes immediately when reduced motion is asked for', async () => {
    vi.stubGlobal(
      'matchMedia',
      (q: string) =>
        ({
          matches: q.includes('reduce'),
          media: q,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
    try {
      const { user } = await setup((r) => r.offTime.start('sleep'));
      const dormant = await screen.findByRole('dialog', { name: 'Off time' });
      await user.click(within(dormant).getByRole('button', { name: 'Wake up' }));
      expect(
        await screen.findByRole('status', { name: 'Off time ended' }, { timeout: 300 }),
      ).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the command palette knows the modes', () => {
  it('offers only what can happen now', async () => {
    const { user, repositories } = await setup();
    const actions = async () => {
      await user.keyboard('{Control>}k{/Control}');
      const list = await screen.findByRole('list', { name: 'Actions' });
      const names = within(list)
        .getAllByRole('button')
        .map((b) => b.textContent?.replace(/^Action/, ''));
      return { list, names };
    };
    let { names } = await actions();
    expect(names).toEqual(['Start work', 'Sleep mode']);
    await user.keyboard('{Escape}');

    await repositories.work.start({ kind: 'general' });
    await screen.findByRole('button', { name: /Working · General work/ });
    const working = await actions();
    expect(working.names).toEqual([
      'Return to Work Mode',
      'Pause work',
      'Finish work',
      'Sleep mode',
    ]);
    await user.click(within(working.list).getByRole('button', { name: /Pause work/ }));
    ({ names } = await actions());
    expect(names).toContain('Resume work');
    await user.keyboard('{Escape}');

    const active = await once<WorkSession | undefined>(repositories.work.watchActive);
    await repositories.work.finish(active!.id);
    await repositories.offTime.start('sleep');
    await screen.findByRole('dialog', { name: 'Off time' });
    ({ names } = await actions());
    expect(names).toEqual(['Wake up']);
  });
});
