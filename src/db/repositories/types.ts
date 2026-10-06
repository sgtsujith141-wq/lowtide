import type {
  ProjectFocus,
  SpaceColumn,
  SpaceView,
  EntityLink,
  LinkableType,
  SourceRecord,
  SpaceBodyFormat,
  SpaceNode,
  SpaceNodeKind,
  SpaceTable,
  SpaceBlock,
  SpaceCellValue,
  ResearchStatus,
  Note,
  NoteKind,
  CollegeItem,
  CollegeKind,
  CollegeStatus,
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
  HackathonKind,
  HackathonSelection,
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
  /**
   * The parent task (schema V10): the new task is its subtask, in the same
   * project. A subtask can't have subtasks.
   */
  parentId?: Id;
  /** The local day it's planned for. */
  plannedFor?: LocalDate;
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
  /** Makes it a subtask of another task, or (null) a task of its own. */
  parentId?: Id | null;
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
   * `todo` → `doing` (true) or back (false). Closed tasks reject with
   * `RecordStateError`. No event: starting isn't finishing anything.
   */
  setDoing(id: Id, doing: boolean): Promise<Task>;
  /** Every task, any status, oldest first (search and subtasks). */
  watchAll: Watch<Task[]>;
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
  /** Omitted means research hasn't started (ADR-056). */
  researchStatus?: ResearchStatus;
  /** Omitted means a hackathon (schema V11). */
  kind?: HackathonKind;
  /** Omitted means nothing submitted or heard yet (schema V11). */
  selection?: HackathonSelection;
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
  researchStatus?: ResearchStatus;
  /** `null` removes it (read as a hackathon). */
  kind?: HackathonKind | null;
  /** `null` removes it (nothing heard yet). */
  selection?: HackathonSelection | null;
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
  /** Out of the lists, kept, restorable (schema V10). */
  archive(id: Id): Promise<Hackathon>;
  restore(id: Id): Promise<Hackathon>;
  /** Pins (true) or unpins it. A viewing choice: `updatedAt` is left alone. */
  setPinned(id: Id, pinned: boolean): Promise<Hackathon>;
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
  collegeItems: CollegeItem[];
  notes: Note[];
  spaceNodes: SpaceNode[];
  sourceRecords: SourceRecord[];
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
  /** What it is, in a sentence or two (schema V10). */
  description?: string;
  focus?: ProjectFocus;
}

/** Omitted keys are left alone; `null` or blank removes an optional field. State has its own method. */
export type ProjectChanges = { name?: string; kind?: ProjectKind } & {
  [K in 'objective' | 'phase' | 'nextAction' | 'repoUrl' | 'description']?: string | null;
};

export interface NewMilestone {
  title: string;
  /** Defaults to 1 (ADR-038). */
  weight?: number;
  dueOn?: LocalDate;
  notes?: string;
  /** Where in the roadmap (0 = first); omitted: last. */
  position?: number;
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
/** What to set up with a new project (v2.1). */
export interface ProjectSetup {
  /** Make the project's SPACE folder (default true). */
  spaceHome?: boolean;
  /** A project template id (`software`, `hackathon`, `research`, `content`, `utility`). */
  template?: string;
  /** Also make the template's suggested milestones (default false). */
  templateMilestones?: boolean;
  /** Milestones to make, in order (after any template ones). */
  milestones?: string[];
}

export interface ProjectCreated {
  project: Project;
  /** The project's SPACE folder, when made. */
  space?: SpaceNode;
  milestones: Milestone[];
  /** SPACE pages and databases the setup made. */
  pages: SpaceNode[];
}

export interface ProjectRepository {
  create(input: NewProject): Promise<Project>;
  /**
   * A project and its setup in one transaction (v2.1): the SPACE folder,
   * template sections and pages, and milestones. All of it, or nothing.
   */
  createWithSetup(input: NewProject, setup?: ProjectSetup): Promise<ProjectCreated>;
  /**
   * Creates a technical project for a hackathon's build and links it
   * (`hackathon.projectId`) in one transaction. Only on explicit request
   * (ADR-039); rejects with `RecordStateError` if it's already linked.
   */
  createFromHackathon(hackathonId: Id): Promise<Project>;
  update(id: Id, changes: ProjectChanges): Promise<Project>;
  /**
   * Moves the project to `state`. Leaving `archived` only goes to `parked`.
   * `done` needs every milestone complete, unless `overrideDecisionId` names a
   * decision of this project that records why.
   */
  setState(id: Id, state: ProjectState, options?: { overrideDecisionId?: Id }): Promise<Project>;
  /**
   * Sets or clears the portfolio focus (ADR-064). A viewing priority, so it
   * leaves `updatedAt` alone and writes no ledger event: it never reads as
   * project movement.
   */
  setFocus(id: Id, focus: ProjectFocus | null): Promise<Project>;
  /** Pins (true) or unpins (schema V10). Like focus, never project movement. */
  setPinned(id: Id, pinned: boolean): Promise<Project>;
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
  /**
   * Puts the project's live milestones in exactly this order (every one,
   * each once). Archived milestones keep their place after them.
   */
  reorderMilestones(projectId: Id, ids: readonly Id[]): Promise<Milestone[]>;
  /** Rejects with `RecordStateError` while a task or item still refers to it. */
  removeMilestone(id: Id): Promise<void>;
  /**
   * Takes a milestone off the roadmap and out of progress (schema V10), kept
   * with its history; `restoreMilestone` brings it back at the end.
   */
  archiveMilestone(id: Id): Promise<Milestone>;
  restoreMilestone(id: Id): Promise<Milestone>;
  /** Live (not archived) milestones, in pipeline order. */
  watchMilestones(projectId: Id): Watch<Milestone[]>;
  /** A project's archived milestones, most recently archived first. */
  watchArchivedMilestones(projectId: Id): Watch<Milestone[]>;
  /** Every project's live milestones (for summaries). */
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
  /** Every project's decisions, newest first (SPACE links and search). */
  watchAllDecisions: Watch<Decision[]>;
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
  /**
   * Notes what a finished session changed (v2 PHASE 015): the outcome only,
   * never its times; no ledger event. Empty text clears it.
   */
  describe(id: Id, outcome: string): Promise<WorkSession>;
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
  /** Only events on this local day. */
  day?: LocalDate;
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
  taskId?: Id;
  result?: string;
  nextAction?: string;
  commits?: string[];
  handoff?: string;
}

/**
 * AI session records. Only a real, authenticated client may call `record`
 * (ADR-041); the app itself never invents one.
 */
export interface AiSessionRepository {
  record(input: NewAiSession): Promise<AiSession>;
  watchForProject(projectId: Id): Watch<AiSession[]>;
}

export interface NewCollegeItem {
  kind: CollegeKind;
  title: string;
  date: LocalDate;
  /** Defaults to `planned`. */
  status?: CollegeStatus;
  course?: string;
  note?: string;
}

/** Omitted keys are left alone; `null` or blank removes `course`/`note`. */
export type CollegeItemChanges = {
  title?: string;
  date?: LocalDate;
  status?: CollegeStatus;
} & { [K in 'course' | 'note']?: string | null };

/**
 * College classes, labs, assignments, exams and events (ADR-051). Status
 * rules: classes and labs are attended or missed; the rest are done.
 */
export interface CollegeRepository {
  create(input: NewCollegeItem): Promise<CollegeItem>;
  update(id: Id, changes: CollegeItemChanges): Promise<CollegeItem>;
  remove(id: Id): Promise<void>;
  /** Items dated `start..end` inclusive, by date then title. */
  watchRange(start: LocalDate, end: LocalDate): Watch<CollegeItem[]>;
}

export interface NewNote {
  kind?: NoteKind;
  title: string;
  body: string;
}

export type NoteChanges = { title?: string; body?: string };

/**
 * Project notes (ADR-056): human- or AI-authored Markdown, canonical here and
 * projected into the technical workspace. The author comes from who is
 * writing (the owner in the app, or an attributed AI client via the companion).
 */
export interface NotesRepository {
  create(projectId: Id, input: NewNote): Promise<Note>;
  update(id: Id, changes: NoteChanges): Promise<Note>;
  remove(id: Id): Promise<void>;
  /** Newest first. */
  watchForProject(projectId: Id): Watch<Note[]>;
}

export interface NewSpaceNode {
  /** Omitted: a top-level section. */
  parentId?: Id;
  /** `section` makes a folder. */
  kind?: SpaceNodeKind;
  title: string;
  icon?: string;
  description?: string;
  body?: string;
  bodyFormat?: SpaceBodyFormat;
  links?: EntityLink[];
  table?: SpaceTable;
  /** The page's content as blocks (ids are assigned when missing). */
  blocks?: NewSpaceBlock[];
}

/** A block to add: its id is assigned unless given. */
export type NewSpaceBlock = Omit<SpaceBlock, 'id'> & { id?: string };

/** A slot of a project's SPACE folder (Overview, Planning, Architecture…). */
export type ProjectSpaceSlot = (typeof PROJECT_SPACE_SLOTS)[number];
export const PROJECT_SPACE_SLOTS = [
  'overview',
  'planning',
  'research',
  'architecture',
  'decisions',
  'build-plans',
  'notes',
  'tables',
  'ai-sessions',
] as const;

/** Omitted keys are left alone; `null` removes an optional field. */
export type SpaceNodeChanges = {
  title?: string;
  links?: EntityLink[];
  table?: SpaceTable;
} & { [K in 'icon' | 'body' | 'description']?: string | null };

/** A new property for a SPACE database; its id is assigned unless given. */
export type NewSpaceColumn = Omit<SpaceColumn, 'id'> & { id?: string };

/** Changes to a property. A type change converts every cell or is refused. */
export type SpaceColumnChanges = Partial<Omit<SpaceColumn, 'id'>>;

/** A new view; its id is assigned unless given. */
export type NewSpaceView = Omit<SpaceView, 'id'> & { id?: string };

/**
 * Optional optimistic check for structural writes: when given, the write is
 * refused with `SpaceConflictError` if the node's revision moved on.
 */
export interface Expect {
  baseRevision?: number;
}

/**
 * SPACE, the knowledge hierarchy (ADR-062): sections, pages and tables with
 * links to LOWTIDE records and their provenance. Knowledge, not activity:
 * nothing here writes a ledger event or a snapshot. Nodes are archived, never
 * deleted.
 */
export interface SpaceRepository {
  /* v2.1 operations are listed after the PHASE 014 ones below. */
  get(id: Id): Promise<SpaceNode | undefined>;
  /** The node with a maintained key (`projects`, `project:<id>`…), if it exists. */
  getByKey(key: string): Promise<SpaceNode | undefined>;
  /** Appended after its siblings. */
  create(input: NewSpaceNode): Promise<SpaceNode>;
  update(id: Id, changes: SpaceNodeChanges): Promise<SpaceNode>;
  /** Moves under `parentId` (null: top level), at `order` or last. Refuses loops. */
  move(id: Id, parentId: Id | null, order?: number): Promise<SpaceNode>;
  archive(id: Id): Promise<SpaceNode>;
  restore(id: Id): Promise<SpaceNode>;
  /** Creates any missing top-level section; returns all six, in order. */
  ensureRoots(): Promise<SpaceNode[]>;
  /** Children of a node (null: top level), in order, archived included. */
  watchChildren(parentId: Id | null): Watch<SpaceNode[]>;
  /** Every node (for trees and search), by parent then order. */
  watchAll: Watch<SpaceNode[]>;
  /** Nodes that link to a LOWTIDE record. */
  watchLinked(type: LinkableType, id: Id): Watch<SpaceNode[]>;
  /** Where a record came from: its provenance records, canonical first. */
  watchSources(type: LinkableType, id: Id): Watch<SourceRecord[]>;
  /**
   * Provenance for a project and everything in it (milestones, tasks, items,
   * decisions), most recently applied first: the import and reconciliation
   * trail, never activity.
   */
  watchProjectSources(projectId: Id): Watch<SourceRecord[]>;

  /*
   * Editing (v2 PHASE 014, ADR-067). Every change bumps the page's revision
   * and adds to its batched history, attributed to the owner or the AI
   * client. Still no ledger events: knowledge is not activity.
   */

  /**
   * Saves a page's title and blocks as an editor sees them. Refused with a
   * `SpaceConflictError` when the page changed since `baseRevision`, so a
   * write from elsewhere is never silently overwritten.
   */
  saveContent(
    id: Id,
    content: { title?: string; blocks: SpaceBlock[] },
    baseRevision: number,
  ): Promise<SpaceNode>;
  /** Adds blocks at the end (an imported body becomes blocks first, unchanged). */
  appendBlocks(id: Id, blocks: NewSpaceBlock[]): Promise<SpaceNode>;
  /** Changes one block. */
  updateBlock(
    id: Id,
    blockId: string,
    changes: Partial<Omit<SpaceBlock, 'id'>>,
  ): Promise<SpaceNode>;
  /** Sets one cell of a table page (`null` empties it). */
  setCell(
    id: Id,
    rowId: string,
    columnId: string,
    value: SpaceCellValue | null,
  ): Promise<SpaceNode>;
  /**
   * Adds a row to a table page; returns the page. `rowId` and `index` let a
   * deleted row come back as it was (undo).
   */
  addRow(
    id: Id,
    cells: Record<string, SpaceCellValue>,
    options?: { rowId?: string; index?: number },
  ): Promise<SpaceNode>;
  /** Sets several cells of one row (`null` empties a cell). */
  updateRow(
    id: Id,
    rowId: string,
    cells: Record<string, SpaceCellValue | null>,
    expect?: Expect,
  ): Promise<SpaceNode>;
  /** Removes a row; returns the page. */
  deleteRow(id: Id, rowId: string, expect?: Expect): Promise<SpaceNode>;
  /** Adds a property, last or at `position`. */
  addColumn(id: Id, column: NewSpaceColumn, position?: number, expect?: Expect): Promise<SpaceNode>;
  /** Renames or changes a property; a type change converts every cell or is refused. */
  updateColumn(
    id: Id,
    columnId: string,
    changes: SpaceColumnChanges,
    expect?: Expect,
  ): Promise<SpaceNode>;
  /** Removes a property and its cells (and drops it from views). */
  removeColumn(id: Id, columnId: string, expect?: Expect): Promise<SpaceNode>;
  /** Adds or replaces a saved view (by id). */
  saveView(id: Id, view: NewSpaceView): Promise<SpaceNode>;
  removeView(id: Id, viewId: string): Promise<SpaceNode>;
  /** Inserts blocks after `afterBlockId` (null: at the top). */
  insertBlocks(
    id: Id,
    afterBlockId: string | null,
    blocks: NewSpaceBlock[],
    expect?: Expect,
  ): Promise<SpaceNode>;
  /** Removes blocks by id. Imported content kept as it was can't be removed this way. */
  deleteBlocks(id: Id, blockIds: readonly string[], expect?: Expect): Promise<SpaceNode>;
  /** Moves one block after `afterBlockId` (null: to the top). */
  moveBlock(
    id: Id,
    blockId: string,
    afterBlockId: string | null,
    expect?: Expect,
  ): Promise<SpaceNode>;
  /** Replaces a run of consecutive blocks (first to last id) with new ones. */
  replaceBlocks(
    id: Id,
    fromBlockId: string,
    toBlockId: string,
    blocks: NewSpaceBlock[],
    expect?: Expect,
  ): Promise<SpaceNode>;
  /** Pins (true) or unpins a page, folder or database. A viewing choice. */
  setPinned(id: Id, pinned: boolean): Promise<SpaceNode>;
  /**
   * A copy of a page, folder or database placed after it. With `deep`, its
   * subpages too. Content only: no history, no activity.
   */
  duplicateTree(id: Id, options?: { deep?: boolean; parentId?: Id }): Promise<SpaceNode>;
  /**
   * A new page (or database) from a template page: its blocks (or columns
   * and views, without rows), never its history.
   */
  applyTemplate(templateId: Id, parentId: Id, title?: string): Promise<SpaceNode>;
  /**
   * LOWTIDE's own pages under the LOWTIDE section: the Templates folder with
   * its starting templates (made once; yours to change), and the AI folder's
   * operating guide, kept as `guide` (rewritten when it differs).
   */
  ensureSystemPages(guide: { title: string; markdown: string }): Promise<void>;
  /**
   * Deletes an archived page, folder or database for good, with everything
   * under it. Refused for anything not archived and for sections LOWTIDE
   * maintains. Returns how many nodes were deleted.
   */
  deletePermanently(id: Id): Promise<number>;
  /** Links a page to a record (once). */
  addLink(id: Id, link: EntityLink): Promise<SpaceNode>;
  removeLink(id: Id, link: EntityLink): Promise<SpaceNode>;
  /** A copy of a page (content only, not its subpages), placed after it. */
  duplicate(id: Id): Promise<SpaceNode>;
  /**
   * The project's SPACE folder under Projects, made when first needed, and
   * optionally one of its standard slots. Nothing is made before it's used.
   */
  ensureProjectSpace(projectId: Id, slot?: ProjectSpaceSlot): Promise<SpaceNode>;
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
  /** Attended classes/labs and done assignments/exams/events (ADR-051). */
  collegeDone: CollegeItem[];
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
  college: CollegeRepository;
  notes: NotesRepository;
  space: SpaceRepository;
}
