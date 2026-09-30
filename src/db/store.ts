import type {
  AiSession,
  CollegeItem,
  Decision,
  Habit,
  HabitEntry,
  Hackathon,
  InboxItem,
  LedgerEvent,
  Milestone,
  Note,
  OffTimeSession,
  ProgressSnapshot,
  Project,
  ProjectItem,
  ProtectedTime,
  Task,
  WorkSession,
} from '../types/domain';

/*
 * The storage contract the domain repositories are written against
 * (ADR-057). It is the small slice of Dexie that LOWTIDE actually uses, so
 * the browser's Dexie database satisfies it as-is, and the companion's SQLite
 * adapter implements it. Every validation rule, ledger event and snapshot
 * therefore runs on the same code whichever backend holds the data.
 *
 * Semantics both backends honour:
 * - `put` upserts by primary key; `add` fails on an existing key; both fail
 *   (ConstraintError) on a unique-index clash.
 * - Index queries skip records whose indexed field is absent.
 * - A table read returns records in primary-key order; an index query in
 *   index order, then primary key.
 * - `transaction` runs its scope atomically: all writes commit, or none.
 */

export type IndexValue = string | number | readonly (string | number)[];

export interface StoreCollection<T> {
  filter(fn: (record: T) => boolean): StoreCollection<T>;
  toArray(): Promise<T[]>;
  first(): Promise<T | undefined>;
  count(): Promise<number>;
  delete(): Promise<number>;
  sortBy(key: string): Promise<T[]>;
}

export interface StoreWhere<T> {
  equals(value: IndexValue): StoreCollection<T>;
  between(
    lower: IndexValue,
    upper: IndexValue,
    includeLower?: boolean,
    includeUpper?: boolean,
  ): StoreCollection<T>;
  belowOrEqual(value: IndexValue): StoreCollection<T>;
}

export interface StoreTable<T> {
  get(key: string): Promise<T | undefined>;
  put(record: T): Promise<unknown>;
  add(record: T): Promise<unknown>;
  bulkAdd(records: readonly T[]): Promise<unknown>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
  toArray(): Promise<T[]>;
  filter(fn: (record: T) => boolean): StoreCollection<T>;
  where(index: string): StoreWhere<T>;
  orderBy(index: string): StoreCollection<T>;
  toCollection(): StoreCollection<T>;
}

export type TransactionMode = 'r' | 'rw';
/**
 * A table taking part in a transaction. Typed loosely on purpose: each
 * backend passes its own table objects, and only the scope's return is typed.
 */
export type AnyTable = object;

export interface StoreDb {
  tasks: StoreTable<Task>;
  inbox: StoreTable<InboxItem>;
  habits: StoreTable<Habit>;
  habitEntries: StoreTable<HabitEntry>;
  hackathons: StoreTable<Hackathon>;
  protectedTime: StoreTable<ProtectedTime>;
  projects: StoreTable<Project>;
  milestones: StoreTable<Milestone>;
  projectItems: StoreTable<ProjectItem>;
  decisions: StoreTable<Decision>;
  workSessions: StoreTable<WorkSession>;
  offTimeSessions: StoreTable<OffTimeSession>;
  events: StoreTable<LedgerEvent>;
  progressSnapshots: StoreTable<ProgressSnapshot>;
  aiSessions: StoreTable<AiSession>;
  collegeItems: StoreTable<CollegeItem>;
  notes: StoreTable<Note>;

  transaction<R>(
    mode: TransactionMode,
    tables: readonly AnyTable[],
    scope: () => Promise<R>,
  ): Promise<R>;
  transaction<R>(mode: TransactionMode, table: AnyTable, scope: () => Promise<R>): Promise<R>;
  transaction<R>(
    mode: TransactionMode,
    table1: AnyTable,
    table2: AnyTable,
    scope: () => Promise<R>,
  ): Promise<R>;
  transaction<R>(
    mode: TransactionMode,
    table1: AnyTable,
    table2: AnyTable,
    table3: AnyTable,
    scope: () => Promise<R>,
  ): Promise<R>;
}
