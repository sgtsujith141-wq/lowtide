import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { toLocalDate } from '../lib/time';
import { revealLazyContent, setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

async function setup(seed?: (r: Repositories) => Promise<unknown>) {
  const repositories = createDexieRepositories(newDb());
  await seed?.(repositories);
  const rendered = await renderApp('/', repositories);
  // Every section renders once its live data arrives; wait for all six.
  await vi.waitFor(() => expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(6), {
    timeout: 5000,
  });
  await screen.findByText(/days? with a pulse in the last year/, {}, { timeout: 5000 });
  return { repositories, ...rendered };
}

describe('Home (ADR-043)', () => {
  it('orders its sections: actions, Daily Pulse, projects, needs you, today, activity, rhythms', async () => {
    await setup();
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent?.replace(/\d+$/, '').trim());
    expect(headings).toEqual([
      'Daily Pulse',
      'Projects',
      'Needs you',
      'Today',
      'Recent activity',
      'Individual rhythms',
    ]);
    for (const name of ['Start Work', 'Sleep Mode', 'Ask LOWTIDE'])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });

  it('shows a year of empty Daily Pulse squares with no data, and invents nothing', async () => {
    await setup();
    const grid = screen.getByRole('grid', { name: 'Daily Pulse, last 12 months' });
    const cells = within(grid).getAllByRole('gridcell');
    expect(cells.length).toBeGreaterThanOrEqual(52 * 7 + 1);
    expect(cells.every((c) => c.getAttribute('data-level') === '0')).toBe(true);
    expect(screen.getByText('0 days with a pulse in the last year')).toBeInTheDocument();
    expect(screen.getByText(/Nothing has happened here yet/)).toBeInTheDocument();
  });

  it('renders the secondary grids when scrolled to, with no gym grid or gym card', async () => {
    await setup();
    expect(screen.getAllByRole('grid')).toHaveLength(1);
    revealLazyContent();
    await screen.findByRole('grid', { name: 'Work, last 12 months' });
    const names = screen.getAllByRole('grid').map((g) => g.getAttribute('aria-label'));
    expect(names).toEqual([
      'Daily Pulse, last 12 months',
      'Work, last 12 months',
      'Projects, last 12 months',
      'College, last 12 months',
      'Personal, last 12 months',
      'Sleep & off time, last 12 months',
    ]);
    expect(screen.queryByText(/gym/i)).not.toBeInTheDocument();
  });

  it('colours today from real records and opens the day’s details on selection', async () => {
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
    const detail = screen.getByRole('region', { name: /^Details for / });
    expect(within(detail).getByText('Tasks done')).toBeInTheDocument();
    expect(within(detail).getByText('1')).toBeInTheDocument();
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

  it('shows a live project as a card, and its approvals and blockers under Needs you', async () => {
    await setup(async (r) => {
      const p = await r.projects.create({ name: 'Engine', state: 'active' });
      const m = await r.projects.addMilestone(p.id, { title: 'Scope' });
      await r.projects.addMilestone(p.id, { title: 'Build' });
      await r.projects.completeMilestone(m.id);
      await r.projects.addItem(p.id, { kind: 'focus', title: 'Wire the bus' });
      await r.projects.addItem(p.id, { kind: 'approval', title: 'Sign off copy' });
      await r.projects.addItem(p.id, { kind: 'blocker', title: 'No fixtures' });
      await r.projects.create({ name: 'Old thing', state: 'archived' });
    });
    const cards = within(screen.getByRole('region', { name: 'Projects' }));
    expect(await cards.findByRole('link', { name: 'Engine' })).toHaveAttribute(
      'href',
      '/projects/engine',
    );
    expect(cards.queryByText('Old thing')).not.toBeInTheDocument();
    expect(
      cards.getByRole('progressbar', { name: 'Engine: 50% of milestones' }),
    ).toBeInTheDocument();
    expect(cards.getByText('Now: Build')).toBeInTheDocument();
    expect(cards.getByText('Wire the bus')).toBeInTheDocument();
    const needs = within(screen.getByRole('region', { name: /Needs you/ }));
    expect(needs.getByRole('link', { name: /Sign off copy/ })).toHaveAttribute(
      'href',
      '/projects/engine',
    );
    expect(needs.getByRole('link', { name: /No fixtures/ })).toBeInTheDocument();
  });

  it('says plainly when nothing needs you', async () => {
    await setup();
    expect(await screen.findByText('Nothing is waiting on you.')).toBeInTheDocument();
  });

  it('Ask LOWTIDE is an honest local search, not a fake AI', async () => {
    const { user } = await setup((r) => r.projects.create({ name: 'Lighthouse' }));
    await user.click(screen.getByRole('button', { name: 'Ask LOWTIDE' }));
    const search = screen.getByRole('search');
    expect(within(search).getByText(/No AI is connected/)).toBeInTheDocument();
    await user.type(within(search).getByRole('textbox', { name: 'Ask LOWTIDE' }), 'light');
    expect(await within(search).findByRole('link', { name: /Lighthouse/ })).toHaveAttribute(
      'href',
      '/projects/lighthouse',
    );
  });
});
