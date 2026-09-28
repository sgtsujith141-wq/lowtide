import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, type Repositories } from '../db/repositories';
import { setupTestDatabase, steppingClock } from './helpers';
import { renderApp } from './render';

const newDb = setupTestDatabase();

async function setup(thoughts: string[], override?: (r: Repositories) => Repositories) {
  const db = newDb();
  const base = createDexieRepositories(db, { clock: steppingClock() });
  for (const t of thoughts) await base.inbox.capture(t);
  const repositories = override ? override(base) : base;
  return { db, repositories, ...renderApp('/inbox', repositories) };
}

const list = () => screen.getByRole('list', { name: 'Inbox items' });
const items = () => within(list()).getAllByRole('listitem');

describe('Inbox page', () => {
  it('lists unprocessed thoughts oldest first with their capture time', async () => {
    await setup(['first thought', 'second\nwith detail']);
    await screen.findByText('first thought');
    expect(items().map((li) => li.querySelector('p')?.textContent)).toEqual([
      'first thought',
      'second\nwith detail',
    ]);
    expect(within(items()[0]!).getByText(/\d/, { selector: 'time' })).toHaveAttribute(
      'datetime',
      '2026-09-28T09:00:00.000Z',
    );
    expect(screen.getByText('2 to sort')).toBeInTheDocument();
  });

  it('turns a thought into a task: it leaves the inbox and appears in Tasks', async () => {
    const { user, repositories } = await setup(['Book the dentist\nafter 5pm', 'keep me']);
    const row = (await screen.findByText(/Book the dentist/)).closest('li')!;

    await user.click(within(row).getByRole('button', { name: 'Make task' }));

    await vi.waitFor(() =>
      expect(within(list()).queryByText(/Book the dentist/)).not.toBeInTheDocument(),
    );
    expect(within(list()).getByText('keep me')).toBeInTheDocument();
    // Focus moves to the item that took its place.
    expect(within(items()[0]!).getByRole('button', { name: 'Make task' })).toHaveFocus();
    const [task] = await repositories.tasks.listOpen();
    expect(task).toMatchObject({ title: 'Book the dentist', notes: 'after 5pm' });

    await user.click(screen.getByRole('link', { name: 'Tasks' }));
    expect(await screen.findByText('Book the dentist')).toBeInTheDocument();
    expect(screen.getByText('after 5pm')).toBeInTheDocument();
  });

  it('clears a thought that needs no action without making a task', async () => {
    const { user, db, repositories } = await setup(['just venting']);
    await user.click(await screen.findByRole('button', { name: 'Clear' }));

    expect(await screen.findByText(/Nothing waiting/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toHaveFocus();
    expect(await repositories.tasks.listOpen()).toEqual([]);
    const [stored] = await db.inbox.toArray();
    expect(stored).toMatchObject({ content: 'just venting', processedAt: expect.any(String) });
  });

  it('describes each action button with the thought it acts on', async () => {
    await setup(['water the plants']);
    const button = await screen.findByRole('button', { name: 'Make task' });
    expect(button).toHaveAccessibleDescription('water the plants');
  });

  it('surfaces a failed conversion calmly and keeps the item', async () => {
    const { user } = await setup(['fragile'], (r) => ({
      ...r,
      inbox: { ...r.inbox, convertToTask: vi.fn().mockRejectedValue(new Error('AbortError')) },
    }));
    await user.click(await screen.findByRole('button', { name: 'Make task' }));
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
    await user.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t clear that item');
    expect(screen.getByText('fragile')).toBeInTheDocument();
  });

  it('shows a peaceful empty state', async () => {
    await setup([]);
    expect(await screen.findByText(/Nothing waiting/)).toBeInTheDocument();
  });
});
