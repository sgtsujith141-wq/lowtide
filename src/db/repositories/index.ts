import type { LowtideDatabase } from '../database';
import {
  createDexieActivityRepository,
  createDexieAiSessionRepository,
  createDexieEventRepository,
} from './dexie-activity-repositories';
import { createDexieBackupRepository } from './dexie-backup-repository';
import { createDexieHabitRepository } from './dexie-habit-repository';
import { createDexieHackathonRepository } from './dexie-hackathon-repository';
import { createDexieInboxRepository } from './dexie-inbox-repository';
import { createDexieOffTimeRepository } from './dexie-off-time-repository';
import { createDexieProjectRepository } from './dexie-project-repository';
import { createDexieProtectedTimeRepository } from './dexie-protected-time-repository';
import { createDexieTaskRepository } from './dexie-task-repository';
import { createDexieWorkRepository } from './dexie-work-repository';
import type { RepositoryDeps } from './shared';
import type { Repositories } from './types';

export type {
  ActivityRepository,
  ActivitySources,
  AiSessionRepository,
  EventQuery,
  EventRepository,
  MilestoneChanges,
  NewAiSession,
  NewDecision,
  NewMilestone,
  NewProject,
  NewProjectItem,
  OffTimeRepository,
  ProjectChanges,
  ProjectItemChanges,
  ProjectRepository,
  StartWork,
  WorkRepository,
  BackupCounts,
  BackupData,
  BackupDocument,
  BackupInspection,
  BackupProblem,
  BackupRepository,
  ValidatedBackup,
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
/** Current database schema version (display only, e.g. backup previews). */
export { SCHEMA_VERSION } from '../schema';

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
    backup: createDexieBackupRepository({ db, ...deps }),
    projects: createDexieProjectRepository({ db, ...deps }),
    work: createDexieWorkRepository({ db, ...deps }),
    offTime: createDexieOffTimeRepository({ db, ...deps }),
    events: createDexieEventRepository({ db, ...deps }),
    aiSessions: createDexieAiSessionRepository({ db, ...deps }),
    activity: createDexieActivityRepository({ db, ...deps }),
  };
}
