import { Dexie, type EntityTable } from 'dexie';
import type {
  AiSession,
  Decision,
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
import { DATABASE_NAME, STORES_V1, STORES_V2, STORES_V3, STORES_V4 } from './schema';

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
  }
}

export function openDatabase(name?: string): LowtideDatabase {
  return new LowtideDatabase(name);
}
