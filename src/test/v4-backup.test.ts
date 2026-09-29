import { describe, expect, it } from 'vitest';
import { STORE_NAMES } from '../db/migrations';
import {
  createDexieRepositories,
  type BackupDocument,
  type Repositories,
  type ValidatedBackup,
} from '../db/repositories';
import { setupTestDatabase, steppingClock } from './helpers';

const newDb = setupTestDatabase();

/** Every V4 store populated through the real repositories. */
async function seedV4(r: Repositories) {
  const p = await r.projects.create({ name: 'Engine', objective: 'Run the city', phase: 'Build' });
  const m1 = await r.projects.addMilestone(p.id, { title: 'Scope' });
  await r.projects.addMilestone(p.id, { title: 'Ship', weight: 2, dueOn: '2026-10-20' });
  await r.projects.completeMilestone(m1.id);
  const t = await r.tasks.create({ title: 'Wire it', projectId: p.id, milestoneId: m1.id });
  await r.projects.addItem(p.id, { kind: 'blocker', title: 'Key', taskId: t.id });
  await r.projects.addItem(p.id, { kind: 'approval', title: 'Sign off' });
  const idea = await r.projects.addItem(p.id, { kind: 'idea', title: 'Later' });
  await r.projects.resolveItem(idea.id);
  const d = await r.projects.recordDecision(p.id, { title: 'DB', decision: 'IndexedDB' });
  await r.projects.recordDecision(p.id, { title: 'DB', decision: 'SQLite', supersedesId: d.id });
  const w = await r.work.start({ kind: 'task', taskId: t.id });
  await r.work.pause(w.id);
  await r.work.resume(w.id);
  await r.work.finish(w.id, 'wired');
  const s = await r.offTime.start('sleep');
  await r.offTime.end(s.id);
  await r.offTime.declareDayOff('2026-10-04');
  await r.aiSessions.record({
    client: 'claude-code',
    scope: 'project',
    projectId: p.id,
    startedAt: '2026-09-28T09:00:00.000Z',
    endedAt: '2026-09-28T09:30:00.000Z',
    summary: 'Reviewed',
  });
  const h = await r.hackathons.create({ name: 'Hack' });
  await r.hackathons.update(h.id, { projectId: p.id });
  await r.protectedTime.create({ title: 'Walk', date: '2026-09-29', kind: 'rest' });
  await r.tasks.complete(t.id);
  await r.college.create({ kind: 'class', title: 'DBMS', date: '2026-09-28', status: 'attended' });
}

function inspectOk(r: Repositories, doc: unknown): ValidatedBackup {
  const result = r.backup.inspect(JSON.stringify(doc));
  if (!result.ok) throw new Error(`${result.problem}: ${result.issues.join(' | ')}`);
  return result.backup;
}

async function exported() {
  const r = createDexieRepositories(newDb(), { clock: steppingClock() });
  await seedV4(r);
  return { r, doc: await r.backup.exportBackup() };
}

describe('V4 backup round trip', () => {
  it('fills every V4 and V5 store', async () => {
    const { doc } = await exported();
    for (const store of STORE_NAMES) {
      if (store === 'inbox' || store === 'habits' || store === 'habitEntries') continue;
      expect(doc.data[store].length, store).toBeGreaterThan(0);
    }
  });

  it('export → restore → export gives identical data', async () => {
    const { r, doc } = await exported();
    const backup = inspectOk(r, doc);
    const target = createDexieRepositories(newDb());
    await target.tasks.create({ title: 'replaced' });
    await target.backup.restore(backup);
    const again = await target.backup.exportBackup();
    expect(again.data).toEqual(doc.data);
  });
});

const clone = (d: BackupDocument) => structuredClone(d);

describe('V4 integrity', () => {
  it.each<[string, (d: BackupDocument) => void]>([
    [
      'a milestone of a missing project',
      (d) => (d.data.milestones[0]!.projectId = d.data.tasks[0]!.id),
    ],
    [
      'a duplicate project slug',
      (d) => d.data.projects.push({ ...d.data.projects[0]!, id: crypto.randomUUID() }),
    ],
    [
      'a task milestone from another project',
      (d) => {
        const other = { ...d.data.projects[0]!, id: crypto.randomUUID(), slug: 'other' };
        d.data.projects.push(other);
        d.data.tasks.find((t) => t.milestoneId)!.projectId = other.id;
      },
    ],
    [
      'a resolved item outside Done',
      (d) => {
        const item = d.data.projectItems.find((i) => i.resolvedAt)!;
        item.lane = 'parked';
      },
    ],
    [
      'an open blocker outside Blocked',
      (d) => (d.data.projectItems.find((i) => i.kind === 'blocker')!.lane = 'next'),
    ],
    [
      'a decision superseding a missing one',
      (d) => (d.data.decisions.find((x) => x.supersedesId)!.supersedesId = crypto.randomUUID()),
    ],
    [
      'two open work sessions',
      (d) => {
        const open = { ...d.data.workSessions[0]! };
        delete open.endedAt;
        d.data.workSessions = [open, { ...open, id: crypto.randomUUID(), pauses: [] }];
      },
    ],
    [
      'a work session whose task is in another project',
      (d) => {
        const other = { ...d.data.projects[0]!, id: crypto.randomUUID(), slug: 'other' };
        d.data.projects.push(other);
        d.data.workSessions[0]!.projectId = other.id;
      },
    ],
    [
      'a session ending before it starts',
      (d) => (d.data.workSessions[0]!.endedAt = '2000-01-01T00:00:00.000Z'),
    ],
    [
      'a day off with a start time',
      (d) => {
        d.data.offTimeSessions.find((o) => o.kind === 'day_off')!.startedAt =
          '2026-10-04T00:00:00.000Z';
      },
    ],
    [
      'two days off on one date',
      (d) => {
        const off = d.data.offTimeSessions.find((o) => o.kind === 'day_off')!;
        d.data.offTimeSessions.push({ ...off, id: crypto.randomUUID() });
      },
    ],
    [
      'an event about the wrong kind of record',
      (d) => (d.data.events[0]!.entityType = 'aiSession'),
    ],
    [
      'two snapshots for one project and day',
      (d) => {
        d.data.progressSnapshots.push({ ...d.data.progressSnapshots[0]!, id: crypto.randomUUID() });
      },
    ],
    [
      'a project-scoped AI session without a project',
      (d) => {
        delete (d.data.aiSessions[0] as { projectId?: string }).projectId;
      },
    ],
    [
      'a hackathon linked to a missing project',
      (d) => (d.data.hackathons[0]!.projectId = crypto.randomUUID()),
    ],
  ])('rejects %s, writing nothing', async (_, corrupt) => {
    const { r, doc } = await exported();
    const bad = clone(doc);
    corrupt(bad);
    const before = await r.backup.exportBackup();
    expect(r.backup.inspect(JSON.stringify(bad))).toMatchObject({
      ok: false,
      problem: 'invalid-data',
    });
    expect((await r.backup.exportBackup()).data).toEqual(before.data);
  });

  it('accepts the untouched export', async () => {
    const { r, doc } = await exported();
    expect(r.backup.inspect(JSON.stringify(doc)).ok).toBe(true);
  });
});
