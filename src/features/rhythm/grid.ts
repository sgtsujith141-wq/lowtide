import { format } from 'date-fns';
import { addDays, startOfWeek } from '../../lib/calendar';
import { fromLocalDate } from '../../lib/time';
import type { Habit, HabitEntry, LocalDate } from '../../types/domain';
import { formatValue, habitLevel, LEVEL_WORD, overallLevel, type Level } from './intensity';

/** 26 weeks, about six months: dense enough to show a rhythm, small enough to read. */
export const GRID_WEEKS = 26;

export interface GridDay {
  date: LocalDate;
  level: Level;
  /** Full, color-free description for screen readers and the detail line. */
  label: string;
}

/** `null` marks days after `today` in the current week (not drawn). */
export type GridWeek = (GridDay | null)[];

/** First and last day of the grid ending with `today` (weeks start on Monday). */
export function gridRange(today: LocalDate, weeks = GRID_WEEKS) {
  return { start: addDays(startOfWeek(today), -7 * (weeks - 1)), end: today };
}

/** Which habits the grid shows: all of them combined, or one. */
export type GridView = { kind: 'overall' } | { kind: 'habit'; habitId: string };

function dayLabel(date: LocalDate): string {
  return format(fromLocalDate(date), 'EEEE d MMMM yyyy');
}

/**
 * Builds the week columns ending with `today`. Pure: one pass groups entries
 * by date, then each day is looked up. Only entries passed in can colour a
 * square; nothing is ever inferred.
 */
export function buildGrid(
  today: LocalDate,
  habits: readonly Habit[],
  entries: readonly HabitEntry[],
  view: GridView,
  weeks = GRID_WEEKS,
): GridWeek[] {
  const habitsById = new Map(habits.map((h) => [h.id, h]));
  const byDate = new Map<LocalDate, HabitEntry[]>();
  for (const entry of entries) {
    if (!habitsById.has(entry.habitId)) continue;
    if (view.kind === 'habit' && entry.habitId !== view.habitId) continue;
    const list = byDate.get(entry.date);
    if (list) list.push(entry);
    else byDate.set(entry.date, [entry]);
  }

  const { start } = gridRange(today, weeks);
  const columns: GridWeek[] = [];
  for (let w = 0; w < weeks; w++) {
    const column: GridWeek = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      column.push(
        date > today ? null : describeDay(date, byDate.get(date) ?? [], habitsById, view),
      );
    }
    columns.push(column);
  }
  return columns;
}

function describeDay(
  date: LocalDate,
  dayEntries: readonly HabitEntry[],
  habitsById: ReadonlyMap<string, Habit>,
  view: GridView,
): GridDay {
  const logged = dayEntries
    .map((entry) => ({ entry, habit: habitsById.get(entry.habitId)! }))
    .sort((a, b) => a.habit.name.localeCompare(b.habit.name));
  const levels = logged.map(({ habit, entry }) => habitLevel(habit, entry));
  const level = view.kind === 'overall' ? overallLevel(levels) : (levels[0] ?? 0);

  if (logged.length === 0) return { date, level: 0, label: `${dayLabel(date)}: nothing recorded` };
  const parts = logged.map(({ habit, entry }) =>
    view.kind === 'overall'
      ? `${habit.name} ${formatValue(habit, entry.value)}`
      : formatValue(habit, entry.value),
  );
  const summary =
    view.kind === 'overall'
      ? `${LEVEL_WORD[level]} activity across ${logged.length} ${logged.length === 1 ? 'habit' : 'habits'}`
      : LEVEL_WORD[level];
  return { date, level, label: `${dayLabel(date)}: ${parts.join(', ')} (${summary})` };
}

/** Month label per column: the month's short name where a new month starts. */
export function monthLabels(columns: readonly GridWeek[]): (string | null)[] {
  let previous = '';
  return columns.map((column) => {
    const first = column.find((day) => day !== null);
    if (!first) return null;
    const month = first.date.slice(0, 7);
    if (month === previous) return null;
    previous = month;
    return format(fromLocalDate(first.date), 'MMM');
  });
}
