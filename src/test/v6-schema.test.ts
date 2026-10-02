import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectBackup } from '../db/backup';
import { openDatabase } from '../db/database';
import { createDexieRepositories, InvalidInputError } from '../db/repositories';
import {
  SCHEMA_VERSION,
  STORES_V1,
  STORES_V2,
  STORES_V3,
  STORES_V4,
  STORES_V5,
} from '../db/schema';
import { setupTestDatabase, steppingClock } from './helpers';

const names: string[] = [];
afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});
const newDb = setupTestDatabase();
const at = '2026-09-20T08:00:00.000Z';
const hack = {
  id: '0d6f6c3e-6666-4a2b-9c3d-000000000001',
  name: 'Autumn hack',
  eventStart: '2026-10-04',
  registrationStatus: 'registered',
  pptStatus: 'submitted',
  buildStatus: 'in_progress',
  status: 'active',
  problemStatement: 'Clean water',
  createdAt: at,
  updatedAt: at,
};

describe('schema V5 → V6 (ADR-056)', () => {
  it('opens a genuine V5 database with hackathons unchanged and research unset', async () => {
    const name = `lowtide-v6-migration-${crypto.randomUUID()}`;
    names.push(name);
    const v5 = new Dexie(name);
    v5.version(1).stores(STORES_V1);
    v5.version(2).stores(STORES_V2);
    v5.version(3).stores(STORES_V3);
    v5.version(4).stores(STORES_V4);
    v5.version(5).stores(STORES_V5);
    await v5.open();
    await v5.table('hackathons').add(hack);
    v5.close();

    const db = openDatabase(name);
    await db.open();
    expect(SCHEMA_VERSION).toBe(10);
    expect(db.verno).toBe(10);
    const stored = await db.hackathons.get(hack.id);
    expect(stored).toEqual(hack);
    expect(stored).not.toHaveProperty('researchStatus');
    expect(await db.notes.count()).toBe(0);
    db.close();
  });

  it('imports a schema-5 backup with research unset and no notes', () => {
    const data: Record<string, unknown[]> = {};
    for (const store of [
      'tasks',
      'inbox',
      'habits',
      'habitEntries',
      'protectedTime',
      'projects',
      'milestones',
      'projectItems',
      'decisions',
      'workSessions',
      'offTimeSessions',
      'events',
      'progressSnapshots',
      'aiSessions',
      'collegeItems',
    ])
      data[store] = [];
    data.hackathons = [hack];
    const result = inspectBackup(
      JSON.stringify({
        format: 'lowtide-backup',
        formatVersion: 1,
        schemaVersion: 5,
        exportedAt: at,
        data,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backup.data.notes).toEqual([]);
    expect(result.backup.data.hackathons[0]).not.toHaveProperty('researchStatus');
  });

  it('records research only when set, and round-trips it through a backup', async () => {
    const r = createDexieRepositories(newDb());
    const h = await r.hackathons.create({ name: 'Research hack' });
    expect(h).not.toHaveProperty('researchStatus');
    const updated = await r.hackathons.update(h.id, { researchStatus: 'in_progress' });
    expect(updated.researchStatus).toBe('in_progress');
    const doc = await r.backup.exportBackup();
    const result = r.backup.inspect(JSON.stringify(doc));
    expect(result.ok && result.backup.data.hackathons[0]?.researchStatus).toBe('in_progress');
  });
});

describe('notes and AI attribution (ADR-056)', () => {
  it('attributes notes to the owner in the app, with a note.created event', async () => {
    const db = newDb();
    const r = createDexieRepositories(db, { clock: steppingClock() });
    const p = await r.projects.create({ name: 'Engine' });
    const note = await r.notes.create(p.id, { title: ' Bus design ', body: 'Use a queue.' });
    expect(note).toMatchObject({ title: 'Bus design', kind: 'note', author: 'owner' });
    expect(note).not.toHaveProperty('client');
    const [event] = await db.events.where('type').equals('note.created').toArray();
    expect(event).toMatchObject({ entityType: 'note', entityId: note.id, source: 'app' });
    expect(event).not.toHaveProperty('actor');
  });

  it('attributes AI writes to the client: notes, decisions and every event', async () => {
    const db = newDb();
    const owner = createDexieRepositories(db, { clock: steppingClock() });
    const p = await owner.projects.create({ name: 'Engine' });
    const ai = createDexieRepositories(db, {
      clock: steppingClock('2026-09-28T10:00:00.000Z'),
      source: 'ai-client',
      actor: 'claude-code',
    });
    const note = await ai.notes.create(p.id, {
      kind: 'handoff',
      title: 'Handoff',
      body: 'Next: tests',
    });
    expect(note).toMatchObject({ author: 'ai-client', client: 'claude-code', kind: 'handoff' });
    const decision = await ai.projects.recordDecision(p.id, { title: 'DB', decision: 'SQLite' });
    expect(decision).toMatchObject({ origin: 'ai-client', client: 'claude-code' });
    await ai.projects.addItem(p.id, { kind: 'approval', title: 'Approve schema' });
    const all = (await db.events.toArray()).filter((e) => e.source === 'ai-client');
    expect(all.map((e) => e.type).sort()).toEqual([
      'decision.recorded',
      'note.created',
      'project.approval_requested',
    ]);
    expect(all.every((e) => e.actor === 'claude-code')).toBe(true);
  });

  it('refuses an AI note without a named client', async () => {
    const db = newDb();
    const p = await createDexieRepositories(db).projects.create({ name: 'Engine' });
    const anonymous = createDexieRepositories(db, { source: 'ai-client' });
    await expect(anonymous.notes.create(p.id, { title: 'x', body: 'y' })).rejects.toBeInstanceOf(
      InvalidInputError,
    );
  });

  it('records the richer AI session details a real client reports', async () => {
    const db = newDb();
    const r = createDexieRepositories(db);
    const p = await r.projects.create({ name: 'Engine' });
    const t = await r.tasks.create({ title: 'Wire it', projectId: p.id });
    const s = await r.aiSessions.record({
      client: 'claude-code',
      scope: 'project',
      projectId: p.id,
      startedAt: '2026-09-28T09:00:00.000Z',
      endedAt: '2026-09-28T09:40:00.000Z',
      summary: 'Wired the bus',
      taskId: t.id,
      result: 'Tests pass',
      nextAction: 'Add retries',
      commits: ['abc1234'],
      handoff: 'Retry logic next',
    });
    expect(s).toMatchObject({ taskId: t.id, commits: ['abc1234'], handoff: 'Retry logic next' });
    const [event] = await db.events.where('type').equals('ai.session.completed').toArray();
    expect(event).toMatchObject({ source: 'ai-client', actor: 'claude-code' });
  });
});
