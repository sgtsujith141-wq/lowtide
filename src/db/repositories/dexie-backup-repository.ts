import { toTimestamp } from '../../lib/time';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  countBackupData,
  inspectBackup,
  sortBackupData,
} from '../backup';
import type { StoreDb, StoreTable } from '../store';
import { STORE_NAMES, type StoreName } from '../migrations';
import { SCHEMA_VERSION } from '../schema';
import { resolveDeps, type RepositoryDeps } from './shared';
import type { BackupData, BackupRepository } from './types';

/** The typed table for a store (the same object as `db.tasks`, etc.). */
function tableOf(db: StoreDb, store: StoreName): StoreTable<unknown> {
  return db[store] as StoreTable<unknown>;
}

function allTables(db: StoreDb) {
  return STORE_NAMES.map((store) => tableOf(db, store));
}

async function readAll(db: StoreDb): Promise<BackupData> {
  const lists = await Promise.all(STORE_NAMES.map((store) => tableOf(db, store).toArray()));
  return Object.fromEntries(
    STORE_NAMES.map((store, i) => [store, lists[i]]),
  ) as unknown as BackupData;
}

export function createDexieBackupRepository(deps: RepositoryDeps): BackupRepository {
  const resolved = resolveDeps(deps);
  const { db, clock, watch } = resolved;

  return {
    async exportBackup() {
      // One read-only transaction over every store: a consistent snapshot.
      const data = await db.transaction('r', allTables(db), () => readAll(db));
      return {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        exportedAt: toTimestamp(clock()),
        data: sortBackupData(data),
      };
    },

    watchCounts: watch(async () => countBackupData(await readAll(db))),

    inspect: inspectBackup,

    restore(backup) {
      const { data } = backup;
      // Replace, atomically (ADR-033): clear and refill every store inside one
      // read-write transaction. Any failure aborts it and nothing changes.
      return db.transaction('rw', allTables(db), async () => {
        await Promise.all(allTables(db).map((table) => table.clear()));
        // Every store, in backup order (parents before children).
        for (const store of STORE_NAMES) await tableOf(db, store).bulkAdd(data[store]);
      });
    },
  };
}
