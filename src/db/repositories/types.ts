import type { Id, InboxItem, Task, TaskPriority, Timestamp } from '../../types/domain';

/**
 * Repository contracts. UI and feature code depend on these interfaces only,
 * never on Dexie, so a synced or remote implementation can replace the local
 * one without touching components.
 *
 * All methods are async, return plain domain objects, and validate input
 * before writing. Missing records reject with `RecordNotFoundError`.
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
  get(id: Id): Promise<Task | undefined>;
  /** Tasks with status `todo` or `doing`, oldest first. */
  listOpen(): Promise<Task[]>;
  /** Marks a task `done` and stamps `completedAt`. */
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
   */
  convertToTask(id: Id): Promise<Task>;
}

export interface Repositories {
  tasks: TaskRepository;
  inbox: InboxRepository;
}
