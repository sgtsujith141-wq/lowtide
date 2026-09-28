import type { Habit, HabitEntry } from '../../types/domain';

/** Display-only activity level. Never persisted, never a score (ADR-024). */
export type Level = 0 | 1 | 2 | 3 | 4;

export const LEVEL_WORD: Record<Level, string> = {
  0: 'no activity',
  1: 'light',
  2: 'moderate',
  3: 'strong',
  4: 'high',
};

/**
 * One habit's level for one day (ADR-024):
 * - no entry → 0;
 * - `check` logged → 4 (the habit is fully done);
 * - `count`/`minutes` with a target → by share of the target:
 *   under 25% → 1, 25–<50% → 2, 50–<100% → 3, at or over 100% → 4;
 * - `count`/`minutes` without a target → 2. There is nothing to be partial
 *   of, so the square says "recorded" rather than inventing how full the day was.
 */
export function habitLevel(habit: Habit, entry: HabitEntry | undefined): Level {
  if (!entry) return 0;
  if (habit.unit === 'check') return 4;
  if (!habit.target) return 2;
  const share = entry.value / habit.target;
  if (share >= 1) return 4;
  if (share >= 0.5) return 3;
  if (share >= 0.25) return 2;
  return 1;
}

/**
 * Overall level for one day (ADR-025): add up the per-habit levels of every
 * habit with an entry that day (archived habits included, so history never
 * changes), then band the sum:
 *   0 → 0 · 1–3 → 1 · 4–7 → 2 · 8–11 → 3 · 12+ → 4.
 * One fully done habit reads "moderate", two "strong", three or more "high".
 * Each habit contributes at most 4, so one huge entry can't fill the day by
 * itself, and adding a new habit never dims past days (there is no denominator).
 */
export function overallLevel(levels: readonly Level[]): Level {
  const sum = levels.reduce<number>((total, level) => total + level, 0);
  if (sum === 0) return 0;
  if (sum < 4) return 1;
  if (sum < 8) return 2;
  if (sum < 12) return 3;
  return 4;
}

/** "45 min", "3 of 5", "done". */
export function formatValue(habit: Habit, value: number): string {
  if (habit.unit === 'check') return 'done';
  const amount = habit.unit === 'minutes' ? `${value} min` : String(value);
  if (!habit.target) return amount;
  return habit.unit === 'minutes'
    ? `${value} of ${habit.target} min`
    : `${value} of ${habit.target}`;
}
