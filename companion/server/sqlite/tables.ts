import {
  PROJECT_FOCUS,
  LINKABLE_TYPES,
  SOURCE_ROLES,
  SOURCE_SYSTEMS,
  SPACE_BODY_FORMATS,
  SPACE_NODE_KINDS,
  AI_SCOPES,
  BUILD_STATUSES,
  COLLEGE_KINDS,
  COLLEGE_STATUSES,
  DECISION_ORIGINS,
  ENTITY_TYPES,
  EVENT_SOURCES,
  EVENT_TYPES,
  HABIT_CATEGORIES,
  HABIT_UNITS,
  HACKATHON_KINDS,
  HACKATHON_SELECTIONS,
  HACKATHON_STATUSES,
  NOTE_AUTHORS,
  NOTE_KINDS,
  OFFTIME_KINDS,
  PPT_STATUSES,
  PROJECT_ITEM_KINDS,
  PROJECT_KINDS,
  PROJECT_LANES,
  PROJECT_STATES,
  PROTECTED_TIME_KINDS,
  REGISTRATION_STATUSES,
  RESEARCH_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  WORK_KINDS,
} from '../../../src/types/domain';
import type { StoreName } from '../../../src/db/migrations';

/*
 * The relational schema for LOWTIDE domain schema V7 (ADR-057, ADR-062): one table per
 * store, one typed column per field, enumerations as CHECK constraints (from
 * the same constants the domain uses), references as deferred foreign keys,
 * and the browser's indexes and unique indexes. Nested value collections
 * without their own identity (session pauses, event data, lane counts, lists
 * of file paths or commits) are JSON columns, validated by the domain schemas.
 *
 * Absent optional fields are NULL, and NULL reads back as an absent field.
 */

export type ColumnType = 'text' | 'integer' | 'real' | 'bool' | 'json';

export interface Column {
  field: string;
  column: string;
  type: ColumnType;
  required: boolean;
  /** Allowed values (CHECK). */
  values?: readonly string[];
  /** Foreign key target table (deferred). */
  references?: string;
  unique?: boolean;
}

export interface TableSpec {
  store: StoreName;
  table: string;
  columns: Column[];
  /** Dexie index names this table answers: 'status', '[habitId+date]', … */
  indexes: string[];
  /** Unique composite indexes, as field lists. */
  unique?: string[][];
}

const snake = (field: string) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function col(
  field: string,
  type: ColumnType,
  required: boolean,
  extra: Partial<Pick<Column, 'values' | 'references' | 'unique' | 'column'>> = {},
): Column {
  return { field, column: extra.column ?? snake(field), type, required, ...extra };
}

const req = (field: string, type: ColumnType = 'text', extra = {}) => col(field, type, true, extra);
const opt = (field: string, type: ColumnType = 'text', extra = {}) =>
  col(field, type, false, extra);
const id = req('id');
const created = req('createdAt');
const updated = req('updatedAt');

export const TABLES: TableSpec[] = [
  {
    store: 'tasks',
    table: 'tasks',
    columns: [
      id,
      req('title'),
      opt('notes'),
      req('status', 'text', { values: TASK_STATUSES }),
      req('priority', 'text', { values: TASK_PRIORITIES }),
      opt('dueAt'),
      opt('project'),
      opt('projectId', 'text', { references: 'projects' }),
      opt('milestoneId', 'text', { references: 'milestones' }),
      opt('plannedFor'),
      opt('parentId', 'text', { references: 'tasks' }),
      created,
      opt('completedAt'),
      updated,
    ],
    indexes: ['status', 'dueAt', 'createdAt', 'plannedFor', 'projectId', 'parentId'],
  },
  {
    store: 'inbox',
    table: 'inbox',
    columns: [
      id,
      req('content'),
      created,
      opt('processedAt'),
      opt('convertedToTaskId', 'text', { references: 'tasks' }),
    ],
    indexes: ['createdAt'],
  },
  {
    store: 'habits',
    table: 'habits',
    columns: [
      id,
      req('name'),
      req('category', 'text', { values: HABIT_CATEGORIES }),
      req('unit', 'text', { values: HABIT_UNITS }),
      opt('target', 'real'),
      req('archived', 'bool'),
      created,
    ],
    indexes: ['createdAt'],
  },
  {
    store: 'habitEntries',
    table: 'habit_entries',
    columns: [
      id,
      req('habitId', 'text', { references: 'habits' }),
      req('date'),
      req('value', 'real'),
      opt('note'),
      created,
      updated,
    ],
    indexes: ['habitId', 'date', '[habitId+date]'],
    unique: [['habitId', 'date']],
  },
  {
    store: 'hackathons',
    table: 'hackathons',
    columns: [
      id,
      req('name'),
      opt('registrationDeadline'),
      opt('eventStart'),
      opt('eventEnd'),
      req('registrationStatus', 'text', { values: REGISTRATION_STATUSES }),
      req('pptStatus', 'text', { values: PPT_STATUSES }),
      req('buildStatus', 'text', { values: BUILD_STATUSES }),
      opt('researchStatus', 'text', { values: RESEARCH_STATUSES }),
      opt('team'),
      opt('problemStatement'),
      opt('nextAction'),
      req('status', 'text', { values: HACKATHON_STATUSES }),
      opt('notes'),
      opt('projectId', 'text', { references: 'projects' }),
      opt('archivedAt'),
      opt('pinnedAt'),
      opt('kind', 'text', { values: HACKATHON_KINDS }),
      opt('selection', 'text', { values: HACKATHON_SELECTIONS }),
      created,
      updated,
    ],
    indexes: ['status', 'registrationDeadline', 'eventStart', 'projectId'],
  },
  {
    store: 'protectedTime',
    table: 'protected_time',
    columns: [
      id,
      req('title'),
      req('date'),
      req('kind', 'text', { values: PROTECTED_TIME_KINDS }),
      opt('notes'),
    ],
    indexes: ['date'],
  },
  {
    store: 'projects',
    table: 'projects',
    columns: [
      id,
      req('name'),
      req('slug', 'text', { unique: true }),
      req('kind', 'text', { values: PROJECT_KINDS }),
      req('state', 'text', { values: PROJECT_STATES }),
      opt('objective'),
      opt('phase'),
      opt('nextAction'),
      opt('repoUrl'),
      opt('focus', 'text', { values: PROJECT_FOCUS }),
      opt('description'),
      opt('pinnedAt'),
      created,
      updated,
      req('stateChangedAt'),
    ],
    indexes: ['slug', 'state', 'updatedAt'],
  },
  {
    store: 'milestones',
    table: 'milestones',
    columns: [
      id,
      req('projectId', 'text', { references: 'projects' }),
      req('title'),
      opt('notes'),
      req('order', 'integer', { column: 'sort_order' }),
      req('weight', 'real'),
      opt('dueOn'),
      opt('completedAt'),
      opt('archivedAt'),
      created,
      updated,
    ],
    indexes: ['projectId', '[projectId+order]'],
  },
  {
    store: 'projectItems',
    table: 'project_items',
    columns: [
      id,
      req('projectId', 'text', { references: 'projects' }),
      req('kind', 'text', { values: PROJECT_ITEM_KINDS }),
      req('lane', 'text', { values: PROJECT_LANES }),
      req('title'),
      opt('body'),
      opt('waitingOn'),
      opt('taskId', 'text', { references: 'tasks' }),
      opt('milestoneId', 'text', { references: 'milestones' }),
      req('order', 'integer', { column: 'sort_order' }),
      created,
      updated,
      req('laneChangedAt'),
      opt('resolvedAt'),
    ],
    indexes: ['projectId', '[projectId+lane]', 'taskId'],
  },
  {
    store: 'decisions',
    table: 'decisions',
    columns: [
      id,
      req('projectId', 'text', { references: 'projects' }),
      req('title'),
      opt('context'),
      req('decision'),
      opt('consequences'),
      req('decidedAt'),
      opt('supersedesId', 'text', { references: 'decisions' }),
      req('origin', 'text', { values: DECISION_ORIGINS }),
      opt('client'),
      created,
    ],
    indexes: ['projectId', 'decidedAt'],
  },
  {
    store: 'workSessions',
    table: 'work_sessions',
    columns: [
      id,
      req('kind', 'text', { values: WORK_KINDS }),
      opt('projectId', 'text', { references: 'projects' }),
      opt('taskId', 'text', { references: 'tasks' }),
      opt('intent'),
      req('startedAt'),
      opt('endedAt'),
      req('pauses', 'json'),
      req('localDate'),
      opt('outcome'),
      created,
      updated,
    ],
    indexes: ['kind', 'projectId', 'taskId', 'localDate', 'startedAt'],
  },
  {
    store: 'offTimeSessions',
    table: 'off_time_sessions',
    columns: [
      id,
      req('kind', 'text', { values: OFFTIME_KINDS }),
      req('localDate'),
      opt('startedAt'),
      opt('endedAt'),
      opt('note'),
      created,
      updated,
    ],
    indexes: ['kind', 'localDate', 'startedAt'],
  },
  {
    store: 'events',
    table: 'events',
    columns: [
      id,
      req('type', 'text', { values: EVENT_TYPES }),
      req('at'),
      req('localDate'),
      req('entityType', 'text', { values: ENTITY_TYPES }),
      req('entityId'),
      opt('projectId', 'text', { references: 'projects' }),
      req('data', 'json'),
      req('source', 'text', { values: EVENT_SOURCES }),
      opt('actor'),
    ],
    indexes: ['at', 'localDate', 'type', 'projectId', '[entityType+entityId]'],
  },
  {
    store: 'progressSnapshots',
    table: 'progress_snapshots',
    columns: [
      id,
      req('projectId', 'text', { references: 'projects' }),
      req('localDate'),
      req('completedWeight', 'real'),
      req('totalWeight', 'real'),
      req('milestoneCount', 'integer'),
      req('completedCount', 'integer'),
      req('state', 'text', { values: PROJECT_STATES }),
      req('laneCounts', 'json'),
      updated,
    ],
    indexes: ['projectId', '[projectId+localDate]'],
    unique: [['projectId', 'localDate']],
  },
  {
    store: 'aiSessions',
    table: 'ai_sessions',
    columns: [
      id,
      req('client'),
      req('scope', 'text', { values: AI_SCOPES }),
      opt('projectId', 'text', { references: 'projects' }),
      req('startedAt'),
      req('endedAt'),
      req('summary'),
      opt('filesTouched', 'json'),
      opt('taskId', 'text', { references: 'tasks' }),
      opt('result'),
      opt('nextAction'),
      opt('commits', 'json'),
      opt('handoff'),
      created,
    ],
    indexes: ['projectId', 'startedAt'],
  },
  {
    store: 'collegeItems',
    table: 'college_items',
    columns: [
      id,
      req('kind', 'text', { values: COLLEGE_KINDS }),
      req('title'),
      req('date'),
      req('status', 'text', { values: COLLEGE_STATUSES }),
      opt('course'),
      opt('note'),
      created,
      updated,
    ],
    indexes: ['date', 'kind'],
  },
  {
    store: 'notes',
    table: 'notes',
    columns: [
      id,
      req('projectId', 'text', { references: 'projects' }),
      req('kind', 'text', { values: NOTE_KINDS }),
      req('title'),
      req('body'),
      req('author', 'text', { values: NOTE_AUTHORS }),
      opt('client'),
      created,
      updated,
    ],
    indexes: ['projectId', 'createdAt'],
  },
  {
    store: 'spaceNodes',
    table: 'space_nodes',
    columns: [
      id,
      opt('parentId', 'text', { references: 'space_nodes' }),
      req('kind', 'text', { values: SPACE_NODE_KINDS }),
      req('title'),
      opt('icon'),
      opt('description'),
      opt('pinnedAt'),
      opt('key', 'text', { unique: true }),
      opt('body'),
      opt('bodyFormat', 'text', { values: SPACE_BODY_FORMATS }),
      req('order', 'integer', { column: 'sort_order' }),
      req('archived', 'bool'),
      req('links', 'json'),
      req('externalLinks', 'json'),
      req('attachments', 'json'),
      opt('table', 'json', { column: 'table_data' }),
      opt('source', 'json'),
      opt('blocks', 'json'),
      opt('revision', 'integer'),
      opt('edits', 'json'),
      created,
      updated,
    ],
    indexes: ['parentId', 'key', 'updatedAt'],
  },
  {
    store: 'sourceRecords',
    table: 'source_records',
    columns: [
      id,
      req('system', 'text', { values: SOURCE_SYSTEMS }),
      req('sourceId'),
      req('entityType', 'text', { values: LINKABLE_TYPES }),
      req('entityId'),
      req('role', 'text', { values: SOURCE_ROLES }),
      opt('url'),
      req('originalTitle'),
      opt('path', 'json'),
      req('contentHash'),
      req('importedAt'),
      req('appliedAt'),
      opt('sourceCreatedAt'),
      opt('sourceUpdatedAt'),
    ],
    indexes: ['[system+sourceId+entityType]', '[entityType+entityId]'],
    unique: [['system', 'sourceId', 'entityType']],
  },
];

/** The tables of domain schema V6 (companion migration 1). */
export const V6_TABLES = TABLES.filter(
  (t) => t.store !== 'spaceNodes' && t.store !== 'sourceRecords',
);
/** The tables added by domain schema V7 (companion migration 3, ADR-062). */
export const V7_TABLES = TABLES.filter((t) => !V6_TABLES.includes(t));

export const TABLE_BY_STORE = new Map(TABLES.map((t) => [t.store, t]));

const SQL_TYPE: Record<ColumnType, string> = {
  text: 'TEXT',
  integer: 'INTEGER',
  real: 'REAL',
  bool: 'INTEGER',
  json: 'TEXT',
};

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** One column's definition, as in CREATE TABLE or ALTER TABLE … ADD COLUMN. */
export function columnDdl(c: Column): string {
  const parts = [c.column, SQL_TYPE[c.type]];
  if (c.field === 'id') parts.push('PRIMARY KEY');
  else if (c.required) parts.push('NOT NULL');
  if (c.unique) parts.push('UNIQUE');
  if (c.values) parts.push(`CHECK (${c.column} IN (${c.values.map(quote).join(', ')}))`);
  if (c.type === 'bool') parts.push(`CHECK (${c.column} IN (0, 1))`);
  if (c.type === 'json') parts.push(`CHECK (${c.column} IS NULL OR json_valid(${c.column}))`);
  if (c.references) {
    parts.push(`REFERENCES ${c.references}(id) DEFERRABLE INITIALLY DEFERRED`);
  }
  return parts.join(' ');
}

/** CREATE TABLE and CREATE INDEX statements for the given domain tables. */
export function domainDdl(specs: readonly TableSpec[] = TABLES): string[] {
  const statements: string[] = [];
  for (const spec of specs) {
    const lines = spec.columns.map(columnDdl);
    for (const fields of spec.unique ?? []) {
      lines.push(`UNIQUE (${fields.map((f) => columnOf(spec, f)).join(', ')})`);
    }
    statements.push(`CREATE TABLE ${spec.table} (\n  ${lines.join(',\n  ')}\n) STRICT`);
    for (const index of spec.indexes) {
      const cols = indexColumns(spec, index);
      if (cols.length === 1 && spec.columns.find((c) => c.column === cols[0])?.unique) continue;
      const name = `${spec.table}_${cols.join('_')}`;
      statements.push(`CREATE INDEX ${name} ON ${spec.table} (${cols.join(', ')})`);
    }
  }
  return statements;
}

export function columnOf(spec: TableSpec, field: string): string {
  const c = spec.columns.find((x) => x.field === field);
  if (!c) throw new Error(`${spec.store} has no field ${field}`);
  return c.column;
}

/** Columns for a Dexie index name ('status' or '[projectId+lane]'). */
export function indexColumns(spec: TableSpec, index: string): string[] {
  const fields = index.startsWith('[') ? index.slice(1, -1).split('+') : [index];
  return fields.map((f) => columnOf(spec, f));
}
