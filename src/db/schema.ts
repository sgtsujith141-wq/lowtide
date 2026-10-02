import { z } from 'zod/mini';
import {
  PROJECT_FOCUS,
  LINKABLE_TYPES,
  SOURCE_ROLES,
  SOURCE_SYSTEMS,
  SPACE_ATTACHMENT_KINDS,
  SPACE_ATTACHMENT_STATUSES,
  SPACE_BODY_FORMATS,
  SPACE_COLUMN_TYPES,
  SPACE_FILTER_OPS,
  SPACE_VIEW_TYPES,
  ROLLUP_FUNCTIONS,
  SPACE_NODE_KINDS,
  SPACE_BLOCK_TYPES,
  SPACE_EDIT_KINDS,
  SPACE_EDIT_LIMIT,
  type SpaceBlock,
  type SpaceEdit,
  type EntityLink,
  type SourceRecord,
  type SourceRef,
  type SpaceAttachment,
  type SpaceColumn,
  type SpaceNode,
  type SpaceRow,
  type SpaceView,
  NOTE_AUTHORS,
  NOTE_KINDS,
  RESEARCH_STATUSES,
  type Note,
  COLLEGE_KINDS,
  COLLEGE_STATUSES,
  type CollegeItem,
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
  parentId: z.exactOptional(id),
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
  researchStatus: z.exactOptional(z.enum(RESEARCH_STATUSES)),
  team: z.exactOptional(z.string()),
  problemStatement: z.exactOptional(z.string()),
  nextAction: z.exactOptional(z.string()),
  status: z.enum(HACKATHON_STATUSES),
  notes: z.exactOptional(z.string()),
  projectId: z.exactOptional(id),
  archivedAt: z.exactOptional(timestamp),
  pinnedAt: z.exactOptional(timestamp),
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
  focus: z.exactOptional(z.enum(PROJECT_FOCUS)),
  description: z.exactOptional(text.check(z.maxLength(2000))),
  pinnedAt: z.exactOptional(timestamp),
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
  archivedAt: z.exactOptional(timestamp),
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
  client: z.exactOptional(text),
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
  actor: z.exactOptional(text),
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
  taskId: z.exactOptional(id),
  result: z.exactOptional(text),
  nextAction: z.exactOptional(text),
  commits: z.exactOptional(z.array(text)),
  handoff: z.exactOptional(text),
  createdAt: timestamp,
}) satisfies z.ZodMiniType<AiSession>;

/* Schema V5 (ADR-051). */

export const collegeItemSchema = z.object({
  id,
  kind: z.enum(COLLEGE_KINDS),
  title: text,
  date: localDate,
  status: z.enum(COLLEGE_STATUSES),
  course: z.exactOptional(text),
  note: z.exactOptional(text),
  createdAt: timestamp,
  updatedAt: timestamp,
}) satisfies z.ZodMiniType<CollegeItem>;

/* Schema V6 (ADR-056). */

export const noteSchema = z.object({
  id,
  projectId: id,
  kind: z.enum(NOTE_KINDS),
  title: text,
  body: z.string().check(z.maxLength(200_000)),
  author: z.enum(NOTE_AUTHORS),
  client: z.exactOptional(text),
  createdAt: timestamp,
  updatedAt: timestamp,
}) satisfies z.ZodMiniType<Note>;

/* Schema V7 (ADR-062): SPACE and source provenance. */

const linkableType = z.enum(LINKABLE_TYPES);
const entityLink = z.object({
  type: linkableType,
  id,
  rowId: z.exactOptional(z.string().check(z.minLength(1), z.maxLength(200))),
  label: z.exactOptional(z.string().check(z.maxLength(2000))),
});
const shortKey = z.string().check(z.minLength(1), z.maxLength(200));

export const entityLinkSchema = entityLink satisfies z.ZodMiniType<EntityLink>;

const sourceRef = z.object({
  system: z.enum(SOURCE_SYSTEMS),
  sourceId: shortKey,
  url: z.exactOptional(text),
  originalTitle: z.string().check(z.maxLength(2000)),
  path: z.exactOptional(z.array(z.string())),
  importedAt: timestamp,
  sourceCreatedAt: z.exactOptional(timestamp),
  sourceUpdatedAt: z.exactOptional(timestamp),
}) satisfies z.ZodMiniType<SourceRef>;

const spaceAttachment = z.object({
  id: shortKey,
  kind: z.enum(SPACE_ATTACHMENT_KINDS),
  name: text,
  status: z.enum(SPACE_ATTACHMENT_STATUSES),
  url: z.exactOptional(text),
  note: z.exactOptional(text),
}) satisfies z.ZodMiniType<SpaceAttachment>;

const spaceColumn = z.object({
  id: shortKey,
  name: z.string().check(z.maxLength(500)),
  type: z.enum(SPACE_COLUMN_TYPES),
  options: z.exactOptional(
    z.array(z.object({ name: z.string(), color: z.exactOptional(z.string()) })),
  ),
  description: z.exactOptional(z.string()),
  targets: z.exactOptional(z.array(linkableType)),
  rollup: z.exactOptional(
    z.object({
      relation: shortKey,
      fn: z.enum(ROLLUP_FUNCTIONS),
      property: z.exactOptional(shortKey),
    }),
  ),
  formula: z.exactOptional(z.string().check(z.maxLength(2000))),
}) satisfies z.ZodMiniType<SpaceColumn>;

const spaceCell = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(entityLink),
]);

const spaceRow = z.object({
  id: shortKey,
  cells: z.record(z.string(), spaceCell),
  pageId: z.exactOptional(id),
  links: z.exactOptional(z.array(entityLink)),
  createdAt: z.exactOptional(timestamp),
  updatedAt: z.exactOptional(timestamp),
  createdBy: z.exactOptional(z.string().check(z.minLength(1), z.maxLength(200))),
  updatedBy: z.exactOptional(z.string().check(z.minLength(1), z.maxLength(200))),
}) satisfies z.ZodMiniType<SpaceRow>;

const spaceView = z.object({
  id: shortKey,
  name: z.string().check(z.minLength(1), z.maxLength(200)),
  type: z.enum(SPACE_VIEW_TYPES),
  filters: z.exactOptional(
    z.array(
      z.object({
        column: shortKey,
        op: z.enum(SPACE_FILTER_OPS),
        value: z.exactOptional(z.string().check(z.maxLength(2000))),
      }),
    ),
  ),
  sorts: z.exactOptional(z.array(z.object({ column: shortKey, dir: z.enum(['asc', 'desc']) }))),
  groupBy: z.exactOptional(shortKey),
  dateColumn: z.exactOptional(shortKey),
  hidden: z.exactOptional(z.array(shortKey)),
  order: z.exactOptional(z.array(shortKey)),
}) satisfies z.ZodMiniType<SpaceView>;

const spaceBlock = z.object({
  id: shortKey,
  type: z.enum(SPACE_BLOCK_TYPES),
  text: z.exactOptional(z.string().check(z.maxLength(200_000))),
  checked: z.exactOptional(z.boolean()),
  indent: z.exactOptional(z.number().check(z.int(), z.minimum(0), z.maximum(3))),
  icon: z.exactOptional(z.string().check(z.maxLength(64))),
  language: z.exactOptional(z.string().check(z.maxLength(40))),
  link: z.exactOptional(entityLink),
  file: z.exactOptional(
    z.object({
      name: text.check(z.maxLength(500)),
      kind: z.enum(SPACE_ATTACHMENT_KINDS),
      url: z.exactOptional(text),
      mime: z.exactOptional(z.string().check(z.maxLength(200))),
      size: z.exactOptional(count),
      attachmentId: z.exactOptional(shortKey),
    }),
  ),
  rows: z.exactOptional(z.array(z.array(z.string()))),
  url: z.exactOptional(z.string().check(z.minLength(1), z.maxLength(4000))),
  title: z.exactOptional(z.string().check(z.maxLength(2000))),
  by: z.exactOptional(z.object({ client: text.check(z.maxLength(200)), at: timestamp })),
}) satisfies z.ZodMiniType<SpaceBlock>;

const spaceEdit = z.object({
  kind: z.enum(SPACE_EDIT_KINDS),
  by: z.enum(EVENT_SOURCES),
  client: z.exactOptional(z.string().check(z.maxLength(200))),
  startedAt: timestamp,
  at: timestamp,
  count: z.number().check(z.int(), z.minimum(1)),
}) satisfies z.ZodMiniType<SpaceEdit>;

export const spaceNodeSchema = z.object({
  id,
  parentId: z.exactOptional(id),
  kind: z.enum(SPACE_NODE_KINDS),
  title: text.check(z.maxLength(2000)),
  icon: z.exactOptional(z.string().check(z.maxLength(64))),
  description: z.exactOptional(text.check(z.maxLength(2000))),
  pinnedAt: z.exactOptional(timestamp),
  key: z.exactOptional(shortKey),
  body: z.exactOptional(z.string().check(z.maxLength(1_000_000))),
  bodyFormat: z.exactOptional(z.enum(SPACE_BODY_FORMATS)),
  order: count,
  archived: z.boolean(),
  links: z.array(entityLink),
  externalLinks: z.array(z.object({ url: text, label: z.exactOptional(z.string()) })),
  attachments: z.array(spaceAttachment),
  table: z.exactOptional(
    z.object({
      columns: z.array(spaceColumn),
      rows: z.array(spaceRow),
      views: z.exactOptional(z.array(spaceView)),
    }),
  ),
  source: z.exactOptional(sourceRef),
  blocks: z.exactOptional(z.array(spaceBlock).check(z.maxLength(10_000))),
  revision: z.exactOptional(count),
  edits: z.exactOptional(z.array(spaceEdit).check(z.maxLength(SPACE_EDIT_LIMIT))),
  createdAt: timestamp,
  updatedAt: timestamp,
}) satisfies z.ZodMiniType<SpaceNode>;

export const sourceRecordSchema = z.object({
  id,
  system: z.enum(SOURCE_SYSTEMS),
  sourceId: shortKey,
  entityType: linkableType,
  entityId: id,
  role: z.enum(SOURCE_ROLES),
  url: z.exactOptional(text),
  originalTitle: z.string().check(z.maxLength(2000)),
  path: z.exactOptional(z.array(z.string())),
  contentHash: shortKey,
  importedAt: timestamp,
  appliedAt: timestamp,
  sourceCreatedAt: z.exactOptional(timestamp),
  sourceUpdatedAt: z.exactOptional(timestamp),
}) satisfies z.ZodMiniType<SourceRecord>;

/**
 * IndexedDB name. Changing it abandons existing user data; don't.
 */
export const DATABASE_NAME = 'lowtide';

/**
 * Current schema version. Bump it (never edit a shipped version) when the
 * store layout or record shape changes; see docs/DATA-MODEL.md#migrations.
 */
export const SCHEMA_VERSION = 10;

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

/**
 * Version 5 (v2 PHASE 006, ADR-051): one new store for college classes, labs,
 * assignments, exams and events. Additive: no existing record is touched.
 */
export const STORES_V5 = {
  collegeItems: 'id, date, kind',
} as const;

/**
 * Version 6 (v2 PHASE 008B, ADR-056): a `notes` store; optional
 * `Hackathon.researchStatus`, `Decision.client`, `LedgerEvent.actor` and
 * AI-session detail fields. Additive: no existing record is rewritten, and
 * existing hackathons keep research unset (not started), never guessed.
 */
export const STORES_V6 = {
  notes: 'id, projectId, createdAt',
} as const;

/**
 * Version 7 (v2 PHASE 010, ADR-062): `spaceNodes` (the SPACE hierarchy of
 * sections, pages and tables) and `sourceRecords` (provenance for imported
 * records, and the importer's memory). Additive: nothing existing is touched.
 */
export const STORES_V7 = {
  spaceNodes: 'id, parentId, &key, updatedAt',
  sourceRecords: 'id, &[system+sourceId+entityType], [entityType+entityId]',
} as const;

/**
 * Version 8 (v2 PHASE 012, ADR-064): optional `Project.focus`. No store or
 * index changes; the version records the new optional field. Existing
 * projects keep focus unset.
 */
export const STORES_V8 = {} as const;

/**
 * Version 9 (v2 PHASE 014, ADR-067): SPACE pages gain optional `blocks`,
 * `revision` and `edits`. No store or index changes; imported bodies are
 * never converted.
 */
export const STORES_V9 = {} as const;

/**
 * Version 10 (LOWTIDE v2.1): subtasks (`Task.parentId`, indexed), archived
 * milestones and hackathons, pins, project and SPACE descriptions, and SPACE
 * databases (views, row authorship, relation targets, rollups, formulas,
 * bookmark blocks). Additive: no existing record is rewritten.
 */
export const STORES_V10 = {
  tasks: 'id, status, dueAt, createdAt, plannedFor, projectId, parentId',
} as const;
