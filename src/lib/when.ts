import { differenceInCalendarDays, format, isSameYear } from 'date-fns';
import type { Timestamp } from '../types/domain';

/**
 * Short, calm description of when something happened, in local time:
 * "just now", "14:05", "yesterday", "Tue", "12 Sep", "12 Sep 2025".
 */
export function formatWhen(at: Timestamp, now: Date): string {
  const then = new Date(at);
  const seconds = (now.getTime() - then.getTime()) / 1000;
  if (seconds >= 0 && seconds < 60) return 'just now';
  const days = differenceInCalendarDays(now, then);
  if (days === 0) return format(then, 'HH:mm');
  if (days === 1) return 'yesterday';
  if (days > 1 && days < 7) return format(then, 'EEE');
  return format(then, isSameYear(then, now) ? 'd MMM' : 'd MMM yyyy');
}

/** Full local date and time, for tooltips. */
export function formatFull(at: Timestamp): string {
  return format(new Date(at), 'EEEE d MMMM yyyy, HH:mm');
}
