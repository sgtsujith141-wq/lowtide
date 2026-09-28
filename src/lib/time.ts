import type { LocalDate, Timestamp } from '../types/domain';

/** Source of "now". Injected into repositories so tests can control time. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** Persisted instant: ISO 8601, UTC, millisecond precision. */
export function toTimestamp(date: Date): Timestamp {
  return date.toISOString();
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Calendar day of `date` in the local time zone, as `YYYY-MM-DD`. */
export function toLocalDate(date: Date): LocalDate {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight at the start of a `LocalDate`. Throws on malformed or impossible input. */
export function fromLocalDate(value: LocalDate): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  // Round-trip rejects overflow such as 2026-02-30 (which Date rolls into March).
  if (!date || toLocalDate(date) !== value) {
    throw new RangeError(`Not a valid local date: ${value}`);
  }
  return date;
}

/*
 * Date-only deadlines (ADR-016). The UI works in calendar days; `Task.dueAt`
 * is a timestamp. A chosen day D is stored as the fixed instant `D T12:00Z`
 * (UTC noon) and read back from its UTC date part, so the day is encoded
 * independently of any time zone: it never shifts when the device's zone or
 * DST changes. Never derive the day with `new Date(dueAt)` in local time.
 * Deadline status (overdue/today/…) compares that day with today's local day.
 */

/** Stored `dueAt` for a deadline on calendar day `value`. */
export function deadlineFromLocalDate(value: LocalDate): Timestamp {
  fromLocalDate(value); // validates
  return `${value}T12:00:00.000Z`;
}

/** Calendar day of a stored `dueAt`. */
export function localDateOfDeadline(dueAt: Timestamp): LocalDate {
  return dueAt.slice(0, 10);
}
