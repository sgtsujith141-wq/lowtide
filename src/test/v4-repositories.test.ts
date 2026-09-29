import { describe, expect, it } from 'vitest';
import {
  createDexieRepositories,
  InvalidInputError,
  RecordNotFoundError,
  RecordStateError,
} from '../db/repositories';
import { slugify } from '../db/repositories/dexie-project-repository';
import { recordWatch, setupTestDatabase, steppingClock } from './helpers';

const newDb = setupTestDatabase();

function setup(start?: string) {
  const db = newDb();
  return { db, r: createDexieRepositories(db, { clock: steppingClock(start) }) };
}

describe('projects', () => {
  it('creates with a unique slug, a created event and a first snapshot', async () => {
    const { db, r } = setup();
    const a = await r.projects.create({ name: '  LOWTIDE v2 — Home!  ', objective: 'Ship v2' });
    const b = await r.projects.create({ name: 'lowtide v2 home' });
    expect(a).toMatchObject({
      name: 'LOWTIDE v2 — Home!',
      slug: 'lowtide-v2-home',
      state: 'planning',
    });
    expect(b.slug).toBe('lowtide-v2-home-2');
    expect(slugify('***')).toBe('project');
    const events = await db.events.where('projectId').equals(a.id).toArray();
    expect(events.map((e) => [e.type, e.data])).toEqual([
      ['project.updated', { change: 'created', to: 'planning' }],
    ]);
    expect(await db.progressSnapshots.where('projectId').equals(a.id).count()).toBe(1);
  });

  it('tracks weighted milestones in the day’s snapshot and emits milestone.completed', async () => {
    const { db, r } = setup();
    const p = await r.projects.create({ name: 'Engine' });
    const scope = await r.projects.addMilestone(p.id, { title: 'Scope' });
    await r.projects.addMilestone(p.id, { title: 'Build', weight: 3 });
    expect(scope).toMatchObject({ order: 0, weight: 1 });
    await r.projects.completeMilestone(scope.id);
    const [snapshot] = await db.progressSnapshots.where('projectId').equals(p.id).toArray();
    expect(snapshot).toMatchObject({
      completedWeight: 1,
      totalWeight: 4,
      milestoneCount: 2,
      completedCount: 1,
    });
    const types = (await db.events.where('projectId').equals(p.id).toArray()).map((e) => e.type);
    expect(types).toContain('milestone.completed');
  });

  it('keeps past snapshots when a later day adds a milestone', async () => {
    const db = newDb();
    let now = new Date('2026-09-20T09:00:00.000Z');
    const r = createDexieRepositories(db, { clock: () => now });
    const p = await r.projects.create({ name: 'History' });
    const m = await r.projects.addMilestone(p.id, { title: 'One' });
    await r.projects.completeMilestone(m.id);
    now = new Date('2026-09-22T09:00:00.000Z');
    await r.projects.addMilestone(p.id, { title: 'Two' });
    const snaps = await db.progressSnapshots.where('projectId').equals(p.id).sortBy('localDate');
    expect(snaps.map((s) => [s.completedWeight, s.totalWeight])).toEqual([
      [1, 1],
      [1, 2],
    ]);
  });

  it('refuses done with open milestones unless a decision of the project overrides', async () => {
    const { r } = setup();
    const p = await r.projects.create({ name: 'Almost' });
    await r.projects.addMilestone(p.id, { title: 'Last bit' });
    await expect(r.projects.setState(p.id, 'done')).rejects.toBeInstanceOf(RecordStateError);
    const other = await r.projects.create({ name: 'Other' });
    const foreign = await r.projects.recordDecision(other.id, { title: 'x', decision: 'y' });
    await expect(
      r.projects.setState(p.id, 'done', { overrideDecisionId: foreign.id }),
    ).rejects.toBeInstanceOf(RecordStateError);
    const why = await r.projects.recordDecision(p.id, {
      title: 'Ship without the last bit',
      decision: 'It moved to v3',
    });
    await expect(
      r.projects.setState(p.id, 'done', { overrideDecisionId: why.id }),
    ).resolves.toMatchObject({
      state: 'done',
    });
  });

  it('only leaves archived for parked, and records state changes', async () => {
    const { db, r } = setup();
    const p = await r.projects.create({ name: 'Old' });
    await r.projects.setState(p.id, 'archived');
    await expect(r.projects.setState(p.id, 'active')).rejects.toBeInstanceOf(InvalidInputError);
    await r.projects.setState(p.id, 'parked');
    const changes = (await db.events.where('projectId').equals(p.id).sortBy('at'))
      .filter((e) => e.data.change === 'state')
      .map((e) => `${e.data.from}→${e.data.to}`);
    expect(changes).toEqual(['planning→archived', 'archived→parked']);
  });

  it('refuses to remove a milestone a task still uses', async () => {
    const { r } = setup();
    const p = await r.projects.create({ name: 'Linked' });
    const m = await r.projects.addMilestone(p.id, { title: 'M' });
    const t = await r.tasks.create({ title: 'T', projectId: p.id, milestoneId: m.id });
    await expect(r.projects.removeMilestone(m.id)).rejects.toBeInstanceOf(RecordStateError);
    await r.tasks.update(t.id, { milestoneId: null });
    await r.projects.removeMilestone(m.id);
    expect(await r.projects.get(p.id)).toBeDefined();
  });

  it('reorders milestones by swapping with a neighbour', async () => {
    const { r } = setup();
    const p = await r.projects.create({ name: 'Order' });
    const a = await r.projects.addMilestone(p.id, { title: 'A' });
    await r.projects.addMilestone(p.id, { title: 'B' });
    await r.projects.moveMilestone(a.id, 1);
    const watch = recordWatch(r.projects.watchMilestones(p.id));
    const list = await watch.until((v) => v.length === 2);
    expect(list.map((m) => m.title)).toEqual(['B', 'A']);
    watch.stop();
  });
});

describe('project items and lanes', () => {
  it('places items by kind and emits approval/parked events', async () => {
    const { db, r } = setup();
    const p = await r.projects.create({ name: 'Lanes' });
    const approval = await r.projects.addItem(p.id, { kind: 'approval', title: 'Sign off copy' });
    const blocker = await r.projects.addItem(p.id, { kind: 'blocker', title: 'API key' });
    const idea = await r.projects.addItem(p.id, { kind: 'idea', title: 'Dark grid' });
    const wait = await r.projects.addItem(p.id, {
      kind: 'dependency',
      title: 'Design review',
      waitingOn: 'Asha',
    });
    expect([approval.lane, blocker.lane, idea.lane, wait.lane]).toEqual([
      'needs_approval',
      'blocked',
      'parked',
      'waiting',
    ]);
    expect(wait.waitingOn).toBe('Asha');
    const types = (await db.events.where('projectId').equals(p.id).toArray()).map((e) => e.type);
    expect(types).toContain('project.approval_requested');
    expect(types).toContain('project.item_parked');
  });

  it('keeps open approvals and blockers in their lane until resolved', async () => {
    const { r } = setup();
    const p = await r.projects.create({ name: 'Rules' });
    const blocker = await r.projects.addItem(p.id, { kind: 'blocker', title: 'Stuck' });
    await expect(r.projects.moveItem(blocker.id, 'next')).rejects.toBeInstanceOf(InvalidInputError);
    const resolved = await r.projects.resolveItem(blocker.id);
    expect(resolved).toMatchObject({ lane: 'done' });
    expect(resolved.resolvedAt).toBeDefined();
    await expect(r.projects.moveItem(blocker.id, 'next')).rejects.toBeInstanceOf(RecordStateError);
    const reopened = await r.projects.reopenItem(blocker.id);
    expect(reopened.lane).toBe('blocked');
    expect(reopened).not.toHaveProperty('resolvedAt');
  });

  it('moves a step to waiting with what it waits on, and drops it when leaving', async () => {
    const { r } = setup();
    const p = await r.projects.create({ name: 'Flow' });
    const step = await r.projects.addItem(p.id, { kind: 'step', title: 'Deploy' });
    const waiting = await r.projects.moveItem(step.id, 'waiting', 'CI quota');
    expect(waiting).toMatchObject({ lane: 'waiting', waitingOn: 'CI quota' });
    const back = await r.projects.moveItem(step.id, 'working_now');
    expect(back).not.toHaveProperty('waitingOn');
  });

  it('links an item only to a task and milestone of the same project', async () => {
    const { r } = setup();
    const p = await r.projects.create({ name: 'Mine' });
    const q = await r.projects.create({ name: 'Theirs' });
    const theirTask = await r.tasks.create({ title: 'Theirs', projectId: q.id });
    await expect(
      r.projects.addItem(p.id, { kind: 'blocker', title: 'x', taskId: theirTask.id }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    const myTask = await r.tasks.create({ title: 'Mine', projectId: p.id });
    await expect(
      r.projects.addItem(p.id, { kind: 'blocker', title: 'x', taskId: myTask.id }),
    ).resolves.toMatchObject({ taskId: myTask.id });
  });
});

describe('decisions', () => {
  it('records immutable decisions that can supersede one of the same project', async () => {
    const { db, r } = setup();
    const p = await r.projects.create({ name: 'Choices' });
    const first = await r.projects.recordDecision(p.id, { title: 'DB', decision: 'IndexedDB' });
    const second = await r.projects.recordDecision(p.id, {
      title: 'DB',
      decision: 'SQLite via companion',
      supersedesId: first.id,
    });
    expect(second).toMatchObject({ origin: 'owner', supersedesId: first.id });
    const other = await r.projects.create({ name: 'Elsewhere' });
    await expect(
      r.projects.recordDecision(other.id, { title: 'x', decision: 'y', supersedesId: first.id }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect((await db.events.where('type').equals('decision.recorded').toArray()).length).toBe(2);
  });
});

describe('task and hackathon links', () => {
  it('validates project and milestone links, and clears the milestone when the project changes', async () => {
    const { r } = setup();
    const p = await r.projects.create({ name: 'P' });
    const q = await r.projects.create({ name: 'Q' });
    const m = await r.projects.addMilestone(p.id, { title: 'M' });
    await expect(
      r.tasks.create({ title: 'x', projectId: q.id, milestoneId: m.id }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    await expect(
      r.tasks.create({ title: 'x', projectId: 'aaaaaaaa-0000-4000-8000-000000000000' }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    const t = await r.tasks.create({ title: 'x', projectId: p.id, milestoneId: m.id });
    const moved = await r.tasks.update(t.id, { projectId: q.id });
    expect(moved).toMatchObject({ projectId: q.id });
    expect(moved).not.toHaveProperty('milestoneId');
  });

  it('emits task.completed with the project when a task is completed', async () => {
    const { db, r } = setup();
    const p = await r.projects.create({ name: 'P' });
    const t = await r.tasks.create({ title: 'x', projectId: p.id });
    await r.tasks.complete(t.id);
    const [event] = await db.events.where('type').equals('task.completed').toArray();
    expect(event).toMatchObject({ entityType: 'task', entityId: t.id, projectId: p.id });
  });

  it('links a hackathon to a project only when asked, and unlinks with null', async () => {
    const { r } = setup();
    const h = await r.hackathons.create({ name: 'Hack' });
    expect(h).not.toHaveProperty('projectId');
    const p = await r.projects.create({ name: 'Hack build' });
    expect((await r.hackathons.update(h.id, { projectId: p.id })).projectId).toBe(p.id);
    expect(await r.hackathons.update(h.id, { projectId: null })).not.toHaveProperty('projectId');
  });
});

describe('work sessions', () => {
  it('starts, pauses, resumes and finishes, one at a time, with events', async () => {
    const { db, r } = setup();
    const s = await r.work.start({ kind: 'general', intent: ' Inbox zero ' });
    expect(s).toMatchObject({ kind: 'general', intent: 'Inbox zero', pauses: [] });
    await expect(r.work.start({ kind: 'general' })).rejects.toBeInstanceOf(RecordStateError);
    await r.work.pause(s.id);
    await expect(r.work.pause(s.id)).rejects.toBeInstanceOf(RecordStateError);
    await r.work.resume(s.id);
    const done = await r.work.finish(s.id, 'cleared it');
    expect(done.pauses).toHaveLength(1);
    expect(done.pauses[0]!.resumedAt).toBeDefined();
    expect(done).toMatchObject({ outcome: 'cleared it' });
    expect(done.endedAt).toBeDefined();
    const types = (await db.events.orderBy('at').toArray()).map((e) => e.type);
    expect(types).toEqual(['work.started', 'work.paused', 'work.resumed', 'work.finished']);
    await expect(r.work.pause(s.id)).rejects.toBeInstanceOf(RecordStateError);
  });

  it('closes an open pause when finishing while paused', async () => {
    const { r } = setup();
    const s = await r.work.start({ kind: 'college' });
    await r.work.pause(s.id);
    const done = await r.work.finish(s.id);
    expect(done.pauses[0]!.resumedAt).toBe(done.endedAt);
  });

  it('takes the task’s project and rejects a mismatch', async () => {
    const { r } = setup();
    const p = await r.projects.create({ name: 'P' });
    const q = await r.projects.create({ name: 'Q' });
    const t = await r.tasks.create({ title: 'x', projectId: p.id });
    await expect(
      r.work.start({ kind: 'task', taskId: t.id, projectId: q.id }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    const s = await r.work.start({ kind: 'task', taskId: t.id });
    expect(s.projectId).toBe(p.id);
  });

  it('requires a project for project work and a task for task work', async () => {
    const { r } = setup();
    await expect(r.work.start({ kind: 'project' })).rejects.toBeInstanceOf(InvalidInputError);
    await expect(r.work.start({ kind: 'task' })).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('survives a reload: the open session is read back from storage', async () => {
    const { db, r } = setup();
    const s = await r.work.start({ kind: 'general' });
    const again = createDexieRepositories(db);
    const watch = recordWatch(again.work.watchActive);
    expect((await watch.until((v) => v !== undefined))?.id).toBe(s.id);
    watch.stop();
  });

  it('discards a mistaken session with its events', async () => {
    const { db, r } = setup();
    const s = await r.work.start({ kind: 'general' });
    await r.work.discard(s.id);
    expect(await db.workSessions.count()).toBe(0);
    expect(await db.events.count()).toBe(0);
  });
});

describe('off time', () => {
  it('won’t start while work is running, and work won’t start during off time', async () => {
    const { r } = setup();
    const work = await r.work.start({ kind: 'general' });
    await expect(r.offTime.start('sleep')).rejects.toBeInstanceOf(RecordStateError);
    await r.work.finish(work.id);
    const sleep = await r.offTime.start('sleep');
    await expect(r.work.start({ kind: 'general' })).rejects.toBeInstanceOf(RecordStateError);
    await expect(r.offTime.start('rest')).rejects.toBeInstanceOf(RecordStateError);
    const ended = await r.offTime.end(sleep.id);
    expect(ended.endedAt! >= ended.startedAt!).toBe(true);
  });

  it('records sleep windows as private events and days off without events', async () => {
    const { db, r } = setup();
    const s = await r.offTime.start('sleep');
    await r.offTime.end(s.id);
    await r.offTime.declareDayOff('2026-10-03', 'nothing planned');
    await r.offTime.declareDayOff('2026-10-03', 'still nothing');
    const offTime = await db.offTimeSessions.toArray();
    expect(offTime.filter((o) => o.kind === 'day_off')).toHaveLength(1);
    expect((await db.events.orderBy('at').toArray()).map((e) => e.type)).toEqual([
      'offtime.started',
      'offtime.ended',
    ]);
    const publicWatch = recordWatch(r.events.watchRecent());
    expect(await publicWatch.until(() => true)).toEqual([]);
    publicWatch.stop();
    await r.offTime.removeDayOff('2026-10-03');
    expect(await db.offTimeSessions.count()).toBe(1);
  });
});

describe('events and AI sessions', () => {
  it('hides private events unless asked, and filters by project', async () => {
    const { r } = setup();
    const habit = await r.habits.create({ name: 'Read', category: 'personal', unit: 'check' });
    await r.habits.setEntry(habit.id, '2026-09-28', 1);
    const p = await r.projects.create({ name: 'P' });
    const all = recordWatch(r.events.watchRecent({ includePrivate: true }));
    expect((await all.until((v) => v.length === 2)).map((e) => e.type)).toEqual([
      'project.updated',
      'habit.logged',
    ]);
    all.stop();
    const mine = recordWatch(r.events.watchRecent({ projectId: p.id }));
    expect((await mine.until((v) => v.length === 1))[0]!.type).toBe('project.updated');
    mine.stop();
  });

  it('removes a habit entry’s events when the entry is cleared', async () => {
    const { db, r } = setup();
    const habit = await r.habits.create({ name: 'Read', category: 'personal', unit: 'check' });
    await r.habits.setEntry(habit.id, '2026-09-28', 1);
    await r.habits.clearEntry(habit.id, '2026-09-28');
    expect(await db.events.count()).toBe(0);
  });

  it('records a reported AI session with an ai-client event, never by itself', async () => {
    const { db, r } = setup();
    const p = await r.projects.create({ name: 'P' });
    await expect(
      r.aiSessions.record({
        client: 'claude-code',
        scope: 'project',
        startedAt: '2026-09-28T09:00:00.000Z',
        endedAt: '2026-09-28T10:00:00.000Z',
        summary: 'x',
      }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    const s = await r.aiSessions.record({
      client: 'claude-code',
      scope: 'project',
      projectId: p.id,
      startedAt: '2026-09-28T09:00:00.000Z',
      endedAt: '2026-09-28T10:00:00.000Z',
      summary: 'Refactored the grid',
    });
    const event = await db.events.where('type').equals('ai.session.completed').first();
    expect(event).toMatchObject({ entityId: s.id, source: 'ai-client', projectId: p.id });
  });
});

describe('activity sources', () => {
  it('collects the day’s real records and nothing from protected time or inbox', async () => {
    const { r } = setup('2026-09-28T09:00:00.000Z');
    await r.protectedTime.create({ title: 'Dinner', date: '2026-09-28', kind: 'relationship' });
    await r.inbox.capture('a thought');
    const habit = await r.habits.create({ name: 'Read', category: 'personal', unit: 'check' });
    await r.habits.setEntry(habit.id, '2026-09-28', 1);
    const t = await r.tasks.create({ title: 'x' });
    await r.tasks.complete(t.id);
    const w = await r.work.start({ kind: 'general' });
    await r.work.finish(w.id);
    const watch = recordWatch(r.activity.watchSources('2026-09-28', '2026-09-28'));
    const sources = await watch.until((v) => v.workSessions.length === 1);
    expect(sources.habitEntries).toHaveLength(1);
    expect(sources.completedTasks).toHaveLength(1);
    expect(Object.keys(sources).sort()).toEqual(
      [
        'collegeDone',
        'completedTasks',
        'decisions',
        'habitEntries',
        'habits',
        'milestones',
        'offTimeSessions',
        'resolvedItems',
        'workSessions',
      ].sort(),
    );
    watch.stop();
  });
});
