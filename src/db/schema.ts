import { z } from 'zod/mini';
import {
  AI_SCOPES,
  DECISION_ORIGINS,
  ENTITY_TYPES,
  EVENT_SOURCES,
  EVENT_TYPES,
  OFFTIME_KINDS,
  PROJECT_ITEM_KINDS,
  PROJECT_KINDS,
  PROJECT_LANES,
  PROJECT_STATES,
  WORK_KINDS,
  type AiSession,
  type Decision,
  type LedgerEvent,
  type Milestone,
  type OffTimeSession,
  type ProgressSnapshot,
  type Project,
  type ProjectItem,
  type WorkSession,
  BUILD_STATUSES,
  HABIT_CATEGORIES,
  HABIT_UNITS,
  HACKATHON_STATUSES,
  PPT_STATUSES,
  PROTECTED_TIME_KINDS,
  REGISTRATION_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Habit,
  type HabitEntry,
  type Hackathon,
  type InboxItem,
  type ProtectedTime,
  type Task,
} from '../types/domain';

/**
 * Persisted-record schemas and the IndexedDB store layout.
 *
 * Every record is validated with these schemas before it is written, and they
 * are the gate for any future import. `satisfies z.ZodMiniType<T>` keeps each
 * schema in lockstep with its domain type: drift is a compile error.
 */

const id = z.uuid();
const timestamp = z.iso.datetime();
const localDate = z.iso.date();
const text = z.string().check(z.trim(), z.minLength(1));

export const taskSchema = z.object({
  id,
  title: text,
  notes: z.exactOptional(z.string()),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  dueAt: z.exactOptional(timestamp),
  project: z.exactOptional(text),
  plannedFor: z.exactOptional(localDate),
  projectId: z.exactOptional(id),
  milestoneId: z.exactOptional(id),
  createdAt: timestamp,
  completedAt: z.exactOptional(timestamp),
  updatedAt: timestamp,
}) satisfies z.ZodMiniType<Task>;

export const inboxItemSchema = z.object({
  id,
  content: text,
  createdAt: timestamp,
  processedAt: z.exactOptional(timestamp),
  convertedToTaskId: z.exactOptional(id),
}) satisfies z.ZodMiniType<InboxItem>;

export const habitSchema = z.object({
  id,
  name: text,
  category: z.enum(HABIT_CATEGORIES),
  unit: z.enum(HABIT_UNITS),
  target: z.exactOptional(z.number().check(z.positive())),
  archived: z.boolean(),
  createdAt: timestamp,
}) satisfies z.ZodMiniType<Habit>;

export const habitEntrySchema = z.object({
  id,
  habitId: id,
  date: localDate,
  value: z.number().check(z.nonnegative()),
  note: z.exactOptional(z.string()),
  createdAt: timestamp,
  updatedAt: timestamp,
}) satisfies z.ZodMiniType<HabitEntry>;

export const hackathonSchema = z.object({
  id,
  name: text,
  registrationDeadline: z.exactOptional(localDate),
  eventStart: z.exactOptional(localDate),
  eventEnd: z.exactOptional(localDate),
  registrationStatus: z.enum(REGISTRATION_STATUSES),
  pptStatus: z.enum(PPT_STATUSES),
  buildStatus: z.enum(BUILD_STATUSES),
  team: z.exactOptional(z.string()),
  problemStatement: z.exactOptional(z.string()),
  nextAction: z.exactOptional(z.string()),
  status: z.enum(HACKATHON_STATUSES),
  notes: z.exactOptional(z.string()),
  projectId: z.exactOptional(id),
  createdAt: timestamp,
  updatedAt: timestamp,
}) satisfies z.ZodMiniType<Hackathon>;

export const protectedTimeSchema = z.object({
  id,
  title: text,
  date: localDate,
  kind: z.enum(PROTECTED_TIME_KINDS),
  notes: z.exactOptional(z.string()),
}) satisfies z.ZodMiniType<ProtectedTime>;

/* Schema V4 (ADR-046). */

const count = z.number().check(z.int(), z.nonnegative());
const weight = z.number().check(z.positive());
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const projectSchema = z.object({
  id,
  name: text.check(z.maxLength(120)),
  slug: z.string().check(z.regex(SLUG_PATTERN), z.maxLength(64)),
  kind: z.enum(PROJECT_KINDS),
  state: z.enum(PROJECT_STATES),
  objective: z.exactOptional(text),
  phase: z.exactOptional(text),
  nextAction: z.exactOptional(text),
  repoUrl: z.exactOptional(text),
  createdAt: timestamp,
  updatedAt: timestamp,
  stateChangedAt: timestamp,
}) satisfies z.ZodMiniType<Project>;

export const milestoneSchema = z.object({
  id,
  projectId: id,
  title: text,
  notes: z.exactOptional(text),
  order: count,
  weight,
  dueOn: z.exactOptional(localDate),
  completedAt: z.exactOptional(timestamp),
  createdAt: timestamp,
  updatedAt: timestamp,
}) satisfies z.ZodMiniType<Milestone>;

export const projectItemSchema = z.object({
  id,
  projectId: id,
  kind: z.enum(PROJECT_ITEM_KINDS),
  lane: z.enum(PROJECT_LANES),
  title: text,
  body: z.exactOptional(text),
  waitingOn: z.exactOptional(text),
  taskId: z.exactOptional(id),
  milestoneId: z.exactOptional(id),
  order: count,
  createdAt: timestamp,
  updatedAt: timestamp,
  laneChangedAt: timestamp,
  resolvedAt: z.exactOptional(timestamp),
}) satisfies z.ZodMiniType<ProjectItem>;

export const decisionSchema = z.object({
  id,
  projectId: id,
  title: text,
  context: z.exactOptional(text),
  decision: text,
  consequences: z.exactOptional(text),
  decidedAt: timestamp,
  supersedesId: z.exactOptional(id),
  origin: z.enum(DECISION_ORIGINS),
  createdAt: timestamp,
}) satisfies z.ZodMiniType<Decision>;

export const workSessionSchema = z.object({
  id,
  kind: z.enum(WORK_KINDS),
  projectId: z.exactOptional(id),
  taskId: z.exactOptional(id),
  intent: z.exactOptional(text),
  startedAt: timestamp,
  endedAt: z.exactOptional(timestamp),
  pauses: z.array(z.object({ at: timestamp, resumedAt: z.exactOptional(timestamp) })),
  localDate,
  outcome: z.exactOptional(text),
  createdAt: timestamp,
  updatedAt: timestamp,
}) satisfies z.ZodMiniType<WorkSession>;

export const offTimeSessionSchema = z.object({
  id,
  kind: z.enum(OFFTIME_KINDS),
  localDate,
  startedAt: z.exactOptional(timestamp),
  endedAt: z.exactOptional(timestamp),
  note: z.exactOptional(text),
  createdAt: timestamp,
  updatedAt: timestamp,
}) satisfies z.ZodMiniType<OffTimeSession>;

export const ledgerEventSchema = z.object({
  id,
  type: z.enum(EVENT_TYPES),
  at: timestamp,
  localDate,
  entityType: z.enum(ENTITY_TYPES),
  entityId: id,
  projectId: z.exactOptional(id),
  data: z.record(z.string(), z.string()),
  source: z.enum(EVENT_SOURCES),
}) satisfies z.ZodMiniType<LedgerEvent>;

export const progressSnapshotSchema = z.object({
  id,
  projectId: id,
  localDate,
  completedWeight: z.number().check(z.nonnegative()),
  totalWeight: z.number().check(z.nonnegative()),
  milestoneCount: count,
  completedCount: count,
  state: z.enum(PROJECT_STATES),
  laneCounts: z.record(z.enum(PROJECT_LANES), count),
  updatedAt: timestamp,
}) satisfies z.ZodMiniType<ProgressSnapshot>;

export const aiSessionSchema = z.object({
  id,
  client: text,
  scope: z.enum(AI_SCOPES),
  projectId: z.exactOptional(id),
  startedAt: timestamp,
  endedAt: timestamp,
  summary: text,
  filesTouched: z.exactOptional(z.array(text)),
  createdAt: timestamp,
}) satisfies z.ZodMiniType<AiSession>;

/**
 * IndexedDB name. Changing it abandons existing user data; don't.
 */
export const DATABASE_NAME = 'lowtide';

/**
 * Current schema version. Bump it (never edit a shipped version) when the
 * store layout or record shape changes; see docs/DATA-MODEL.md#migrations.
 */
export const SCHEMA_VERSION = 4;

/**
 * Dexie store definitions for version 1. First entry is the primary key;
 * the rest are indexes. `&` = unique, `[a+b]` = compound. Only fields we
 * query by are indexed. Booleans are not valid IndexedDB keys, so
 * `habits.archived` is deliberately not indexed.
 */
export const STORES_V1 = {
  tasks: 'id, status, dueAt, createdAt',
  inbox: 'id, createdAt',
  habits: 'id, createdAt',
  habitEntries: 'id, habitId, date, &[habitId+date]',
  hackathons: 'id, status, registrationDeadline, eventStart',
  protectedTime: 'id, date',
} as const;

/**
 * Version 2 (PHASE 002): index `tasks.plannedFor` so Today can query a day's
 * plan directly. Only changed stores are listed; the rest carry over from V1.
 * Record shape change: optional `Task.plannedFor`. No data rewrite is needed:
 * V1 tasks are valid V2 tasks with `plannedFor` absent.
 */
export const STORES_V2 = {
  tasks: 'id, status, dueAt, createdAt, plannedFor',
} as const;

/**
 * Version 3 (PHASE 004): hackathon dates become `LocalDate` (ADR-027). The
 * index layout is unchanged; the version exists to run the data upgrade in
 * `migrations.ts` (`migrateHackathonToV3`).
 */
export const STORES_V3 = {
  hackathons: 'id, status, registrationDeadline, eventStart',
} as const;

/**
 * Version 4 (v2 PHASE 002, ADR-046): nine new stores and two new indexes.
 * Additive only: the upgrade writes nothing to existing records, derives no
 * projects from task labels and converts no hackathons.
 */
export const STORES_V4 = {
  tasks: 'id, status, dueAt, createdAt, plannedFor, projectId',
  hackathons: 'id, status, registrationDeadline, eventStart, projectId',
  projects: 'id, &slug, state, updatedAt',
  milestones: 'id, projectId, [projectId+order]',
  projectItems: 'id, projectId, [projectId+lane], taskId',
  decisions: 'id, projectId, decidedAt',
  workSessions: 'id, kind, projectId, taskId, localDate, startedAt',
  offTimeSessions: 'id, kind, localDate, startedAt',
  events: 'id, at, localDate, type, projectId, [entityType+entityId]',
  progressSnapshots: 'id, projectId, &[projectId+localDate]',
  aiSessions: 'id, projectId, startedAt',
} as const;
