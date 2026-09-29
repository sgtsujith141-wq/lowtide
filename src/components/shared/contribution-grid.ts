import { format } from 'date-fns';
import { addDays, weekdayIndex } from '../../lib/calendar';
import { fromLocalDate } from '../../lib/time';
import type { LocalDate } from '../../types/domain';

/*
 * Geometry of a GitHub-style contribution calendar (ADR-042): 7 rows, Sunday
 * first, one column per week, the last column ending with today. Pure, so the
 * layout is tested without rendering.
 */

export type Level = 0 | 1 | 2 | 3 | 4;

export const GRID_PALETTES = [
  'pulse',
  'work',
  'sleep',
  'personal',
  'gym',
  'college',
  'projects',
] as const;
export type GridPalette = (typeof GRID_PALETTES)[number];

/** A year: 52 full weeks plus the current one, like GitHub. */
export const YEAR_WEEKS = 53;

/** Sunday of the week containing `day`. */
export function sundayOf(day: LocalDate): LocalDate {
  return addDays(day, -((weekdayIndex(day) + 1) % 7));
}

/** Week columns ending with today's week; days after `today` are `null`. */
export function gridColumns(today: LocalDate, weeks = YEAR_WEEKS): (LocalDate | null)[][] {
  const start = addDays(sundayOf(today), -7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d);
      return date > today ? null : date;
    }),
  );
}

export function gridStart(today: LocalDate, weeks = YEAR_WEEKS): LocalDate {
  return addDays(sundayOf(today), -7 * (weeks - 1));
}

/**
 * Month labels: a column is labelled with its month when its Sunday starts a
 * new month, unless the previous label is fewer than 3 columns away (GitHub
 * skips cramped labels the same way).
 */
export function monthLabels(columns: readonly (LocalDate | null)[][]): (string | null)[] {
  let previousMonth = '';
  let lastLabelled = -Infinity;
  return columns.map((column, i) => {
    const first = column.find((d): d is LocalDate => d !== null);
    if (!first) return null;
    const month = first.slice(0, 7);
    if (month === previousMonth) return null;
    previousMonth = month;
    if (i - lastLabelled < 3) return null;
    lastLabelled = i;
    return format(fromLocalDate(first), 'MMM');
  });
}

/** Full, colour-free day name for labels: "Wednesday 30 September 2026". */
export function longDay(date: LocalDate): string {
  return format(fromLocalDate(date), 'EEEE d MMMM yyyy');
}

/** Weeks needed to show the last `days` days (7, 30, 90, 180, 365). */
export function weeksForDays(days: number): number {
  return Math.max(1, Math.ceil(days / 7) + 1);
}
