import { z } from 'zod/mini';
import type {
  BackupCounts,
  BackupData,
  BackupInspection,
  BackupProblem,
  ValidatedBackup,
} from './repositories/types';
import {
  migrateSnapshot,
  STORE_NAMES,
  storesForSchema,
  type RawSnapshot,
  type StoreName,
} from './migrations';
import {
  checkAiSession,
  checkCollegeItem,
  checkEntryValue,
  checkHabitTarget,
  checkHackathonDates,
  checkLedgerEvent,
  checkOffTime,
  checkProjectItem,
  checkWorkSession,
} from './rules';
import {
  collegeItemSchema,
  aiSessionSchema,
  decisionSchema,
  habitEntrySchema,
  habitSchema,
  hackathonSchema,
  inboxItemSchema,
  ledgerEventSchema,
  milestoneSchema,
  offTimeSessionSchema,
  progressSnapshotSchema,
  projectItemSchema,
  projectSchema,
  protectedTimeSchema,
  SCHEMA_VERSION,
  taskSchema,
  workSessionSchema,
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
  projects: projectSchema,
  milestones: milestoneSchema,
  projectItems: projectItemSchema,
  decisions: decisionSchema,
  workSessions: workSessionSchema,
  offTimeSessions: offTimeSessionSchema,
  events: ledgerEventSchema,
  progressSnapshots: progressSnapshotSchema,
  aiSessions: aiSessionSchema,
  collegeItems: collegeItemSchema,
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

type Created = { createdAt: string; id: string };
const CREATED = [(r: Created) => r.createdAt, (r: Created) => r.id] as const;

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
    projects: [...data.projects].sort(byKeys(...CREATED)),
    milestones: [...data.milestones].sort(byKeys(...CREATED)),
    projectItems: [...data.projectItems].sort(byKeys(...CREATED)),
    decisions: [...data.decisions].sort(byKeys(...CREATED)),
    workSessions: [...data.workSessions].sort(byKeys(...CREATED)),
    offTimeSessions: [...data.offTimeSessions].sort(byKeys(...CREATED)),
    events: [...data.events].sort(
      byKeys(
        (e) => e.at,
        (e) => e.id,
      ),
    ),
    progressSnapshots: [...data.progressSnapshots].sort(
      byKeys(
        (p) => p.projectId,
        (p) => p.localDate,
        (p) => p.id,
      ),
    ),
    aiSessions: [...data.aiSessions].sort(byKeys(...CREATED)),
    collegeItems: [...data.collegeItems].sort(
      byKeys(
        (c) => c.date,
        (c) => c.id,
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
 *    version (newer than this build → reject), export time, and every store
 *    that schema has (six before V4, fifteen in V4, sixteen from V5);
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
  const expected = storesForSchema(schemaVersion);
  for (const key of Object.keys(data)) {
    if (!(expected as readonly string[]).includes(key)) {
      issues.push(`data.${key} is not a store of database version ${schemaVersion}`);
    }
  }
  const rawSnapshot = {} as RawSnapshot;
  for (const store of expected) {
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

  checkV4Integrity(data, issues, attempt);
}

/** Cross-store rules for the V4 stores (ADR-046, architecture §15). */
function checkV4Integrity(
  data: BackupData,
  issues: string[],
  attempt: (label: string, check: () => void) => void,
) {
  const projects = new Set(data.projects.map((p) => p.id));
  const needProject = (label: string, projectId: string | undefined) => {
    if (projectId !== undefined && !projects.has(projectId)) {
      issues.push(`${label}: project ${projectId} is not in the backup`);
    }
  };

  const slugs = new Set<string>();
  data.projects.forEach((p, i) => {
    if (slugs.has(p.slug)) issues.push(`projects[${i}]: duplicate slug ${p.slug}`);
    slugs.add(p.slug);
  });

  const milestones = new Map(data.milestones.map((m) => [m.id, m]));
  const orders = new Set<string>();
  data.milestones.forEach((m, i) => {
    needProject(`milestones[${i}]`, m.projectId);
    const key = `${m.projectId}|${m.order}`;
    if (orders.has(key)) issues.push(`milestones[${i}]: duplicate order ${m.order}`);
    orders.add(key);
  });

  const taskById = new Map(data.tasks.map((t) => [t.id, t]));
  const milestoneOf = (label: string, milestoneId: string | undefined, projectId?: string) => {
    if (milestoneId === undefined) return;
    const milestone = milestones.get(milestoneId);
    if (!milestone) return issues.push(`${label}: milestone ${milestoneId} is not in the backup`);
    if (milestone.projectId !== projectId) {
      issues.push(`${label}: milestone ${milestoneId} belongs to another project`);
    }
  };

  data.tasks.forEach((t, i) => {
    needProject(`tasks[${i}]`, t.projectId);
    milestoneOf(`tasks[${i}]`, t.milestoneId, t.projectId);
  });
  data.hackathons.forEach((h, i) => needProject(`hackathons[${i}]`, h.projectId));

  data.projectItems.forEach((item, i) => {
    const label = `projectItems[${i}]`;
    needProject(label, item.projectId);
    attempt(label, () => checkProjectItem(item));
    milestoneOf(label, item.milestoneId, item.projectId);
    if (item.taskId !== undefined) {
      const task = taskById.get(item.taskId);
      if (!task) issues.push(`${label}: task ${item.taskId} is not in the backup`);
      else if (task.projectId !== item.projectId) {
        issues.push(`${label}: task ${item.taskId} belongs to another project`);
      }
    }
  });

  const decisions = new Map(data.decisions.map((d) => [d.id, d]));
  data.decisions.forEach((d, i) => {
    needProject(`decisions[${i}]`, d.projectId);
    if (d.supersedesId === undefined) return;
    const earlier = decisions.get(d.supersedesId);
    if (!earlier || earlier.projectId !== d.projectId) {
      issues.push(`decisions[${i}]: supersedes ${d.supersedesId}, not a decision of its project`);
    }
  });

  let openWork = 0;
  data.workSessions.forEach((w, i) => {
    const label = `workSessions[${i}]`;
    needProject(label, w.projectId);
    attempt(label, () => checkWorkSession(w));
    if (w.endedAt === undefined) openWork += 1;
    if (w.taskId !== undefined) {
      const task = taskById.get(w.taskId);
      if (!task) issues.push(`${label}: task ${w.taskId} is not in the backup`);
      else if (task.projectId !== undefined && task.projectId !== w.projectId) {
        issues.push(`${label}: its task belongs to project ${task.projectId}`);
      }
    }
  });
  if (openWork > 1) issues.push(`workSessions: ${openWork} sessions are open; at most one may be`);

  let openOff = 0;
  const daysOff = new Set<string>();
  data.offTimeSessions.forEach((o, i) => {
    attempt(`offTimeSessions[${i}]`, () => checkOffTime(o));
    if (o.kind !== 'day_off' && o.endedAt === undefined) openOff += 1;
    if (o.kind === 'day_off') {
      if (daysOff.has(o.localDate)) issues.push(`offTimeSessions[${i}]: second day off`);
      daysOff.add(o.localDate);
    }
  });
  if (openOff > 1) issues.push(`offTimeSessions: ${openOff} windows are open; at most one may be`);

  data.events.forEach((e, i) => {
    attempt(`events[${i}]`, () => checkLedgerEvent(e));
    needProject(`events[${i}]`, e.projectId);
  });

  const snapshotDays = new Set<string>();
  data.progressSnapshots.forEach((p, i) => {
    needProject(`progressSnapshots[${i}]`, p.projectId);
    const key = `${p.projectId}|${p.localDate}`;
    if (snapshotDays.has(key)) issues.push(`progressSnapshots[${i}]: second snapshot that day`);
    snapshotDays.add(key);
  });

  data.aiSessions.forEach((a, i) => {
    attempt(`aiSessions[${i}]`, () => checkAiSession(a));
    needProject(`aiSessions[${i}]`, a.projectId);
  });

  data.collegeItems.forEach((c, i) => attempt(`collegeItems[${i}]`, () => checkCollegeItem(c)));
}
