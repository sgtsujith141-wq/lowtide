import type {
  AiScope,
  ProjectItemKind,
  ProjectKind,
  ProjectLane,
  ProjectState,
  WorkKind,
  AiSession,
  Decision,
  LedgerEvent,
  Milestone,
  OffTimeSession,
  ProgressSnapshot,
  Project,
  ProjectItem,
  WorkSession,
  BuildStatus,
  Hackathon,
  HackathonStatus,
  PptStatus,
  RegistrationStatus,
  Habit,
  HabitCategory,
  HabitEntry,
  HabitUnit,
  Id,
  InboxItem,
  LocalDate,
  ProtectedTime,
  ProtectedTimeKind,
  Task,
  TaskPriority,
  Timestamp,
} from '../../types/domain';

/**
 * Repository contracts. UI and feature code depend on these interfaces only,
 * never on Dexie, so a synced or remote implementation can replace the local
 * one without touching components.
 *
 * All methods are async, return plain domain objects, and validate input
 * before writing.
 *
 * Missing records:
 * - Lookups (`get`) resolve to `undefined` when the record doesn't exist;
 *   absence is a normal answer, not an error.
 * - Operations that need an existing record (`update`, `complete`, `reopen`,
 *   `drop`, `planFor`, `removeFromPlan`, `convertToTask`, `markProcessed`, and
 *   protected-time `update`/`remove`, habit `update`/`archive`/`restore`/
 *   `setEntry`/`clearEntry`, hackathon `update`) reject with `RecordNotFoundError`.
 * - Operations not allowed in the record's current state (e.g. completing a
 *   dropped task, converting an already-processed inbox item) reject with
 *   `RecordStateError`.
 */

/** Stops a subscription. Safe to call more than once. */
export type Unsubscribe = () => void;

/**
 * A live view of a query. `onChange` receives the current result soon after
 * subscribing and again whenever the underlying data changes, whichever tab
 * or component made the change. `onError` receives query failures.
 * Storage-agnostic on purpose: no Dexie or Observable types leak out.
 */
export type Watch<T> = (
  onChange: (value: T) => void,
  onError?: (error: unknown) => void,
) => Unsubscribe;

export interface NewTask {
  title: string;
  notes?: string;
  priority?: TaskPriority;
  dueAt?: Timestamp;
  project?: string;
  /** An existing project (schema V4). */
  projectId?: Id;
  /** A milestone of `projectId`. */
  milestoneId?: Id;
}

/**
 * Edits to a task's content. Omitted keys are left alone; `null` (or a blank
 * string for `notes`/`project`) removes an optional field. Status changes go
 * through `complete`/`reopen`/`drop`, not here.
 */
export interface TaskChanges {
  title?: string;
  notes?: string | null;
  priority?: TaskPriority;
  dueAt?: Timestamp | null;
  project?: string | null;
  /** Links or (null) unlinks a project; unlinking also clears the milestone. */
  projectId?: Id | null;
  milestoneId?: Id | null;
}

export interface TaskRepository {
  create(input: NewTask): Promise<Task>;
  /** Resolves to `undefined` if no task has this id. */
  get(id: Id): Promise<Task | undefined>;
  /** Tasks with status `todo` or `doing`, oldest first. */
  listOpen(): Promise<Task[]>;
  /** Live version of `listOpen`. */
  watchOpen: Watch<Task[]>;
  /** Tasks with status `done` or `dropped`, most recently changed first. */
  watchClosed: Watch<Task[]>;
  update(id: Id, changes: TaskChanges): Promise<Task>;
  /** Open task → `done`, stamping `completedAt`. */
  complete(id: Id): Promise<Task>;
  /** `done` or `dropped` task → `todo`; clears `completedAt`. */
  reopen(id: Id): Promise<Task>;
  /** Open task → `dropped`. Kept, not deleted, so it can be reopened. */
  drop(id: Id): Promise<Task>;
  /**
   * Puts an open task in the plan for local day `date` (sets `plannedFor`).
   * Never touches `dueAt`. Closed tasks reject with `RecordStateError`.
   */
  planFor(id: Id, date: LocalDate): Promise<Task>;
  /** Clears `plannedFor`. Never touches `dueAt`. Any status. */
  removeFromPlan(id: Id): Promise<Task>;
  /**
   * Open tasks relevant to local day `day`: planned for that day, or with a
   * deadline on or before it (overdue included). Unordered and possibly
   * overlapping in meaning; composing sections is the caller's job.
   */
  watchForDay(day: LocalDate): Watch<Task[]>;
}

export interface InboxRepository {
  /** Stores a raw thought. Rejects empty/whitespace-only content. */
  capture(content: string): Promise<InboxItem>;
  /** Items not yet processed, oldest first (the order you'd work through them). */
  listUnprocessed(): Promise<InboxItem[]>;
  /** Live version of `listUnprocessed`. */
  watchUnprocessed: Watch<InboxItem[]>;
  countUnprocessed(): Promise<number>;
  /**
   * Turns an inbox item into a task in one atomic step: the task is created
   * and the item is marked processed and linked to it, or neither happens.
   * The first line of the content becomes the title, any further lines the notes.
   * Rejects with `RecordNotFoundError` if the item is missing and
   * `RecordStateError` if it was already processed.
   */
  convertToTask(id: Id): Promise<Task>;
  /**
   * Marks an item processed without creating anything ("needs no action").
   * The item is kept with its `processedAt`, not deleted.
   */
  markProcessed(id: Id): Promise<InboxItem>;
}

export interface NewProtectedTime {
  title: string;
  date: LocalDate;
  kind: ProtectedTimeKind;
  notes?: string;
}

/** Omitted keys are left alone; `null` or blank `notes` removes the note. */
export interface ProtectedTimeChanges {
  title?: string;
  date?: LocalDate;
  kind?: ProtectedTimeKind;
  notes?: string | null;
}

/**
 * Time kept for people and rest. Deliberately no status, completion or
 * history of any kind: an entry is a plan, not a commitment to measure (ADR-021).
 */
export interface ProtectedTimeRepository {
  create(input: NewProtectedTime): Promise<ProtectedTime>;
  update(id: Id, changes: ProtectedTimeChanges): Promise<ProtectedTime>;
  /** Deletes the entry. */
  remove(id: Id): Promise<void>;
  /** Entries on local day `date`, ordered by title. */
  watchForDate(date: LocalDate): Watch<ProtectedTime[]>;
  /**
   * Entries with `start <= date <= end` (inclusive LocalDates), ordered by
   * date, then title, then id. One indexed range query.
   */
  watchRange(start: LocalDate, end: LocalDate): Watch<ProtectedTime[]>;
}

export interface NewHabit {
  name: string;
  category: HabitCategory;
  unit: HabitUnit;
  /** Only for `count`/`minutes`; must be positive. */
  target?: number;
}

/**
 * Omitted keys are left alone; `target: null` removes the target. The unit
 * can't change: it would change the meaning of every entry already logged.
 */
export interface HabitChanges {
  name?: string;
  category?: HabitCategory;
  target?: number | null;
}

/**
 * Rhythm: habits and one entry per habit per local day (ADR-023).
 * No entry means no recorded activity; entries are only ever created by an
 * explicit `setEntry`.
 */
export interface HabitRepository {
  /** Rejects with `InvalidInputError` for a target on a `check` habit or a non-positive target. */
  create(input: NewHabit): Promise<Habit>;
  update(id: Id, changes: HabitChanges): Promise<Habit>;
  /** Hides a habit from daily logging. Its entries are kept. */
  archive(id: Id): Promise<Habit>;
  restore(id: Id): Promise<Habit>;
  /** Every habit, active and archived, oldest first. */
  watchAll: Watch<Habit[]>;
  /**
   * Upserts the entry for (habit, day): creates it, or updates value/note and
   * `updatedAt` while keeping its id and `createdAt`. Value rules by unit:
   * `check` = 1; `count` = positive whole number; `minutes` = positive, up to
   * 1440. Invalid values reject with `InvalidInputError`; archived habits with
   * `RecordStateError`.
   */
  setEntry(habitId: Id, date: LocalDate, value: number, note?: string): Promise<HabitEntry>;
  /** Removes the entry for (habit, day) if there is one. Missing habit → `RecordNotFoundError`. */
  clearEntry(habitId: Id, date: LocalDate): Promise<void>;
  /** Entries for every habit (archived included) with `start <= date <= end`. */
  watchEntries(start: LocalDate, end: LocalDate): Watch<HabitEntry[]>;
}

/** Only `name` is required; statuses default to considering / not registered / not started. */
export interface NewHackathon {
  name: string;
  status?: HackathonStatus;
  registrationDeadline?: LocalDate;
  eventStart?: LocalDate;
  eventEnd?: LocalDate;
  registrationStatus?: RegistrationStatus;
  pptStatus?: PptStatus;
  buildStatus?: BuildStatus;
  team?: string;
  problemStatement?: string;
  nextAction?: string;
  notes?: string;
}

/**
 * Omitted keys are left alone; `null` (or a blank string) removes an optional
 * field. `projectId` links a technical Project only on explicit request (ADR-039).
 */
export type HackathonChanges = {
  projectId?: Id | null;
  name?: string;
  status?: HackathonStatus;
  registrationStatus?: RegistrationStatus;
  pptStatus?: PptStatus;
  buildStatus?: BuildStatus;
} & {
  [
    K in
      | 'registrationDeadline'
      | 'eventStart'
      | 'eventEnd'
      | 'team'
      | 'problemStatement'
      | 'nextAction'
      | 'notes'
  ]?: string | null;
};

/**
 * Hackathons as project sheets (ADR-027/028). Never deleted: finished and
 * dropped keep everything. Dates are `LocalDate`s; `eventEnd` needs
 * `eventStart` and can't be earlier (`InvalidInputError`). Nothing here
 * touches habits or tasks.
 */
export interface HackathonRepository {
  create(input: NewHackathon): Promise<Hackathon>;
  update(id: Id, changes: HackathonChanges): Promise<Hackathon>;
  /** Every hackathon, oldest first. Composition (sorting, Today) is pure and done by callers. */
  watchAll: Watch<Hackathon[]>;
}

/** Every persisted collection, as stored (six since V1, nine more since V4). */
export interface BackupData {
  tasks: Task[];
  inbox: InboxItem[];
  habits: Habit[];
  habitEntries: HabitEntry[];
  hackathons: Hackathon[];
  protectedTime: ProtectedTime[];
  projects: Project[];
  milestones: Milestone[];
  projectItems: ProjectItem[];
  decisions: Decision[];
  workSessions: WorkSession[];
  offTimeSessions: OffTimeSession[];
  events: LedgerEvent[];
  progressSnapshots: ProgressSnapshot[];
  aiSessions: AiSession[];
}

export type BackupCounts = Record<keyof BackupData, number>;

/**
 * A LOWTIDE backup file (ADR-031). `formatVersion` versions this envelope;
 * `schemaVersion` records the database schema the data was written under.
 * They change independently.
 */
export interface BackupDocument {
  format: 'lowtide-backup';
  formatVersion: number;
  schemaVersion: number;
  exportedAt: Timestamp;
  data: BackupData;
}

declare const validatedBackup: unique symbol;

/**
 * A backup that has been parsed, migrated to the current schema and fully
 * validated. Only `inspect` produces one, so `restore` can't be handed raw data.
 */
export interface ValidatedBackup {
  readonly [validatedBackup]: true;
  readonly exportedAt: Timestamp;
  readonly sourceSchemaVersion: number;
  readonly data: BackupData;
  readonly counts: BackupCounts;
}

export type BackupProblem =
  'not-json' | 'not-lowtide' | 'newer-format' | 'newer-schema' | 'invalid-data';

export type BackupInspection =
  | { ok: true; backup: ValidatedBackup }
  /** `issues` are developer-facing details; the UI shows calm text per `problem`. */
  | { ok: false; problem: BackupProblem; issues: string[] };

/**
 * Local backup and restore (ADR-031–033). Replace, never merge. Nothing here
 * touches the network.
 */
export interface BackupRepository {
  /** Every store, read in one read-only transaction, sorted deterministically. */
  exportBackup(): Promise<BackupDocument>;
  /** Record counts per store, live. */
  watchCounts: Watch<BackupCounts>;
  /** Parses, migrates and validates a backup file's text without touching the database. */
  inspect(text: string): BackupInspection;
  /**
   * Replaces all LOWTIDE data with the backup in one read-write transaction
   * over every store. If anything fails, nothing changes.
   */
  restore(backup: ValidatedBackup): Promise<void>;
}

/* ----------------------------- Schema V4 ----------------------------- */

export interface NewProject {
  name: string;
  kind?: ProjectKind;
  state?: ProjectState;
  objective?: string;
  phase?: string;
  nextAction?: string;
  repoUrl?: string;
}

/** Omitted keys are left alone; `null` or blank removes an optional field. State has its own method. */
export type ProjectChanges = { name?: string; kind?: ProjectKind } & {
  [K in 'objective' | 'phase' | 'nextAction' | 'repoUrl']?: string | null;
};

export interface NewMilestone {
  title: string;
  /** Defaults to 1 (ADR-038). */
  weight?: number;
  dueOn?: LocalDate;
  notes?: string;
}

export type MilestoneChanges = { title?: string; weight?: number } & {
  [K in 'dueOn' | 'notes']?: string | null;
};

export interface NewProjectItem {
  kind: ProjectItemKind;
  title: string;
  /** Defaults by kind (`approval` → needs_approval, `blocker` → blocked, …). */
  lane?: Exclude<ProjectLane, 'done'>;
  body?: string;
  waitingOn?: string;
  taskId?: Id;
  milestoneId?: Id;
}

export type ProjectItemChanges = { title?: string } & {
  [K in 'body' | 'waitingOn']?: string | null;
};

export interface NewDecision {
  title: string;
  decision: string;
  context?: string;
  consequences?: string;
  supersedesId?: Id;
}

/**
 * Projects and their command model (ADR-038, ADR-046). Every change that
 * moves a project also upserts today's progress snapshot and appends its
 * ledger event in the same transaction. Projects are archived, never deleted.
 */
export interface ProjectRepository {
  create(input: NewProject): Promise<Project>;
  update(id: Id, changes: ProjectChanges): Promise<Project>;
  /**
   * Moves the project to `state`. Leaving `archived` only goes to `parked`.
   * `done` needs every milestone complete, unless `overrideDecisionId` names a
   * decision of this project that records why.
   */
  setState(id: Id, state: ProjectState, options?: { overrideDecisionId?: Id }): Promise<Project>;
  get(id: Id): Promise<Project | undefined>;
  /** Every project, most recently updated first. */
  watchAll: Watch<Project[]>;
  watchBySlug(slug: string): Watch<Project | undefined>;

  addMilestone(projectId: Id, input: NewMilestone): Promise<Milestone>;
  updateMilestone(id: Id, changes: MilestoneChanges): Promise<Milestone>;
  completeMilestone(id: Id): Promise<Milestone>;
  reopenMilestone(id: Id): Promise<Milestone>;
  /** Swaps order with the neighbour before (-1) or after (+1). */
  moveMilestone(id: Id, direction: -1 | 1): Promise<void>;
  /** Rejects with `RecordStateError` while a task or item still refers to it. */
  removeMilestone(id: Id): Promise<void>;
  /** In pipeline order. */
  watchMilestones(projectId: Id): Watch<Milestone[]>;
  /** Every project's milestones (for summaries). */
  watchAllMilestones: Watch<Milestone[]>;

  addItem(projectId: Id, input: NewProjectItem): Promise<ProjectItem>;
  updateItem(id: Id, changes: ProjectItemChanges): Promise<ProjectItem>;
  /**
   * Moves an open item to another lane (not `done`: use `resolveItem`). Open
   * approvals and blockers can't leave their lane except by being resolved.
   */
  moveItem(id: Id, lane: Exclude<ProjectLane, 'done'>, waitingOn?: string): Promise<ProjectItem>;
  resolveItem(id: Id): Promise<ProjectItem>;
  /** Back to its kind's default lane. */
  reopenItem(id: Id): Promise<ProjectItem>;
  removeItem(id: Id): Promise<void>;
  watchItems(projectId: Id): Watch<ProjectItem[]>;
  watchAllItems: Watch<ProjectItem[]>;

  /** Immutable once recorded. */
  recordDecision(projectId: Id, input: NewDecision): Promise<Decision>;
  /** Newest first. */
  watchDecisions(projectId: Id): Watch<Decision[]>;
  /** Oldest first. */
  watchSnapshots(projectId: Id): Watch<ProgressSnapshot[]>;
  /** A project's tasks (any status), oldest first. */
  watchTasks(projectId: Id): Watch<Task[]>;
}

export interface StartWork {
  kind: WorkKind;
  projectId?: Id;
  taskId?: Id;
  intent?: string;
}

/**
 * Work sessions (Start Work, architecture §7). At most one is open. A task's
 * project always becomes the session's project; a mismatch is rejected.
 * Starting is refused while an off-time window is open.
 */
export interface WorkRepository {
  start(input: StartWork): Promise<WorkSession>;
  pause(id: Id): Promise<WorkSession>;
  resume(id: Id): Promise<WorkSession>;
  finish(id: Id, outcome?: string): Promise<WorkSession>;
  /** Deletes a session started by mistake, with its events. */
  discard(id: Id): Promise<void>;
  /** The open session, if any. */
  watchActive: Watch<WorkSession | undefined>;
  /** Sessions that started on `start <= localDate <= end`. */
  watchRange(start: LocalDate, end: LocalDate): Watch<WorkSession[]>;
  watchForProject(projectId: Id): Watch<WorkSession[]>;
}

/**
 * Off time (Sleep Mode, architecture §8): manually started and ended windows,
 * never a claim about sleep itself; and declared days off. Starting a window
 * is refused while work is running.
 */
export interface OffTimeRepository {
  start(kind: 'sleep' | 'rest', note?: string): Promise<OffTimeSession>;
  end(id: Id): Promise<OffTimeSession>;
  /** Deletes a window started by mistake, with its events. */
  discard(id: Id): Promise<void>;
  /** At most one per date. */
  declareDayOff(date: LocalDate, note?: string): Promise<OffTimeSession>;
  removeDayOff(date: LocalDate): Promise<void>;
  watchActive: Watch<OffTimeSession | undefined>;
  watchRange(start: LocalDate, end: LocalDate): Watch<OffTimeSession[]>;
}

export interface EventQuery {
  projectId?: Id;
  /** Private life events (off time, habit logs) are left out unless asked for. */
  includePrivate?: boolean;
  limit?: number;
}

/** An event with the current title of what it refers to (absent if deleted). */
export interface TimelineEntry {
  event: LedgerEvent;
  /** Task title, milestone title, decision title, work intent… */
  title?: string;
  projectName?: string;
}

/** The ledger, read-only: events are written by the repositories that change records. */
export interface EventRepository {
  /** Newest first. */
  watchRecent(query?: EventQuery): Watch<LedgerEvent[]>;
  watchRange(start: LocalDate, end: LocalDate, query?: EventQuery): Watch<LedgerEvent[]>;
  /** Newest first, each joined with the current record's title (events never copy it). */
  watchTimeline(query?: EventQuery): Watch<TimelineEntry[]>;
}

export interface NewAiSession {
  client: string;
  scope: AiScope;
  projectId?: Id;
  startedAt: Timestamp;
  endedAt: Timestamp;
  summary: string;
  filesTouched?: string[];
}

/**
 * AI session records. Only a real, authenticated client may call `record`
 * (ADR-041); the app itself never invents one.
 */
export interface AiSessionRepository {
  record(input: NewAiSession): Promise<AiSession>;
  watchForProject(projectId: Id): Watch<AiSession[]>;
}

/** Raw records behind activity grids and the Daily Pulse, for a date range. */
export interface ActivitySources {
  habits: Habit[];
  habitEntries: HabitEntry[];
  workSessions: WorkSession[];
  offTimeSessions: OffTimeSession[];
  /** Tasks with a `completedAt` (status done). */
  completedTasks: Task[];
  milestones: Milestone[];
  decisions: Decision[];
  /** Resolved blocker and approval items. */
  resolvedItems: ProjectItem[];
}

export interface ActivityRepository {
  /**
   * Everything dated within `start..end` (LocalDates, inclusive; instants
   * compared by their local day), read in one live query. Protected time and
   * inbox are deliberately not part of it.
   */
  watchSources(start: LocalDate, end: LocalDate): Watch<ActivitySources>;
}

export interface Repositories {
  tasks: TaskRepository;
  inbox: InboxRepository;
  protectedTime: ProtectedTimeRepository;
  habits: HabitRepository;
  hackathons: HackathonRepository;
  backup: BackupRepository;
  projects: ProjectRepository;
  work: WorkRepository;
  offTime: OffTimeRepository;
  events: EventRepository;
  aiSessions: AiSessionRepository;
  activity: ActivityRepository;
}
