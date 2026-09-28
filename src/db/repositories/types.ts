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
 * - Operations that need an existing record (`complete`, `convertToTask`, and
 *   future update/delete methods) reject with `RecordNotFoundError`.
 * - Operations not allowed in the record's current state (e.g. converting an
 *   already-processed inbox item) reject with `RecordStateError`.
 */

export interface NewTask {
  title: string;
  notes?: string;
  priority?: TaskPriority;
  dueAt?: Timestamp;
  project?: string;
}

export interface TaskRepository {
  create(input: NewTask): Promise<Task>;
  /** Resolves to `undefined` if no task has this id. */
  get(id: Id): Promise<Task | undefined>;
  /** Tasks with status `todo` or `doing`, oldest first. */
  listOpen(): Promise<Task[]>;
  /** Marks a task `done` and stamps `completedAt`. Rejects with `RecordNotFoundError` if missing. */
  complete(id: Id): Promise<Task>;
}

export interface InboxRepository {
  /** Stores a raw thought. Rejects empty/whitespace-only content. */
  capture(content: string): Promise<InboxItem>;
  /** Items not yet processed, oldest first (the order you'd work through them). */
  listUnprocessed(): Promise<InboxItem[]>;
  countUnprocessed(): Promise<number>;
  /**
   * Turns an inbox item into a task in one atomic step: the task is created
   * and the item is marked processed and linked to it, or neither happens.
   * The first line of the content becomes the title, any further lines the notes.
   * Rejects with `RecordNotFoundError` if the item is missing and
   * `RecordStateError` if it was already processed.
   */
  convertToTask(id: Id): Promise<Task>;
}

export interface Repositories {
  tasks: TaskRepository;
  inbox: InboxRepository;
}
