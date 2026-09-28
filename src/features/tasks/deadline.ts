import { differenceInCalendarDays, format } from 'date-fns';
import { fromLocalDate, localDateOfDeadline } from '../../lib/time';
import type { LocalDate, Timestamp } from '../../types/domain';

export type DeadlineTone = 'overdue' | 'today' | 'soon' | 'later';

export interface DeadlineLabel {
  tone: DeadlineTone;
  /** Always states the meaning in words; tone only adds colour. */
  text: string;
}

function formatDay(day: Date, today: Date): string {
  return format(day, day.getFullYear() === today.getFullYear() ? 'd MMM' : 'd MMM yyyy');
}

/** How a deadline relates to `today`, by local calendar day (ADR-016). */
export function describeDeadline(dueAt: Timestamp, today: LocalDate): DeadlineLabel {
  const due = fromLocalDate(localDateOfDeadline(dueAt));
  const now = fromLocalDate(today);
  const days = differenceInCalendarDays(due, now);
  if (days < 0) {
    return {
      tone: 'overdue',
      text: days === -1 ? 'Was due yesterday' : `Was due ${formatDay(due, now)}`,
    };
  }
  if (days === 0) return { tone: 'today', text: 'Due today' };
  if (days === 1) return { tone: 'soon', text: 'Due tomorrow' };
  if (days < 7) return { tone: 'soon', text: `Due ${format(due, 'EEEE')}` };
  return { tone: 'later', text: `Due ${formatDay(due, now)}` };
}
