import type { GridDay } from '../../components/shared/ContributionGrid';
import type { Level } from '../../components/shared/contribution-grid';
import { longDay } from '../../components/shared/contribution-grid';
import type { ActivitySources } from '../../db/repositories';
import { eachDay } from '../../lib/calendar';
import { toLocalDate } from '../../lib/time';
import type { HabitCategory, LocalDate, WorkSession } from '../../types/domain';
import { habitLevel, overallLevel } from '../rhythm/intensity';
import { CATEGORY_PRESET, routineSignals } from '../rhythm/presets';
import { activeMinutes } from '../work/duration';
import {
  dailyPulse,
  EMPTY_PULSE_SIGNALS,
  type PulseResult,
  type PulseSignals,
} from './daily-pulse';

/*
 * From raw records to one summary per day (ADR-037). Pure: the Daily Pulse
 * and every themed grid are derived here at read time, never stored.
 * Only records passed in can colour a square; nothing is inferred.
 */

export interface DaySummary {
  date: LocalDate;
  signals: PulseSignals;
  pulse: PulseResult;
  workMinutes: number;
  collegeMinutes: number;
  tasksCompleted: number;
  milestonesCompleted: number;
  decisions: number;
  resolved: number;
  /** Routines at level ≥ 1 that day, with their category and level. */
  routines: { name: string; category: HabitCategory; level: Level }[];
  /** Minutes of off-time (sleep/rest) windows that ended this day. */
  offTimeMinutes: number;
  /** Attended classes/labs and done assignments, exams and events (ADR-051). */
  collegeDone: number;
  dayOff: boolean;
}

const dayOf = (at: string) => toLocalDate(new Date(at));

function emptyDay(date: LocalDate): DaySummary {
  return {
    date,
    signals: { ...EMPTY_PULSE_SIGNALS },
    pulse: dailyPulse(EMPTY_PULSE_SIGNALS),
    workMinutes: 0,
    collegeMinutes: 0,
    tasksCompleted: 0,
    milestonesCompleted: 0,
    decisions: 0,
    resolved: 0,
    routines: [],
    offTimeMinutes: 0,
    collegeDone: 0,
    dayOff: false,
  };
}

export function summariseDays(
  sources: ActivitySources,
  start: LocalDate,
  end: LocalDate,
): Map<LocalDate, DaySummary> {
  const days = new Map<LocalDate, DaySummary>();
  const day = (date: LocalDate) => {
    if (date < start || date > end) return null;
    let summary = days.get(date);
    if (!summary) {
      summary = emptyDay(date);
      days.set(date, summary);
    }
    return summary;
  };

  for (const session of sources.workSessions) {
    if (session.endedAt === undefined) continue;
    const d = day(session.localDate);
    if (!d) continue;
    const minutes = activeMinutes(session);
    if (session.kind === 'college') d.collegeMinutes += minutes;
    else d.workMinutes += minutes;
  }
  for (const task of sources.completedTasks) {
    const d = task.completedAt ? day(dayOf(task.completedAt)) : null;
    if (d) d.tasksCompleted += 1;
  }
  for (const milestone of sources.milestones) {
    const d = milestone.completedAt ? day(dayOf(milestone.completedAt)) : null;
    if (d) d.milestonesCompleted += 1;
  }
  for (const decision of sources.decisions) {
    const d = day(dayOf(decision.decidedAt));
    if (d) d.decisions += 1;
  }
  for (const item of sources.resolvedItems) {
    const d = item.resolvedAt ? day(dayOf(item.resolvedAt)) : null;
    if (d) d.resolved += 1;
  }
  const habits = new Map(sources.habits.map((h) => [h.id, h]));
  for (const entry of sources.habitEntries) {
    const habit = habits.get(entry.habitId);
    const d = habit ? day(entry.date) : null;
    if (!habit || !d) continue;
    const level = habitLevel(habit, entry);
    if (level >= 1) d.routines.push({ name: habit.name, category: habit.category, level });
  }
  for (const off of sources.offTimeSessions) {
    if (off.kind === 'day_off') {
      const d = day(off.localDate);
      if (d) d.dayOff = true;
    } else if (off.startedAt && off.endedAt) {
      const d = day(dayOf(off.endedAt));
      if (d)
        d.offTimeMinutes += Math.round(
          (Date.parse(off.endedAt) - Date.parse(off.startedAt)) / 60_000,
        );
    }
  }

  for (const item of sources.collegeDone) {
    const d = day(item.date);
    if (d) d.collegeDone += 1;
  }

  for (const d of days.values()) {
    d.routines.sort((a, b) => a.name.localeCompare(b.name));
    const routines = routineSignals(d.routines);
    d.signals = {
      ...routines,
      // College activity also counts attended classes and done coursework (ADR-051).
      collegeRoutines: routines.collegeRoutines + d.collegeDone,
      workMinutes: d.workMinutes,
      collegeMinutes: d.collegeMinutes,
      progressMoves: d.tasksCompleted + d.milestonesCompleted + d.decisions + d.resolved,
      offTimeCompleted: d.offTimeMinutes > 0,
      dayOff: d.dayOff,
    };
    d.pulse = dailyPulse(d.signals);
  }
  return days;
}

/* Themed grid levels (presentation only; each capped, none rewards excess). */

/** Work minutes: 1–29 · 30–89 · 90–179 · 180+. Beyond 3 hours adds nothing. */
export function workLevel(minutes: number): Level {
  if (minutes <= 0) return 0;
  if (minutes < 30) return 1;
  if (minutes < 90) return 2;
  if (minutes < 180) return 3;
  return 4;
}

/** Project movement count: 1 · 2 · 3–4 · 5+. */
export function projectLevel(moves: number): Level {
  if (moves <= 0) return 0;
  if (moves === 1) return 1;
  if (moves === 2) return 2;
  if (moves <= 4) return 3;
  return 4;
}

/**
 * Length of the marked off-time window, never a sleep measurement:
 * under 3 h · 3–<5 h · 5–<7 h · 7 h+.
 */
export function offTimeLevel(minutes: number): Level {
  if (minutes <= 0) return 0;
  if (minutes < 180) return 1;
  if (minutes < 300) return 2;
  if (minutes < 420) return 3;
  return 4;
}

const presetLevels = (d: DaySummary, preset: 'personal' | 'gym' | 'college' | 'work') =>
  d.routines.filter((r) => CATEGORY_PRESET[r.category] === preset).map((r) => r.level);

export type ThemedGrid = 'pulse' | 'work' | 'projects' | 'college' | 'personal' | 'sleep' | 'gym';

const PULSE_WORD = ['no pulse', 'light pulse', 'moderate pulse', 'strong pulse', 'high pulse'];

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} h${m ? ` ${m} m` : ''}` : `${m} m`;
}

/** What a day holds, in words, for tooltips and screen readers. */
export function describeDay(d: DaySummary): string[] {
  const parts: string[] = [];
  if (d.workMinutes) parts.push(`${duration(d.workMinutes)} work`);
  if (d.collegeMinutes) parts.push(`${duration(d.collegeMinutes)} study`);
  if (d.tasksCompleted)
    parts.push(`${d.tasksCompleted} task${d.tasksCompleted === 1 ? '' : 's'} done`);
  if (d.milestonesCompleted)
    parts.push(`${d.milestonesCompleted} milestone${d.milestonesCompleted === 1 ? '' : 's'}`);
  if (d.decisions) parts.push(`${d.decisions} decision${d.decisions === 1 ? '' : 's'}`);
  if (d.resolved) parts.push(`${d.resolved} resolved`);
  if (d.routines.length)
    parts.push(`${d.routines.length} routine${d.routines.length === 1 ? '' : 's'}`);
  if (d.collegeDone) parts.push(`${d.collegeDone} college item${d.collegeDone === 1 ? '' : 's'}`);
  if (d.offTimeMinutes) parts.push(`off time ${duration(d.offTimeMinutes)}`);
  if (d.dayOff) parts.push('day off');
  return parts;
}

/** Level and label per date for one themed grid. */
export function gridDays(
  summaries: ReadonlyMap<LocalDate, DaySummary>,
  grid: ThemedGrid,
): Map<LocalDate, GridDay> {
  const result = new Map<LocalDate, GridDay>();
  for (const d of summaries.values()) {
    let level: Level;
    let text: string;
    switch (grid) {
      case 'pulse':
        level = d.pulse.level;
        text = describeDay(d).join(', ') || 'nothing recorded';
        text = `${PULSE_WORD[level]}: ${text}`;
        break;
      case 'work': {
        const routines = presetLevels(d, 'work');
        level = Math.max(workLevel(d.workMinutes), routines.length ? 1 : 0) as Level;
        text = d.workMinutes ? `${duration(d.workMinutes)} of work` : 'no work session';
        if (routines.length)
          text += `, ${routines.length} coding routine${routines.length === 1 ? '' : 's'}`;
        break;
      }
      case 'projects': {
        const moves = d.signals.progressMoves;
        level = projectLevel(moves);
        text = moves
          ? `${moves} piece${moves === 1 ? '' : 's'} of progress`
          : 'no progress recorded';
        break;
      }
      case 'college': {
        const routines = presetLevels(d, 'college');
        const items = projectLevel(d.collegeDone);
        level = Math.max(workLevel(d.collegeMinutes), overallLevel(routines), items) as Level;
        text = d.collegeMinutes ? `${duration(d.collegeMinutes)} of study` : 'no study session';
        if (routines.length)
          text += `, ${routines.length} learning routine${routines.length === 1 ? '' : 's'}`;
        if (d.collegeDone)
          text += `, ${d.collegeDone} class${d.collegeDone === 1 ? '' : 'es'} or coursework`;
        break;
      }
      case 'personal': {
        const levels = presetLevels(d, 'personal');
        level = overallLevel(levels);
        text = levels.length
          ? `${levels.length} personal routine${levels.length === 1 ? '' : 's'}`
          : 'no personal routine';
        break;
      }
      case 'gym': {
        // Movement isn't "more is better": the best session that day sets the square.
        const levels = presetLevels(d, 'gym');
        level = levels.reduce<Level>((max, l) => (l > max ? l : max), 0);
        text = levels.length
          ? `${levels.length} gym routine${levels.length === 1 ? '' : 's'}`
          : 'no gym routine';
        break;
      }
      case 'sleep':
        level = offTimeLevel(d.offTimeMinutes);
        text = d.offTimeMinutes
          ? `off-time window of ${duration(d.offTimeMinutes)} (marked, not measured)`
          : 'no off time marked';
        if (d.dayOff) text += ', day off';
        break;
    }
    if (level > 0 || grid === 'pulse')
      result.set(d.date, { level, label: `${longDay(d.date)}: ${text}` });
  }
  return result;
}

/** Sums active work minutes per day for a list of sessions (e.g. one project). */
export function minutesByDay(sessions: readonly WorkSession[], start: LocalDate, end: LocalDate) {
  const totals = new Map<LocalDate, number>(eachDay(start, end).map((d) => [d, 0]));
  for (const s of sessions) {
    if (s.endedAt === undefined || !totals.has(s.localDate)) continue;
    totals.set(s.localDate, totals.get(s.localDate)! + activeMinutes(s));
  }
  return totals;
}

export { duration as formatMinutes };
