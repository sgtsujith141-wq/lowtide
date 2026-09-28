import { z } from 'zod/mini';
import type {
  BackupCounts,
  BackupData,
  BackupInspection,
  BackupProblem,
  ValidatedBackup,
} from './repositories/types';
import { migrateSnapshot, STORE_NAMES, type RawSnapshot, type StoreName } from './migrations';
import { checkEntryValue, checkHabitTarget, checkHackathonDates } from './rules';
import {
  habitEntrySchema,
  habitSchema,
  hackathonSchema,
  inboxItemSchema,
  protectedTimeSchema,
  SCHEMA_VERSION,
  taskSchema,
} from './schema';

/*
 * The backup envelope and the import pipeline (ADR-031/032). Pure: nothing
 * here touches IndexedDB, so a file is fully checked before any data is.
 */

export const BACKUP_FORMAT = 'lowtide-backup';
/** Version of the backup file envelope. Independent of SCHEMA_VERSION. */
export const BACKUP_FORMAT_VERSION = 1;
/** Oldest database schema a backup's data may come from. */
export const OLDEST_SUPPORTED_SCHEMA = 1;

const SCHEMAS = {
  tasks: taskSchema,
  inbox: inboxItemSchema,
  habits: habitSchema,
  habitEntries: habitEntrySchema,
  hackathons: hackathonSchema,
  protectedTime: protectedTimeSchema,
} as const;

const byKeys =
  <T>(...keys: ((x: T) => string)[]) =>
  (a: T, b: T) => {
    for (const key of keys) {
      const c = key(a).localeCompare(key(b));
      if (c) return c;
    }
    return 0;
  };

/** Stable order per store, so identical data always serialises identically. */
export function sortBackupData(data: BackupData): BackupData {
  return {
    tasks: [...data.tasks].sort(
      byKeys(
        (t) => t.createdAt,
        (t) => t.id,
      ),
    ),
    inbox: [...data.inbox].sort(
      byKeys(
        (i) => i.createdAt,
        (i) => i.id,
      ),
    ),
    habits: [...data.habits].sort(
      byKeys(
        (h) => h.createdAt,
        (h) => h.id,
      ),
    ),
    habitEntries: [...data.habitEntries].sort(
      byKeys(
        (e) => e.date,
        (e) => e.habitId,
        (e) => e.id,
      ),
    ),
    hackathons: [...data.hackathons].sort(
      byKeys(
        (h) => h.createdAt,
        (h) => h.id,
      ),
    ),
    protectedTime: [...data.protectedTime].sort(
      byKeys(
        (p) => p.date,
        (p) => p.id,
      ),
    ),
  };
}

export function countBackupData(data: BackupData): BackupCounts {
  return Object.fromEntries(
    STORE_NAMES.map((store) => [store, data[store].length]),
  ) as BackupCounts;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const fail = (problem: BackupProblem, issues: string[]): BackupInspection => ({
  ok: false,
  problem,
  issues,
});

const MAX_ISSUES = 25;

/**
 * Import pipeline, in order:
 * 1. parse JSON;
 * 2. check the envelope: marker, format version (newer → reject), schema
 *    version (newer than this build → reject), export time, all six arrays;
 * 3. migrate older-schema data in memory with the database's own migrations;
 * 4. validate every record against the current schemas and the domain rules
 *    the repositories enforce;
 * 5. check cross-store integrity: unique ids per store, entries point at a
 *    habit in the backup, one entry per habit per day, converted inbox items
 *    point at a task in the backup.
 * Any problem rejects the whole file. Nothing is repaired or skipped.
 */
export function inspectBackup(text: string): BackupInspection {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('not-json', ['The file is not valid JSON']);
  }
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT) {
    return fail('not-lowtide', [`Missing "format": "${BACKUP_FORMAT}"`]);
  }

  const { formatVersion, schemaVersion, exportedAt, data } = raw;
  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion) || formatVersion < 1) {
    return fail('invalid-data', [`Invalid formatVersion: ${String(formatVersion)}`]);
  }
  if (formatVersion > BACKUP_FORMAT_VERSION) {
    return fail('newer-format', [
      `formatVersion ${formatVersion} is newer than ${BACKUP_FORMAT_VERSION}`,
    ]);
  }
  if (
    typeof schemaVersion !== 'number' ||
    !Number.isInteger(schemaVersion) ||
    schemaVersion < OLDEST_SUPPORTED_SCHEMA
  ) {
    return fail('invalid-data', [`Invalid schemaVersion: ${String(schemaVersion)}`]);
  }
  if (schemaVersion > SCHEMA_VERSION) {
    return fail('newer-schema', [`schemaVersion ${schemaVersion} is newer than ${SCHEMA_VERSION}`]);
  }
  if (!z.iso.datetime().safeParse(exportedAt).success) {
    return fail('invalid-data', ['exportedAt is not an ISO timestamp']);
  }
  if (!isObject(data)) return fail('invalid-data', ['Missing data']);

  const issues: string[] = [];
  const rawSnapshot = {} as RawSnapshot;
  for (const store of STORE_NAMES) {
    const records = data[store];
    if (!Array.isArray(records)) {
      issues.push(`data.${store} is missing or not a list`);
      continue;
    }
    const bad = records.findIndex((r) => !isObject(r));
    if (bad !== -1) issues.push(`${store}[${bad}] is not a record`);
    rawSnapshot[store] = records as Record<string, unknown>[];
  }
  if (issues.length) return fail('invalid-data', issues);

  const migrated = migrateSnapshot(rawSnapshot, schemaVersion);
  const parsed = {} as Record<StoreName, unknown[]>;
  for (const store of STORE_NAMES) {
    parsed[store] = [];
    migrated[store].forEach((record, i) => {
      const result = SCHEMAS[store].safeParse(record);
      if (result.success) parsed[store].push(result.data);
      else
        issues.push(
          `${store}[${i}]: ${result.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`,
        );
    });
  }
  if (issues.length) return fail('invalid-data', issues.slice(0, MAX_ISSUES));

  const snapshot = parsed as unknown as BackupData;
  checkIntegrity(snapshot, issues);
  if (issues.length) return fail('invalid-data', issues.slice(0, MAX_ISSUES));

  const sorted = sortBackupData(snapshot);
  const backup = {
    exportedAt: exportedAt as string,
    sourceSchemaVersion: schemaVersion,
    data: sorted,
    counts: countBackupData(sorted),
  } as unknown as ValidatedBackup;
  return { ok: true, backup };
}

function checkIntegrity(data: BackupData, issues: string[]) {
  const attempt = (label: string, check: () => void) => {
    try {
      check();
    } catch (error) {
      issues.push(`${label}: ${(error as Error).message}`);
    }
  };

  for (const store of STORE_NAMES) {
    const seen = new Set<string>();
    for (const record of data[store]) {
      if (seen.has(record.id)) issues.push(`${store}: duplicate id ${record.id}`);
      seen.add(record.id);
    }
  }

  const habits = new Map(data.habits.map((h) => [h.id, h]));
  data.habits.forEach((h, i) => attempt(`habits[${i}]`, () => checkHabitTarget(h.unit, h.target)));

  const days = new Set<string>();
  data.habitEntries.forEach((e, i) => {
    const habit = habits.get(e.habitId);
    if (!habit) return issues.push(`habitEntries[${i}]: habit ${e.habitId} is not in the backup`);
    attempt(`habitEntries[${i}]`, () => checkEntryValue(habit.unit, e.value));
    const key = `${e.habitId}|${e.date}`;
    if (days.has(key))
      issues.push(`habitEntries[${i}]: second entry for ${e.habitId} on ${e.date}`);
    days.add(key);
  });

  data.hackathons.forEach((h, i) => attempt(`hackathons[${i}]`, () => checkHackathonDates(h)));

  const tasks = new Set(data.tasks.map((t) => t.id));
  data.inbox.forEach((item, i) => {
    if (item.convertedToTaskId && !tasks.has(item.convertedToTaskId)) {
      issues.push(
        `inbox[${i}]: converted to task ${item.convertedToTaskId}, which is not in the backup`,
      );
    }
  });
}
