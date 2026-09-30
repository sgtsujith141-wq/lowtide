import { z } from 'zod/mini';
import {
  DECISION_ORIGINS,
  HACKATHON_STATUSES,
  PROJECT_ITEM_KINDS,
  PROJECT_KINDS,
  PROJECT_STATES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  BUILD_STATUSES,
  PPT_STATUSES,
  REGISTRATION_STATUSES,
} from '../../../types/domain';

/*
 * The Notion importer's two inputs (ADR-062):
 *
 * - a SNAPSHOT: what was read from Notion, read-only, page by page and
 *   database by database (bodies as Notion's enhanced Markdown, database rows
 *   as Notion returns them);
 * - a PLAN: the owner's mapping from that snapshot to LOWTIDE (which records
 *   are the canonical projects, which databases hold tasks, where each page
 *   lives in SPACE, what to skip and why).
 *
 * Both hold personal data, so they live in the LOWTIDE data folder, never in
 * the source repository. The importer itself is generic.
 */

/** A Notion id: 32 lowercase hex characters, no dashes. */
export type NotionId = string;

export interface NotionPropertySchema {
  name: string;
  type: string;
  description?: string;
  options?: { name: string; color?: string }[];
}

export interface NotionDataSource {
  url: string;
  name: string;
  schema: Record<string, NotionPropertySchema>;
  /** Rows as the view query returns them: values keyed by property name, plus `url`. */
  rows: Record<string, unknown>[];
}

export interface NotionPage {
  id: NotionId;
  url: string;
  title: string;
  icon?: string | null;
  parentId: NotionId | null;
  parentKind: 'page' | 'database' | null;
  /** Enhanced Markdown between `<content>` tags; empty for a blank page. */
  body: string;
  properties?: Record<string, unknown>;
  lastEditedAt?: string | null;
  truncated?: boolean;
}

export interface NotionDatabase {
  id: NotionId;
  url: string;
  title: string;
  parentId: NotionId | null;
  inline?: boolean | null;
  /** A linked view of another database's data source: it holds no rows of its own. */
  linkedView?: boolean;
  dataSources: NotionDataSource[];
}

export interface NotionSnapshot {
  capturedAt: string;
  pages: NotionPage[];
  databases: NotionDatabase[];
}

/* ------------------------------------------------------------------------ */
/* The plan.                                                                 */
/* ------------------------------------------------------------------------ */

const notionId = z.string().check(z.regex(/^[0-9a-f]{32}$/));
const key = z.string().check(z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), z.maxLength(64));
const nonEmpty = z.string().check(z.trim(), z.minLength(1));
const valueMap = <T extends readonly [string, ...string[]]>(values: T) =>
  z.record(z.string(), z.enum(values));

/** A project the plan declares canonical, with the Notion records behind it. */
const planProject = z.object({
  key,
  name: nonEmpty,
  slug: key,
  kind: z.enum(PROJECT_KINDS),
  /**
   * The Notion record that is this project's authority (role `canonical`).
   * When it's a row of a `projects` database, the project's fields come from it.
   */
  source: notionId,
  /** Used when there is no row, or the row has no usable state. */
  state: z.optional(z.enum(PROJECT_STATES)),
  repoUrl: z.optional(nonEmpty),
  /** Older duplicates of this project, kept as provenance (role `legacy`). */
  legacy: z.optional(z.array(notionId)),
  /** Related records linked to it without authority (role `reference`). */
  references: z.optional(z.array(notionId)),
});

/** SPACE slots under a project, created on first use. */
export const PROJECT_SLOTS = [
  'overview',
  'planning',
  'research',
  'architecture',
  'decisions',
  'build-plans',
  'notes',
  'tables',
  'files',
  'ai-sessions',
  'legacy',
] as const;
export type ProjectSlot = (typeof PROJECT_SLOTS)[number];

export const SLOT_TITLES: Record<ProjectSlot, string> = {
  overview: 'Overview',
  planning: 'Planning',
  research: 'Research',
  architecture: 'Architecture',
  decisions: 'Decisions',
  'build-plans': 'Build Plans',
  notes: 'Notes',
  tables: 'Tables',
  files: 'Files',
  'ai-sessions': 'AI Sessions',
  legacy: 'Legacy',
};

/**
 * Where a SPACE target is: a top-level section (`projects`, `ideas`,
 * `archive`…), a project (`project:<key>`), a slot of one
 * (`project:<key>:planning`), or a sub-section of a section (`ideas/Money
 * Lab`: created as needed).
 */
const target = z
  .string()
  .check(
    z.regex(
      /^(?:(?:projects|hackathons|college|ideas|personal|archive)(?:\/[^/]+)*|project:[a-z0-9-]+(?::[a-z-]+)?)$/,
    ),
  );

const placement = z.object({
  id: notionId,
  under: target,
  /** Replaces the Notion title in SPACE (the original stays in provenance). */
  title: z.optional(nonEmpty),
  archived: z.optional(z.boolean()),
});

const projectsDb = z.object({
  role: z.literal('projects'),
  /** Notion property names for each field. */
  fields: z.object({
    state: z.optional(z.string()),
    objective: z.optional(z.string()),
    phase: z.optional(z.string()),
    nextAction: z.optional(z.string()),
  }),
  states: z.optional(valueMap(PROJECT_STATES)),
  /** A non-empty property becomes an open project item of this kind. */
  items: z.optional(
    z.array(
      z.object({
        property: z.string(),
        kind: z.enum(PROJECT_ITEM_KINDS),
        title: z.optional(nonEmpty),
      }),
    ),
  ),
});

const tasksDb = z.object({
  role: z.literal('tasks'),
  /** Every row belongs to this project… */
  project: z.optional(key),
  /** …or to the project whose row its relation names. */
  projectProperty: z.optional(z.string()),
  fields: z.object({
    title: z.string(),
    status: z.optional(z.string()),
    done: z.optional(z.string()),
    priority: z.optional(z.string()),
    due: z.optional(z.string()),
    notes: z.optional(z.array(z.string())),
    /** A select whose options become the project's milestones, in option order. */
    milestone: z.optional(z.string()),
  }),
  statuses: z.optional(valueMap(TASK_STATUSES)),
  priorities: z.optional(valueMap(TASK_PRIORITIES)),
  /** Rows that duplicate a canonical task row elsewhere: row → canonical row. */
  duplicates: z.optional(z.record(notionId, notionId)),
});

const hackathonsDb = z.object({
  role: z.literal('hackathons'),
  fields: z.object({
    name: z.string(),
    status: z.optional(z.string()),
    registration: z.optional(z.string()),
    ppt: z.optional(z.string()),
    build: z.optional(z.string()),
    start: z.optional(z.string()),
    end: z.optional(z.string()),
    team: z.optional(z.string()),
    problemStatement: z.optional(z.string()),
    nextAction: z.optional(z.string()),
    notes: z.optional(z.string()),
  }),
  statuses: z.optional(valueMap(HACKATHON_STATUSES)),
  registrations: z.optional(valueMap(REGISTRATION_STATUSES)),
  ppts: z.optional(valueMap(PPT_STATUSES)),
  builds: z.optional(valueMap(BUILD_STATUSES)),
});

const decisionsDb = z.object({
  role: z.literal('decisions'),
  /** Every row belongs to this project… */
  project: z.optional(key),
  /** …or, through this relation, to exactly one canonical project (otherwise SPACE only). */
  relation: z.optional(z.string()),
  /** Relation targets that stand for a project: Notion row → project key. */
  relationProjects: z.optional(z.record(notionId, key)),
  fields: z.object({
    title: z.string(),
    decision: z.array(z.string()),
    context: z.optional(z.array(z.string())),
    consequences: z.optional(z.array(z.string())),
    date: z.optional(z.string()),
    madeBy: z.optional(z.string()),
  }),
  /** `madeBy` value → origin; unmapped values are `owner`. */
  origins: z.optional(valueMap(DECISION_ORIGINS)),
  /** `madeBy` value → AI client name, for `ai-client` origins. */
  clients: z.optional(z.record(z.string(), nonEmpty)),
});

/** Kept as a SPACE table only. Every database is also kept as a table. */
const tableDb = z.object({ role: z.literal('table') });

const databasePlan = z.discriminatedUnion('role', [
  projectsDb,
  tasksDb,
  hackathonsDb,
  decisionsDb,
  tableDb,
]);

export const migrationPlanSchema = z.object({
  version: z.literal(1),
  projects: z.array(planProject),
  databases: z.record(notionId, databasePlan),
  placements: z.array(placement),
  /** Not imported at all, each with its reason (linked views, blank rows…). */
  skip: z.array(z.object({ id: notionId, reason: nonEmpty })),
});

export type MigrationPlan = z.infer<typeof migrationPlanSchema>;
export type PlanProject = z.infer<typeof planProject>;
export type DatabasePlan = z.infer<typeof databasePlan>;
export type Placement = z.infer<typeof placement>;
