import type { HabitCategory, HabitUnit } from '../../types/domain';

export const CATEGORY_LABEL: Record<HabitCategory, string> = {
  coding: 'Coding',
  learning: 'Learning',
  fitness: 'Fitness',
  health: 'Health',
  money: 'Money',
  personal: 'Personal',
};

export const UNIT_LABEL: Record<HabitUnit, string> = {
  check: 'Done or not',
  count: 'Count',
  minutes: 'Minutes',
};
