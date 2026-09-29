import { screen, within } from '@testing-library/react';
import { format } from 'date-fns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { formatFull } from '../lib/when';
import { setupTestDatabase, steppingClock, expectFocus } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

async function setup(thoughts: string[], override?: (r: Repositories) => Repositories) {
  const db = newDb();
  const base = createDexieRepositories(db, { clock: steppingClock() });
  for (const t of thoughts) await base.inbox.capture(t);
  const repositories = override ? override(base) : base;
  return { db, repositories, ...(await renderApp('/inbox', repositories)) };
}

const list = () => screen.getByRole('list', { name: 'Inbox items' });
const items = () => within(list()).getAllByRole('listitem');

describe('Inbox page', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists unprocessed thoughts oldest first with their capture time', async () => {
    // Pin "now" a few minutes after the stepping clock's captures, so the
    // relative label is the same-day clock time whatever the real date is.
    // Only Date is faked (and keeps ticking), so Dexie and waits run normally.
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-28T09:05:00.000Z'));
    await setup(['first thought', 'second\nwith detail']);
    await screen.findByText('first thought');
    expect(items().map((li) => li.querySelector('p')?.textContent)).toEqual([
      'first thought',
      'second\nwith detail',
    ]);
    const times = items().map((li) => li.querySelector('time'));
    const captured = ['2026-09-28T09:00:00.000Z', '2026-09-28T09:01:00.000Z'];
    times.forEach((time, i) => {
      const at = captured[i]!;
      expect(time).toHaveAttribute('datetime', at);
      // Local clock time, computed here so the test holds in any time zone.
      expect(time).toHaveTextContent(format(new Date(at), 'HH:mm'));
      expect(time).toHaveAttribute('title', formatFull(at));
    });
    expect(screen.getByText('2 to sort')).toBeInTheDocument();
  });

  it('turns a thought into a task: it leaves the inbox and appears in Tasks', async () => {
    const { user, repositories } = await setup(['Book the dentist\nafter 5pm', 'keep me']);
    const row = (await screen.findByText(/Book the dentist/)).closest('li')!;

    await user.click(within(row).getByRole('button', { name: /^Make task: / }));

    await vi.waitFor(() =>
      expect(within(list()).queryByText(/Book the dentist/)).not.toBeInTheDocument(),
    );
    expect(within(list()).getByText('keep me')).toBeInTheDocument();
    // Focus moves to the item that took its place.
    await expectFocus(() => within(items()[0]!).getByRole('button', { name: /^Make task: / }));
    const [task] = await repositories.tasks.listOpen();
    expect(task).toMatchObject({ title: 'Book the dentist', notes: 'after 5pm' });

    await user.click(screen.getByRole('link', { name: 'Tasks' }));
    expect(await screen.findByText('Book the dentist')).toBeInTheDocument();
    expect(screen.getByText('after 5pm')).toBeInTheDocument();
  });

  it('clears a thought that needs no action without making a task', async () => {
    const { user, db, repositories } = await setup(['just venting']);
    await user.click(await screen.findByRole('button', { name: /^Clear: / }));

    expect(await screen.findByText(/Nothing waiting/)).toBeInTheDocument();
    await expectFocus(() => screen.getByRole('heading', { level: 1, name: 'Inbox' }));
    expect(await repositories.tasks.listOpen()).toEqual([]);
    const [stored] = await db.inbox.toArray();
    expect(stored).toMatchObject({ content: 'just venting', processedAt: expect.any(String) });
  });

  it('names and describes each action button by the thought it acts on', async () => {
    await setup(['water the plants', 'call the bank\nabout the card']);
    const button = await screen.findByRole('button', { name: 'Make task: water the plants' });
    expect(button).toHaveAccessibleDescription('water the plants');
    expect(screen.getByRole('button', { name: 'Clear: call the bank' })).toBeInTheDocument();
  });

  it('surfaces a failed conversion calmly and keeps the item', async () => {
    const { user } = await setup(['fragile'], (r) => ({
      ...r,
      inbox: { ...r.inbox, convertToTask: vi.fn().mockRejectedValue(new Error('AbortError')) },
    }));
    await user.click(await screen.findByRole('button', { name: /^Make task: / }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t turn that into a task. Nothing changed',
    );
    expect(screen.getByText('fragile')).toBeInTheDocument();
  });

  it('surfaces a failed clear calmly and keeps the item', async () => {
    const { user } = await setup(['fragile'], (r) => ({
      ...r,
      inbox: { ...r.inbox, markProcessed: vi.fn().mockRejectedValue(new Error('x')) },
    }));
    await user.click(await screen.findByRole('button', { name: /^Clear: / }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t clear that item');
    expect(screen.getByText('fragile')).toBeInTheDocument();
  });

  it('shows a peaceful empty state', async () => {
    await setup([]);
    expect(await screen.findByText(/Nothing waiting/)).toBeInTheDocument();
  });
});
