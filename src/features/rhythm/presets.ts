import type { HabitCategory } from '../../types/domain';
import type { Level } from './intensity';

/**
 * v2 grid presets (ADR-045): which themed grid, and which Daily Pulse signal,
 * a habit's existing category feeds. Presentation only: habit records keep
 * their category and are never rewritten.
 */
export const GRID_PRESETS = ['work', 'college', 'gym', 'personal'] as const;
export type GridPreset = (typeof GRID_PRESETS)[number];

/**
 * `null`: not mapped. Money stays out of the master Daily Pulse unless the
 * owner configures it later. There is no relationship category to map
 * (ADR-013), and protected time is not a habit.
 */
export const CATEGORY_PRESET: Record<HabitCategory, GridPreset | null> = {
  coding: 'work',
  learning: 'college',
  fitness: 'gym',
  health: 'personal',
  personal: 'personal',
  money: null,
};

/** Routine counts for one day, in the shape the Daily Pulse takes (ADR-037). */
export interface RoutineSignals {
  workRoutines: number;
  collegeRoutines: number;
  movementRoutines: number;
  personalRoutines: number;
}

const SIGNAL_FOR: Record<GridPreset, keyof RoutineSignals> = {
  work: 'workRoutines',
  college: 'collegeRoutines',
  gym: 'movementRoutines',
  personal: 'personalRoutines',
};

/**
 * Counts one day's routines that reached level 1 or more (ADR-024), by
 * preset. Unmapped categories are ignored.
 */
export function routineSignals(
  day: readonly { category: HabitCategory; level: Level }[],
): RoutineSignals {
  const counts: RoutineSignals = {
    workRoutines: 0,
    collegeRoutines: 0,
    movementRoutines: 0,
    personalRoutines: 0,
  };
  for (const { category, level } of day) {
    const preset = CATEGORY_PRESET[category];
    if (preset && level >= 1) counts[SIGNAL_FOR[preset]] += 1;
  }
  return counts;
}
