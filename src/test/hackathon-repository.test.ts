import { describe, expect, it } from 'vitest';
import {
  createDexieRepositories,
  InvalidInputError,
  RecordNotFoundError,
} from '../db/repositories';
import { recordWatch, setupTestDatabase, steppingClock } from './helpers';

const newDb = setupTestDatabase();

function setup() {
  const db = newDb();
  return { db, ...createDexieRepositories(db, { clock: steppingClock() }) };
}

describe('HackathonRepository', () => {
  it('creates a minimal hackathon with calm defaults', async () => {
    const { hackathons } = setup();
    const h = await hackathons.create({ name: '  Hackurity ', eventStart: '2026-10-04' });
    expect(h).toEqual({
      id: expect.any(String),
      name: 'Hackurity',
      eventStart: '2026-10-04',
      status: 'considering',
      registrationStatus: 'not_registered',
      pptStatus: 'not_started',
      buildStatus: 'not_started',
      createdAt: '2026-09-28T09:00:00.000Z',
      updatedAt: '2026-09-28T09:00:00.000Z',
    });
  });

  it('creates a full hackathon, trimming text and omitting blanks', async () => {
    const { hackathons } = setup();
    const h = await hackathons.create({
      name: 'AI Build Week',
      status: 'active',
      registrationDeadline: '2026-10-01',
      eventStart: '2026-10-10',
      eventEnd: '2026-10-11',
      registrationStatus: 'registered',
      pptStatus: 'in_progress',
      buildStatus: 'not_started',
      team: ' A, B ',
      problemStatement: ' PS 7: offline triage\nfor clinics ',
      nextAction: ' Finish PPT outline ',
      notes: '   ',
    });
    expect(h).toMatchObject({
      team: 'A, B',
      problemStatement: 'PS 7: offline triage\nfor clinics',
      nextAction: 'Finish PPT outline',
    });
    expect(h).not.toHaveProperty('notes');
  });

  it('rejects a blank name, invalid dates and bad ranges, writing nothing', async () => {
    const { db, hackathons } = setup();
    await expect(hackathons.create({ name: '  ' })).rejects.toThrow();
    await expect(hackathons.create({ name: 'x', eventStart: '2026-02-30' })).rejects.toThrow();
    await expect(
      hackathons.create({ name: 'x', eventStart: '2026-10-04T12:00:00.000Z' }),
    ).rejects.toThrow();
    await expect(
      hackathons.create({ name: 'x', eventStart: '2026-10-05', eventEnd: '2026-10-04' }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    await expect(hackathons.create({ name: 'x', eventEnd: '2026-10-04' })).rejects.toBeInstanceOf(
      InvalidInputError,
    );
    expect(await db.hackathons.count()).toBe(0);
  });

  it('allows a one-day event and an independent registration deadline', async () => {
    const { hackathons } = setup();
    const h = await hackathons.create({
      name: 'x',
      eventStart: '2026-10-04',
      eventEnd: '2026-10-04',
      registrationDeadline: '2026-11-01', // no invented rule about ordering
    });
    expect(h.eventEnd).toBe('2026-10-04');
  });

  it('updates fields, keeps id and createdAt, bumps updatedAt, and clears with null or blank', async () => {
    const { hackathons } = setup();
    const h = await hackathons.create({
      name: 'x',
      team: 'A',
      eventStart: '2026-10-04',
      eventEnd: '2026-10-05',
    });
    const u = await hackathons.update(h.id, {
      pptStatus: 'submitted',
      nextAction: 'Record backup demo',
      team: '',
      eventEnd: null,
    });
    expect(u).toMatchObject({
      id: h.id,
      createdAt: h.createdAt,
      pptStatus: 'submitted',
      nextAction: 'Record backup demo',
    });
    expect(u.updatedAt > h.updatedAt).toBe(true);
    expect(u).not.toHaveProperty('team');
    expect(u).not.toHaveProperty('eventEnd');
    await expect(
      hackathons.update(h.id, { eventStart: null, eventEnd: '2026-10-05' }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    await expect(hackathons.update(h.id, { eventEnd: '2026-10-01' })).rejects.toBeInstanceOf(
      InvalidInputError,
    );
    await expect(hackathons.update(crypto.randomUUID(), { name: 'y' })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it('keeps finished and dropped hackathons with all their details', async () => {
    const { db, hackathons } = setup();
    const a = await hackathons.create({
      name: 'A',
      problemStatement: 'PS 1',
      nextAction: 'n',
      notes: 'x',
    });
    const b = await hackathons.create({ name: 'B', team: 'T' });
    await hackathons.update(a.id, { status: 'finished' });
    await hackathons.update(b.id, { status: 'dropped' });
    expect(await db.hackathons.count()).toBe(2);
    expect(await db.hackathons.get(a.id)).toMatchObject({
      status: 'finished',
      problemStatement: 'PS 1',
      nextAction: 'n',
      notes: 'x',
    });
  });

  it('watchAll emits oldest first and reacts to create and update', async () => {
    const { hackathons } = setup();
    const live = recordWatch(hackathons.watchAll);
    await live.until((l) => l.length === 0);
    const a = await hackathons.create({ name: 'First' });
    await hackathons.create({ name: 'Second' });
    await live.until((l) => l.map((h) => h.name).join() === 'First,Second');
    await hackathons.update(a.id, { buildStatus: 'demo_ready' });
    await live.until((l) => l[0]?.buildStatus === 'demo_ready');
    live.stop();
  });

  it('never creates habit entries or touches tasks', async () => {
    const { db, hackathons } = setup();
    const h = await hackathons.create({ name: 'x', nextAction: 'Register team' });
    await hackathons.update(h.id, {
      registrationStatus: 'registered',
      pptStatus: 'submitted',
      buildStatus: 'submitted',
      status: 'finished',
    });
    expect(await db.habitEntries.count()).toBe(0);
    expect(await db.habits.count()).toBe(0);
    expect(await db.tasks.count()).toBe(0);
  });
});
