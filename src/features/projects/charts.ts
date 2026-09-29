import type { GridDay } from '../../components/shared/ContributionGrid';
import { longDay, type Level } from '../../components/shared/contribution-grid';
import { addDays, daysBetween, eachDay, startOfWeek } from '../../lib/calendar';
import type { LedgerEvent, LocalDate, ProgressSnapshot, WorkSession } from '../../types/domain';
import { formatMinutes, projectLevel, workLevel } from '../pulse/days';
import { activeMinutes } from '../work/duration';

/*
 * Chart data for the Command Room, from real records only (pure).
 */

export interface ProgressPoint {
  date: LocalDate;
  /** Percent of milestone weight done that day, or null before any milestone. */
  percent: number | null;
  /** True when the value was carried forward from an earlier snapshot. */
  carried: boolean;
}

/**
 * Daily series from the first snapshot to `today`. Days without a snapshot
 * carry the previous values forward at render time (architecture §6); no day
 * before the first snapshot is shown, so nothing is invented.
 */
export function progressSeries(
  snapshots: readonly ProgressSnapshot[],
  today: LocalDate,
): ProgressPoint[] {
  if (snapshots.length === 0) return [];
  const byDay = new Map(snapshots.map((s) => [s.localDate, s]));
  const first = snapshots.reduce((min, s) => (s.localDate < min ? s.localDate : min), today);
  let last: ProgressSnapshot | undefined;
  return eachDay(first, today).map((date) => {
    const own = byDay.get(date);
    if (own) last = own;
    const s = own ?? last;
    return {
      date,
      percent:
        s && s.totalWeight > 0 ? Math.floor((s.completedWeight / s.totalWeight) * 100) : null,
      carried: !own,
    };
  });
}

export interface WeekBar {
  weekStart: LocalDate;
  minutes: number;
}

/** Active work minutes per Monday-first week, the last `weeks` weeks ending this week. */
export function weeklyMinutes(
  sessions: readonly WorkSession[],
  today: LocalDate,
  weeks = 12,
): WeekBar[] {
  const thisWeek = startOfWeek(today);
  const bars = Array.from({ length: weeks }, (_, i) => ({
    weekStart: addDays(thisWeek, -7 * (weeks - 1 - i)),
    minutes: 0,
  }));
  for (const s of sessions) {
    if (s.endedAt === undefined) continue;
    const index = weeks - 1 - Math.floor(daysBetween(startOfWeek(s.localDate), thisWeek) / 7);
    if (index >= 0 && index < weeks) bars[index]!.minutes += activeMinutes(s);
  }
  return bars;
}

const MOVEMENT = new Set<LedgerEvent['type']>([
  'work.finished',
  'task.completed',
  'milestone.completed',
  'decision.recorded',
  'project.approval_requested',
  'project.item_parked',
  'project.updated',
  'ai.session.completed',
]);

/**
 * The project's own contribution calendar (gold): the higher of its work
 * level (minutes that day) and its movement level (events that day). Only
 * days with real records get a square; nothing before the project existed.
 */
export function projectCalendar(
  events: readonly LedgerEvent[],
  sessions: readonly WorkSession[],
): Map<LocalDate, GridDay> {
  const minutes = new Map<LocalDate, number>();
  for (const s of sessions) {
    if (s.endedAt === undefined) continue;
    minutes.set(s.localDate, (minutes.get(s.localDate) ?? 0) + activeMinutes(s));
  }
  const moves = new Map<LocalDate, number>();
  for (const e of events) {
    if (!MOVEMENT.has(e.type) || e.type === 'work.finished') continue;
    moves.set(e.localDate, (moves.get(e.localDate) ?? 0) + 1);
  }
  const days = new Map<LocalDate, GridDay>();
  for (const date of new Set([...minutes.keys(), ...moves.keys()])) {
    const m = minutes.get(date) ?? 0;
    const n = moves.get(date) ?? 0;
    const level = Math.max(workLevel(m), projectLevel(n)) as Level;
    if (level === 0) continue;
    const parts = [
      m ? `${formatMinutes(m)} of work` : '',
      n ? `${n} update${n === 1 ? '' : 's'}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    days.set(date, { level, label: `${longDay(date)}: ${parts}` });
  }
  return days;
}
