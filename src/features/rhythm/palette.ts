import type { GridDay } from '../../components/shared/ContributionGrid';
import type { GridPalette } from '../../components/shared/contribution-grid';
import type { Habit, LocalDate } from '../../types/domain';
import type { GridView, GridWeek } from './grid';
import { CATEGORY_PRESET } from './presets';

/** A habit's grid palette follows its preset (ADR-045); money uses gold. */
export function habitPalette(habit: Pick<Habit, 'category'>): GridPalette {
  const preset = CATEGORY_PRESET[habit.category];
  if (preset === 'work') return 'work';
  if (preset === 'college') return 'college';
  if (preset === 'gym') return 'gym';
  if (preset === 'personal') return 'personal';
  return 'projects';
}

/** Overall is teal (the original sea-glass rhythm); groups and habits use their presets. */
export function viewPalette(view: GridView, habits: readonly Habit[]): GridPalette {
  if (view.kind === 'group') return view.groupId === 'coding-learning' ? 'college' : 'gym';
  if (view.kind === 'habit') {
    const habit = habits.find((h) => h.id === view.habitId);
    return habit ? habitPalette(habit) : 'personal';
  }
  return 'personal';
}

/** `buildGrid`'s week columns as a map by date (geometry comes from ContributionGrid). */
export function gridDaysOf(weeks: readonly GridWeek[]): Map<LocalDate, GridDay> {
  const days = new Map<LocalDate, GridDay>();
  for (const week of weeks)
    for (const day of week) if (day) days.set(day.date, { level: day.level, label: day.label });
  return days;
}
