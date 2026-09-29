/*
 * Data upgrades that run inside Dexie version steps. Pure functions on plain
 * records, so they can be unit-tested and reasoned about without a database.
 */

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

export const HACKATHON_DATE_FIELDS = ['registrationDeadline', 'eventStart', 'eventEnd'] as const;

function isRealLocalDate(value: string): boolean {
  if (!LOCAL_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * V2 → V3 for one hackathon record (ADR-027). For each date field:
 * - absent → stays absent;
 * - already `YYYY-MM-DD` (a real date) → kept;
 * - an ISO timestamp → its UTC date component (`toISOString().slice(0, 10)`);
 * - anything else → removed from the field, but never lost: the raw value
 *   is appended to `notes` as `[Moved by LOWTIDE upgrade] eventStart: <raw>`
 *   so the record still validates and the user can see what was there.
 * Additionally, if `eventEnd` ends up before `eventStart`, or exists without
 * `eventStart`, it is moved to notes the same way (the V3 rules forbid it).
 * Returns a new object; the input is not mutated.
 */
export function migrateHackathonToV3(record: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...record };
  const moved: string[] = [];

  for (const field of HACKATHON_DATE_FIELDS) {
    if (!(field in next)) continue;
    const value = next[field];
    if (value === undefined) {
      delete next[field];
      continue;
    }
    if (typeof value === 'string' && isRealLocalDate(value)) continue;
    if (typeof value === 'string' && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value))) {
      next[field] = new Date(value).toISOString().slice(0, 10);
      continue;
    }
    moved.push(`${field}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    delete next[field];
  }

  const start = next.eventStart as string | undefined;
  const end = next.eventEnd as string | undefined;
  if (end !== undefined && (start === undefined || end < start)) {
    moved.push(`eventEnd: ${end}`);
    delete next.eventEnd;
  }

  if (moved.length > 0) {
    const note = moved.map((line) => `[Moved by LOWTIDE upgrade] ${line}`).join('\n');
    const existing = typeof next.notes === 'string' && next.notes.trim() ? next.notes : '';
    next.notes = existing ? `${existing}\n${note}` : note;
  }
  return next;
}

/** Stores that exist since schema V1 (and are all a V1–V3 backup has). */
export const LEGACY_STORE_NAMES = [
  'tasks',
  'inbox',
  'habits',
  'habitEntries',
  'hackathons',
  'protectedTime',
] as const;

/** Stores added by schema V4 (ADR-046). */
export const V4_STORE_NAMES = [
  'projects',
  'milestones',
  'projectItems',
  'decisions',
  'workSessions',
  'offTimeSessions',
  'events',
  'progressSnapshots',
  'aiSessions',
] as const;

/** Stores added by schema V5 (ADR-051). */
export const V5_STORE_NAMES = ['collegeItems'] as const;

/** Persisted stores, in the order backups list them. */
export const STORE_NAMES = [...LEGACY_STORE_NAMES, ...V4_STORE_NAMES, ...V5_STORE_NAMES] as const;
export type StoreName = (typeof STORE_NAMES)[number];

/** The stores a backup written under `schemaVersion` must contain. */
export function storesForSchema(schemaVersion: number): readonly StoreName[] {
  if (schemaVersion >= 5) return STORE_NAMES;
  if (schemaVersion === 4) return [...LEGACY_STORE_NAMES, ...V4_STORE_NAMES];
  return LEGACY_STORE_NAMES;
}

export type RawSnapshot = Record<StoreName, Record<string, unknown>[]>;

/**
 * Upgrades a snapshot's records from database schema `from` to the current
 * one, in memory, with the very same functions the database upgrade steps
 * use. V1 → V2 changed no record data (only added an index); V2 → V3 runs
 * `migrateHackathonToV3` on every hackathon; V3 → V4 adds the nine new
 * stores empty and changes nothing else (no projects are derived from task
 * labels, no hackathons converted, no history synthesized); V4 → V5 adds
 * `collegeItems` empty. Returns new arrays.
 */
export function migrateSnapshot(
  snapshot: Partial<RawSnapshot> & Pick<RawSnapshot, (typeof LEGACY_STORE_NAMES)[number]>,
  from: number,
): RawSnapshot {
  const next = { ...snapshot } as RawSnapshot;
  if (from < 3) next.hackathons = snapshot.hackathons.map(migrateHackathonToV3);
  if (from < 4) for (const store of V4_STORE_NAMES) next[store] = [];
  if (from < 5) for (const store of V5_STORE_NAMES) next[store] = [];
  return next;
}
