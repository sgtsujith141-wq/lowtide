import { describe, expect, it } from 'vitest';
import { RecordNotFoundError } from '../db/repositories';
import { createDexieTaskRepository } from '../db/repositories/dexie-task-repository';
import { steppingClock, setupTestDatabase } from './helpers';

const newDb = setupTestDatabase();

describe('TaskRepository (Dexie)', () => {
  it('creates a todo task with defaults and omits unset optional fields', async () => {
    const tasks = createDexieTaskRepository({ db: newDb(), clock: steppingClock() });
    const task = await tasks.create({ title: '  Email the landlord  ' });

    expect(task).toEqual({
      id: expect.any(String),
      title: 'Email the landlord',
      status: 'todo',
      priority: 'normal',
      createdAt: '2026-09-28T09:00:00.000Z',
      updatedAt: '2026-09-28T09:00:00.000Z',
    });
    expect(Object.keys(task)).not.toContain('notes');
    expect(await tasks.get(task.id)).toEqual(task);
  });

  it('rejects an empty title without writing anything', async () => {
    const db = newDb();
    const tasks = createDexieTaskRepository({ db });
    await expect(tasks.create({ title: '   ' })).rejects.toThrow();
    expect(await db.tasks.count()).toBe(0);
  });

  it('completes a task and drops it from the open list', async () => {
    const tasks = createDexieTaskRepository({ db: newDb(), clock: steppingClock() });
    const a = await tasks.create({ title: 'A' });
    const b = await tasks.create({ title: 'B' });

    const done = await tasks.complete(a.id);
    expect(done).toMatchObject({ status: 'done', completedAt: '2026-09-28T09:02:00.000Z' });
    expect(done.updatedAt).toBe(done.completedAt);
    expect((await tasks.listOpen()).map((t) => t.id)).toEqual([b.id]);
  });

  it('lists open tasks oldest first', async () => {
    const tasks = createDexieTaskRepository({ db: newDb(), clock: steppingClock() });
    const first = await tasks.create({ title: 'first' });
    const second = await tasks.create({ title: 'second' });
    expect((await tasks.listOpen()).map((t) => t.id)).toEqual([first.id, second.id]);
  });

  it('rejects completing a missing task', async () => {
    const tasks = createDexieTaskRepository({ db: newDb() });
    await expect(tasks.complete(crypto.randomUUID())).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});
