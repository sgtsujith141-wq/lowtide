import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectBackup } from '../../src/db/backup';
import { STORE_NAMES } from '../../src/db/migrations';
import type { MigrationCheck, MigrationReport } from '../../src/db/companion/wire';
import type { BackupData } from '../../src/db/repositories';

export type { MigrationCheck, MigrationReport };
import { getMeta, setMeta } from './sqlite/migrations';
import type { SqliteStore } from './sqlite/store';

/*
 * Migration into the companion (ADR-058, stage B). The payload is a normal
 * LOWTIDE backup, validated with the same pipeline as the app's restore
 * preview. Then, in ONE SQLite transaction: every record is inserted with
 * its id, every store is read back and compared record by record with the
 * payload, and deferred foreign keys are checked at commit. Any difference
 * rolls the whole transaction back, leaving the companion empty.
 *
 * Before anything is written, an exact copy of the payload is kept in
 * <data>/backups (owner-only). The browser's IndexedDB is never touched.
 */

class VerificationError extends Error {
  constructor(readonly checks: MigrationCheck[]) {
    super('The companion’s copy didn’t match the backup');
    this.name = 'VerificationError';
  }
}

/** Key-order-independent serialisation, for record-by-record comparison. */
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const byId = (records: readonly { id: string }[]) =>
  [...records].sort((a, b) => a.id.localeCompare(b.id));

export async function isEmpty(store: SqliteStore): Promise<boolean> {
  for (const name of STORE_NAMES) if ((await store[name].count()) > 0) return false;
  return true;
}

export async function migrateIntoCompanion(
  store: SqliteStore,
  text: string,
  options: { dataDir: string; now?: () => Date },
): Promise<MigrationReport> {
  const now = options.now ?? (() => new Date());
  const inspection = inspectBackup(text);
  if (!inspection.ok) {
    return {
      ok: false,
      problem: `The backup didn’t validate (${inspection.problem}): ${inspection.issues.slice(0, 3).join('; ')}`,
      stores: [],
      checks: [{ name: 'backup validates', ok: false }],
    };
  }
  const { data, exportedAt, sourceSchemaVersion } = inspection.backup;
  if (!(await isEmpty(store))) {
    return {
      ok: false,
      problem:
        'The companion already holds LOWTIDE data. Migration only fills an empty companion; to replace its data, restore a backup in LOWTIDE instead.',
      stores: [],
      checks: [{ name: 'companion is empty', ok: false }],
    };
  }

  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const savedCopy = join(options.dataDir, 'backups', `pre-migration-${stamp}.json`);
  writeFileSync(savedCopy, text, { mode: 0o600 });
  chmodSync(savedCopy, 0o600);

  const stores = STORE_NAMES.map((name) => ({
    store: name,
    backup: data[name].length,
    companion: 0,
  }));
  const tables = STORE_NAMES.map((name) => store[name]);
  const migratedAt = now().toISOString();
  try {
    const checks = await store.transaction<MigrationCheck[]>('rw', tables, async () => {
      for (const name of STORE_NAMES) {
        await (
          store[name] as unknown as { bulkAdd(r: readonly unknown[]): Promise<unknown> }
        ).bulkAdd(data[name]);
      }
      const verified = await verify(store, data, stores);
      // Recorded inside the same transaction, so it exists only if the data does.
      setMeta(store.sql, 'migrated_at', migratedAt);
      setMeta(store.sql, 'migrated_from_exported_at', exportedAt);
      setMeta(store.sql, 'migrated_from_schema', String(sourceSchemaVersion));
      return verified;
    });
    return {
      ok: true,
      exportedAt,
      sourceSchemaVersion,
      migratedAt,
      savedCopy,
      stores,
      checks: [
        { name: 'backup validates (restore-preview pipeline)', ok: true },
        { name: 'companion was empty', ok: true },
        ...checks,
        { name: 'foreign keys hold at commit', ok: true },
      ],
    };
  } catch (error) {
    const checks =
      error instanceof VerificationError
        ? error.checks
        : [{ name: 'transaction commits', ok: false, detail: (error as Error).message }];
    for (const s of stores) s.companion = await store[s.store].count();
    return {
      ok: false,
      problem: 'The migration was rolled back; the companion is unchanged.',
      exportedAt,
      sourceSchemaVersion,
      savedCopy,
      stores,
      checks,
    };
  }
}

/** Reads every store back and compares it, record by record, with the payload. */
async function verify(
  store: SqliteStore,
  data: BackupData,
  stores: MigrationReport['stores'],
): Promise<MigrationCheck[]> {
  const checks: MigrationCheck[] = [];
  let allEqual = true;
  for (const s of stores) {
    const saved = (await store[s.store].toArray()) as { id: string }[];
    s.companion = saved.length;
    const expected = byId(data[s.store] as { id: string }[]);
    const actual = byId(saved);
    const countOk = expected.length === actual.length;
    const idsOk = countOk && expected.every((r, i) => r.id === actual[i]!.id);
    const recordsOk = idsOk && expected.every((r, i) => stable(r) === stable(actual[i]));
    if (!recordsOk) allEqual = false;
    if (!countOk || !idsOk || !recordsOk) {
      checks.push({
        name: `${s.store} copied exactly`,
        ok: false,
        detail: !countOk
          ? `${expected.length} in the backup, ${actual.length} in the companion`
          : !idsOk
            ? 'ids differ'
            : 'a record differs',
      });
    }
  }
  const named = (name: string, ok: boolean): MigrationCheck => ({ name, ok });
  checks.push(
    named(
      'every store count matches',
      stores.every((s) => s.backup === s.companion),
    ),
  );
  checks.push(named('every id preserved', allEqual));
  checks.push(named('every record identical (fields, timestamps, dates, links)', allEqual));
  checks.push(
    named(
      'no projects, events, snapshots or sessions invented',
      stores.every((s) => s.backup === s.companion),
    ),
  );
  checks.push(named('protected time unchanged', allEqual));
  checks.push(named('decision history and supersession preserved', allEqual));
  checks.push(named('work and off-time timestamps preserved', allEqual));
  checks.push(named('no hackathon converted to a project', allEqual));
  if (checks.some((c) => !c.ok)) throw new VerificationError(checks);
  return checks;
}

export function migrationInfo(store: SqliteStore) {
  const migratedAt = getMeta(store.sql, 'migrated_at');
  return migratedAt
    ? {
        migratedAt,
        exportedAt: getMeta(store.sql, 'migrated_from_exported_at'),
        sourceSchemaVersion: Number(getMeta(store.sql, 'migrated_from_schema')),
      }
    : undefined;
}
