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
  /** Free-text project label (v0.1). Kept verbatim; never derived into a Project. */
  project?: string;
  /** Link to a Project (schema V4). Set only by an explicit action. */
  projectId?: Id;
  /** A milestone of the same project (schema V4). Requires `projectId`. */
  milestoneId?: Id;
  /**
   * The local day the user chose to work on this ("in my plan for that day").
   * Independent of `dueAt`: planning never changes the deadline and vice versa.
   * Kept after completion as a record of intent (ADR-019).
   */
  plannedFor?: LocalDate;
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
  /** Calendar days, not instants (schema V3, ADR-027). Exact times go in `notes`. */
  registrationDeadline?: LocalDate;
  eventStart?: LocalDate;
  /** Not before `eventStart`; only set together with `eventStart`. */
  eventEnd?: LocalDate;
  registrationStatus: RegistrationStatus;
  pptStatus: PptStatus;
  buildStatus: BuildStatus;
  /** Free text, e.g. teammate names. */
  team?: string;
  problemStatement?: string;
  nextAction?: string;
  status: HackathonStatus;
  notes?: string;
  /** A technical Project tracking the build (schema V4, ADR-039). Owner-set only. */
  projectId?: Id;
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

/* ------------------------------------------------------------------------ */
/* Schema V4 (LOWTIDE v2, ADR-046). See docs/LOWTIDE-V2-ARCHITECTURE.md §3–§9. */
/* ------------------------------------------------------------------------ */

export const PROJECT_STATES = [
  'planning',
  'active',
  'waiting',
  'needs_approval',
  'blocked',
  'parked',
  'review',
  'done',
  'archived',
] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

export const PROJECT_KINDS = ['software', 'research', 'other'] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export interface Project {
  id: Id;
  name: string;
  /** Unique, `[a-z0-9-]`, 1–64 chars. The workspace folder name. */
  slug: string;
  kind: ProjectKind;
  state: ProjectState;
  /** What "done" means, in a sentence. */
  objective?: string;
  /** The current phase in words ("Foundation", "Beta"…). */
  phase?: string;
  nextAction?: string;
  /** Informational only: nothing is fetched (ADR-041). */
  repoUrl?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  stateChangedAt: Timestamp;
}

export interface Milestone {
  id: Id;
  projectId: Id;
  title: string;
  notes?: string;
  /** Whole number ≥ 0, unique within the project. */
  order: number;
  /** Finite and above 0; defaults to 1 (ADR-038). */
  weight: number;
  dueOn?: LocalDate;
  completedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const PROJECT_LANES = [
  'working_now',
  'next',
  'waiting',
  'needs_approval',
  'blocked',
  'parked',
  'done',
] as const;
export type ProjectLane = (typeof PROJECT_LANES)[number];

export const PROJECT_ITEM_KINDS = [
  'focus',
  'step',
  'dependency',
  'approval',
  'blocker',
  'idea',
  'note',
] as const;
export type ProjectItemKind = (typeof PROJECT_ITEM_KINDS)[number];

/** Command, status and context information that isn't naturally a Task. */
export interface ProjectItem {
  id: Id;
  projectId: Id;
  kind: ProjectItemKind;
  lane: ProjectLane;
  title: string;
  body?: string;
  /** Who or what it waits on; only in lane `waiting`. */
  waitingOn?: string;
  /** A task of the same project, annotated rather than copied. */
  taskId?: Id;
  milestoneId?: Id;
  order: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  laneChangedAt: Timestamp;
  /** Present exactly when `lane` is `done`. */
  resolvedAt?: Timestamp;
}

export const DECISION_ORIGINS = ['owner', 'accepted-proposal'] as const;
export type DecisionOrigin = (typeof DECISION_ORIGINS)[number];

/** Immutable. Changed only by recording a newer decision that supersedes it. */
export interface Decision {
  id: Id;
  projectId: Id;
  title: string;
  context?: string;
  decision: string;
  consequences?: string;
  decidedAt: Timestamp;
  supersedesId?: Id;
  origin: DecisionOrigin;
  createdAt: Timestamp;
}

export const WORK_KINDS = ['project', 'task', 'college', 'general'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export interface WorkPause {
  at: Timestamp;
  resumedAt?: Timestamp;
}

export interface WorkSession {
  id: Id;
  kind: WorkKind;
  projectId?: Id;
  taskId?: Id;
  intent?: string;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  pauses: WorkPause[];
  /** The local day it started. */
  localDate: LocalDate;
  outcome?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const OFFTIME_KINDS = ['sleep', 'rest', 'day_off'] as const;
export type OffTimeKind = (typeof OFFTIME_KINDS)[number];

/**
 * A manually marked off-time window (sleep/rest), or a declared day off.
 * Never a claim about physiological sleep. Not protected time (ADR-021).
 */
export interface OffTimeSession {
  id: Id;
  kind: OffTimeKind;
  localDate: LocalDate;
  startedAt?: Timestamp;
  endedAt?: Timestamp;
  note?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const EVENT_TYPES = [
  'work.started',
  'work.paused',
  'work.resumed',
  'work.finished',
  'offtime.started',
  'offtime.ended',
  'habit.logged',
  'task.completed',
  'milestone.completed',
  'project.updated',
  'project.approval_requested',
  'project.item_parked',
  'decision.recorded',
  'ai.session.completed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ENTITY_TYPES = [
  'workSession',
  'offTimeSession',
  'habitEntry',
  'task',
  'milestone',
  'project',
  'projectItem',
  'decision',
  'aiSession',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Which entity each event type is about. */
export const EVENT_ENTITY: Record<EventType, EntityType> = {
  'work.started': 'workSession',
  'work.paused': 'workSession',
  'work.resumed': 'workSession',
  'work.finished': 'workSession',
  'offtime.started': 'offTimeSession',
  'offtime.ended': 'offTimeSession',
  'habit.logged': 'habitEntry',
  'task.completed': 'task',
  'milestone.completed': 'milestone',
  'project.updated': 'project',
  'project.approval_requested': 'projectItem',
  'project.item_parked': 'projectItem',
  'decision.recorded': 'decision',
  'ai.session.completed': 'aiSession',
};

/** Events that are private life state: never in the workspace, never default AI context. */
export const PRIVATE_EVENT_TYPES: readonly EventType[] = [
  'offtime.started',
  'offtime.ended',
  'habit.logged',
];

export const EVENT_SOURCES = ['app', 'ai-client'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** A fact that something happened. References its record; never replaces it. */
export interface LedgerEvent {
  id: Id;
  type: EventType;
  at: Timestamp;
  localDate: LocalDate;
  entityType: EntityType;
  entityId: Id;
  projectId?: Id;
  /** Small immutable facts (e.g. `{ from: 'active', to: 'blocked' }`), never a record copy. */
  data: Record<string, string>;
  source: EventSource;
}

export interface ProgressSnapshot {
  id: Id;
  projectId: Id;
  localDate: LocalDate;
  completedWeight: number;
  totalWeight: number;
  milestoneCount: number;
  completedCount: number;
  state: ProjectState;
  laneCounts: Record<ProjectLane, number>;
  updatedAt: Timestamp;
}

export const AI_SCOPES = ['project', 'workspace', 'global'] as const;
export type AiScope = (typeof AI_SCOPES)[number];

/** Written only when a real, authenticated client reports a session. */
export interface AiSession {
  id: Id;
  client: string;
  scope: AiScope;
  projectId?: Id;
  startedAt: Timestamp;
  endedAt: Timestamp;
  summary: string;
  filesTouched?: string[];
  createdAt: Timestamp;
}
