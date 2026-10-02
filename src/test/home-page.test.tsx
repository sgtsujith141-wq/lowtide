import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { deadlineFromLocalDate, toLocalDate } from '../lib/time';
import { addDays } from '../lib/calendar';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

async function setup(seed?: (r: Repositories) => Promise<unknown>) {
  const db = newDb();
  // Open the database first, as a real visit would have: an empty profile
  // otherwise opens it inside the first render, racing every live query.
  await db.open();
  const repositories = createDexieRepositories(db);
  await seed?.(repositories);
  const rendered = await renderApp('/', repositories);
  // Generous waits: a busy machine renders the first frame slowly.
  await screen.findByText(/with a pulse in the last 12 months/, {}, { timeout: 10_000 });
  await screen.findByRole('heading', { level: 2, name: 'Today' }, { timeout: 10_000 });
  return { repositories, ...rendered };
}

const sectionNames = () =>
  screen
    .getAllByRole('heading', { level: 2 })
    .map((h) => h.textContent?.replace(/\d+$/, '').trim());

describe('Home v3 (v2 PHASE 012)', () => {
  it('opens with a quiet greeting and compact actions, not a giant "Home" heading', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toHaveClass('sr-only');
    expect(screen.getByText(/^Good (morning|afternoon|evening)\.$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Work' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sleep Mode' })).toHaveTextContent('Sleep');
    expect(
      screen.getByRole('button', { name: /^Search LOWTIDE \((⌘K|Ctrl K)\)$/ }),
    ).toBeInTheDocument();
  });

  it('hides sections with nothing to say: an empty profile shows the pulse, projects, today and rhythms', async () => {
    await setup();
    expect(sectionNames()).toEqual(['Daily Pulse', 'Projects', 'Today', 'Rhythms']);
    expect(screen.queryByText(/Nothing has happened/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing is waiting on you/)).not.toBeInTheDocument();
  });

  it('orders every section when there is something to show', async () => {
    await setup(async (r) => {
      const p = await r.projects.create({ name: 'Engine', state: 'active' });
      await r.projects.addItem(p.id, { kind: 'blocker', title: 'No fixtures' });
    });
    await screen.findByRole('heading', { level: 2, name: /Needs you/ });
    await screen.findByRole('heading', { level: 2, name: 'Recent' });
    expect(sectionNames()).toEqual([
      'Daily Pulse',
      'Projects',
      'Needs you',
      'Today',
      'Recent',
      'Rhythms',
    ]);
  });

  it('shows a whole year of empty squares with an honest count, and invents nothing', async () => {
    await setup();
    const grid = screen.getByRole('grid', { name: 'Daily Pulse, last 12 months' });
    const cells = within(grid).getAllByRole('gridcell');
    expect(cells.length).toBeGreaterThanOrEqual(52 * 7 + 1);
    expect(cells.every((c) => c.getAttribute('data-level') === '0')).toBe(true);
    expect(screen.getByText(/with a pulse in the last 12 months/).textContent).toMatch(/^0 days/);
    expect(screen.queryByText(/streak/i)).not.toBeInTheDocument();
  });

  it('opens a day’s detail from the grid, by mouse or keyboard, with only what it holds', async () => {
    const { user } = await setup(async (r) => {
      const t = await r.tasks.create({ title: 'Ship it' });
      await r.tasks.complete(t.id);
    });
    const today = toLocalDate(new Date());
    const cell = await screen.findByRole(
      'gridcell',
      { name: /light pulse: 1 task done/ },
      { timeout: 5000 },
    );
    expect(cell).toHaveAttribute('data-date', today);
    await user.click(cell);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Tasks done')).toBeInTheDocument();
    expect(within(drawer).getByText('Light')).toBeInTheDocument();
    expect(within(drawer).queryByText('Work')).not.toBeInTheDocument();
    expect(await within(drawer).findByText(/Completed: Ship it/)).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Keyboard: the grid is one tab stop; Enter opens the focused day.
    cell.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('never lets protected time or inbox capture colour a square', async () => {
    await setup(async (r) => {
      const today = toLocalDate(new Date());
      await r.protectedTime.create({ title: 'Dinner', date: today, kind: 'relationship' });
      await r.inbox.capture('a thought');
    });
    const cells = within(
      screen.getByRole('grid', { name: 'Daily Pulse, last 12 months' }),
    ).getAllByRole('gridcell');
    expect(cells.every((c) => c.getAttribute('data-level') === '0')).toBe(true);
  });

  it('shows the projects in focus as rows: primary first, "not current" left to Projects', async () => {
    await setup(async (r) => {
      const main = await r.projects.create({ name: 'Main', state: 'active' });
      const side = await r.projects.create({ name: 'Side', state: 'active' });
      const later = await r.projects.create({ name: 'Later', state: 'active' });
      await r.projects.create({ name: 'Unset', state: 'active' });
      await r.projects.create({ name: 'Done thing', state: 'archived' });
      await r.projects.setFocus(side.id, 'secondary');
      await r.projects.setFocus(main.id, 'primary');
      await r.projects.setFocus(later.id, 'background');
      const m = await r.projects.addMilestone(main.id, { title: 'Scope' });
      await r.projects.addMilestone(main.id, { title: 'Build' });
      await r.projects.completeMilestone(m.id);
      await r.projects.addItem(main.id, { kind: 'focus', title: 'Main: wire the bus' });
    });
    const list = within(await screen.findByRole('list', { name: 'Projects in focus' }));
    const names = list.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(['Main', 'Side', 'Unset']);
    expect(screen.getByRole('link', { name: /View all projects \(1 more\)/ })).toHaveAttribute(
      'href',
      '/projects',
    );
    expect(list.getByRole('progressbar', { name: 'Main: 50% of milestones' })).toBeInTheDocument();
    expect(list.getByText('Scope', { exact: false })).toBeInTheDocument();
    // The project's own name isn't repeated in front of its work.
    expect(list.getByText('Wire the bus')).toBeInTheDocument();
    // No milestones: said plainly, never a made-up percentage.
    expect(list.getAllByText('No milestones yet')).toHaveLength(2);
    expect(screen.queryByText('Done thing')).not.toBeInTheDocument();
  });

  it('groups Needs you by project: blockers by name, overdue work counted', async () => {
    const yesterday = addDays(toLocalDate(new Date()), -1);
    await setup(async (r) => {
      const p = await r.projects.create({ name: 'Engine', state: 'active' });
      await r.projects.addItem(p.id, { kind: 'blocker', title: 'No fixtures' });
      await r.projects.addItem(p.id, { kind: 'approval', title: 'Sign off copy' });
      for (const title of ['One', 'Two', 'Three'])
        await r.tasks.create({ title, projectId: p.id, dueAt: deadlineFromLocalDate(yesterday) });
    });
    const needs = within(await screen.findByRole('region', { name: /Needs you/ }));
    const group = needs.getByRole('link', { name: /Engine/ });
    expect(group).toHaveAttribute('href', '/projects/engine');
    expect(group).toHaveTextContent('BlockedNo fixtures');
    expect(group).toHaveTextContent('Needs approvalSign off copy');
    expect(group).toHaveTextContent('3 overdue items');
    expect(needs.queryByText('One')).not.toBeInTheDocument();
  });

  it('counts college coursework due today under Needs you, but not classes', async () => {
    await setup(async (r) => {
      const today = toLocalDate(new Date());
      await r.college.create({ kind: 'assignment', title: 'Lab report', date: today });
      await r.college.create({ kind: 'class', title: 'Lecture', date: today });
    });
    const needs = within(await screen.findByRole('region', { name: /Needs you/ }));
    expect(needs.getByRole('link', { name: /College/ })).toHaveTextContent('1 item due today');
  });

  it('keeps Today to honest figures: no gym figure, no routine names', async () => {
    await setup(async (r) => {
      const today = toLocalDate(new Date());
      const stretch = await r.habits.create({
        name: 'Stretch',
        category: 'personal',
        unit: 'check',
      });
      await r.habits.create({ name: 'Rowing', category: 'fitness', unit: 'check' });
      await r.habits.setEntry(stretch.id, today, 1);
    });
    const figures = within(document.querySelector<HTMLElement>('[aria-label="Today in figures"]')!);
    expect(figures.getByText('Work')).toBeInTheDocument();
    expect(figures.getByText('Personal')).toBeInTheDocument();
    expect(figures.getByText('1 / 1')).toBeInTheDocument();
    expect(screen.queryByText(/gym/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Stretch')).not.toBeInTheDocument();
    expect(screen.queryByText('Rowing')).not.toBeInTheDocument();
  });

  it('offers a way to begin when nothing has happened yet, starting the top project', async () => {
    const { user, repositories } = await setup(async (r) => {
      const p = await r.projects.create({ name: 'Main', state: 'active' });
      await r.projects.setFocus(p.id, 'primary');
    });
    expect(screen.getByText('Nothing started yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start Main' }));
    expect(
      await screen.findByRole('region', { name: 'Work Mode' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    const active = await new Promise<unknown>((resolve) => {
      const stop = repositories.work.watchActive((v) => {
        stop();
        resolve(v);
      });
    });
    expect(active).toMatchObject({ kind: 'project' });
  });

  it('shows one rhythm at a time, switchable, without the gym', async () => {
    const { user } = await setup();
    const grids = () => screen.getAllByRole('grid').map((g) => g.getAttribute('aria-label'));
    expect(grids()).toEqual(['Daily Pulse, last 12 months', 'Work, last 12 months']);
    const picker = screen.getByRole('radiogroup', { name: 'Rhythm to show' });
    expect(
      within(picker)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('value')),
    ).toEqual(['work', 'sleep', 'college', 'personal', 'projects']);
    await user.click(within(picker).getByRole('radio', { name: 'College' }));
    expect(grids()).toEqual(['Daily Pulse, last 12 months', 'College, last 12 months']);
  });

  it('searches locally from ⌘K, honestly, and closes with Escape', async () => {
    const { user } = await setup((r) => r.projects.create({ name: 'Lighthouse' }));
    await user.keyboard('{Control>}k{/Control}');
    const search = await screen.findByRole('search');
    expect(within(search).getByText(/Searches what’s on this device/)).toBeInTheDocument();
    expect(within(search).queryByText(/\bAI\b/)).not.toBeInTheDocument();
    await user.type(within(search).getByRole('textbox', { name: 'Search LOWTIDE' }), 'light');
    expect(await within(search).findByRole('link', { name: /Lighthouse/ })).toHaveAttribute(
      'href',
      '/projects/lighthouse',
    );
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('search')).not.toBeInTheDocument());
  });
});
