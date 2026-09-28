import { format } from 'date-fns';
import { addDays } from '../../lib/calendar';
import { fromLocalDate } from '../../lib/time';
import type { LocalDate, ProtectedTime } from '../../types/domain';

export const WEEK_LENGTH = 7;

export interface WeekDay {
  date: LocalDate;
  /** "Today", "Tomorrow", then the weekday: unique across the seven days. */
  heading: string;
  /** Lower-case form for sentences and button names: "today", "tomorrow", "Friday". */
  word: string;
  /** "Mon 28 Sep". */
  short: string;
}

/** Today and the next six local days (ADR-035). Calendar-day maths, never instants. */
export function weekAhead(today: LocalDate): WeekDay[] {
  return Array.from({ length: WEEK_LENGTH }, (_, i) => {
    const date = addDays(today, i);
    const weekday = format(fromLocalDate(date), 'EEEE');
    const heading = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekday;
    return {
      date,
      heading,
      word: i < 2 ? heading.toLowerCase() : weekday,
      short: format(fromLocalDate(date), 'EEE d MMM'),
    };
  });
}

/** Entries grouped under each of the days, keeping the repository's order. */
export function groupByDay(
  days: readonly WeekDay[],
  entries: readonly ProtectedTime[],
): { day: WeekDay; entries: ProtectedTime[] }[] {
  return days.map((day) => ({ day, entries: entries.filter((e) => e.date === day.date) }));
}
