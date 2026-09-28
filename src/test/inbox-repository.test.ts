import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, RecordStateError, RecordNotFoundError } from '../db/repositories';
import { recordWatch, setupTestDatabase, steppingClock } from './helpers';

const newDb = setupTestDatabase();

describe('InboxRepository (Dexie)', () => {
  it('captures trimmed content and rejects blank input', async () => {
    const { inbox } = createDexieRepositories(newDb(), { clock: steppingClock() });
    const item = await inbox.capture('  call mum  ');
    expect(item).toEqual({
      id: expect.any(String),
      content: 'call mum',
      createdAt: '2026-09-28T09:00:00.000Z',
    });
    await expect(inbox.capture(' \n ')).rejects.toThrow();
    expect(await inbox.countUnprocessed()).toBe(1);
  });

  it('converts an item into a task and marks it processed, atomically', async () => {
    const db = newDb();
    const { inbox, tasks } = createDexieRepositories(db, { clock: steppingClock() });
    const item = await inbox.capture('Book the dentist\nafter 5pm if possible');

    const task = await inbox.convertToTask(item.id);

    expect(task).toMatchObject({
      title: 'Book the dentist',
      notes: 'after 5pm if possible',
      status: 'todo',
    });
    expect(await tasks.get(task.id)).toEqual(task);
    expect(await db.inbox.get(item.id)).toMatchObject({
      processedAt: '2026-09-28T09:01:00.000Z',
      convertedToTaskId: task.id,
    });
    expect(await inbox.listUnprocessed()).toEqual([]);
  });

  it('refuses to convert the same item twice', async () => {
    const db = newDb();
    const { inbox } = createDexieRepositories(db);
    const item = await inbox.capture('once only');
    await inbox.convertToTask(item.id);
    await expect(inbox.convertToTask(item.id)).rejects.toBeInstanceOf(RecordStateError);
    expect(await db.tasks.count()).toBe(1);
  });

  it('rolls back the new task if marking the item processed fails', async () => {
    const db = newDb();
    const { inbox } = createDexieRepositories(db);
    const item = await inbox.capture('fragile');
    vi.spyOn(db.inbox, 'put').mockRejectedValueOnce(new Error('disk full'));

    await expect(inbox.convertToTask(item.id)).rejects.toThrow('disk full');

    expect(await db.tasks.count()).toBe(0);
    expect(await inbox.countUnprocessed()).toBe(1);
  });

  it('rejects converting a missing item', async () => {
    const { inbox } = createDexieRepositories(newDb());
    await expect(inbox.convertToTask(crypto.randomUUID())).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it('lists unprocessed items oldest first', async () => {
    const { inbox } = createDexieRepositories(newDb(), { clock: steppingClock() });
    const a = await inbox.capture('a');
    const b = await inbox.capture('b');
    const c = await inbox.capture('c');
    await inbox.convertToTask(b.id);
    expect((await inbox.listUnprocessed()).map((i) => i.id)).toEqual([a.id, c.id]);
  });
});

describe('InboxRepository processing without a task', () => {
  it('marks an item processed, keeps it, and creates no task', async () => {
    const db = newDb();
    const { inbox } = createDexieRepositories(db, { clock: steppingClock() });
    const item = await inbox.capture('just needed to write it down');

    const processed = await inbox.markProcessed(item.id);

    expect(processed).toEqual({ ...item, processedAt: '2026-09-28T09:01:00.000Z' });
    expect(await db.inbox.get(item.id)).toEqual(processed);
    expect(await inbox.listUnprocessed()).toEqual([]);
    expect(await db.tasks.count()).toBe(0);
  });

  it('refuses to process an item twice or a missing one', async () => {
    const { inbox } = createDexieRepositories(newDb());
    const item = await inbox.capture('once');
    await inbox.markProcessed(item.id);
    await expect(inbox.markProcessed(item.id)).rejects.toBeInstanceOf(RecordStateError);
    await expect(inbox.convertToTask(item.id)).rejects.toBeInstanceOf(RecordStateError);
    await expect(inbox.markProcessed(crypto.randomUUID())).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });
});

describe('InboxRepository subscriptions', () => {
  it('emits unprocessed items on capture, conversion and processing', async () => {
    const { inbox, tasks } = createDexieRepositories(newDb(), { clock: steppingClock() });
    const live = recordWatch(inbox.watchUnprocessed);
    const openTasks = recordWatch(tasks.watchOpen);
    await live.until((items) => items.length === 0);

    const a = await inbox.capture('first');
    const b = await inbox.capture('second');
    await live.until((items) => items.map((i) => i.id).join() === [a.id, b.id].join());

    await inbox.convertToTask(a.id);
    await live.until((items) => items.length === 1 && items[0]?.id === b.id);
    await openTasks.until((list) => list.length === 1 && list[0]?.title === 'first');

    await inbox.markProcessed(b.id);
    await live.until((items) => items.length === 0);
    live.stop();
    openTasks.stop();
  });
});
