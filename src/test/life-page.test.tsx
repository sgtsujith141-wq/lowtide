import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { addDays } from '../lib/calendar';
import { toLocalDate } from '../lib/time';
import { setupTestDatabase } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();
const today = () => toLocalDate(new Date());

async function setup(seed?: (r: Repositories) => Promise<unknown>) {
  const db = newDb();
  const repositories = createDexieRepositories(db);
  await seed?.(repositories);
  const rendered = await renderApp('/life', repositories);
  await screen.findByRole('grid', { name: 'College, last 90 days' });
  return { db, repositories, ...rendered };
}

const area = (name: string) => screen.getByRole('region', { name });

describe('Life page', () => {
  it('has four areas, each with its own grid and range switch', async () => {
    await setup();
    for (const name of ['Personal', 'Sleep & off time', 'Gym', 'College']) {
      expect(
        within(area(name)).getByRole('grid', { name: `${name}, last 90 days` }),
      ).toBeInTheDocument();
      expect(within(area(name)).getByRole('radiogroup', { name: 'Range' })).toBeInTheDocument();
    }
    expect(screen.getByText(/gives no dosage advice/)).toBeInTheDocument();
  });

  it('switches a grid to the last 7 days, drawing exactly seven squares', async () => {
    const { user } = await setup();
    await user.click(within(area('Gym')).getByRole('radio', { name: '7 days' }));
    const grid = within(area('Gym')).getByRole('grid', { name: 'Gym, last 7 days' });
    const dates = within(grid)
      .getAllByRole('gridcell')
      .map((c) => c.getAttribute('data-date'));
    expect(dates).toHaveLength(7);
    expect(dates).toContain(today());
    expect(dates).toContain(addDays(today(), -6));
    expect(dates).not.toContain(addDays(today(), -7));
  });

  it('logs a personal routine, which colours the Personal grid', async () => {
    const { user } = await setup((r) =>
      r.habits.create({ name: 'Tablets', category: 'health', unit: 'check' }),
    );
    await user.click(await within(area('Personal')).findByRole('button', { name: 'Tablets' }));
    const grid = within(area('Personal')).getByRole('grid');
    await vi.waitFor(() =>
      expect(grid.querySelector(`[data-date="${today()}"]`)).toHaveAccessibleName(
        /1 personal routine/,
      ),
    );
  });

  it('logs a gym session with type, duration and note', async () => {
    const { user, db } = await setup((r) =>
      r.habits.create({ name: 'Strength', category: 'fitness', unit: 'minutes' }),
    );
    const form = await within(area('Gym')).findByRole('form', { name: 'Log a gym session' });
    await user.type(within(form).getByRole('spinbutton', { name: 'Minutes' }), '45');
    await user.type(within(form).getByRole('textbox', { name: 'Note (optional)' }), 'heavy day');
    await user.click(within(form).getByRole('button', { name: 'Log session' }));
    const log = await within(area('Gym')).findByRole('list', { name: 'Today’s gym' });
    expect(log).toHaveTextContent('Strength45 m· heavy day');
    expect(await db.habitEntries.toArray()).toMatchObject([
      { date: today(), value: 45, note: 'heavy day' },
    ]);
  });

  it('asks for minutes rather than logging an empty session', async () => {
    const { user } = await setup((r) =>
      r.habits.create({ name: 'Cardio', category: 'fitness', unit: 'minutes' }),
    );
    const form = await within(area('Gym')).findByRole('form', { name: 'Log a gym session' });
    await user.click(within(form).getByRole('button', { name: 'Log session' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('How many minutes?');
  });

  it('marks a sleep window, shows it as marked (not measured), and declares a day off', async () => {
    const { user } = await setup();
    const sleep = area('Sleep & off time');
    await user.click(within(sleep).getByRole('button', { name: 'Start sleep window' }));
    // A page-wide role query: each poll walks all four 90-day grids (~360 named
    // cells), which in jsdom can take most of a second on a loaded machine.
    const bar = await screen.findByRole('region', { name: 'Off time' }, { timeout: 8000 });
    await user.click(within(bar).getByRole('button', { name: 'Wake up' }));
    expect(await within(sleep).findByText(/marked$/)).toBeInTheDocument();
    expect(within(sleep).getByText(/not how long you slept/)).toBeInTheDocument();

    const tomorrow = addDays(today(), 1);
    const day = within(sleep).getByLabelText('Day');
    await user.clear(day);
    await user.type(day, tomorrow);
    await user.click(within(sleep).getByRole('button', { name: 'Declare a day off' }));
    const upcoming = await within(sleep).findByRole('list', { name: 'Upcoming days off' });
    expect(within(upcoming).getAllByRole('listitem')).toHaveLength(1);
    await user.click(within(upcoming).getByRole('button', { name: /^Remove day off/ }));
    await vi.waitFor(() =>
      expect(
        within(sleep).queryByRole('list', { name: 'Upcoming days off' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('won’t start off time while work runs, and says why', async () => {
    const { user } = await setup((r) => r.work.start({ kind: 'general' }));
    await screen.findByRole('region', { name: 'Work session' });
    await user.click(within(area('Sleep & off time')).getByRole('button', { name: 'Start rest' }));
    expect(await within(area('Sleep & off time')).findByRole('alert')).toHaveTextContent(
      'Finish the work session first',
    );
  });

  it('records classes as attended or missed and coursework as done', async () => {
    const { user, repositories } = await setup(async (r) => {
      await r.college.create({ kind: 'class', title: 'DBMS', date: today(), course: 'CS301' });
      await r.college.create({ kind: 'assignment', title: 'Essay', date: addDays(today(), 2) });
    });
    const college = area('College');
    const todayList = within(college).getByRole('region', { name: 'College today' });
    await user.click(await within(todayList).findByRole('button', { name: 'Missed: DBMS' }));
    expect(await within(todayList).findByText('(missed)')).toBeInTheDocument();
    await user.click(within(todayList).getByRole('button', { name: 'Attended: DBMS' }));
    expect(await within(todayList).findByText('(attended)')).toBeInTheDocument();
    const coming = within(college).getByRole('region', { name: 'College coming up' });
    await user.click(within(coming).getByRole('button', { name: 'Done: Essay' }));
    await vi.waitFor(() =>
      expect(
        within(college).queryByRole('region', { name: 'College coming up' }),
      ).not.toBeInTheDocument(),
    );
    const items = await new Promise<{ status: string }[]>((resolve) => {
      const stop = repositories.college.watchRange(
        '2000-01-01',
        '2100-01-01',
      )((v) => {
        stop();
        resolve(v);
      });
    });
    expect(items.map((i) => i.status).sort()).toEqual(['attended', 'done']);
  });

  it('adds a college item and starts a study session', async () => {
    const { user } = await setup();
    const college = area('College');
    await user.click(within(college).getByRole('button', { name: /Add class, lab/ }));
    const form = within(college).getByRole('form', { name: 'Add to college' });
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Kind' }), 'Lab');
    await user.type(within(form).getByRole('textbox', { name: 'Title' }), 'Networks lab');
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    expect(
      await within(within(college).getByRole('region', { name: 'College today' })).findByText(
        'Networks lab',
      ),
    ).toBeInTheDocument();
    await user.click(within(college).getByRole('button', { name: 'Start study' }));
    const bar = await screen.findByRole('region', { name: 'Work session' });
    expect(await within(bar).findByText(/College \/ study: Study/)).toBeInTheDocument();
  });
});
