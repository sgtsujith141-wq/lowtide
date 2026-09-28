import type {
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
 *   `setEntry`/`clearEntry`) reject with `RecordNotFoundError`.
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

export interface Repositories {
  tasks: TaskRepository;
  inbox: InboxRepository;
  protectedTime: ProtectedTimeRepository;
  habits: HabitRepository;
}
