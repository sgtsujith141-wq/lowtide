import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { addDays } from '../lib/calendar';
import { deadlineFromLocalDate, toLocalDate } from '../lib/time';
import { setupTestDatabase, expectFocus } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();
const today = () => toLocalDate(new Date());
const inDays = (n: number) => toLocalDate(new Date(Date.now() + n * 86_400_000));

async function setup(
  seed?: (r: Repositories) => Promise<unknown>,
  override?: (r: Repositories) => Repositories,
) {
  const base = createDexieRepositories(newDb());
  await seed?.(base);
  const repositories = override ? override(base) : base;
  const rendered = await renderApp('/today', repositories);
  await screen.findByRole('heading', { name: 'Needs attention' });
  return { repositories, ...rendered };
}

const region = (name: string) => screen.getByRole('region', { name });

describe('Today page', () => {
  it('lives at /today (ADR-043): date, capture, and three calm sections', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, el) => el?.tagName === 'TIME' && el.getAttribute('datetime') === today(),
      ),
    ).toBeInTheDocument();
    await expectFocus(() => screen.getByRole('textbox', { name: 'What’s taking up space?' }));
    expect(
      within(region('Needs attention')).getByText('Nothing pressing today.'),
    ).toBeInTheDocument();
    expect(within(region('My plan')).getByText('Nothing else planned.')).toBeInTheDocument();
    expect(
      await within(region('Protected time')).findAllByText('Nothing planned here yet.'),
    ).toHaveLength(7);
  });

  it('shows overdue and due-today tasks under Needs attention, but not future ones', async () => {
    await setup(async ({ tasks }) => {
      await tasks.create({ title: 'Pay rent', dueAt: deadlineFromLocalDate(inDays(-2)) });
      await tasks.create({ title: 'Submit form', dueAt: deadlineFromLocalDate(today()) });
      await tasks.create({ title: 'Next week thing', dueAt: deadlineFromLocalDate(inDays(7)) });
    });
    const attention = region('Needs attention');
    expect(await within(attention).findByText('Pay rent')).toBeInTheDocument();
    expect(within(attention).getByText('Submit form')).toBeInTheDocument();
    expect(within(attention).getByText('Due today')).toBeInTheDocument();
    expect(screen.queryByText('Next week thing')).not.toBeInTheDocument();
  });

  it('plans a task from Tasks in two clicks, then takes it out of the plan without losing it', async () => {
    const { user, repositories } = await setup((r) =>
      r.tasks.create({ title: 'Read chapter 4', dueAt: deadlineFromLocalDate(inDays(3)) }),
    );
    expect(screen.queryByText('Read chapter 4')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add from Tasks' }));
    expect(screen.getByRole('button', { name: 'Add from Tasks' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await user.click(await screen.findByRole('button', { name: 'Plan for today: Read chapter 4' }));

    const plan = region('My plan');
    expect(await within(plan).findByText('Read chapter 4')).toBeInTheDocument();
    const [stored] = await repositories.tasks.listOpen();
    expect(stored?.plannedFor).toBe(today());
    expect(stored?.dueAt).toBe(deadlineFromLocalDate(inDays(3)));
    // Nothing left to offer: the picker says so.
    expect(await screen.findByText(/No other open tasks/)).toBeInTheDocument();

    await user.click(
      within(plan).getByRole('button', { name: 'Take out of today’s plan: Read chapter 4' }),
    );
    await vi.waitFor(() =>
      expect(
        within(plan).queryByRole('button', { name: 'Complete: Read chapter 4' }),
      ).not.toBeInTheDocument(),
    );
    // Back among the tasks you could plan, since the picker is still open.
    expect(
      await within(plan).findByRole('button', { name: 'Plan for today: Read chapter 4' }),
    ).toBeInTheDocument();
    await expectFocus(() => screen.getByRole('heading', { name: 'My plan' }));
    const [kept] = await repositories.tasks.listOpen();
    expect(kept).toMatchObject({ title: 'Read chapter 4', status: 'todo' });
    expect(kept).not.toHaveProperty('plannedFor');
  });

  it('closes the picker with Escape and returns focus to its button', async () => {
    const { user } = await setup((r) => r.tasks.create({ title: 'Someday' }));
    const toggle = screen.getByRole('button', { name: 'Add from Tasks' });
    await user.click(toggle);
    await screen.findByRole('button', { name: 'Plan for today: Someday' });
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('button', { name: 'Plan for today: Someday' }),
    ).not.toBeInTheDocument();
    await expectFocus(() => toggle);
  });

  it('shows a task due and planned today once, and keeps it there when unplanned', async () => {
    const { user, repositories } = await setup(async ({ tasks }) => {
      const t = await tasks.create({ title: 'Both', dueAt: deadlineFromLocalDate(today()) });
      await tasks.planFor(t.id, today());
    });
    const attention = region('Needs attention');
    await within(attention).findByText('Both');
    expect(screen.getAllByText('Both')).toHaveLength(1);
    expect(within(attention).getByText('In today’s plan')).toBeInTheDocument();

    await user.click(
      within(attention).getByRole('button', { name: 'Take out of today’s plan: Both' }),
    );
    await vi.waitFor(async () =>
      expect((await repositories.tasks.listOpen())[0]).not.toHaveProperty('plannedFor'),
    );
    expect(within(attention).getByText('Both')).toBeInTheDocument();
    expect(within(attention).queryByText('In today’s plan')).not.toBeInTheDocument();
  });

  it('completing a task removes it from Today and keeps it in Tasks history', async () => {
    const { user, repositories } = await setup(async ({ tasks }) => {
      const t = await tasks.create({ title: 'Planned thing' });
      await tasks.planFor(t.id, today());
    });
    await user.click(await screen.findByRole('button', { name: 'Complete: Planned thing' }));
    await vi.waitFor(() => expect(screen.queryByText('Planned thing')).not.toBeInTheDocument());
    const closed = await new Promise<{ status: string; plannedFor?: string }[]>((resolve) => {
      const stop = repositories.tasks.watchClosed((list) => {
        stop();
        resolve(list);
      });
    });
    expect(closed[0]).toMatchObject({ status: 'done', plannedFor: today() });
  });

  it('surfaces a failed plan change calmly', async () => {
    const { user } = await setup(
      async ({ tasks }) => {
        const t = await tasks.create({ title: 'Sticky' });
        await tasks.planFor(t.id, today());
      },
      (r) => ({
        ...r,
        tasks: { ...r.tasks, removeFromPlan: vi.fn().mockRejectedValue(new Error('x')) },
      }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Take out of today’s plan: Sticky' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t take that out of today’s plan',
    );
    expect(within(region('My plan')).getByText('Sticky')).toBeInTheDocument();
  });

  it('still captures thoughts from Today', async () => {
    const { user, repositories } = await setup();
    await user.type(
      screen.getByRole('textbox', { name: 'What’s taking up space?' }),
      'call Priya{Enter}',
    );
    expect(
      await screen.findByRole('link', { name: '1 thought waiting in your inbox' }),
    ).toBeInTheDocument();
    expect((await repositories.inbox.listUnprocessed())[0]?.content).toBe('call Priya');
  });
});

describe('Protected time this week on Today', () => {
  const week = () => screen.getByRole('list', { name: 'Protected time this week' });
  const dayRow = (heading: RegExp | string) =>
    within(week()).getByRole('listitem', { name: heading });

  it('shows exactly today and the next six days, calmly empty', async () => {
    await setup();
    const section = region('Protected time');
    await within(section).findByRole('list', { name: 'Protected time this week' });
    const headings = within(week()).getAllByRole('heading', { level: 3 });
    expect(headings).toHaveLength(7);
    expect(headings[0]).toHaveTextContent(/^Today/);
    expect(headings[1]).toHaveTextContent(/^Tomorrow/);
    expect(within(section).getAllByText('Nothing planned here yet.')).toHaveLength(7);
    // Every day has exactly one uniquely named add button.
    const addButtons = within(section).getAllByRole('button', { name: /^Add protected time for / });
    expect(new Set(addButtons.map((b) => b.getAttribute('aria-label'))).size).toBe(7);
    expect(
      within(section).getByRole('button', { name: 'Add protected time for today' }),
    ).toBeInTheDocument();
    expect(
      within(section).queryByText(/goal|target|streak|completed|missed|score|\d+\/\d+/i),
    ).not.toBeInTheDocument();
  });

  it('adds on a future day, edits, moves and removes by keyboard, with no completion controls', async () => {
    const { user, repositories } = await setup();
    const section = region('Protected time');
    const inThree = addDays(today(), 3);
    const threeDaysWord = within(
      await within(section).findByRole('list', { name: 'Protected time this week' }),
    )
      .getAllByRole('heading', { level: 3 })[3]!
      .textContent!.match(/^[A-Za-z]+/)![0];

    await user.click(
      within(section).getByRole('button', { name: `Add protected time for ${threeDaysWord}` }),
    );
    const form = within(section).getByRole('form', { name: `Protect time on ${threeDaysWord}` });
    expect(within(form).getByLabelText('Day')).toHaveValue(inThree);
    await expectFocus(() => within(form).getByLabelText('What’s it for?'));
    await user.keyboard('Dinner with friends');
    await user.selectOptions(within(form).getByLabelText('Kind'), 'friends');
    await user.type(within(form).getByLabelText('Note (optional)'), 'the usual place{Enter}');

    const edit = await within(section).findByRole('button', {
      name: `Edit Dinner with friends (${threeDaysWord})`,
    });
    await expectFocus(() => edit);
    expect(
      within(dayRow(new RegExp(`^${threeDaysWord}`))).getByText('Dinner with friends'),
    ).toBeInTheDocument();
    expect(within(section).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      within(section).queryByRole('button', { name: /complete|done/i }),
    ).not.toBeInTheDocument();

    // Edit and move it to tomorrow through the same form.
    await user.keyboard('{Enter}');
    const editor = within(section).getByRole('form', {
      name: 'Edit protected time: Dinner with friends',
    });
    await user.clear(within(editor).getByLabelText('What’s it for?'));
    await user.type(within(editor).getByLabelText('What’s it for?'), 'Movie night');
    await user.selectOptions(within(editor).getByLabelText('Day'), addDays(today(), 1));
    await user.click(within(editor).getByRole('button', { name: 'Save' }));
    const moved = await within(section).findByRole('button', {
      name: 'Edit Movie night (tomorrow)',
    });
    await expectFocus(() => moved);
    expect(within(dayRow(/^Tomorrow/)).getByText('Movie night')).toBeInTheDocument();
    const [stored] = await new Promise<
      { title: string; kind: string; date: string; notes?: string }[]
    >((resolve) => {
      const stop = repositories.protectedTime.watchRange(
        today(),
        addDays(today(), 6),
      )((l) => {
        stop();
        resolve(l);
      });
    });
    expect(stored).toMatchObject({
      title: 'Movie night',
      kind: 'friends',
      date: addDays(today(), 1),
      notes: 'the usual place',
    });

    await user.click(
      within(section).getByRole('button', { name: 'Remove Movie night (tomorrow)' }),
    );
    await vi.waitFor(() =>
      expect(
        within(dayRow(/^Tomorrow/)).getByText('Nothing planned here yet.'),
      ).toBeInTheDocument(),
    );
    await expectFocus(() =>
      within(section).getByRole('button', { name: 'Add protected time for tomorrow' }),
    );
  });

  it('requires a title and cancels with Escape, returning focus to that day', async () => {
    const { user } = await setup();
    const section = region('Protected time');
    await user.click(
      await within(section).findByRole('button', { name: 'Add protected time for today' }),
    );
    await user.click(within(section).getByRole('button', { name: 'Add' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('Give it a short title.');
    expect(within(section).getByLabelText('What’s it for?')).toHaveAccessibleDescription(
      'Give it a short title.',
    );
    await user.keyboard('{Escape}');
    expect(within(section).queryByRole('form')).not.toBeInTheDocument();
    await vi.waitFor(() =>
      expect(
        within(section).getByRole('button', { name: 'Add protected time for today' }),
      ).toHaveFocus(),
    );
  });

  it('shows entries across the week and nothing beyond it; each kind stays protected time', async () => {
    await setup(async ({ protectedTime }) => {
      await protectedTime.create({ title: 'Call home', date: today(), kind: 'family' });
      await protectedTime.create({
        title: 'Evening together',
        date: today(),
        kind: 'relationship',
      });
      await protectedTime.create({
        title: 'Lunch with friends',
        date: addDays(today(), 6),
        kind: 'friends',
      });
      await protectedTime.create({
        title: 'Too far ahead',
        date: addDays(today(), 7),
        kind: 'rest',
      });
      await protectedTime.create({ title: 'Yesterday', date: addDays(today(), -1), kind: 'rest' });
    });
    const section = region('Protected time');
    const todayRow = await waitForRow(/^Today/, 'Call home');
    expect(
      within(todayRow)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('p')?.textContent),
    ).toEqual(['Call home', 'Evening together']);
    expect(within(section).getByText('Lunch with friends')).toBeInTheDocument();
    expect(within(section).queryByText('Too far ahead')).not.toBeInTheDocument();
    expect(within(section).queryByText('Yesterday')).not.toBeInTheDocument();
    expect(within(section).getAllByText('Nothing planned here yet.')).toHaveLength(5);
  });

  it('keeps the form open with an error when saving fails', async () => {
    const { user } = await setup(undefined, (r) => ({
      ...r,
      protectedTime: { ...r.protectedTime, create: vi.fn().mockRejectedValue(new Error('x')) },
    }));
    const section = region('Protected time');
    await user.click(
      await within(section).findByRole('button', { name: 'Add protected time for today' }),
    );
    await user.type(within(section).getByLabelText('What’s it for?'), 'Nap{Enter}');
    expect(await within(section).findByRole('alert')).toHaveTextContent('Couldn’t save that');
    expect(within(section).getByLabelText('What’s it for?')).toHaveValue('Nap');
  });

  async function waitForRow(heading: RegExp, text: string) {
    await within(region('Protected time')).findByText(text);
    return dayRow(heading);
  }
});
