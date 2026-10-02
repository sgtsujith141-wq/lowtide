import { Dexie, type EntityTable } from 'dexie';
import type {
  AiSession,
  CollegeItem,
  Note,
  Decision,
  SourceRecord,
  SpaceNode,
  Habit,
  HabitEntry,
  Hackathon,
  InboxItem,
  LedgerEvent,
  Milestone,
  OffTimeSession,
  ProgressSnapshot,
  Project,
  ProjectItem,
  ProtectedTime,
  Task,
  WorkSession,
} from '../types/domain';
import { migrateHackathonToV3 } from './migrations';
import type { StoreDb } from './store';
import {
  DATABASE_NAME,
  STORES_V1,
  STORES_V2,
  STORES_V3,
  STORES_V4,
  STORES_V5,
  STORES_V6,
  STORES_V7,
  STORES_V8,
} from './schema';

/**
 * The LOWTIDE IndexedDB database.
 *
 * Only code inside src/db may import this (enforced by ESLint). Everything
 * else talks to repositories, so the storage engine can change later.
 */
export class LowtideDatabase extends Dexie {
  tasks!: EntityTable<Task, 'id'>;
  inbox!: EntityTable<InboxItem, 'id'>;
  habits!: EntityTable<Habit, 'id'>;
  habitEntries!: EntityTable<HabitEntry, 'id'>;
  hackathons!: EntityTable<Hackathon, 'id'>;
  protectedTime!: EntityTable<ProtectedTime, 'id'>;
  projects!: EntityTable<Project, 'id'>;
  milestones!: EntityTable<Milestone, 'id'>;
  projectItems!: EntityTable<ProjectItem, 'id'>;
  decisions!: EntityTable<Decision, 'id'>;
  workSessions!: EntityTable<WorkSession, 'id'>;
  offTimeSessions!: EntityTable<OffTimeSession, 'id'>;
  events!: EntityTable<LedgerEvent, 'id'>;
  progressSnapshots!: EntityTable<ProgressSnapshot, 'id'>;
  aiSessions!: EntityTable<AiSession, 'id'>;
  collegeItems!: EntityTable<CollegeItem, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  spaceNodes!: EntityTable<SpaceNode, 'id'>;
  sourceRecords!: EntityTable<SourceRecord, 'id'>;

  constructor(name: string = DATABASE_NAME) {
    super(name);
    // Version history. Append new versions below; never edit a shipped one.
    this.version(1).stores(STORES_V1);
    // V2: + tasks.plannedFor index. No upgrade(): existing tasks stay valid as-is.
    this.version(2).stores(STORES_V2);
    // V3: hackathon dates become LocalDate. Same indexes; rewrites records.
    this.version(3)
      .stores(STORES_V3)
      .upgrade((tx) =>
        tx
          .table('hackathons')
          .toCollection()
          .modify((record: Record<string, unknown>, ref: { value: unknown }) => {
            ref.value = migrateHackathonToV3(record);
          }),
      );
    // V4 (ADR-046): nine new stores, two new indexes. No upgrade(): additive
    // only, so no existing record is read or rewritten.
    this.version(4).stores(STORES_V4);
    // V5 (ADR-051): + collegeItems. Additive, no upgrade().
    this.version(5).stores(STORES_V5);
    // V6 (ADR-056): + notes, new optional fields. Additive, no upgrade().
    this.version(6).stores(STORES_V6);
    // V7 (ADR-062): + spaceNodes, sourceRecords. Additive, no upgrade().
    this.version(7).stores(STORES_V7);
    // V8 (ADR-064): optional Project.focus. No store changes, no upgrade().
    this.version(8).stores(STORES_V8);
  }
}

export function openDatabase(name?: string): LowtideDatabase {
  return new LowtideDatabase(name);
}

const stores = new WeakMap<LowtideDatabase, StoreDb>();

/**
 * The Dexie database as the repositories' storage contract (ADR-057). Tables
 * are Dexie's own objects (they satisfy `StoreTable` as they are); only
 * `transaction` is forwarded, because Dexie's overloads are typed more
 * narrowly than the contract. Dexie's transaction zones keep working, since
 * every call still reaches the same table objects.
 */
export function asStore(db: LowtideDatabase): StoreDb {
  let store = stores.get(db);
  if (!store) {
    const transaction = (mode: 'r' | 'rw', ...rest: unknown[]) =>
      (db.transaction as unknown as (...args: unknown[]) => Promise<unknown>)(mode, ...rest);
    store = {
      tasks: db.tasks,
      inbox: db.inbox,
      habits: db.habits,
      habitEntries: db.habitEntries,
      hackathons: db.hackathons,
      protectedTime: db.protectedTime,
      projects: db.projects,
      milestones: db.milestones,
      projectItems: db.projectItems,
      decisions: db.decisions,
      workSessions: db.workSessions,
      offTimeSessions: db.offTimeSessions,
      events: db.events,
      progressSnapshots: db.progressSnapshots,
      aiSessions: db.aiSessions,
      collegeItems: db.collegeItems,
      notes: db.notes,
      spaceNodes: db.spaceNodes,
      sourceRecords: db.sourceRecords,
      transaction: transaction as StoreDb['transaction'],
    };
    stores.set(db, store);
  }
  return store;
}
