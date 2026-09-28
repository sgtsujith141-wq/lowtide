import { Dexie, type EntityTable } from 'dexie';
import type { Habit, HabitEntry, Hackathon, InboxItem, ProtectedTime, Task } from '../types/domain';
import { DATABASE_NAME, STORES_V1 } from './schema';

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

  constructor(name: string = DATABASE_NAME) {
    super(name);
    // Version history. Append new versions below; never edit a shipped one.
    this.version(1).stores(STORES_V1);
  }
}

export function openDatabase(name?: string): LowtideDatabase {
  return new LowtideDatabase(name);
}
