import { asStore, type LowtideDatabase } from '../database';
import type { StoreDb } from '../store';
import {
  createDexieActivityRepository,
  createDexieAiSessionRepository,
  createDexieEventRepository,
} from './dexie-activity-repositories';
import { createDexieBackupRepository } from './dexie-backup-repository';
import { createDexieCollegeRepository } from './dexie-college-repository';
import { createDexieNotesRepository } from './dexie-notes-repository';
import { createDexieSpaceRepository } from './dexie-space-repository';
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
  NewSpaceNode,
  SpaceNodeChanges,
  SpaceRepository,
  NewNote,
  NoteChanges,
  NotesRepository,
  CollegeItemChanges,
  CollegeRepository,
  NewCollegeItem,
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
  TimelineEntry,
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
  NewSpaceBlock,
  NewSpaceColumn,
  NewSpaceView,
  SpaceColumnChanges,
  Expect,
  ProjectSetup,
  ProjectCreated,
  ProjectSpaceSlot,
} from './types';
export { PROJECT_SPACE_SLOTS } from './types';
export {
  InvalidInputError,
  RecordStateError,
  RecordNotFoundError,
  SpaceConflictError,
} from './errors';
/** Current database schema version (display only, e.g. backup previews). */
export { SCHEMA_VERSION } from '../schema';

/** Local IndexedDB-backed implementation of every repository. */
export function createDexieRepositories(
  db: LowtideDatabase,
  deps: Omit<RepositoryDeps, 'db'> = {},
): Repositories {
  return createRepositories(asStore(db), deps);
}

/**
 * Every repository over any storage that honours the contract (ADR-057):
 * Dexie in the browser, SQLite in the companion. Same domain code for both.
 */
export function createRepositories(
  db: StoreDb,
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
    college: createDexieCollegeRepository({ db, ...deps }),
    notes: createDexieNotesRepository({ db, ...deps }),
    space: createDexieSpaceRepository({ db, ...deps }),
  };
}
