import type { Id, InboxItem, Task, TaskPriority, Timestamp } from '../../types/domain';

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
 *   `drop`, `convertToTask`, `markProcessed`) reject with `RecordNotFoundError`.
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

export interface Repositories {
  tasks: TaskRepository;
  inbox: InboxRepository;
}
