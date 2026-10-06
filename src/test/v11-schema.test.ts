import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectBackup } from '../db/backup';
import { openDatabase } from '../db/database';
import { STORE_NAMES } from '../db/migrations';
import { createDexieRepositories } from '../db/repositories';
import {
  SCHEMA_VERSION,
  STORES_V1,
  STORES_V2,
  STORES_V3,
  STORES_V4,
  STORES_V5,
  STORES_V6,
  STORES_V7,
  STORES_V8,
  STORES_V9,
  STORES_V10,
} from '../db/schema';
import { hackathonStages } from '../features/hackathons/progress';
import { setupTestDatabase } from './helpers';

const names: string[] = [];
afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});
const newDb = setupTestDatabase();
const at = '2026-10-01T08:00:00.000Z';
const hack = {
  id: '0d6f6c3e-1111-4a2b-9c3d-000000000011',
  name: 'Autumn hack',
  eventStart: '2026-10-20',
  registrationStatus: 'registered',
  pptStatus: 'in_progress',
  buildStatus: 'not_started',
  status: 'active',
  pinnedAt: at,
  createdAt: at,
  updatedAt: at,
};

/** A database made with the shipped V1–V10 definitions only. */
async function v10Database(seed: (db: Dexie) => Promise<unknown>) {
  const name = `lowtide-v11-migration-${crypto.randomUUID()}`;
  names.push(name);
  const v10 = new Dexie(name);
  const steps = [
    STORES_V1,
    STORES_V2,
    STORES_V3,
    STORES_V4,
    STORES_V5,
    STORES_V6,
    STORES_V7,
    STORES_V8,
    STORES_V9,
    STORES_V10,
  ];
  for (const [i, stores] of steps.entries()) v10.version(i + 1).stores(stores);
  await v10.open();
  await seed(v10);
  v10.close();
  return name;
}

describe('schema V10 → V11 (ADR-072)', () => {
  it('opens a genuine V10 database with hackathons unchanged, kind and selection unset', async () => {
    const name = await v10Database((db) => db.table('hackathons').add(hack));
    const db = openDatabase(name);
    await db.open();
    expect(SCHEMA_VERSION).toBe(11);
    expect(db.verno).toBe(11);
    const stored = await db.hackathons.get(hack.id);
    expect(stored).toEqual(hack);
    expect(stored).not.toHaveProperty('kind');
    expect(stored).not.toHaveProperty('selection');
    db.close();
  });

  it('imports a schema-10 backup as it was, and refuses unknown kinds', () => {
    const data = Object.fromEntries(STORE_NAMES.map((s) => [s, [] as unknown[]]));
    data.hackathons = [hack];
    const envelope = (hackathons: unknown[]) =>
      JSON.stringify({
        format: 'lowtide-backup',
        formatVersion: 1,
        schemaVersion: 10,
        exportedAt: at,
        data: { ...data, hackathons },
      });
    const result = inspectBackup(envelope([hack]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backup.data.hackathons[0]).toEqual(hack);
    expect(inspectBackup(envelope([{ ...hack, kind: 'ideathon' }])).ok).toBe(false);
    expect(inspectBackup(envelope([{ ...hack, selection: 'maybe' }])).ok).toBe(false);
  });
});

describe('hackathon kind and selection (ADR-072)', () => {
  it('records a CTF and its selection, and clears both with null or a blank choice', async () => {
    const r = createDexieRepositories(newDb());
    const plain = await r.hackathons.create({ name: 'Plain hack' });
    expect(plain).not.toHaveProperty('kind');
    expect(plain).not.toHaveProperty('selection');

    const ctf = await r.hackathons.create({ name: 'Night CTF', kind: 'ctf', selection: 'applied' });
    expect(ctf).toMatchObject({ kind: 'ctf', selection: 'applied' });

    const shortlisted = await r.hackathons.update(ctf.id, { selection: 'shortlisted' });
    expect(shortlisted).toMatchObject({ kind: 'ctf', selection: 'shortlisted' });
    expect(await r.hackathons.update(ctf.id, { selection: null })).not.toHaveProperty('selection');

    // The edit form sends every field; a blank selection means "nothing yet".
    const fromForm = await r.hackathons.update(ctf.id, {
      selection: '' as never,
      kind: 'hackathon',
    });
    expect(fromForm).not.toHaveProperty('selection');
    expect(fromForm.kind).toBe('hackathon');
    expect(await r.hackathons.update(ctf.id, { kind: null })).not.toHaveProperty('kind');
    expect(await r.hackathons.create({ name: 'Blank', selection: '' as never })).not.toHaveProperty(
      'selection',
    );
  });

  it('leaves every other field alone when only the selection changes', async () => {
    const r = createDexieRepositories(newDb());
    const h = await r.hackathons.create({
      name: 'Build week',
      eventStart: '2026-11-04',
      registrationStatus: 'registered',
      pptStatus: 'submitted',
      nextAction: 'Wait for results',
    });
    const after = await r.hackathons.update(h.id, { selection: 'selected' });
    expect(after.updatedAt >= h.updatedAt).toBe(true);
    expect(after).toEqual({ ...h, selection: 'selected', updatedAt: after.updatedAt });
  });

  it('round-trips kind and selection through a backup', async () => {
    const r = createDexieRepositories(newDb());
    await r.hackathons.create({ name: 'Night CTF', kind: 'ctf', selection: 'rejected' });
    const doc = await r.backup.exportBackup();
    expect(doc.schemaVersion).toBe(11);
    const result = r.backup.inspect(JSON.stringify(doc));
    expect(result.ok && result.backup.data.hackathons[0]).toMatchObject({
      kind: 'ctf',
      selection: 'rejected',
    });
  });
});

describe('the CTF rail (ADR-072)', () => {
  const base = {
    registrationStatus: 'registered',
    pptStatus: 'not_needed',
    buildStatus: 'not_started',
    researchStatus: 'in_progress',
  } as const;

  it('has registration, preparation and the competition, and no build stages', () => {
    const stages = hackathonStages({ ...base, kind: 'ctf', status: 'active' });
    expect(stages).toEqual([
      { key: 'registration', state: 'done' },
      { key: 'preparation', state: 'active' },
      { key: 'competition', state: 'todo' },
    ]);
  });

  it('marks the competition done only when the owner finishes it', () => {
    const finished = hackathonStages({ ...base, kind: 'ctf', status: 'finished' });
    expect(finished.at(-1)).toEqual({ key: 'competition', state: 'done' });
    // A problem statement or build status never counts for a CTF.
    const noisy = hackathonStages({
      ...base,
      kind: 'ctf',
      status: 'considering',
      problemStatement: 'Web, crypto',
      buildStatus: 'submitted',
    });
    expect(noisy.map((s) => s.key)).toEqual(['registration', 'preparation', 'competition']);
    expect(noisy.at(-1)?.state).toBe('todo');
  });

  it('keeps the hackathon rail for a hackathon, with or without a kind', () => {
    const unset = hackathonStages({ ...base, status: 'active' }).map((s) => s.key);
    const explicit = hackathonStages({ ...base, kind: 'hackathon', status: 'active' }).map(
      (s) => s.key,
    );
    expect(unset).toEqual([
      'registration',
      'problem',
      'research',
      'build',
      'testing',
      'submission',
    ]);
    expect(explicit).toEqual(unset);
  });
});
