/**
 * LOWTIDE domain types.
 *
 * Conventions (see docs/DATA-MODEL.md):
 * - `Id` is a UUID v4 string from `crypto.randomUUID()`.
 * - `Timestamp` is an ISO 8601 instant in UTC, always from `Date#toISOString()`
 *   (e.g. `2026-09-28T14:03:11.402Z`). Fixed width, so strings sort chronologically.
 * - `LocalDate` is a calendar day in the user's local time zone, `YYYY-MM-DD`.
 *   Used where the meaning is "which day", not "which instant" (habits, protected time).
 * - Optional fields are omitted when absent, never stored as `null`.
 *
 * Each union is backed by a runtime `as const` array so the Zod schemas in
 * src/db/schema.ts and any future UI pickers share one list.
 */

export type Id = string;
export type Timestamp = string;
export type LocalDate = string;

export const TASK_STATUSES = ['todo', 'doing', 'done', 'dropped'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface Task {
  id: Id;
  title: string;
  notes?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt?: Timestamp;
  /** Free-text project label. There is no Project entity yet. */
  project?: string;
  createdAt: Timestamp;
  /** Set when status becomes `done`; cleared if the task is reopened. */
  completedAt?: Timestamp;
  updatedAt: Timestamp;
}

export interface InboxItem {
  id: Id;
  content: string;
  createdAt: Timestamp;
  /** Set once the item has been dealt with (converted, filed or discarded). */
  processedAt?: Timestamp;
  convertedToTaskId?: Id;
}

/**
 * Deliberately no relationship/family/friends category: time with people is
 * never tracked as a habit, streak or activity square. It lives in
 * `ProtectedTime` instead.
 */
export const HABIT_CATEGORIES = [
  'coding',
  'learning',
  'fitness',
  'health',
  'money',
  'personal',
] as const;
export type HabitCategory = (typeof HABIT_CATEGORIES)[number];

/** `check`: value is 1 when done that day. `count`/`minutes`: value is the amount. */
export const HABIT_UNITS = ['check', 'count', 'minutes'] as const;
export type HabitUnit = (typeof HABIT_UNITS)[number];

export interface Habit {
  id: Id;
  name: string;
  category: HabitCategory;
  unit: HabitUnit;
  /** Daily amount that counts as "done" for `count`/`minutes` habits. */
  target?: number;
  archived: boolean;
  createdAt: Timestamp;
}

/** At most one entry per habit per local day (enforced by a unique index). */
export interface HabitEntry {
  id: Id;
  habitId: Id;
  date: LocalDate;
  value: number;
  note?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const REGISTRATION_STATUSES = [
  'not_registered',
  'registered',
  'waitlisted',
  'rejected',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const PPT_STATUSES = ['not_needed', 'not_started', 'in_progress', 'submitted'] as const;
export type PptStatus = (typeof PPT_STATUSES)[number];

export const BUILD_STATUSES = ['not_started', 'in_progress', 'demo_ready', 'submitted'] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

/** Overall lifecycle of a hackathon, independent of the per-track statuses above. */
export const HACKATHON_STATUSES = ['considering', 'active', 'finished', 'dropped'] as const;
export type HackathonStatus = (typeof HACKATHON_STATUSES)[number];

export interface Hackathon {
  id: Id;
  name: string;
  registrationDeadline?: Timestamp;
  eventStart?: Timestamp;
  eventEnd?: Timestamp;
  registrationStatus: RegistrationStatus;
  pptStatus: PptStatus;
  buildStatus: BuildStatus;
  /** Free text, e.g. teammate names. */
  team?: string;
  problemStatement?: string;
  nextAction?: string;
  status: HackathonStatus;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const PROTECTED_TIME_KINDS = [
  'relationship',
  'family',
  'friends',
  'rest',
  'personal',
] as const;
export type ProtectedTimeKind = (typeof PROTECTED_TIME_KINDS)[number];

export interface ProtectedTime {
  id: Id;
  title: string;
  date: LocalDate;
  kind: ProtectedTimeKind;
  notes?: string;
}
