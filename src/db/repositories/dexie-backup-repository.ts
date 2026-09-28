import { toTimestamp } from '../../lib/time';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  countBackupData,
  inspectBackup,
  sortBackupData,
} from '../backup';
import type { LowtideDatabase } from '../database';
import { SCHEMA_VERSION } from '../schema';
import { resolveDeps, watchQuery, type RepositoryDeps } from './shared';
import type { BackupData, BackupRepository } from './types';

function allTables(db: LowtideDatabase) {
  return [db.tasks, db.inbox, db.habits, db.habitEntries, db.hackathons, db.protectedTime];
}

async function readAll(db: LowtideDatabase): Promise<BackupData> {
  const [tasks, inbox, habits, habitEntries, hackathons, protectedTime] = await Promise.all([
    db.tasks.toArray(),
    db.inbox.toArray(),
    db.habits.toArray(),
    db.habitEntries.toArray(),
    db.hackathons.toArray(),
    db.protectedTime.toArray(),
  ]);
  return { tasks, inbox, habits, habitEntries, hackathons, protectedTime };
}

export function createDexieBackupRepository(deps: RepositoryDeps): BackupRepository {
  const { db, clock } = resolveDeps(deps);

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

    watchCounts: watchQuery(async () => countBackupData(await readAll(db))),

    inspect: inspectBackup,

    restore(backup) {
      const { data } = backup;
      // Replace, atomically (ADR-033): clear and refill every store inside one
      // read-write transaction. Any failure aborts it and nothing changes.
      return db.transaction('rw', allTables(db), async () => {
        await Promise.all(allTables(db).map((table) => table.clear()));
        // Parents before children.
        await db.habits.bulkAdd(data.habits);
        await db.tasks.bulkAdd(data.tasks);
        await db.hackathons.bulkAdd(data.hackathons);
        await db.protectedTime.bulkAdd(data.protectedTime);
        await db.inbox.bulkAdd(data.inbox);
        await db.habitEntries.bulkAdd(data.habitEntries);
      });
    },
  };
}
