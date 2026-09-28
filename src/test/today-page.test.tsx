import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { deadlineFromLocalDate, toLocalDate } from '../lib/time';
import { setupTestDatabase } from './helpers';
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
  const rendered = await renderApp('/', repositories);
  await screen.findByRole('heading', { name: 'Needs attention' });
  return { repositories, ...rendered };
}

const region = (name: string) => screen.getByRole('region', { name });

describe('Today page', () => {
  it('is the home route: date, capture, and three calm sections', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, el) => el?.tagName === 'TIME' && el.getAttribute('datetime') === today(),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'What’s taking up space?' })).toHaveFocus();
    expect(
      within(region('Needs attention')).getByText('Nothing pressing today.'),
    ).toBeInTheDocument();
    expect(within(region('My plan')).getByText('Nothing else planned.')).toBeInTheDocument();
    expect(
      await within(region('Protected time')).findByText('Nothing protected yet.'),
    ).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: 'My plan' })).toHaveFocus();
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
    expect(toggle).toHaveFocus();
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

describe('Protected time on Today', () => {
  it('adds, edits and removes an entry with the keyboard, with no completion controls', async () => {
    const { user, repositories } = await setup();
    const section = region('Protected time');

    await user.click(within(section).getByRole('button', { name: 'Protect time' }));
    const form = within(section).getByRole('form', { name: 'Protect time' });
    expect(within(form).getByLabelText('What’s it for?')).toHaveFocus();
    await user.keyboard('Dinner together');
    await user.selectOptions(within(form).getByLabelText('Kind'), 'relationship');
    await user.type(within(form).getByLabelText('Note (optional)'), 'no phones{Enter}');

    const list = await within(section).findByRole('list', { name: 'Protected time today' });
    expect(within(list).getByText('Dinner together')).toBeInTheDocument();
    expect(within(list).getByText(/Relationship/)).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Edit: Dinner together' })).toHaveFocus();
    // Protected time is not a task: nothing to tick off, nothing counted.
    expect(within(section).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      within(section).queryByRole('button', { name: /complete|done/i }),
    ).not.toBeInTheDocument();
    expect(within(section).queryByText(/goal|streak|target|completed/i)).not.toBeInTheDocument();

    await user.keyboard('{Enter}'); // opens the editor from the focused Edit button
    const editor = within(section).getByRole('form', {
      name: 'Edit protected time: Dinner together',
    });
    await user.clear(within(editor).getByLabelText('What’s it for?'));
    await user.type(within(editor).getByLabelText('What’s it for?'), 'Movie night');
    await user.selectOptions(within(editor).getByLabelText('Kind'), 'friends');
    await user.click(within(editor).getByRole('button', { name: 'Save' }));
    expect(await within(section).findByText('Movie night')).toBeInTheDocument();
    const [entry] = await new Promise<{ title: string; kind: string; date: string }[]>(
      (resolve) => {
        const stop = repositories.protectedTime.watchForDate(today())((l) => {
          stop();
          resolve(l);
        });
      },
    );
    expect(entry).toMatchObject({
      title: 'Movie night',
      kind: 'friends',
      date: today(),
      notes: 'no phones',
    });

    await user.click(within(section).getByRole('button', { name: 'Remove: Movie night' }));
    expect(await within(section).findByText('Nothing protected yet.')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Protect time' })).toHaveFocus();
  });

  it('requires a title and cancels with Escape', async () => {
    const { user } = await setup();
    const section = region('Protected time');
    await user.click(within(section).getByRole('button', { name: 'Protect time' }));
    await user.click(within(section).getByRole('button', { name: 'Add' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('Give it a short title.');
    expect(within(section).getByLabelText('What’s it for?')).toHaveAccessibleDescription(
      'Give it a short title.',
    );
    await user.keyboard('{Escape}');
    expect(within(section).queryByRole('form')).not.toBeInTheDocument();
  });

  it('shows only today’s entries', async () => {
    await setup(async ({ protectedTime }) => {
      await protectedTime.create({ title: 'Call home', date: today(), kind: 'family' });
      await protectedTime.create({ title: 'Tomorrow’s walk', date: inDays(1), kind: 'rest' });
    });
    const section = region('Protected time');
    expect(await within(section).findByText('Call home')).toBeInTheDocument();
    expect(within(section).queryByText('Tomorrow’s walk')).not.toBeInTheDocument();
  });

  it('keeps the form open with an error when saving fails', async () => {
    const { user } = await setup(undefined, (r) => ({
      ...r,
      protectedTime: { ...r.protectedTime, create: vi.fn().mockRejectedValue(new Error('x')) },
    }));
    const section = region('Protected time');
    await user.click(within(section).getByRole('button', { name: 'Protect time' }));
    await user.type(within(section).getByLabelText('What’s it for?'), 'Nap{Enter}');
    expect(await within(section).findByRole('alert')).toHaveTextContent('Couldn’t save that');
    expect(within(section).getByLabelText('What’s it for?')).toHaveValue('Nap');
  });
});
