import type { LocalDate } from '../types/domain';
import { fromLocalDate } from './time';

/*
 * Calendar arithmetic on `LocalDate` strings. A day is a (year, month, day)
 * triple, so arithmetic runs on UTC date fields, where every day is exactly
 * 24 hours. Local time zones and DST can't skip or repeat a day here.
 */

const MS_PER_DAY = 86_400_000;

function toUtcMs(day: LocalDate): number {
  fromLocalDate(day); // validates
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

function fromUtcMs(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: LocalDate, days: number): LocalDate {
  return fromUtcMs(toUtcMs(day) + days * MS_PER_DAY);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(day: LocalDate): number {
  return (new Date(toUtcMs(day)).getUTCDay() + 6) % 7;
}

/** Monday of the week containing `day`. */
export function startOfWeek(day: LocalDate): LocalDate {
  return addDays(day, -weekdayIndex(day));
}

/** Every day from `start` to `end`, inclusive. */
export function eachDay(start: LocalDate, end: LocalDate): LocalDate[] {
  const count = daysBetween(start, end);
  return Array.from({ length: Math.max(0, count + 1) }, (_, i) => addDays(start, i));
}
