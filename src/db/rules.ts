import type { Hackathon, HabitUnit } from '../types/domain';
import { InvalidInputError } from './repositories/errors';

/*
 * Domain invariants beyond record shape. Shared by the repositories (every
 * write) and backup import (every restored record), so a backup can never
 * bring in data the app itself would refuse to write.
 */

/** Longest loggable day, in minutes. Anything above is a typo, not a day. */
export const MAX_MINUTES = 24 * 60;

/** Habit targets: optional, only for count/minutes, positive (ADR-023). */
export function checkHabitTarget(unit: HabitUnit, target: number | undefined) {
  if (target === undefined) return;
  if (unit === 'check') throw new InvalidInputError('A done-or-not habit has no target');
  if (!Number.isFinite(target) || target <= 0) {
    throw new InvalidInputError('A target must be a positive number');
  }
  if (unit === 'count' && !Number.isInteger(target)) {
    throw new InvalidInputError('A count target must be a whole number');
  }
  if (unit === 'minutes' && target > MAX_MINUTES) {
    throw new InvalidInputError(`A minutes target can't exceed ${MAX_MINUTES}`);
  }
}

/** Unit rules for a recorded entry (ADR-023). Zero is not an entry: clear instead. */
export function checkEntryValue(unit: HabitUnit, value: number) {
  const ok =
    unit === 'check'
      ? value === 1
      : unit === 'count'
        ? Number.isInteger(value) && value > 0
        : Number.isFinite(value) && value > 0 && value <= MAX_MINUTES;
  if (!ok) throw new InvalidInputError(`Not a valid ${unit} value: ${value}`);
}

/** Hackathon date range (ADR-027): an end needs a start and can't precede it. */
export function checkHackathonDates(h: Pick<Hackathon, 'eventStart' | 'eventEnd'>) {
  if (h.eventEnd === undefined) return;
  if (h.eventStart === undefined) throw new InvalidInputError('An end date needs a start date');
  if (h.eventEnd < h.eventStart)
    throw new InvalidInputError('The event can’t end before it starts');
}
