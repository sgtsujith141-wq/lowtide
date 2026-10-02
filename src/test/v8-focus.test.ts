import { describe, expect, it } from 'vitest';
import { asStore } from '../db/database';
import { importNotion } from '../db/import/notion/importer';
import { createDexieRepositories } from '../db/repositories';
import { SCHEMA_VERSION } from '../db/schema';
import { fixturePlan, fixtureSnapshot } from './notion-fixture';
import { setupTestDatabase, steppingClock } from './helpers';

const newDb = setupTestDatabase();

describe('schema V8: project focus (ADR-064)', () => {
  it('is set and cleared without moving the project or writing to the ledger', async () => {
    const db = newDb();
    const r = createDexieRepositories(db, { clock: steppingClock() });
    expect(SCHEMA_VERSION).toBe(9);
    const p = await r.projects.create({ name: 'Engine' });
    const events = await db.events.count();
    const focused = await r.projects.setFocus(p.id, 'primary');
    expect(focused).toMatchObject({
      focus: 'primary',
      updatedAt: p.updatedAt,
      stateChangedAt: p.stateChangedAt,
    });
    expect(await db.events.count()).toBe(events);
    const cleared = await r.projects.setFocus(p.id, null);
    expect(cleared).not.toHaveProperty('focus');
  });

  it('travels in backups', async () => {
    const r = createDexieRepositories(newDb(), { clock: steppingClock() });
    const p = await r.projects.create({ name: 'Engine' });
    await r.projects.setFocus(p.id, 'supporting');
    const doc = await r.backup.exportBackup();
    expect(doc.schemaVersion).toBe(9);
    const result = r.backup.inspect(JSON.stringify(doc));
    if (!result.ok) throw new Error(result.issues.join('; '));
    const target = createDexieRepositories(newDb());
    await target.backup.restore(result.backup);
    expect((await target.projects.get(p.id))?.focus).toBe('supporting');
  });

  it('is LOWTIDE’s own: a Notion re-import keeps it even when the source changed', async () => {
    const db = newDb();
    const store = asStore(db);
    const r = createDexieRepositories(db);
    await importNotion(store, fixtureSnapshot(), fixturePlan(), {
      now: new Date('2026-02-10T12:00:00.000Z'),
      newId: () => crypto.randomUUID(),
    });
    const widget = (await db.projects.where('slug').equals('widget').first())!;
    await r.projects.setFocus(widget.id, 'primary');
    const changed = fixtureSnapshot();
    changed.databases[0]!.dataSources[0]!.rows[0]!.Next = 'A newer next step';
    await importNotion(store, changed, fixturePlan(), {
      now: new Date('2026-02-11T12:00:00.000Z'),
      newId: () => crypto.randomUUID(),
    });
    const after = (await db.projects.get(widget.id))!;
    expect(after).toMatchObject({ nextAction: 'A newer next step', focus: 'primary' });
  });
});
