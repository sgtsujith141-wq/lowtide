import { describe, expect, it } from 'vitest';
import { RecordNotFoundError, RecordStateError } from '../db/repositories';
import { asStore } from '../db/database';
import { createDexieTaskRepository } from '../db/repositories/dexie-task-repository';
import { recordWatch, setupTestDatabase, steppingClock } from './helpers';

const newDb = setupTestDatabase();

describe('TaskRepository (Dexie)', () => {
  it('creates a todo task with defaults and omits unset optional fields', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()), clock: steppingClock() });
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
    const tasks = createDexieTaskRepository({ db: asStore(db) });
    await expect(tasks.create({ title: '   ' })).rejects.toThrow();
    expect(await db.tasks.count()).toBe(0);
  });

  it('completes a task and drops it from the open list', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()), clock: steppingClock() });
    const a = await tasks.create({ title: 'A' });
    const b = await tasks.create({ title: 'B' });

    const done = await tasks.complete(a.id);
    expect(done).toMatchObject({ status: 'done', completedAt: '2026-09-28T09:02:00.000Z' });
    expect(done.updatedAt).toBe(done.completedAt);
    expect((await tasks.listOpen()).map((t) => t.id)).toEqual([b.id]);
  });

  it('lists open tasks oldest first', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()), clock: steppingClock() });
    const first = await tasks.create({ title: 'first' });
    const second = await tasks.create({ title: 'second' });
    expect((await tasks.listOpen()).map((t) => t.id)).toEqual([first.id, second.id]);
  });

  it('resolves get() to undefined for a missing task instead of throwing', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    await expect(tasks.get(crypto.randomUUID())).resolves.toBeUndefined();
  });

  it('rejects completing a missing task', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    await expect(tasks.complete(crypto.randomUUID())).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe('TaskRepository editing and lifecycle', () => {
  it('omits blank notes and project on create', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    const task = await tasks.create({ title: 'Call', notes: '  ', project: ' ' });
    expect(Object.keys(task)).not.toContain('notes');
    expect(Object.keys(task)).not.toContain('project');
  });

  it('updates content, trims it, and clears optionals with null or blank', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()), clock: steppingClock() });
    const task = await tasks.create({
      title: 'Draft',
      notes: 'old',
      project: 'Home',
      dueAt: '2026-10-01T06:30:00.000Z',
    });

    const edited = await tasks.update(task.id, {
      title: '  Final  ',
      priority: 'high',
      notes: '',
      project: null,
      dueAt: null,
    });

    expect(edited).toEqual({
      id: task.id,
      title: 'Final',
      status: 'todo',
      priority: 'high',
      createdAt: task.createdAt,
      updatedAt: '2026-09-28T09:01:00.000Z',
    });
    expect(await tasks.get(task.id)).toEqual(edited);
  });

  it('leaves omitted fields untouched on update', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    const task = await tasks.create({ title: 'Keep', notes: 'n', project: 'P' });
    const edited = await tasks.update(task.id, { priority: 'low' });
    expect(edited).toMatchObject({ title: 'Keep', notes: 'n', project: 'P', priority: 'low' });
  });

  it('rejects an update that blanks the title, keeping the stored task', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    const task = await tasks.create({ title: 'Keep me' });
    await expect(tasks.update(task.id, { title: '   ' })).rejects.toThrow();
    expect((await tasks.get(task.id))?.title).toBe('Keep me');
  });

  it('rejects updating a missing task', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    await expect(tasks.update(crypto.randomUUID(), { title: 'x' })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it('reopens a completed task and clears completedAt', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()), clock: steppingClock() });
    const task = await tasks.create({ title: 'Again' });
    await tasks.complete(task.id);
    const reopened = await tasks.reopen(task.id);
    expect(reopened.status).toBe('todo');
    expect(Object.keys(reopened)).not.toContain('completedAt');
  });

  it('drops a task without deleting it, and can reopen it', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    const task = await tasks.create({ title: 'Maybe not' });
    const dropped = await tasks.drop(task.id);
    expect(dropped.status).toBe('dropped');
    expect(Object.keys(dropped)).not.toContain('completedAt');
    expect(await tasks.get(task.id)).toEqual(dropped);
    expect(await tasks.listOpen()).toEqual([]);
    expect((await tasks.reopen(task.id)).status).toBe('todo');
  });

  it('refuses transitions that make no sense for the current status', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    const task = await tasks.create({ title: 'Once' });
    await expect(tasks.reopen(task.id)).rejects.toBeInstanceOf(RecordStateError);
    await tasks.drop(task.id);
    await expect(tasks.complete(task.id)).rejects.toBeInstanceOf(RecordStateError);
    await expect(tasks.drop(task.id)).rejects.toBeInstanceOf(RecordStateError);
  });

  it('rejects lifecycle changes on a missing task', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    const id = crypto.randomUUID();
    await expect(tasks.reopen(id)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(tasks.drop(id)).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe('TaskRepository subscriptions', () => {
  it('emits open tasks now and again after every change', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    const open = recordWatch(tasks.watchOpen);
    await open.until((list) => list.length === 0);

    const task = await tasks.create({ title: 'Watch me' });
    await open.until((list) => list.length === 1 && list[0]?.id === task.id);

    await tasks.update(task.id, { title: 'Watched' });
    await open.until((list) => list[0]?.title === 'Watched');

    await tasks.complete(task.id);
    await open.until((list) => list.length === 0);
    open.stop();
  });

  it('emits closed tasks, most recently changed first', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()), clock: steppingClock() });
    const a = await tasks.create({ title: 'a' });
    const b = await tasks.create({ title: 'b' });
    const closed = recordWatch(tasks.watchClosed);
    await tasks.complete(a.id);
    await tasks.drop(b.id);
    const list = await closed.until((l) => l.length === 2);
    expect(list.map((t) => [t.title, t.status])).toEqual([
      ['b', 'dropped'],
      ['a', 'done'],
    ]);
    closed.stop();
  });

  it('stops emitting after unsubscribe', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    const open = recordWatch(tasks.watchOpen);
    await open.until(() => true);
    open.stop();
    const seen = open.values.length;
    await tasks.create({ title: 'unseen' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(open.values.length).toBe(seen);
  });
});

describe('TaskRepository planning (plannedFor)', () => {
  it('plans and unplans without touching the deadline', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    const dueAt = '2026-10-02T12:00:00.000Z';
    const task = await tasks.create({ title: 'Essay', dueAt });

    const planned = await tasks.planFor(task.id, '2026-09-29');
    expect(planned).toMatchObject({ plannedFor: '2026-09-29', dueAt });

    const unplanned = await tasks.removeFromPlan(task.id);
    expect(unplanned).not.toHaveProperty('plannedFor');
    expect(unplanned.dueAt).toBe(dueAt);
  });

  it('keeps plannedFor when the deadline is edited or cleared', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    const task = await tasks.create({ title: 'x' });
    await tasks.planFor(task.id, '2026-09-29');
    expect((await tasks.update(task.id, { dueAt: '2026-11-01T12:00:00.000Z' })).plannedFor).toBe(
      '2026-09-29',
    );
    expect((await tasks.update(task.id, { dueAt: null })).plannedFor).toBe('2026-09-29');
  });

  it('rejects an invalid date, closed tasks and missing tasks', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    const task = await tasks.create({ title: 'x' });
    await expect(tasks.planFor(task.id, '2026-02-30')).rejects.toThrow();
    await tasks.complete(task.id);
    await expect(tasks.planFor(task.id, '2026-09-29')).rejects.toBeInstanceOf(RecordStateError);
    await expect(tasks.planFor(crypto.randomUUID(), '2026-09-29')).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    await expect(tasks.removeFromPlan(crypto.randomUUID())).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it('keeps plannedFor through complete and reopen, without inventing one', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    const planned = await tasks.create({ title: 'planned' });
    await tasks.planFor(planned.id, '2026-09-28');
    expect((await tasks.complete(planned.id)).plannedFor).toBe('2026-09-28');
    expect((await tasks.reopen(planned.id)).plannedFor).toBe('2026-09-28');

    const unplanned = await tasks.create({ title: 'never planned' });
    await tasks.drop(unplanned.id);
    expect(await tasks.reopen(unplanned.id)).not.toHaveProperty('plannedFor');
  });

  it('watchForDay returns open tasks planned that day or due on/before it, once each', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    const day = '2026-09-28';
    const overdue = await tasks.create({ title: 'overdue', dueAt: '2026-09-20T12:00:00.000Z' });
    const dueToday = await tasks.create({ title: 'due today', dueAt: `${day}T12:00:00.000Z` });
    const both = await tasks.create({ title: 'both', dueAt: `${day}T12:00:00.000Z` });
    await tasks.planFor(both.id, day);
    const planned = await tasks.create({ title: 'planned', dueAt: '2026-10-09T12:00:00.000Z' });
    await tasks.planFor(planned.id, day);
    await tasks.create({ title: 'due later', dueAt: '2026-09-29T12:00:00.000Z' });
    const otherDay = await tasks.create({ title: 'planned tomorrow' });
    await tasks.planFor(otherDay.id, '2026-09-29');
    await tasks.create({ title: 'nothing' });
    const done = await tasks.create({ title: 'done', dueAt: `${day}T12:00:00.000Z` });
    await tasks.complete(done.id);

    const live = recordWatch(tasks.watchForDay(day));
    const list = await live.until((l) => l.length > 0);
    expect(list.map((t) => t.title).sort()).toEqual(
      [overdue, dueToday, both, planned].map((t) => t.title).sort(),
    );
    live.stop();
  });

  it('watchForDay reacts to planning, unplanning and completing', async () => {
    const tasks = createDexieTaskRepository({ db: asStore(newDb()) });
    const day = '2026-09-28';
    const task = await tasks.create({ title: 'watch me' });
    const live = recordWatch(tasks.watchForDay(day));
    await live.until((l) => l.length === 0);

    await tasks.planFor(task.id, day);
    await live.until((l) => l.length === 1);
    await tasks.removeFromPlan(task.id);
    await live.until((l) => l.length === 0);
    await tasks.planFor(task.id, day);
    await live.until((l) => l.length === 1);
    await tasks.complete(task.id);
    await live.until((l) => l.length === 0);
    live.stop();
  });
});
