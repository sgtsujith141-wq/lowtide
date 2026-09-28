import { describe, expect, it, vi } from 'vitest';
import { createDexieRepositories, RecordStateError, RecordNotFoundError } from '../db/repositories';
import { steppingClock, setupTestDatabase } from './helpers';

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
