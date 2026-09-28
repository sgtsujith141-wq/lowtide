import { differenceInCalendarDays, format } from 'date-fns';
import { fromLocalDate } from '../../lib/time';
import type { LocalDate } from '../../types/domain';

/**
 * Words for a task's `plannedFor` relative to `today`, or null when there is
 * nothing worth saying. Past plans are not mentioned: an unfinished plan from
 * an earlier day is not a failure to point at.
 */
export function describePlan(plannedFor: LocalDate | undefined, today: LocalDate): string | null {
  if (!plannedFor || plannedFor < today) return null;
  if (plannedFor === today) return 'In today’s plan';
  const day = fromLocalDate(plannedFor);
  const days = differenceInCalendarDays(day, fromLocalDate(today));
  if (days === 1) return 'Planned for tomorrow';
  if (days < 7) return `Planned for ${format(day, 'EEEE')}`;
  return `Planned for ${format(day, 'd MMM')}`;
}
