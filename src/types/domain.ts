/**
 * LOWTIDE domain types.
 *
 * Conventions (see docs/DATA-MODEL.md):
 * - `Id` is a UUID v4 string from `crypto.randomUUID()`.
 * - `Timestamp` is an ISO 8601 instant in UTC, always from `Date#toISOString()`
 *   (e.g. `2026-09-28T14:03:11.402Z`). Fixed width, so strings sort chronologically.
 * - `LocalDate` is a calendar day in the user's local time zone, `YYYY-MM-DD`.
 *   Used where the meaning is "which day", not "which instant" (habits, protected time).
 * - Optional fields are omitted when absent, never stored as `null`.
 *
 * Each union is backed by a runtime `as const` array so the Zod schemas in
 * src/db/schema.ts and any future UI pickers share one list.
 */

export type Id = string;
export type Timestamp = string;
export type LocalDate = string;

export const TASK_STATUSES = ['todo', 'doing', 'done', 'dropped'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface Task {
  id: Id;
  title: string;
  notes?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt?: Timestamp;
  /** Free-text project label (v0.1). Kept verbatim; never derived into a Project. */
  project?: string;
  /** Link to a Project (schema V4). Set only by an explicit action. */
  projectId?: Id;
  /** A milestone of the same project (schema V4). Requires `projectId`. */
  milestoneId?: Id;
  /**
   * The task this is a subtask of (schema V10). Same project as its parent;
   * one level deep, so a subtask has no subtasks of its own.
   */
  parentId?: Id;
  /**
   * The local day the user chose to work on this ("in my plan for that day").
   * Independent of `dueAt`: planning never changes the deadline and vice versa.
   * Kept after completion as a record of intent (ADR-019).
   */
  plannedFor?: LocalDate;
  createdAt: Timestamp;
  /** Set when status becomes `done`; cleared if the task is reopened. */
  completedAt?: Timestamp;
  updatedAt: Timestamp;
}

export interface InboxItem {
  id: Id;
  content: string;
  createdAt: Timestamp;
  /** Set once the item has been dealt with (converted, filed or discarded). */
  processedAt?: Timestamp;
  convertedToTaskId?: Id;
}

/**
 * Deliberately no relationship/family/friends category: time with people is
 * never tracked as a habit, streak or activity square. It lives in
 * `ProtectedTime` instead.
 */
export const HABIT_CATEGORIES = [
  'coding',
  'learning',
  'fitness',
  'health',
  'money',
  'personal',
] as const;
export type HabitCategory = (typeof HABIT_CATEGORIES)[number];

/** `check`: value is 1 when done that day. `count`/`minutes`: value is the amount. */
export const HABIT_UNITS = ['check', 'count', 'minutes'] as const;
export type HabitUnit = (typeof HABIT_UNITS)[number];

export interface Habit {
  id: Id;
  name: string;
  category: HabitCategory;
  unit: HabitUnit;
  /** Daily amount that counts as "done" for `count`/`minutes` habits. */
  target?: number;
  archived: boolean;
  createdAt: Timestamp;
}

/** At most one entry per habit per local day (enforced by a unique index). */
export interface HabitEntry {
  id: Id;
  habitId: Id;
  date: LocalDate;
  value: number;
  note?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const REGISTRATION_STATUSES = [
  'not_registered',
  'registered',
  'waitlisted',
  'rejected',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const PPT_STATUSES = ['not_needed', 'not_started', 'in_progress', 'submitted'] as const;
export type PptStatus = (typeof PPT_STATUSES)[number];

export const BUILD_STATUSES = ['not_started', 'in_progress', 'demo_ready', 'submitted'] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

/** Research for a hackathon (schema V6, ADR-056). Absent means not started. */
export const RESEARCH_STATUSES = ['not_started', 'in_progress', 'done'] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

/** Overall lifecycle of a hackathon, independent of the per-track statuses above. */
export const HACKATHON_STATUSES = ['considering', 'active', 'finished', 'dropped'] as const;
export type HackathonStatus = (typeof HACKATHON_STATUSES)[number];

export interface Hackathon {
  id: Id;
  name: string;
  /** Calendar days, not instants (schema V3, ADR-027). Exact times go in `notes`. */
  registrationDeadline?: LocalDate;
  eventStart?: LocalDate;
  /** Not before `eventStart`; only set together with `eventStart`. */
  eventEnd?: LocalDate;
  registrationStatus: RegistrationStatus;
  pptStatus: PptStatus;
  buildStatus: BuildStatus;
  /** Recorded research progress (schema V6). Absent means not started; never inferred. */
  researchStatus?: ResearchStatus;
  /** Free text, e.g. teammate names. */
  team?: string;
  problemStatement?: string;
  nextAction?: string;
  status: HackathonStatus;
  notes?: string;
  /** A technical Project tracking the build (schema V4, ADR-039). Owner-set only. */
  projectId?: Id;
  /** Set when archived (schema V10): out of the lists, kept, restorable. */
  archivedAt?: Timestamp;
  /** Set when pinned (schema V10): shown first. A viewing choice, never activity. */
  pinnedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const PROTECTED_TIME_KINDS = [
  'relationship',
  'family',
  'friends',
  'rest',
  'personal',
] as const;
export type ProtectedTimeKind = (typeof PROTECTED_TIME_KINDS)[number];

export interface ProtectedTime {
  id: Id;
  title: string;
  date: LocalDate;
  kind: ProtectedTimeKind;
  notes?: string;
}

/* ------------------------------------------------------------------------ */
/* Schema V4 (LOWTIDE v2, ADR-046). See docs/LOWTIDE-V2-ARCHITECTURE.md §3–§9. */
/* ------------------------------------------------------------------------ */

export const PROJECT_STATES = [
  'planning',
  'active',
  'waiting',
  'needs_approval',
  'blocked',
  'parked',
  'review',
  'done',
  'archived',
] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

export const PROJECT_KINDS = ['software', 'research', 'other'] as const;

/**
 * Portfolio focus (schema V8, ADR-064): how much of the owner's attention a
 * project has right now. A viewing priority set by the owner, never derived
 * and never counted as project movement. Absent means not set.
 */
export const PROJECT_FOCUS = ['primary', 'secondary', 'supporting', 'background'] as const;
export type ProjectFocus = (typeof PROJECT_FOCUS)[number];
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export interface Project {
  id: Id;
  name: string;
  /** Unique, `[a-z0-9-]`, 1–64 chars. The workspace folder name. */
  slug: string;
  kind: ProjectKind;
  state: ProjectState;
  /** What "done" means, in a sentence. */
  objective?: string;
  /** The current phase in words ("Foundation", "Beta"…). */
  phase?: string;
  nextAction?: string;
  /** Informational only: nothing is fetched (ADR-041). */
  repoUrl?: string;
  /** Portfolio focus (schema V8). Changing it is not a project movement. */
  focus?: ProjectFocus;
  /** What the project is, in a sentence or two (schema V10). */
  description?: string;
  /** Set when pinned (schema V10). A viewing choice, never project movement. */
  pinnedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  stateChangedAt: Timestamp;
}

export interface Milestone {
  id: Id;
  projectId: Id;
  title: string;
  notes?: string;
  /** Whole number ≥ 0, unique within the project. */
  order: number;
  /** Finite and above 0; defaults to 1 (ADR-038). */
  weight: number;
  dueOn?: LocalDate;
  completedAt?: Timestamp;
  /**
   * Set when archived (schema V10): left out of the roadmap and of progress,
   * kept with its history, restorable.
   */
  archivedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const PROJECT_LANES = [
  'working_now',
  'next',
  'waiting',
  'needs_approval',
  'blocked',
  'parked',
  'done',
] as const;
export type ProjectLane = (typeof PROJECT_LANES)[number];

export const PROJECT_ITEM_KINDS = [
  'focus',
  'step',
  'dependency',
  'approval',
  'blocker',
  'idea',
  'note',
] as const;
export type ProjectItemKind = (typeof PROJECT_ITEM_KINDS)[number];

/** Command, status and context information that isn't naturally a Task. */
export interface ProjectItem {
  id: Id;
  projectId: Id;
  kind: ProjectItemKind;
  lane: ProjectLane;
  title: string;
  body?: string;
  /** Who or what it waits on; only in lane `waiting`. */
  waitingOn?: string;
  /** A task of the same project, annotated rather than copied. */
  taskId?: Id;
  milestoneId?: Id;
  order: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  laneChangedAt: Timestamp;
  /** Present exactly when `lane` is `done`. */
  resolvedAt?: Timestamp;
}

export const DECISION_ORIGINS = ['owner', 'accepted-proposal', 'ai-client'] as const;
export type DecisionOrigin = (typeof DECISION_ORIGINS)[number];

/** Immutable. Changed only by recording a newer decision that supersedes it. */
export interface Decision {
  id: Id;
  projectId: Id;
  title: string;
  context?: string;
  decision: string;
  consequences?: string;
  decidedAt: Timestamp;
  supersedesId?: Id;
  origin: DecisionOrigin;
  /** The AI client that recorded it, when `origin` is `ai-client` (schema V6). */
  client?: string;
  createdAt: Timestamp;
}

export const WORK_KINDS = ['project', 'task', 'college', 'general'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export interface WorkPause {
  at: Timestamp;
  resumedAt?: Timestamp;
}

export interface WorkSession {
  id: Id;
  kind: WorkKind;
  projectId?: Id;
  taskId?: Id;
  intent?: string;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  pauses: WorkPause[];
  /** The local day it started. */
  localDate: LocalDate;
  outcome?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const OFFTIME_KINDS = ['sleep', 'rest', 'day_off'] as const;
export type OffTimeKind = (typeof OFFTIME_KINDS)[number];

/**
 * A manually marked off-time window (sleep/rest), or a declared day off.
 * Never a claim about physiological sleep. Not protected time (ADR-021).
 */
export interface OffTimeSession {
  id: Id;
  kind: OffTimeKind;
  localDate: LocalDate;
  startedAt?: Timestamp;
  endedAt?: Timestamp;
  note?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const EVENT_TYPES = [
  'work.started',
  'work.paused',
  'work.resumed',
  'work.finished',
  'offtime.started',
  'offtime.ended',
  'habit.logged',
  'task.completed',
  'milestone.completed',
  'project.updated',
  'project.approval_requested',
  'project.item_parked',
  'decision.recorded',
  'ai.session.completed',
  'note.created',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ENTITY_TYPES = [
  'workSession',
  'offTimeSession',
  'habitEntry',
  'task',
  'milestone',
  'project',
  'projectItem',
  'decision',
  'aiSession',
  'note',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Which entity each event type is about. */
export const EVENT_ENTITY: Record<EventType, EntityType> = {
  'work.started': 'workSession',
  'work.paused': 'workSession',
  'work.resumed': 'workSession',
  'work.finished': 'workSession',
  'offtime.started': 'offTimeSession',
  'offtime.ended': 'offTimeSession',
  'habit.logged': 'habitEntry',
  'task.completed': 'task',
  'milestone.completed': 'milestone',
  'project.updated': 'project',
  'project.approval_requested': 'projectItem',
  'project.item_parked': 'projectItem',
  'decision.recorded': 'decision',
  'ai.session.completed': 'aiSession',
  'note.created': 'note',
};

/** Events that are private life state: never in the workspace, never default AI context. */
export const PRIVATE_EVENT_TYPES: readonly EventType[] = [
  'offtime.started',
  'offtime.ended',
  'habit.logged',
];

export const EVENT_SOURCES = ['app', 'ai-client'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** A fact that something happened. References its record; never replaces it. */
export interface LedgerEvent {
  id: Id;
  type: EventType;
  at: Timestamp;
  localDate: LocalDate;
  entityType: EntityType;
  entityId: Id;
  projectId?: Id;
  /** Small immutable facts (e.g. `{ from: 'active', to: 'blocked' }`), never a record copy. */
  data: Record<string, string>;
  source: EventSource;
  /** Which AI client acted, when `source` is `ai-client` (schema V6). */
  actor?: string;
}

export interface ProgressSnapshot {
  id: Id;
  projectId: Id;
  localDate: LocalDate;
  completedWeight: number;
  totalWeight: number;
  milestoneCount: number;
  completedCount: number;
  state: ProjectState;
  laneCounts: Record<ProjectLane, number>;
  updatedAt: Timestamp;
}

export const AI_SCOPES = ['project', 'workspace', 'global'] as const;
export type AiScope = (typeof AI_SCOPES)[number];

/** Written only when a real, authenticated client reports a session. */
export interface AiSession {
  id: Id;
  client: string;
  scope: AiScope;
  projectId?: Id;
  startedAt: Timestamp;
  endedAt: Timestamp;
  summary: string;
  filesTouched?: string[];
  /* Schema V6: what a real session reported, when it reported it. */
  taskId?: Id;
  result?: string;
  nextAction?: string;
  commits?: string[];
  handoff?: string;
  createdAt: Timestamp;
}

/* ------------------------------------------------------------------------ */
/* Schema V5 (v2 PHASE 006, ADR-051): college items.                        */
/* ------------------------------------------------------------------------ */

export const COLLEGE_KINDS = ['class', 'lab', 'assignment', 'exam', 'event'] as const;
export type CollegeKind = (typeof COLLEGE_KINDS)[number];

export const COLLEGE_STATUSES = ['planned', 'attended', 'missed', 'done', 'cancelled'] as const;
export type CollegeStatus = (typeof COLLEGE_STATUSES)[number];

/**
 * A class or lab (attended / missed), or an assignment, exam or event (done),
 * on a calendar day. Missing a class is recorded plainly and never scored
 * against you; only attended and done items count as activity.
 */
export interface CollegeItem {
  id: Id;
  kind: CollegeKind;
  title: string;
  /** The day it happens or is due. */
  date: LocalDate;
  status: CollegeStatus;
  /** Free text, e.g. "DBMS" or "Physics 101". */
  course?: string;
  note?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* ------------------------------------------------------------------------ */
/* Schema V6 (v2 PHASE 008B, ADR-056): notes.                               */
/* ------------------------------------------------------------------------ */

export const NOTE_KINDS = ['note', 'handoff', 'summary', 'research'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const NOTE_AUTHORS = ['owner', 'ai-client'] as const;
export type NoteAuthor = (typeof NOTE_AUTHORS)[number];

/**
 * A human- or AI-authored document for a project (Markdown text). Canonical
 * in LOWTIDE; projected into the technical workspace. Kept separate from the
 * generated PROJECT.md and CONTEXT.md, which no one edits by hand.
 */
export interface Note {
  id: Id;
  projectId: Id;
  kind: NoteKind;
  title: string;
  body: string;
  author: NoteAuthor;
  /** The AI client, when `author` is `ai-client`. */
  client?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* ------------------------------------------------------------------------ */
/* Schema V7 (v2 PHASE 010, ADR-062): SPACE and source provenance.          */
/* ------------------------------------------------------------------------ */

/**
 * `section`: a folder in the hierarchy (shown as a Folder). LOWTIDE keeps
 * some itself (Projects, Archive, a project's Planning…, each with a `key`);
 * folders the owner or an AI client make have no key. `page`: a document.
 * `table`: a database (a page whose content is a table).
 */
export const SPACE_NODE_KINDS = ['section', 'page', 'table'] as const;
export type SpaceNodeKind = (typeof SPACE_NODE_KINDS)[number];

/**
 * `markdown`: plain Markdown. `notion`: Notion's enhanced Markdown as
 * imported (callouts, toggles, tables and colours stay as Notion tags), with
 * child-page, mention and file references rewritten to SPACE.
 */
export const SPACE_BODY_FORMATS = ['markdown', 'notion'] as const;
export type SpaceBodyFormat = (typeof SPACE_BODY_FORMATS)[number];

/** The LOWTIDE records a SPACE node, table row or provenance record can point at. */
export const LINKABLE_TYPES = [
  'project',
  'task',
  'milestone',
  'projectItem',
  'decision',
  'hackathon',
  'aiSession',
  'spaceNode',
] as const;
export type LinkableType = (typeof LINKABLE_TYPES)[number];

export interface EntityLink {
  type: LinkableType;
  id: Id;
  /** A row of the linked table node, when the link is to one row of a SPACE table. */
  rowId?: string;
  /** What the link was called at its source (shown if the target is gone). */
  label?: string;
}

export interface ExternalLink {
  url: string;
  label?: string;
}

export const SPACE_ATTACHMENT_KINDS = ['file', 'image', 'pdf', 'video', 'audio'] as const;
export type SpaceAttachmentKind = (typeof SPACE_ATTACHMENT_KINDS)[number];

/**
 * A file that belongs to a page. `stored` would mean LOWTIDE holds the bytes;
 * `external` means only the reference is kept (the file still lives at its
 * source, and a signed source URL may have expired). Nothing claims a file was
 * imported when it wasn't.
 */
export const SPACE_ATTACHMENT_STATUSES = ['stored', 'external'] as const;
export type SpaceAttachmentStatus = (typeof SPACE_ATTACHMENT_STATUSES)[number];

export interface SpaceAttachment {
  id: string;
  kind: SpaceAttachmentKind;
  name: string;
  status: SpaceAttachmentStatus;
  /** Where the file can be found (for `external`, the source reference). */
  url?: string;
  note?: string;
}

/**
 * Property types of a SPACE table (a database). `link` is a Relation to
 * LOWTIDE records or SPACE pages and rows. The last six (schema V10) hold no
 * cells: created/updated time and by come from each row's own record, and
 * rollups and formulas are computed from the row whenever they're shown.
 */
export const SPACE_COLUMN_TYPES = [
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'status',
  'multiSelect',
  'url',
  'link',
  'createdTime',
  'updatedTime',
  'createdBy',
  'updatedBy',
  'rollup',
  'formula',
] as const;
export type SpaceColumnType = (typeof SPACE_COLUMN_TYPES)[number];

/** Column types whose values are derived, never stored in a cell. */
export const DERIVED_COLUMN_TYPES: readonly SpaceColumnType[] = [
  'createdTime',
  'updatedTime',
  'createdBy',
  'updatedBy',
  'rollup',
  'formula',
];

/** What a rollup computes over a row's related records. */
export const ROLLUP_FUNCTIONS = ['count', 'countDone', 'percentDone', 'sum', 'latest'] as const;
export type RollupFunction = (typeof ROLLUP_FUNCTIONS)[number];

export interface SpaceRollup {
  /** The relation (`link`) column of the same table it reads. */
  relation: string;
  fn: RollupFunction;
  /**
   * For `sum` and `latest` over related rows of a SPACE table: the column of
   * that table to read (number or date).
   */
  property?: string;
}

export interface SpaceColumnOption {
  name: string;
  color?: string;
}

export interface SpaceColumn {
  /** Stable within its table. */
  id: string;
  name: string;
  type: SpaceColumnType;
  /** For `select`, `status` and `multiSelect`. */
  options?: SpaceColumnOption[];
  description?: string;
  /** For `link` (schema V10): the kinds of record it may point at (absent: any). */
  targets?: LinkableType[];
  /** For `rollup` (schema V10). */
  rollup?: SpaceRollup;
  /** For `formula` (schema V10): an expression over the row's properties. */
  formula?: string;
}

/**
 * One cell. By column type: `text`/`url`/`select`/`status` → string,
 * `number` → number, `boolean` → boolean, `date` → LocalDate or Timestamp,
 * `multiSelect` → strings, `link` → links to SPACE pages or LOWTIDE records.
 * An empty cell is simply absent from `cells`.
 */
export type SpaceCellValue = string | number | boolean | string[] | EntityLink[];

export interface SpaceRow {
  /** Stable within its table. */
  id: string;
  cells: Record<string, SpaceCellValue>;
  /** The row's own page, when it has one. */
  pageId?: Id;
  /** LOWTIDE records this row became or describes. */
  links?: EntityLink[];
  /* Schema V10: when and by whom the row was made and last changed ('owner' or an AI client). */
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  createdBy?: string;
  updatedBy?: string;
}

/** The ways a SPACE database can be shown (schema V10). */
export const SPACE_VIEW_TYPES = ['table', 'board', 'list', 'calendar'] as const;
export type SpaceViewType = (typeof SPACE_VIEW_TYPES)[number];

export const SPACE_FILTER_OPS = [
  'contains',
  'is',
  'isNot',
  'isEmpty',
  'isNotEmpty',
  'gt',
  'lt',
  'before',
  'after',
  'checked',
  'unchecked',
] as const;
export type SpaceFilterOp = (typeof SPACE_FILTER_OPS)[number];

export interface SpaceFilter {
  column: string;
  op: SpaceFilterOp;
  value?: string;
}

export interface SpaceSort {
  column: string;
  dir: 'asc' | 'desc';
}

/**
 * A saved way of looking at a database (schema V10): its layout, filters,
 * sorts, grouping and which properties show, in what order. Views never copy
 * rows; every view reads the same table.
 */
export interface SpaceView {
  id: string;
  name: string;
  type: SpaceViewType;
  filters?: SpaceFilter[];
  sorts?: SpaceSort[];
  /** Board columns (a select or status property), or list/table grouping. */
  groupBy?: string;
  /** The date property a calendar view places rows by. */
  dateColumn?: string;
  /** Properties hidden in this view. */
  hidden?: string[];
  /** Property order in this view (absent: the table's own order). */
  order?: string[];
}

export interface SpaceTable {
  columns: SpaceColumn[];
  rows: SpaceRow[];
  /** Saved views (schema V10); absent means one plain table view. */
  views?: SpaceView[];
}

/**
 * Blocks of a SPACE page (v2 PHASE 014, schema V9). Text blocks hold a small
 * inline Markdown subset (**bold**, *italic*, `code`, ~~strike~~ and
 * [links](url), where `space:<id>` links a page). `grid` is a static table
 * kept from an imported body; `fallback` is imported content LOWTIDE can't
 * edit, shown as it was so nothing is dropped.
 */
export const SPACE_BLOCK_TYPES = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bullet',
  'numbered',
  'check',
  'quote',
  'callout',
  'code',
  'divider',
  'file',
  'link',
  'table',
  'grid',
  'fallback',
  'bookmark',
] as const;
export type SpaceBlockType = (typeof SPACE_BLOCK_TYPES)[number];

/** A file a block points at. LOWTIDE keeps the reference, never pretends to hold the bytes. */
export interface SpaceBlockFile {
  name: string;
  kind: SpaceAttachmentKind;
  url?: string;
  mime?: string;
  size?: number;
  /** The page attachment it shows, for an imported file. */
  attachmentId?: string;
}

/** Who last wrote a block, when that was an AI client. */
export interface SpaceBlockAuthor {
  client: string;
  at: Timestamp;
}

export interface SpaceBlock {
  /** Stable within its page. */
  id: string;
  type: SpaceBlockType;
  text?: string;
  /** `check` blocks. */
  checked?: boolean;
  /** List nesting, 0–3. */
  indent?: number;
  /** `callout` blocks. */
  icon?: string;
  /** `code` blocks. */
  language?: string;
  /** `link` blocks: the record; `table` blocks: the table page shown. */
  link?: EntityLink;
  file?: SpaceBlockFile;
  /** `grid` blocks: rows of cell text, the first row being the header. */
  rows?: string[][];
  /** `bookmark` blocks (schema V10): a saved link with a title and an optional note in `text`. */
  url?: string;
  title?: string;
  by?: SpaceBlockAuthor;
}

/** Kinds of change kept in a page's history. */
export const SPACE_EDIT_KINDS = [
  'created',
  'edited',
  'renamed',
  'moved',
  'archived',
  'restored',
  'table',
  'linked',
] as const;
export type SpaceEditKind = (typeof SPACE_EDIT_KINDS)[number];

/**
 * One entry of a page's history: who changed it, how, and when. Edits by the
 * same author in one sitting are batched into one entry (`count` changes
 * from `startedAt` to `at`), never one per keystroke. No content is kept.
 */
export interface SpaceEdit {
  kind: SpaceEditKind;
  by: EventSource;
  /** The AI client, when `by` is `ai-client`. */
  client?: string;
  startedAt: Timestamp;
  at: Timestamp;
  count: number;
}

export const SOURCE_SYSTEMS = ['notion'] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

/** Where an imported record came from: enough to answer "where is this from?". */
export interface SourceRef {
  system: SourceSystem;
  /** The source's own id (a Notion page or database id, or a derived `<id>#…` key). */
  sourceId: string;
  url?: string;
  originalTitle: string;
  /** Titles from the source's root down to the record's parent. */
  path?: string[];
  importedAt: Timestamp;
  sourceCreatedAt?: Timestamp;
  sourceUpdatedAt?: Timestamp;
}

/**
 * A node of SPACE, LOWTIDE's knowledge hierarchy: sections, documents and
 * tables. Knowledge, not activity: creating or importing a node never
 * produces a ledger event, a pulse square or a snapshot.
 */
export interface SpaceNode {
  id: Id;
  /** Absent for a top-level section. */
  parentId?: Id;
  kind: SpaceNodeKind;
  title: string;
  icon?: string;
  /** A short line under the title (schema V10). */
  description?: string;
  /** Set when pinned (schema V10): shown in Pinned. A viewing choice, never activity. */
  pinnedAt?: Timestamp;
  /**
   * A stable name for sections LOWTIDE maintains itself: `projects`,
   * `archive`, `project:<id>`, `project:<id>:planning`… Unique.
   */
  key?: string;
  body?: string;
  bodyFormat?: SpaceBodyFormat;
  /** Whole number ≥ 0; siblings are shown in this order. */
  order: number;
  archived: boolean;
  links: EntityLink[];
  externalLinks: ExternalLink[];
  attachments: SpaceAttachment[];
  /** Present exactly when `kind` is `table`. */
  table?: SpaceTable;
  source?: SourceRef;
  /**
   * The page's editable content (schema V9). Absent until the page is first
   * written in LOWTIDE; an imported page then keeps its original `body`
   * untouched beside it.
   */
  blocks?: SpaceBlock[];
  /** Bumped by every content change; editors save against it (absent: 0). */
  revision?: number;
  /** Newest last, at most `SPACE_EDIT_LIMIT` entries. */
  edits?: SpaceEdit[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const SPACE_EDIT_LIMIT = 200;

/** The top-level SPACE sections LOWTIDE keeps (ADR-062), in display order. */
export const SPACE_ROOTS = [
  { key: 'projects', title: 'Projects' },
  { key: 'hackathons', title: 'Hackathons' },
  { key: 'college', title: 'College' },
  { key: 'ideas', title: 'Ideas' },
  { key: 'personal', title: 'Personal' },
  { key: 'archive', title: 'Archive' },
  /** v2.1: LOWTIDE's own pages: templates and the AI operating guide. */
  { key: 'lowtide', title: 'LOWTIDE' },
] as const;
export type SpaceRootKey = (typeof SPACE_ROOTS)[number]['key'];

/**
 * How a source record relates to what LOWTIDE made of it. `canonical`: this
 * source is the record's authority. `legacy`: an older duplicate, kept as
 * provenance. `reference`: the record was placed or linked from it.
 */
export const SOURCE_ROLES = ['canonical', 'legacy', 'reference'] as const;
export type SourceRole = (typeof SOURCE_ROLES)[number];

/**
 * Provenance for an imported record (schema V7), one per (source record,
 * LOWTIDE record type). It is also the importer's memory: running an import
 * again finds what it made last time here instead of making it twice.
 */
export interface SourceRecord {
  id: Id;
  system: SourceSystem;
  sourceId: string;
  entityType: LinkableType;
  entityId: Id;
  role: SourceRole;
  url?: string;
  originalTitle: string;
  path?: string[];
  /** Fingerprint of the source content last applied. */
  contentHash: string;
  importedAt: Timestamp;
  /** When the importer last wrote the LOWTIDE record from this source. */
  appliedAt: Timestamp;
  sourceCreatedAt?: Timestamp;
  sourceUpdatedAt?: Timestamp;
}
