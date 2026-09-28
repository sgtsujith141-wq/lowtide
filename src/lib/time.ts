import { format, isValid, parse } from 'date-fns';
import type { LocalDate, Timestamp } from '../types/domain';

/** Source of "now". Injected into repositories so tests can control time. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** Persisted instant: ISO 8601, UTC, millisecond precision. */
export function toTimestamp(date: Date): Timestamp {
  return date.toISOString();
}

/** Calendar day of `date` in the local time zone, as `YYYY-MM-DD`. */
export function toLocalDate(date: Date): LocalDate {
  return format(date, 'yyyy-MM-dd');
}

/** Local midnight at the start of a `LocalDate`. Throws on malformed input. */
export function fromLocalDate(value: LocalDate): Date {
  const parsed = parse(value, 'yyyy-MM-dd', new Date(0));
  if (!isValid(parsed) || toLocalDate(parsed) !== value) {
    throw new RangeError(`Not a valid local date: ${value}`);
  }
  return parsed;
}
