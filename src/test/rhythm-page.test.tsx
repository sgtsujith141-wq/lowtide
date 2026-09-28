import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { addDays } from '../lib/calendar';
import { toLocalDate } from '../lib/time';
import { setupTestDatabase, expectFocus } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();
const today = () => toLocalDate(new Date());

async function setup(
  seed?: (r: Repositories) => Promise<unknown>,
  override?: (r: Repositories) => Repositories,
) {
  const db = newDb();
  const base = createDexieRepositories(db);
  await seed?.(base);
  const repositories = override ? override(base) : base;
  return { db, repositories, ...(await renderApp('/rhythm', repositories)) };
}

const cell = (date: string) =>
  screen.getByRole('grid').querySelector<HTMLElement>(`[data-date="${date}"]`)!;
const todayLog = () => screen.getByRole('region', { name: 'Today' });

describe('Rhythm page', () => {
  it('starts with a calm empty state and no grid', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Rhythm' })).toBeInTheDocument();
    expect(await screen.findByText(/Nothing here yet/)).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByText(/streak|score|missed|perfect/i)).not.toBeInTheDocument();
  });

  it('creates habits with the form; targets only for amounts', async () => {
    const { user, db } = await setup();
    await user.click(await screen.findByRole('button', { name: 'New rhythm' }));
    const form = screen.getByRole('form', { name: 'New rhythm' });
    expect(within(form).queryByLabelText('Daily target (optional)')).not.toBeInTheDocument();
    await user.type(within(form).getByLabelText('Name'), 'Coding');
    await user.selectOptions(within(form).getByLabelText('Category'), 'coding');
    await user.selectOptions(within(form).getByLabelText('Record as'), 'minutes');
    await user.type(within(form).getByLabelText('Daily target (optional)'), '60{Enter}');

    await expectFocus(screen.findByRole('button', { name: 'Edit Coding' }));
    // Name and details are separate words for assistive tech, not "CodingCoding".
    expect(screen.getByRole('button', { name: 'Edit Coding' }).closest('li')).toHaveTextContent(
      /^Coding Coding · 60 min a day$/,
    );
    expect(screen.getByRole('grid', { name: 'All rhythms, last six months' })).toBeInTheDocument();
    expect(await db.habits.toArray()).toMatchObject([
      { name: 'Coding', category: 'coding', unit: 'minutes', target: 60, archived: false },
    ]);
    // Creating a habit records nothing.
    expect(await db.habitEntries.count()).toBe(0);
    expect(cell(today())).toHaveAccessibleName(/nothing recorded/);
  });

  it('rejects an empty name and a bad target with an associated error', async () => {
    const { user } = await setup();
    await user.click(await screen.findByRole('button', { name: 'New rhythm' }));
    const form = screen.getByRole('form', { name: 'New rhythm' });
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Give it a name.');
    await user.type(within(form).getByLabelText('Name'), 'DSA');
    await user.selectOptions(within(form).getByLabelText('Record as'), 'count');
    await user.type(within(form).getByLabelText('Daily target (optional)'), '2.5');
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('whole number');
  });

  it('toggles a check habit for today and the square follows', async () => {
    const { user, db } = await setup((r) =>
      r.habits.create({ name: 'Gym', category: 'fitness', unit: 'check' }),
    );
    const toggle = await within(todayLog()).findByRole('button', { name: 'Gym' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    await vi.waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
    await expectFocus(() => toggle);
    expect(toggle).toBeEnabled();
    expect(cell(today())).toHaveAccessibleName(/Gym done \(moderate activity across 1 habit\)/);
    expect(await db.habitEntries.toArray()).toMatchObject([{ date: today(), value: 1 }]);

    await user.click(toggle);
    await vi.waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'false'));
    expect(cell(today())).toHaveAccessibleName(/nothing recorded/);
    expect(await db.habitEntries.count()).toBe(0);
  });

  it('logs, edits and clears minutes; intensity updates in the habit view', async () => {
    const { user, db } = await setup((r) =>
      r.habits.create({ name: 'Coding', category: 'coding', unit: 'minutes', target: 60 }),
    );
    const input = await within(todayLog()).findByRole('spinbutton', {
      name: 'Coding, minutes today',
    });
    await user.type(input, '10{Enter}');
    await vi.waitFor(async () => expect((await db.habitEntries.toArray())[0]?.value).toBe(10));

    await user.selectOptions(screen.getByLabelText('Show'), 'Coding');
    expect(screen.getByRole('grid', { name: 'Coding, last six months' })).toBeInTheDocument();
    expect(cell(today())).toHaveAccessibleName(/10 of 60 min \(light\)/);

    await user.clear(input);
    await user.type(input, '60{Enter}');
    await vi.waitFor(() => expect(cell(today())).toHaveAccessibleName(/60 of 60 min \(high\)/));
    expect(await db.habitEntries.count()).toBe(1);

    await user.click(within(todayLog()).getByRole('button', { name: 'Clear today’s Coding' }));
    await vi.waitFor(() => expect(cell(today())).toHaveAccessibleName(/nothing recorded/));
    expect(input).toHaveValue(null);
    await expectFocus(() => input); // the clear button disappears; focus stays in the row
    expect(await db.habitEntries.count()).toBe(0);
  });

  it('saves an amount when leaving the field (number pads may have no Enter)', async () => {
    const { user, db } = await setup((r) =>
      r.habits.create({ name: 'Coding', category: 'coding', unit: 'minutes' }),
    );
    const input = await within(todayLog()).findByRole('spinbutton', {
      name: 'Coding, minutes today',
    });
    await user.type(input, '30');
    expect(await db.habitEntries.count()).toBe(0);
    await user.tab();
    await vi.waitFor(async () => expect((await db.habitEntries.toArray())[0]?.value).toBe(30));
  });

  it('rejects an invalid count and keeps what was typed', async () => {
    const { user, db } = await setup((r) =>
      r.habits.create({ name: 'DSA', category: 'coding', unit: 'count' }),
    );
    const input = await within(todayLog()).findByRole('spinbutton', { name: 'DSA, count today' });
    await user.type(input, '1.5{Enter}');
    expect(await within(todayLog()).findByRole('alert')).toHaveTextContent('whole number above 0');
    expect(input).toHaveAccessibleDescription('Enter a whole number above 0.');
    expect(input).toHaveValue(1.5);
    expect(await db.habitEntries.count()).toBe(0);
  });

  it('surfaces a failed save calmly', async () => {
    const { user } = await setup(
      (r) => r.habits.create({ name: 'Gym', category: 'fitness', unit: 'check' }),
      (r) => ({
        ...r,
        habits: { ...r.habits, setEntry: vi.fn().mockRejectedValue(new Error('x')) },
      }),
    );
    const toggle = await within(todayLog()).findByRole('button', { name: 'Gym' });
    await user.click(toggle);
    expect(await within(todayLog()).findByRole('alert')).toHaveTextContent('Couldn’t save that');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('archives without losing history, and restores', async () => {
    const { user } = await setup(async ({ habits }) => {
      const gym = await habits.create({ name: 'Gym', category: 'fitness', unit: 'check' });
      await habits.create({ name: 'Read', category: 'personal', unit: 'check' });
      await habits.setEntry(gym.id, addDays(today(), -3), 1);
    });
    await user.click(await screen.findByRole('button', { name: 'Archive Gym' }));
    await vi.waitFor(() =>
      expect(within(todayLog()).queryByRole('button', { name: 'Gym' })).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/Archived · 1/)).toBeInTheDocument();
    // History stays in the overall grid and in the archived habit's own view.
    expect(cell(addDays(today(), -3))).toHaveAccessibleName(/Gym done/);
    const show = screen.getByLabelText('Show');
    expect(within(show).getByRole('group', { name: 'Archived' })).toHaveTextContent('Gym');
    await user.selectOptions(show, 'Gym');
    expect(cell(addDays(today(), -3))).toHaveAccessibleName(/done \(high\)/);

    await user.click(screen.getByText(/Archived · 1/));
    await user.click(screen.getByRole('button', { name: 'Restore Gym' }));
    expect(await within(todayLog()).findByRole('button', { name: 'Gym' })).toBeInTheDocument();
  });

  it('edits a habit’s name and target but never its unit', async () => {
    const { user, db } = await setup((r) =>
      r.habits.create({ name: 'Coding', category: 'coding', unit: 'minutes', target: 60 }),
    );
    await user.click(await screen.findByRole('button', { name: 'Edit Coding' }));
    const form = screen.getByRole('form', { name: 'Edit Coding' });
    expect(within(form).getByLabelText('Record as')).toBeDisabled();
    await user.clear(within(form).getByLabelText('Name'));
    await user.type(within(form).getByLabelText('Name'), 'Deep work');
    await user.clear(within(form).getByLabelText('Daily target (optional)'));
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await expectFocus(screen.findByRole('button', { name: 'Edit Deep work' }));
    const [habit] = await db.habits.toArray();
    expect(habit).toMatchObject({ name: 'Deep work', unit: 'minutes' });
    expect(habit).not.toHaveProperty('target');
  });

  it('is one tab stop with arrow-key navigation by day and week', async () => {
    const { user } = await setup((r) =>
      r.habits.create({ name: 'Gym', category: 'fitness', unit: 'check' }),
    );
    const grid = await screen.findByRole('grid');
    const stops = grid.querySelectorAll('[tabindex="0"]');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAttribute('data-date', today());
    expect(stops[0]).toHaveAttribute('aria-current', 'date');

    await user.click(screen.getByLabelText('Show'));
    await user.tab();
    await expectFocus(() => cell(today()));
    await user.keyboard('{ArrowLeft}');
    await expectFocus(() => cell(addDays(today(), -7)));
    await user.keyboard('{ArrowUp}');
    await expectFocus(() => cell(addDays(today(), -8)));
    expect(grid.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    // The visible detail line follows focus.
    expect(
      screen.getByText(cell(addDays(today(), -8)).getAttribute('aria-label')!, { selector: 'p' }),
    ).toBeInTheDocument();
    await user.keyboard('{Home}');
    await expectFocus(() => grid.querySelector('[tabindex="0"]'));
    expect(grid.querySelector('[tabindex="0"]')).toBe(grid.querySelector('[role="gridcell"]'));
    await user.keyboard('{End}');
    await expectFocus(() => cell(today()));
    await user.keyboard('{ArrowRight}'); // no future days: focus stays
    await expectFocus(() => cell(today()));
  });

  it('has 7 weekday rows and about six months of squares', async () => {
    await setup((r) => r.habits.create({ name: 'Gym', category: 'fitness', unit: 'check' }));
    const rows = within(await screen.findByRole('grid')).getAllByRole('row');
    expect(rows).toHaveLength(7);
    const cells = within(screen.getByRole('grid')).getAllByRole('gridcell');
    expect(cells.length).toBeGreaterThan(25 * 7);
    expect(cells.length).toBeLessThanOrEqual(26 * 7);
  });
});

describe('Rhythm category groups', () => {
  it('shows a group grid while today’s logging still lists every active rhythm', async () => {
    const { user } = await setup(async ({ habits }) => {
      const coding = await habits.create({ name: 'Coding', category: 'coding', unit: 'check' });
      const study = await habits.create({
        name: 'Study session',
        category: 'learning',
        unit: 'check',
      });
      const gym = await habits.create({ name: 'Gym', category: 'fitness', unit: 'check' });
      await habits.create({ name: 'Side project', category: 'money', unit: 'check' });
      for (const h of [coding, study, gym]) await habits.setEntry(h.id, today(), 1);
    });
    const show = await screen.findByLabelText('Show');
    expect(within(show).getByRole('group', { name: 'Groups' })).toHaveTextContent(
      'Coding & learningFitness & health',
    );

    await user.selectOptions(show, 'group:coding-learning'); // by value: user-event compares innerHTML (&amp;)
    expect(
      screen.getByRole('grid', { name: 'Coding & learning, last six months' }),
    ).toBeInTheDocument();
    expect(cell(today())).toHaveAccessibleName(
      /Coding done, Study session done \(strong activity across 2 habits\)$/,
    );

    await user.selectOptions(show, 'group:fitness-health');
    expect(
      screen.getByRole('grid', { name: 'Fitness & health, last six months' }),
    ).toBeInTheDocument();
    expect(cell(today())).toHaveAccessibleName(/Gym done \(moderate activity across 1 habit\)$/);

    // The filter changes only the history grid.
    for (const name of ['Coding', 'Study session', 'Gym', 'Side project']) {
      expect(within(todayLog()).getByRole('button', { name })).toBeInTheDocument();
    }
    await user.click(within(todayLog()).getByRole('button', { name: 'Side project' }));
    await vi.waitFor(() =>
      expect(within(todayLog()).getByRole('button', { name: 'Side project' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    // Money isn't in Fitness & health, so the grid square is unchanged.
    expect(cell(today())).toHaveAccessibleName(/Gym done \(moderate activity across 1 habit\)$/);

    await user.selectOptions(show, 'All rhythms');
    expect(cell(today())).toHaveAccessibleName(/across 4 habits\)$/);
    await user.selectOptions(show, 'Gym');
    expect(cell(today())).toHaveAccessibleName(/: done \(high\)$/);
  });
});
