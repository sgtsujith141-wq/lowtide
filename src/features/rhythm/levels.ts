import type { Level } from './intensity';

/** Tailwind classes for each activity level; the only place levels meet colour. */
export const LEVEL_CLASS: Record<Level, string> = {
  0: 'bg-activity-0',
  1: 'bg-activity-1',
  2: 'bg-activity-2',
  3: 'bg-activity-3',
  4: 'bg-activity-4',
};
