import type { Level } from '../rhythm/intensity';

/**
 * Daily Pulse, algorithm version 1 (ADR-037): the v2 master grid's level for
 * one day, from real signals only. Pure and deterministic, so it can be
 * replaced (with a new version and ADR) without touching stored records.
 * The pulse is derived at read time and never persisted.
 *
 * Deliberately absent: protected time (ADR-013, ADR-021), inbox capture,
 * money, and any count of hours beyond the caps below.
 */
export const PULSE_ALGORITHM_VERSION = 1;

export interface PulseSignals {
  /** Active minutes (pauses excluded) of finished project, task and general work sessions. */
  workMinutes: number;
  /** Work-preset (coding) routines at level 1 or more. */
  workRoutines: number;
  /** Tasks completed, milestones completed, decisions recorded, blockers/approvals resolved. */
  progressMoves: number;
  /** Active minutes of finished college/study work sessions. */
  collegeMinutes: number;
  /** College-preset (learning) routines at level 1 or more. */
  collegeRoutines: number;
  /** Personal-preset (personal, health) routines at level 1 or more. */
  personalRoutines: number;
  /** Gym-preset (fitness) routines at level 1 or more. Never required. */
  movementRoutines: number;
  /** A manually started sleep/rest window ended on this day. */
  offTimeCompleted: boolean;
  /** The owner declared this day a day off (a `day_off` off-time record). */
  dayOff: boolean;
}

export const EMPTY_PULSE_SIGNALS: PulseSignals = {
  workMinutes: 0,
  workRoutines: 0,
  progressMoves: 0,
  collegeMinutes: 0,
  collegeRoutines: 0,
  personalRoutines: 0,
  movementRoutines: 0,
  offTimeCompleted: false,
  dayOff: false,
};

/** Minimum session minutes that count as meaningful work or study. */
export const MEANINGFUL_MINUTES = 25;
/** Minutes at which work reaches its cap. More hours never add more. */
export const FULL_WORK_MINUTES = 90;

export interface PulsePoints {
  work: number; // 0–2
  progress: number; // 0–1
  college: number; // 0–1
  personal: number; // 0–2
  movement: number; // 0–1
  recovery: number; // 0–1
}

export interface PulseResult {
  level: Level;
  points: PulsePoints;
  /** Points before banding (0–8). */
  total: number;
  /** True when the day-off rule, not the points, set the level. */
  dayOffApplied: boolean;
}

/** Negative, fractional-count or non-finite input counts as nothing, never as more. */
function amount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** 0 → 0 · 1 → 1 · 2–3 → 2 · 4–5 → 3 · 6+ → 4. */
export function bandPulse(total: number): Level {
  if (total <= 0) return 0;
  if (total === 1) return 1;
  if (total <= 3) return 2;
  if (total <= 5) return 3;
  return 4;
}

export function dailyPulse(signals: PulseSignals): PulseResult {
  const workMinutes = amount(signals.workMinutes);
  const points: PulsePoints = {
    work:
      workMinutes >= FULL_WORK_MINUTES
        ? 2
        : workMinutes >= MEANINGFUL_MINUTES || amount(signals.workRoutines) >= 1
          ? 1
          : 0,
    progress: amount(signals.progressMoves) >= 1 ? 1 : 0,
    college:
      amount(signals.collegeMinutes) >= MEANINGFUL_MINUTES || amount(signals.collegeRoutines) >= 1
        ? 1
        : 0,
    personal: Math.min(2, Math.floor(amount(signals.personalRoutines))),
    movement: amount(signals.movementRoutines) >= 1 ? 1 : 0,
    recovery: signals.offTimeCompleted === true ? 1 : 0,
  };
  const total =
    points.work +
    points.progress +
    points.college +
    points.personal +
    points.movement +
    points.recovery;
  const banded = bandPulse(total);

  // A declared day off is judged on rest, not output: it starts at 1, a
  // completed off-time window adds 2, and any personal or movement routine
  // adds 1. Working anyway never lowers it (the higher level wins).
  if (signals.dayOff !== true) return { level: banded, points, total, dayOffApplied: false };
  const rest = 1 + 2 * points.recovery + Math.min(1, points.personal + points.movement);
  const restLevel = Math.min(4, rest) as Level;
  return {
    level: restLevel > banded ? restLevel : banded,
    points,
    total,
    dayOffApplied: restLevel > banded,
  };
}
