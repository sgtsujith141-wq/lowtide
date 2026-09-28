import type { LowtideDatabase } from '../database';
import { createDexieHabitRepository } from './dexie-habit-repository';
import { createDexieHackathonRepository } from './dexie-hackathon-repository';
import { createDexieInboxRepository } from './dexie-inbox-repository';
import { createDexieProtectedTimeRepository } from './dexie-protected-time-repository';
import { createDexieTaskRepository } from './dexie-task-repository';
import type { RepositoryDeps } from './shared';
import type { Repositories } from './types';

export type {
  HabitChanges,
  HabitRepository,
  HackathonChanges,
  HackathonRepository,
  InboxRepository,
  NewHabit,
  NewHackathon,
  NewProtectedTime,
  NewTask,
  ProtectedTimeChanges,
  ProtectedTimeRepository,
  Repositories,
  TaskChanges,
  TaskRepository,
  Unsubscribe,
  Watch,
} from './types';
export { InvalidInputError, RecordStateError, RecordNotFoundError } from './errors';

/** Local IndexedDB-backed implementation of every repository. */
export function createDexieRepositories(
  db: LowtideDatabase,
  deps: Omit<RepositoryDeps, 'db'> = {},
): Repositories {
  return {
    tasks: createDexieTaskRepository({ db, ...deps }),
    inbox: createDexieInboxRepository({ db, ...deps }),
    protectedTime: createDexieProtectedTimeRepository({ db, ...deps }),
    habits: createDexieHabitRepository({ db, ...deps }),
    hackathons: createDexieHackathonRepository({ db, ...deps }),
  };
}
