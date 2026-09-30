// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORE_NAMES } from '../../src/db/migrations';
import { createRepositories } from '../../src/db/repositories';
import { isEmpty, migrateIntoCompanion, stable } from './migrate';
import { getMeta } from './sqlite/migrations';
import { SqliteStore } from './sqlite/store';
import { fixtureBackupText } from './test-fixtures';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function withBackups() {
  const dataDir = mkdtempSync(join(tmpdir(), 'lowtide-migrate-'));
  const backups = join(dataDir, 'backups');
  mkdirSync(backups, { mode: 0o700 });
  const store = new SqliteStore(':memory:');
  cleanups.push(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { dataDir, store, backups };
}

describe('migration into the companion (ADR-058, stage B)', () => {
  it('copies a real browser backup exactly, verifies it and reports every store', async () => {
    const { dataDir, store, backups } = await withBackups();
    const { text } = await fixtureBackupText();
    const report = await migrateIntoCompanion(store, text, { dataDir });

    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.ok)).toBe(true);
    expect(report.checks.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'every store count matches',
        'every id preserved',
        'protected time unchanged',
        'decision history and supersession preserved',
        'work and off-time timestamps preserved',
        'no hackathon converted to a project',
        'foreign keys hold at commit',
      ]),
    );
    expect(report.stores).toHaveLength(19);
    for (const s of report.stores) expect(s.companion).toBe(s.backup);

    // The companion now holds exactly the backup's data, record for record.
    const original = JSON.parse(text) as { data: Record<string, { id: string }[]> };
    const exported = await createRepositories(store, { watch: store.watch }).backup.exportBackup();
    for (const name of STORE_NAMES) {
      expect(stable(exported.data[name])).toBe(stable(original.data[name]));
    }
    expect(original.data.protectedTime).toHaveLength(1);
    expect(original.data.decisions!.some((d) => 'supersedesId' in d)).toBe(true);

    // An exact, owner-only copy of what was migrated is kept.
    expect(readFileSync(report.savedCopy!, 'utf8')).toBe(text);
    expect(statSync(report.savedCopy!).mode & 0o777).toBe(0o600);
    expect(readdirSync(backups)).toHaveLength(1);
    expect(getMeta(store.sql, 'migrated_at')).toBe(report.migratedAt);
  });

  it('refuses an invalid backup without writing anything', async () => {
    const { dataDir, store, backups } = await withBackups();
    const report = await migrateIntoCompanion(store, '{"format":"lowtide-backup"', { dataDir });
    expect(report.ok).toBe(false);
    expect(report.problem).toMatch(/didn’t validate/);
    expect(await isEmpty(store)).toBe(true);
    expect(readdirSync(backups)).toHaveLength(0);
  });

  it('only fills an empty companion', async () => {
    const { dataDir, store } = await withBackups();
    const { text } = await fixtureBackupText();
    expect((await migrateIntoCompanion(store, text, { dataDir })).ok).toBe(true);
    const again = await migrateIntoCompanion(store, text, { dataDir });
    expect(again.ok).toBe(false);
    expect(again.problem).toMatch(/already holds LOWTIDE data/);
  });

  it('rolls everything back when the read-back differs from the backup', async () => {
    const { dataDir, store } = await withBackups();
    const { text } = await fixtureBackupText();
    // Simulate a store that silently loses a record on the way in.
    const real = store.decisions.toArray.bind(store.decisions);
    vi.spyOn(store.decisions, 'toArray').mockImplementation(async () => (await real()).slice(1));

    const report = await migrateIntoCompanion(store, text, { dataDir });
    expect(report.ok).toBe(false);
    expect(report.problem).toMatch(/rolled back/);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: 'decisions copied exactly', ok: false }),
    );
    vi.restoreAllMocks();
    expect(await isEmpty(store)).toBe(true);
    expect(getMeta(store.sql, 'migrated_at')).toBeUndefined();
  });

  it('rolls everything back when a reference would dangle at commit', async () => {
    const { dataDir, store } = await withBackups();
    const { text } = await fixtureBackupText();
    // A backup whose validation passes but whose rows break a database rule:
    // bypass the validator to prove the database itself still refuses.
    const doc = JSON.parse(text) as { data: Record<string, Record<string, unknown>[]> };
    doc.data.milestones![0]!.projectId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const backup = await import('../../src/db/backup');
    const inspection = backup.inspectBackup(text);
    vi.spyOn(backup, 'inspectBackup').mockReturnValue(
      inspection.ok
        ? { ...inspection, backup: { ...inspection.backup, data: doc.data } as never }
        : inspection,
    );
    const report = await migrateIntoCompanion(store, text, { dataDir });
    vi.restoreAllMocks();
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: 'transaction commits',
        ok: false,
        detail: expect.stringMatching(/FOREIGN KEY/i),
      }),
    );
    expect(await isEmpty(store)).toBe(true);
  });
});
