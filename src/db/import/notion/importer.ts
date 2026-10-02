import { deadlineFromLocalDate, toTimestamp } from '../../../lib/time';
import {
  SPACE_ROOTS,
  type Decision,
  type EntityLink,
  type Hackathon,
  type Id,
  type LinkableType,
  type Milestone,
  type Project,
  type ProjectItem,
  type SourceRecord,
  type SourceRef,
  type SourceRole,
  type SpaceCellValue,
  type SpaceColumn,
  type SpaceColumnType,
  type SpaceNode,
  type SpaceRow,
  type Task,
} from '../../../types/domain';
import { nextSpaceOrder, parseSpaceNode } from '../../repositories/dexie-space-repository';
import { checkHackathonDates, checkProjectItem, defaultLane } from '../../rules';
import {
  decisionSchema,
  hackathonSchema,
  milestoneSchema,
  projectItemSchema,
  projectSchema,
  sourceRecordSchema,
  taskSchema,
} from '../../schema';
import type { StoreDb, StoreTable } from '../../store';
import { convertBody } from './body';
import {
  migrationPlanSchema,
  SLOT_TITLES,
  PROJECT_SLOTS,
  type DatabasePlan,
  type MigrationPlan,
  type MilestoneSet,
  type NotionDatabase,
  type NotionDataSource,
  type NotionId,
  type NotionPage,
  type NotionPropertySchema,
  type NotionSnapshot,
  type PlanProject,
  type ProjectSlot,
} from './types';
import {
  checkbox,
  createdTime,
  date,
  editedTime,
  list,
  localDay,
  number,
  relation,
  rowId,
  text,
  titleProperty,
  unescapeNotion,
  type Row,
} from './values';

/*
 * The Notion importer (ADR-062). Reads a snapshot and a plan, writes LOWTIDE
 * records and SPACE, and remembers every source in `sourceRecords`.
 *
 * Rules it keeps:
 * - Notion is only read. Nothing here can reach Notion.
 * - Idempotent: a source already imported is found through its provenance
 *   record and updated or left alone, never imported twice.
 * - LOWTIDE wins for anything changed in LOWTIDE since it was imported, and
 *   for records LOWTIDE already had (matched by slug or hackathon name).
 *   Notion fills in what LOWTIDE doesn't know yet.
 * - No history is made up: no ledger events, work sessions, snapshots or AI
 *   sessions, and no completion times that Notion didn't record. A record's
 *   creation, state and last-change times are Notion's own when it has them,
 *   never the moment of the import. Imported records never count as activity
 *   (see the activity repository).
 * - Everything runs in one transaction. A dry run does all of it and rolls back.
 */

export interface ImportOptions {
  now: Date;
  newId: () => Id;
  dryRun?: boolean;
}

export type EntityAction =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'linked-existing'
  | 'kept-lowtide'
  | 'removed-in-lowtide'
  | 'provenance';

export interface ImportedEntity {
  sourceId: string;
  entityType: LinkableType;
  entityId: Id;
  role: SourceRole;
  action: EntityAction;
  title: string;
}

export interface ImportIssue {
  sourceId: string;
  title?: string | undefined;
  message: string;
}

export interface ImportReport {
  dryRun: boolean;
  startedAt: string;
  snapshotCapturedAt: string;
  sources: {
    pages: number;
    rowPages: number;
    databases: number;
    rows: number;
    linkedViews: number;
  };
  entities: ImportedEntity[];
  counts: Record<string, Partial<Record<EntityAction, number>>>;
  skipped: ImportIssue[];
  conflicts: ImportIssue[];
  failures: ImportIssue[];
  /** Kept in SPACE only (not a structured record), and why. */
  spaceOnly: ImportIssue[];
  attachments: { pageId: string; name: string; status: string; url?: string }[];
}

class DryRunRollback extends Error {}

/**
 * Part of every content fingerprint. Bump it when the mapping from a source to
 * a record changes, so the next import re-applies records the importer owns
 * (anything changed in LOWTIDE since is still kept).
 */
export const MAPPING_VERSION = 2;

/** A small stable fingerprint (cyrb53) of JSON content; no crypto needed. */
export function fingerprint(value: unknown): string {
  const str = stableJson(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const clean = (value: string | undefined) =>
  value === undefined ? undefined : unescapeNotion(value);
/** `T` with every key that may hold `undefined` made optional instead. */
type Defined<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};
const omit = <T extends object>(value: T): Defined<T> =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Defined<T>;

interface IndexedRow {
  row: Row;
  id: NotionId;
  database: NotionDatabase;
  source: NotionDataSource;
}

interface SourceMeta {
  url?: string;
  originalTitle: string;
  path?: string[];
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
}

/** Validates a plan file; throws with the problems if it isn't one. */
export function parsePlan(value: unknown): MigrationPlan {
  const result = migrationPlanSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Not a valid migration plan: ${result.error.issues
        .slice(0, 10)
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}

export async function importNotion(
  db: StoreDb,
  snapshot: NotionSnapshot,
  planInput: MigrationPlan,
  options: ImportOptions,
): Promise<ImportReport> {
  const plan = parsePlan(planInput);
  const now = toTimestamp(options.now);
  const report: ImportReport = {
    dryRun: options.dryRun === true,
    startedAt: now,
    snapshotCapturedAt: snapshot.capturedAt,
    sources: { pages: 0, rowPages: 0, databases: 0, rows: 0, linkedViews: 0 },
    entities: [],
    counts: {},
    skipped: [],
    conflicts: [],
    failures: [],
    spaceOnly: [],
    attachments: [],
  };

  /* ---------------------------------------------------------------- index */

  const pages = new Map(snapshot.pages.map((p) => [p.id, p]));
  const databases = new Map(snapshot.databases.map((d) => [d.id, d]));
  const rows = new Map<NotionId, IndexedRow>();
  for (const database of snapshot.databases) {
    if (database.linkedView) continue;
    for (const source of database.dataSources) {
      for (const row of source.rows) {
        const id = rowId(row);
        if (id) rows.set(id, { row, id, database, source });
      }
    }
  }
  report.sources = {
    pages: snapshot.pages.filter((p) => p.parentKind !== 'database').length,
    rowPages: snapshot.pages.filter((p) => p.parentKind === 'database').length,
    databases: snapshot.databases.filter((d) => !d.linkedView).length,
    rows: rows.size,
    linkedViews: snapshot.databases.filter((d) => d.linkedView).length,
  };

  const titleOf = (id: NotionId): string | undefined => {
    const page = pages.get(id);
    if (page) return page.title;
    const database = databases.get(id);
    if (database) return database.title;
    const row = rows.get(id);
    if (row) {
      const property = titleProperty(row.source.schema);
      return property ? text(row.row, property) : undefined;
    }
    return undefined;
  };
  const parentOf = (id: NotionId): NotionId | null =>
    pages.get(id)?.parentId ?? databases.get(id)?.parentId ?? rows.get(id)?.database.id ?? null;
  const pathOf = (id: NotionId): string[] => {
    const path: string[] = [];
    const seen = new Set<string>([id]);
    for (let at = parentOf(id); at && !seen.has(at); at = parentOf(at)) {
      seen.add(at);
      path.unshift(titleOf(at) ?? at);
    }
    return path;
  };
  const urlOf = (id: NotionId) =>
    pages.get(id)?.url ?? databases.get(id)?.url ?? `https://app.notion.com/p/${id}`;
  const metaOf = (id: NotionId, extra: Partial<SourceMeta> = {}): SourceMeta =>
    omit({
      url: urlOf(id),
      originalTitle: titleOf(id) ?? '',
      path: pathOf(id),
      sourceUpdatedAt:
        (pages.get(id)?.lastEditedAt ? toIso(pages.get(id)?.lastEditedAt) : undefined) ??
        (rows.get(id) ? editedTime(rows.get(id)!.row, rows.get(id)!.source.schema) : undefined),
      sourceCreatedAt: rows.get(id)
        ? createdTime(rows.get(id)!.row, rows.get(id)!.source.schema)
        : undefined,
      ...extra,
    });

  /* ----------------------------------------------------------- skip list */

  const skipped = new Map(plan.skip.map((s) => [s.id, s.reason]));
  for (const database of snapshot.databases) {
    if (database.linkedView && !skipped.has(database.id)) {
      skipped.set(database.id, 'Linked view of a database imported elsewhere; it holds no rows');
    }
  }
  const isSkipped = (id: NotionId): boolean => {
    const seen = new Set<string>();
    for (let at: NotionId | null = id; at && !seen.has(at); at = parentOf(at)) {
      if (skipped.has(at)) return true;
      seen.add(at);
    }
    return false;
  };
  for (const [id, reason] of skipped) {
    report.skipped.push({ sourceId: id, title: titleOf(id), message: reason });
  }

  /* ---------------------------------------------------------- the writer */

  const tables = [
    db.projects,
    db.milestones,
    db.tasks,
    db.projectItems,
    db.decisions,
    db.hackathons,
    db.spaceNodes,
    db.sourceRecords,
  ];

  const count = (type: string, action: EntityAction) => {
    const byType = (report.counts[type] ??= {});
    byType[action] = (byType[action] ?? 0) + 1;
  };

  async function findSource(sourceId: string, entityType: LinkableType) {
    return db.sourceRecords
      .where('[system+sourceId+entityType]')
      .equals(['notion', sourceId, entityType])
      .first();
  }

  async function writeSource(
    existing: SourceRecord | undefined,
    sourceId: string,
    entityType: LinkableType,
    entityId: Id,
    role: SourceRole,
    meta: SourceMeta,
    contentHash: string,
    applied: boolean,
  ) {
    const record = sourceRecordSchema.parse(
      omit({
        id: existing?.id ?? options.newId(),
        system: 'notion',
        sourceId,
        entityType,
        entityId,
        role,
        url: meta.url,
        originalTitle: meta.originalTitle,
        path: meta.path,
        contentHash,
        importedAt: existing?.importedAt ?? now,
        appliedAt: applied ? now : (existing?.appliedAt ?? now),
        sourceCreatedAt: meta.sourceCreatedAt,
        sourceUpdatedAt: meta.sourceUpdatedAt,
      }),
    );
    await db.sourceRecords.put(record);
  }

  interface Upsert<T> {
    table: StoreTable<T>;
    entityType: LinkableType;
    sourceId: string;
    meta: SourceMeta;
    /** The record's content from the source, without id and timestamps. */
    content: Record<string, unknown>;
    build: (id: Id, existing: T | undefined) => T;
    /** Decisions are immutable: never rewritten. */
    immutable?: boolean;
    /** A record LOWTIDE already has for the same thing (it wins). */
    match?: () => Promise<T | undefined>;
    /** The id to give a new record (SPACE nodes are linked before they're written). */
    newId?: Id;
  }

  /**
   * Creates, updates or leaves a record according to the merge rules, and
   * records its provenance. Returns the LOWTIDE id, or undefined when the
   * owner removed the record since the last import (it isn't recreated).
   */
  async function upsert<T extends { id: Id; updatedAt?: string; createdAt: string }>(
    args: Upsert<T>,
  ): Promise<Id | undefined> {
    const hash = fingerprint([MAPPING_VERSION, args.content]);
    const title = args.meta.originalTitle;
    const existing = await findSource(args.sourceId, args.entityType);
    const done = (id: Id, action: EntityAction, role: SourceRole = 'canonical') => {
      report.entities.push({
        sourceId: args.sourceId,
        entityType: args.entityType,
        entityId: id,
        role,
        action,
        title,
      });
      count(args.entityType, action);
      return id;
    };

    if (existing) {
      const record = await args.table.get(existing.entityId);
      if (!record) {
        done(existing.entityId, 'removed-in-lowtide', existing.role);
        return undefined;
      }
      if (existing.role !== 'canonical') return done(record.id, 'unchanged', existing.role);
      if (existing.contentHash === hash) return done(record.id, 'unchanged');
      if (args.immutable && stableJson(args.build(record.id, record)) === stableJson(record)) {
        // Same record, only the fingerprint's form changed: remember the new one.
        await writeSource(
          existing,
          args.sourceId,
          args.entityType,
          record.id,
          'canonical',
          args.meta,
          hash,
          false,
        );
        return done(record.id, 'unchanged');
      }
      const changedHere = (record.updatedAt ?? record.createdAt) > existing.appliedAt;
      if (changedHere || args.immutable) {
        report.conflicts.push({
          sourceId: args.sourceId,
          title,
          message: changedHere
            ? `Changed in Notion and in LOWTIDE since the last import; the LOWTIDE ${args.entityType} was kept.`
            : `Changed in Notion, but a LOWTIDE ${args.entityType} is immutable; kept as recorded.`,
        });
        await writeSource(
          existing,
          args.sourceId,
          args.entityType,
          record.id,
          'canonical',
          args.meta,
          existing.contentHash,
          false,
        );
        return done(record.id, 'kept-lowtide');
      }
      await args.table.put(args.build(record.id, record));
      await writeSource(
        existing,
        args.sourceId,
        args.entityType,
        record.id,
        'canonical',
        args.meta,
        hash,
        true,
      );
      return done(record.id, 'updated');
    }

    const matched = await args.match?.();
    if (matched) {
      await writeSource(
        undefined,
        args.sourceId,
        args.entityType,
        matched.id,
        'reference',
        args.meta,
        hash,
        true,
      );
      report.conflicts.push({
        sourceId: args.sourceId,
        title,
        message: `LOWTIDE already had this ${args.entityType}; its values were kept and Notion was linked as a reference.`,
      });
      return done(matched.id, 'linked-existing', 'reference');
    }

    const id = args.newId ?? options.newId();
    await args.table.add(args.build(id, undefined));
    await writeSource(
      undefined,
      args.sourceId,
      args.entityType,
      id,
      'canonical',
      args.meta,
      hash,
      true,
    );
    return done(id, 'created');
  }

  /** Provenance only: a legacy or related source of a record made from another source. */
  async function link(
    sourceId: string,
    entityType: LinkableType,
    entityId: Id,
    role: SourceRole,
    meta: SourceMeta,
  ) {
    const existing = await findSource(sourceId, entityType);
    if (existing && existing.entityId !== entityId) {
      report.conflicts.push({
        sourceId,
        title: meta.originalTitle,
        message: `Already linked to another ${entityType}; left as it was.`,
      });
      return;
    }
    const hash = fingerprint({ role, entityId });
    if (!existing || existing.contentHash !== hash || existing.role !== role) {
      await writeSource(existing, sourceId, entityType, entityId, role, meta, hash, true);
    }
    report.entities.push({
      sourceId,
      entityType,
      entityId,
      role,
      action: 'provenance',
      title: meta.originalTitle,
    });
    count(entityType, 'provenance');
  }

  /* ---------------------------------------------------------------- run */

  const run = async () => {
    /** Notion id → project key, for canonical sources and their legacy duplicates. */
    const projectKeyOf = new Map<NotionId, string>();
    const planProjects = new Map(plan.projects.map((p) => [p.key, p]));
    for (const project of plan.projects) {
      projectKeyOf.set(project.source, project.key);
      for (const id of project.legacy ?? []) projectKeyOf.set(id, project.key);
    }
    const projectIds = new Map<string, Id>();
    /** Notion id (row or page) → LOWTIDE records made from it, for SPACE links. */
    const entityLinks = new Map<NotionId, EntityLink[]>();
    const addLink = (id: string, entity: EntityLink) => {
      const baseId = id.split('#')[0]!;
      const links = entityLinks.get(baseId) ?? [];
      if (!links.some((l) => l.type === entity.type && l.id === entity.id)) links.push(entity);
      entityLinks.set(baseId, links);
    };

    // 1. Projects.
    for (const project of plan.projects) {
      const id = await importProject(project);
      if (id) {
        projectIds.set(project.key, id);
        addLink(project.source, { type: 'project', id });
        for (const legacy of project.legacy ?? []) {
          await link(legacy, 'project', id, 'legacy', metaOf(legacy));
          addLink(legacy, { type: 'project', id });
        }
        for (const reference of project.references ?? []) {
          await link(reference, 'project', id, 'reference', metaOf(reference));
          addLink(reference, { type: 'project', id });
        }
      }
    }

    // 2. Project items from project rows.
    for (const project of plan.projects) {
      const projectId = projectIds.get(project.key);
      const found = rows.get(project.source);
      const dbPlan = found ? plan.databases[found.database.id] : undefined;
      if (!projectId || !found || dbPlan?.role !== 'projects') continue;
      for (const rule of dbPlan.items ?? []) {
        const value = clean(text(found.row, rule.property));
        if (!value) continue;
        const sourceId = `${project.source}#${rule.property}`;
        const lane = defaultLane(rule.kind);
        // As old as the Notion row that says it, not as new as the import.
        const since = metaOf(project.source).sourceUpdatedAt;
        const itemId = await upsert<ProjectItem>({
          table: db.projectItems,
          entityType: 'projectItem',
          sourceId,
          meta: metaOf(project.source, { originalTitle: `${project.name}: ${rule.property}` }),
          content: {
            projectId,
            kind: rule.kind,
            title: rule.title ?? value,
            body: rule.title ? value : undefined,
            since,
          },
          build: (id, existing) => {
            const order = existing?.order ?? 0;
            const item = projectItemSchema.parse(
              omit({
                id,
                projectId,
                kind: rule.kind,
                lane: existing?.lane ?? lane,
                title: (rule.title ?? value).slice(0, 500),
                body: rule.title ? value : undefined,
                order,
                createdAt: since ?? existing?.createdAt ?? now,
                updatedAt: since ?? now,
                laneChangedAt: since ?? existing?.laneChangedAt ?? now,
                resolvedAt: existing?.resolvedAt,
              }),
            );
            checkProjectItem(item);
            return item;
          },
        });
        if (itemId) addLink(project.source, { type: 'projectItem', id: itemId });
      }
    }

    // 3. Tasks (and milestones from a phase select).
    const taskIdOfRow = new Map<NotionId, Id>();
    const duplicatesOf = new Map<NotionId, NotionId[]>();
    for (const dbPlan of Object.values(plan.databases)) {
      if (dbPlan.role !== 'tasks') continue;
      for (const [dup, canonical] of Object.entries(dbPlan.duplicates ?? {})) {
        duplicatesOf.set(canonical, [...(duplicatesOf.get(canonical) ?? []), dup]);
      }
    }
    const milestoneIds = new Map<string, Id>();
    for (const [databaseId, dbPlan] of Object.entries(plan.databases)) {
      if (dbPlan.role !== 'tasks') continue;
      await importMilestones(databaseId, dbPlan, milestoneIds, projectIds, addLink);
    }
    for (const [databaseId, dbPlan] of Object.entries(plan.databases)) {
      if (dbPlan.role !== 'tasks') continue;
      const database = databases.get(databaseId);
      if (!database) {
        report.failures.push({
          sourceId: databaseId,
          message: 'Planned tasks database is not in the snapshot',
        });
        continue;
      }
      for (const source of database.dataSources) {
        for (const row of source.rows) {
          const id = rowId(row);
          if (!id || isSkipped(id) || dbPlan.duplicates?.[id]) continue;
          const taskId = await importTask(id, row, source, dbPlan, databaseId, {
            projectIds,
            projectKeyOf,
            milestoneIds,
            duplicates: duplicatesOf.get(id) ?? [],
          });
          if (taskId) {
            taskIdOfRow.set(id, taskId);
            addLink(id, { type: 'task', id: taskId });
          }
        }
      }
    }
    for (const [canonical, dups] of duplicatesOf) {
      const taskId = taskIdOfRow.get(canonical);
      for (const dup of dups) {
        if (!taskId) {
          report.failures.push({
            sourceId: dup,
            title: titleOf(dup),
            message: `Declared a duplicate of ${canonical}, which wasn't imported`,
          });
          continue;
        }
        await link(dup, 'task', taskId, 'legacy', metaOf(dup));
        addLink(dup, { type: 'task', id: taskId });
      }
    }

    // 3b. Milestones a source lists explicitly as task rows (ADR-065).
    for (const set of plan.milestoneSets ?? []) {
      await importMilestoneSet(set, projectIds, addLink);
    }

    // 4. Hackathons.
    for (const [databaseId, dbPlan] of Object.entries(plan.databases)) {
      if (dbPlan.role !== 'hackathons') continue;
      for (const source of databases.get(databaseId)?.dataSources ?? []) {
        for (const row of source.rows) {
          const id = rowId(row);
          if (!id || isSkipped(id)) continue;
          const hackathonId = await importHackathon(id, row, dbPlan);
          if (hackathonId) addLink(id, { type: 'hackathon', id: hackathonId });
        }
      }
    }

    // 5. Decisions.
    for (const [databaseId, dbPlan] of Object.entries(plan.databases)) {
      if (dbPlan.role !== 'decisions') continue;
      for (const source of databases.get(databaseId)?.dataSources ?? []) {
        for (const row of source.rows) {
          const id = rowId(row);
          if (!id || isSkipped(id)) continue;
          const decisionId = await importDecision(id, row, source, dbPlan, projectIds);
          if (decisionId) addLink(id, { type: 'decision', id: decisionId });
        }
      }
    }

    // 6. SPACE.
    await importSpace(projectIds, planProjects, entityLinks);
  };

  /* ------------------------------------------------------------ projects */

  async function importProject(project: PlanProject): Promise<Id | undefined> {
    const found = rows.get(project.source);
    const dbPlan = found ? plan.databases[found.database.id] : undefined;
    const fields = dbPlan?.role === 'projects' ? dbPlan.fields : {};
    const row = found?.row ?? {};
    const status = text(row, fields.state);
    const mapped =
      status !== undefined && dbPlan?.role === 'projects' ? dbPlan.states?.[status] : undefined;
    if (status !== undefined && mapped === undefined) {
      report.conflicts.push({
        sourceId: project.source,
        title: project.name,
        message: `Notion status "${status}" has no LOWTIDE state in the plan; used ${project.state ?? 'planning'}.`,
      });
    }
    const state = mapped ?? project.state ?? 'planning';
    const content = omit({
      name: project.name,
      slug: project.slug,
      kind: project.kind,
      state,
      objective: clean(text(row, fields.objective)),
      phase: clean(text(row, fields.phase)),
      nextAction: clean(text(row, fields.nextAction)),
      repoUrl: project.repoUrl,
    });
    const created = found ? createdTime(found.row, found.source.schema) : undefined;
    // When Notion last recorded this state: the import itself isn't a state change.
    const since = metaOf(project.source).sourceUpdatedAt;
    return upsert<Project>({
      table: db.projects,
      entityType: 'project',
      sourceId: project.source,
      meta: metaOf(project.source),
      content: { ...content, since },
      match: () => db.projects.where('slug').equals(project.slug).first(),
      build: (id, existing) =>
        projectSchema.parse(
          omit({
            ...content,
            // The owner's portfolio focus is LOWTIDE's own, never Notion's (ADR-064).
            focus: existing?.focus,
            id,
            createdAt: created ?? since ?? existing?.createdAt ?? now,
            updatedAt: since ?? now,
            stateChangedAt:
              since ?? (existing && existing.state === state ? existing.stateChangedAt : now),
          }),
        ),
    });
  }

  /* ---------------------------------------------------- tasks, milestones */

  async function importMilestones(
    databaseId: NotionId,
    dbPlan: Extract<DatabasePlan, { role: 'tasks' }>,
    milestoneIds: Map<string, Id>,
    projectIds: Map<string, Id>,
    addLink: (id: string, link: EntityLink) => void,
  ) {
    const property = dbPlan.fields.milestone;
    if (!property) return;
    const projectId = dbPlan.project ? projectIds.get(dbPlan.project) : undefined;
    if (!projectId) {
      report.failures.push({
        sourceId: databaseId,
        message: 'Milestones need the database to belong to one project (`project`)',
      });
      return;
    }
    const database = databases.get(databaseId);
    const schema = database?.dataSources[0]?.schema[property];
    const used = new Set(
      (database?.dataSources ?? []).flatMap((s) => s.rows.map((r) => text(r, property))),
    );
    const options = (schema?.options ?? []).map((o) => o.name).filter((n) => used.has(n));
    const existingOrders = new Set(
      (await db.milestones.where('projectId').equals(projectId).toArray()).map((m) => m.order),
    );
    let next = 0;
    for (const name of options) {
      const sourceId = `${databaseId}#${property}:${name}`;
      const known = await findSource(sourceId, 'milestone');
      const knownOrder = known ? (await db.milestones.get(known.entityId))?.order : undefined;
      let order = knownOrder;
      if (order === undefined) {
        while (existingOrders.has(next)) next += 1;
        order = next;
        existingOrders.add(order);
      }
      const content = { projectId, title: name };
      const milestoneOrder = order;
      const id = await upsert<Milestone>({
        table: db.milestones,
        entityType: 'milestone',
        sourceId,
        meta: metaOf(databaseId, {
          originalTitle: `${database?.title ?? ''}: ${property} = ${name}`,
        }),
        content,
        build: (id, existing) =>
          milestoneSchema.parse(
            omit({
              id,
              projectId,
              title: name,
              order: existing?.order ?? milestoneOrder,
              weight: existing?.weight ?? 1,
              notes: existing?.notes,
              dueOn: existing?.dueOn,
              completedAt: existing?.completedAt,
              createdAt: existing?.createdAt ?? now,
              updatedAt: now,
            }),
          ),
      });
      if (id) {
        milestoneIds.set(`${databaseId}#${name}`, id);
        addLink(databaseId, { type: 'milestone', id });
      }
    }
  }

  /**
   * One milestone per listed task row, in the set's order, after any
   * milestones the project already has. The row stays a task too. A row Notion
   * marks done is done by its last Notion edit (the latest moment Notion
   * recorded it so, else when the snapshot was read): never an event, and,
   * like every imported record, never activity.
   */
  async function importMilestoneSet(
    set: MilestoneSet,
    projectIds: Map<string, Id>,
    addLink: (id: string, link: EntityLink) => void,
  ) {
    const projectId = projectIds.get(set.project);
    const planned = plan.projects.find((p) => p.key === set.project);
    if (!projectId || !planned) {
      report.failures.push({
        sourceId: set.rows[0]!,
        message: `Milestone set for a project the plan doesn't import ("${set.project}")`,
      });
      return;
    }
    const prefix = new RegExp(
      `^${planned.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:—–-]\\s*`,
      'i',
    );
    const mine = new Set<Id>();
    for (const id of set.rows) {
      const known = await findSource(id, 'milestone');
      if (known) mine.add(known.entityId);
    }
    const base = (await db.milestones.where('projectId').equals(projectId).toArray())
      .filter((m) => !mine.has(m.id))
      .reduce((next, m) => Math.max(next, m.order + 1), 0);

    for (const [index, id] of set.rows.entries()) {
      const indexed = rows.get(id);
      const dbPlan = indexed ? plan.databases[indexed.database.id] : undefined;
      if (!indexed || dbPlan?.role !== 'tasks') {
        report.failures.push({
          sourceId: id,
          title: titleOf(id),
          message: 'A milestone row must be a row of a planned tasks database',
        });
        continue;
      }
      const raw = clean(text(indexed.row, dbPlan.fields.title))?.replace(prefix, '');
      if (!raw) {
        report.skipped.push({ sourceId: id, message: 'Milestone row without a title' });
        continue;
      }
      const title = (raw.charAt(0).toUpperCase() + raw.slice(1)).slice(0, 300);
      const meta = metaOf(id);
      const doneBy =
        taskStatusOf(indexed.row, dbPlan) === 'done'
          ? (meta.sourceUpdatedAt ?? toIso(snapshot.capturedAt) ?? now)
          : undefined;
      const order = base + index;
      const milestoneId = await upsert<Milestone>({
        table: db.milestones,
        entityType: 'milestone',
        sourceId: id,
        meta,
        content: { projectId, title, order, doneBy, evidence: set.evidence },
        build: (newId, existing) =>
          milestoneSchema.parse(
            omit({
              id: newId,
              projectId,
              title,
              order: existing?.order ?? order,
              weight: existing?.weight ?? 1,
              notes: existing?.notes,
              dueOn: existing?.dueOn,
              completedAt: doneBy ? (existing?.completedAt ?? doneBy) : undefined,
              createdAt: existing?.createdAt ?? now,
              updatedAt: now,
            }),
          ),
      });
      if (milestoneId) addLink(id, { type: 'milestone', id: milestoneId });
    }
  }

  function taskStatusOf(row: Row, dbPlan: Extract<DatabasePlan, { role: 'tasks' }>) {
    const statusValue = text(row, dbPlan.fields.status);
    return checkbox(row, dbPlan.fields.done)
      ? 'done'
      : (statusValue && dbPlan.statuses?.[statusValue]) || 'todo';
  }

  async function importTask(
    id: NotionId,
    row: Row,
    source: NotionDataSource,
    dbPlan: Extract<DatabasePlan, { role: 'tasks' }>,
    databaseId: NotionId,
    ctx: {
      projectIds: Map<string, Id>;
      projectKeyOf: Map<NotionId, string>;
      milestoneIds: Map<string, Id>;
      duplicates: NotionId[];
    },
  ): Promise<Id | undefined> {
    const f = dbPlan.fields;
    const title = clean(text(row, f.title));
    if (!title) {
      report.skipped.push({ sourceId: id, message: 'Task row without a title' });
      return undefined;
    }
    let projectKey = dbPlan.project;
    if (!projectKey && dbPlan.projectProperty) {
      const keys = new Set(
        relation(row, dbPlan.projectProperty)
          .map((r) => ctx.projectKeyOf.get(r))
          .filter((k): k is string => k !== undefined),
      );
      if (keys.size === 1) projectKey = [...keys][0];
      else if (keys.size > 1) {
        report.conflicts.push({
          sourceId: id,
          title,
          message: 'Task names several projects; left unlinked.',
        });
      }
    }
    const projectId = projectKey ? ctx.projectIds.get(projectKey) : undefined;

    const status: Task['status'] = taskStatusOf(row, dbPlan);
    const priority =
      (text(row, f.priority) && dbPlan.priorities?.[text(row, f.priority)!]) || 'normal';
    const notes = (f.notes ?? [])
      .map((p) => clean(text(row, p)))
      .filter((v): v is string => v !== undefined)
      .join('\n\n');
    let due = localDay(date(row, f.due)?.start);
    let milestoneId = f.milestone
      ? ctx.milestoneIds.get(`${databaseId}#${text(row, f.milestone)}`)
      : undefined;

    // Fill what the canonical row doesn't say from its legacy duplicates.
    for (const dup of ctx.duplicates) {
      const other = rows.get(dup);
      const otherPlan = other ? plan.databases[other.database.id] : undefined;
      if (!other || otherPlan?.role !== 'tasks') continue;
      const otherDone = checkbox(other.row, otherPlan.fields.done);
      const otherStatusValue = text(other.row, otherPlan.fields.status);
      const otherStatus: Task['status'] = otherDone
        ? 'done'
        : (otherStatusValue && otherPlan.statuses?.[otherStatusValue]) || 'todo';
      if (otherStatus !== status) {
        report.conflicts.push({
          sourceId: id,
          title,
          message: `Duplicate ${dup} says "${otherStatus}", this row says "${status}"; the canonical row was kept.`,
        });
      }
      due ??= localDay(date(other.row, otherPlan.fields.due)?.start);
      if (!milestoneId && otherPlan.fields.milestone && otherPlan.project === projectKey) {
        milestoneId = ctx.milestoneIds.get(
          `${other.database.id}#${text(other.row, otherPlan.fields.milestone)}`,
        );
      }
    }
    if (!projectId) milestoneId = undefined;

    const content = omit({
      title,
      notes: notes || undefined,
      status,
      priority,
      due,
      projectId,
      milestoneId,
    });
    // Created no later than Notion's own record of it.
    const created = createdTime(row, source.schema) ?? metaOf(id).sourceUpdatedAt;
    return upsert<Task>({
      table: db.tasks,
      entityType: 'task',
      sourceId: id,
      meta: metaOf(id),
      content: { ...content, created },
      build: (taskId, existing) =>
        taskSchema.parse(
          omit({
            id: taskId,
            title,
            notes: notes || undefined,
            status,
            priority,
            dueAt: due ? deadlineFromLocalDate(due) : undefined,
            project: existing?.project,
            projectId,
            milestoneId,
            plannedFor: existing?.plannedFor,
            createdAt: created ?? existing?.createdAt ?? now,
            // Notion doesn't record when a task was finished: none is invented.
            completedAt: status === 'done' ? existing?.completedAt : undefined,
            updatedAt: metaOf(id).sourceUpdatedAt ?? now,
          }),
        ),
    });
  }

  /* ---------------------------------------------------------- hackathons */

  async function importHackathon(
    id: NotionId,
    row: Row,
    dbPlan: Extract<DatabasePlan, { role: 'hackathons' }>,
  ): Promise<Id | undefined> {
    const f = dbPlan.fields;
    const name = clean(text(row, f.name));
    if (!name) {
      report.skipped.push({ sourceId: id, message: 'Hackathon row without a name' });
      return undefined;
    }
    const pick = <T extends string>(
      map: Record<string, T> | undefined,
      value: string | undefined,
      fallback: T,
    ) => (value !== undefined ? map?.[value] : undefined) ?? fallback;
    const start = localDay(date(row, f.start)?.start);
    let end = localDay(date(row, f.end)?.start) ?? localDay(date(row, f.start)?.end);
    const notes: string[] = [];
    const baseNotes = clean(text(row, f.notes));
    if (baseNotes) notes.push(baseNotes);
    if (end && (!start || end < start)) {
      notes.push(`[From Notion] End date: ${end}`);
      end = undefined;
    }
    const content = omit({
      name,
      status: pick(dbPlan.statuses, text(row, f.status), 'considering'),
      registrationStatus: pick(dbPlan.registrations, text(row, f.registration), 'not_registered'),
      pptStatus: pick(dbPlan.ppts, text(row, f.ppt), 'not_started'),
      buildStatus: pick(dbPlan.builds, text(row, f.build), 'not_started'),
      eventStart: start,
      eventEnd: end,
      team: clean(text(row, f.team)),
      problemStatement: clean(text(row, f.problemStatement)),
      nextAction: clean(text(row, f.nextAction)),
      notes: notes.length ? notes.join('\n') : undefined,
    });
    const created =
      (rows.get(id) ? createdTime(row, rows.get(id)!.source.schema) : undefined) ??
      metaOf(id).sourceUpdatedAt;
    const lower = name.toLowerCase();
    return upsert<Hackathon>({
      table: db.hackathons,
      entityType: 'hackathon',
      sourceId: id,
      meta: metaOf(id),
      content: { ...content, created },
      match: async () =>
        (await db.hackathons.toArray()).find((h) => h.name.trim().toLowerCase() === lower),
      build: (hackathonId, existing) => {
        const hackathon = hackathonSchema.parse(
          omit({
            ...content,
            id: hackathonId,
            registrationDeadline: existing?.registrationDeadline,
            researchStatus: existing?.researchStatus,
            projectId: existing?.projectId,
            createdAt: created ?? existing?.createdAt ?? now,
            updatedAt: metaOf(id).sourceUpdatedAt ?? now,
          }),
        );
        checkHackathonDates(hackathon);
        return hackathon;
      },
    });
  }

  /* ----------------------------------------------------------- decisions */

  async function importDecision(
    id: NotionId,
    row: Row,
    source: NotionDataSource,
    dbPlan: Extract<DatabasePlan, { role: 'decisions' }>,
    projectIds: Map<string, Id>,
  ): Promise<Id | undefined> {
    const f = dbPlan.fields;
    const title = clean(text(row, f.title));
    let projectKey = dbPlan.project;
    if (!projectKey && dbPlan.relation) {
      const keys = new Set(
        relation(row, dbPlan.relation)
          .map((r) => dbPlan.relationProjects?.[r])
          .filter((k): k is string => k !== undefined),
      );
      if (keys.size === 1) projectKey = [...keys][0];
      else {
        report.spaceOnly.push({
          sourceId: id,
          title,
          message:
            keys.size === 0
              ? 'Decision about no canonical project: kept in its SPACE table only.'
              : 'Decision about several projects: kept in its SPACE table only.',
        });
        return undefined;
      }
    }
    const projectId = projectKey ? projectIds.get(projectKey) : undefined;
    const labelled = (properties: string[] | undefined) => {
      const parts = (properties ?? [])
        .map((p) => [p, clean(text(row, p))] as const)
        .filter((entry): entry is readonly [string, string] => entry[1] !== undefined);
      if (parts.length <= 1) return parts[0]?.[1];
      return parts.map(([p, v]) => `**${p}:** ${v}`).join('\n\n');
    };
    const decision = labelled(f.decision);
    if (!title || !decision || !projectId) {
      report.spaceOnly.push({
        sourceId: id,
        title,
        message: !projectId
          ? 'Decision without a project: kept in SPACE only.'
          : 'Decision without a title or text: kept in SPACE only.',
      });
      return undefined;
    }
    const created = createdTime(row, source.schema);
    const day = localDay(date(row, f.date)?.start);
    // The moment it was written down when that's the decision's day; otherwise the day itself.
    const decidedAt =
      created && (!day || created.slice(0, 10) === day)
        ? created
        : day
          ? `${day}T00:00:00.000Z`
          : (created ?? now);
    const madeBy = text(row, f.madeBy);
    const origin = (madeBy && dbPlan.origins?.[madeBy]) || 'owner';
    const content = omit({
      projectId,
      title,
      decision,
      context: labelled(f.context),
      consequences: labelled(f.consequences),
      decidedAt,
      origin,
      client: origin === 'ai-client' ? (madeBy && dbPlan.clients?.[madeBy]) || madeBy : undefined,
    });
    return upsert<Decision>({
      table: db.decisions,
      entityType: 'decision',
      sourceId: id,
      meta: metaOf(id),
      content,
      immutable: true,
      build: (decisionId, existing) =>
        decisionSchema.parse({
          ...content,
          id: decisionId,
          createdAt: existing?.createdAt ?? created ?? now,
        }),
    });
  }

  /* --------------------------------------------------------------- SPACE */

  async function importSpace(
    projectIds: Map<string, Id>,
    planProjects: Map<string, PlanProject>,
    entityLinks: Map<NotionId, EntityLink[]>,
  ) {
    const sections = new Map<string, Id>();

    /** A maintained section by key, created under `parentId` if missing. */
    async function section(
      keyName: string,
      title: string,
      parentId: Id | undefined,
      links: EntityLink[] = [],
      order?: number,
    ): Promise<Id> {
      const cached = sections.get(keyName);
      if (cached) return cached;
      const found = await db.spaceNodes.where('key').equals(keyName).first();
      if (found) {
        sections.set(keyName, found.id);
        return found.id;
      }
      const node = parseSpaceNode({
        id: options.newId(),
        parentId,
        kind: 'section',
        title,
        key: keyName,
        order: order ?? (await nextSpaceOrder(db, parentId)),
        archived: false,
        links,
        externalLinks: [],
        attachments: [],
        createdAt: now,
        updatedAt: now,
      });
      await db.spaceNodes.add(node);
      count('spaceNode', 'created');
      sections.set(keyName, node.id);
      return node.id;
    }

    for (const [order, root] of SPACE_ROOTS.entries()) {
      await section(root.key, root.title, undefined, [], order);
    }

    async function resolveTarget(target: string): Promise<Id | undefined> {
      if (target.startsWith('project:')) {
        const [, projectKey, slot] = target.split(':') as [string, string, ProjectSlot | undefined];
        const project = planProjects.get(projectKey);
        const projectId = projectIds.get(projectKey);
        if (!project || !projectId) return undefined;
        const projectNode = await section(
          `project:${projectId}`,
          project.name,
          await section('projects', 'Projects', undefined),
          [{ type: 'project', id: projectId }],
        );
        if (!slot) return projectNode;
        if (!PROJECT_SLOTS.includes(slot)) return undefined;
        return section(
          `project:${projectId}:${slot}`,
          SLOT_TITLES[slot],
          projectNode,
          [],
          PROJECT_SLOTS.indexOf(slot),
        );
      }
      const [rootKey, ...rest] = target.split('/');
      const root = SPACE_ROOTS.find((r) => r.key === rootKey);
      if (!root) return undefined;
      let at = await section(root.key, root.title, undefined);
      let keyName: string = root.key;
      for (const name of rest) {
        keyName = `${keyName}/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        at = await section(keyName, name, at);
      }
      return at;
    }

    // Every project gets its SPACE home, in plan order, even with nothing placed in it yet.
    for (const project of plan.projects) await resolveTarget(`project:${project.key}`);

    // Which Notion objects become nodes, and where.
    const placements = new Map(plan.placements.map((p, i) => [p.id, { ...p, index: i }]));
    const nodeSources: NotionId[] = [];
    const hasBody = (page: NotionPage) =>
      page.body.replace(/<empty-block\s*\/>/g, '').trim() !== '';
    const childrenOf = new Map<NotionId, NotionId[]>();
    for (const page of snapshot.pages) {
      if (page.parentId)
        childrenOf.set(page.parentId, [...(childrenOf.get(page.parentId) ?? []), page.id]);
    }
    for (const page of snapshot.pages) {
      if (isSkipped(page.id)) continue;
      const isRow = page.parentKind === 'database';
      // A row lives in its table; it gets its own page only when it has content of its own.
      if (
        isRow &&
        !hasBody(page) &&
        !(childrenOf.get(page.id)?.length ?? 0) &&
        !placements.has(page.id)
      )
        continue;
      nodeSources.push(page.id);
    }
    for (const database of snapshot.databases) {
      if (!isSkipped(database.id)) nodeSources.push(database.id);
    }
    const nodeSourceSet = new Set(nodeSources);

    // Node ids: the node made last time, or a new one.
    const nodeIds = new Map<NotionId, Id>();
    const known = new Map<NotionId, SourceRecord>();
    for (const sourceId of nodeSources) {
      const existing = await findSource(sourceId, 'spaceNode');
      if (existing) known.set(sourceId, existing);
      nodeIds.set(sourceId, existing?.entityId ?? options.newId());
    }

    // Parents: the placement, or the nearest imported Notion ancestor.
    const parentFor = async (
      sourceId: NotionId,
    ): Promise<{ parent: Id; archived: boolean } | undefined> => {
      const own = placements.get(sourceId);
      if (own) {
        const parent = await resolveTarget(own.under);
        return parent ? { parent, archived: own.archived ?? false } : undefined;
      }
      let archived = false;
      const seen = new Set<NotionId>();
      for (let at = parentOf(sourceId); at && !seen.has(at); at = parentOf(at)) {
        seen.add(at);
        if (placements.get(at)?.archived) archived = true;
        if (nodeSourceSet.has(at)) return { parent: nodeIds.get(at)!, archived };
      }
      const parent = await resolveTarget('archive/Unsorted Notion');
      return parent ? { parent, archived } : undefined;
    };

    // Sibling order: position of the reference in the parent's Notion body.
    const orderWithin = (sourceId: NotionId): number => {
      const placement = placements.get(sourceId);
      if (placement) return placement.index;
      const parent = parentOf(sourceId);
      const body = parent ? pages.get(parent)?.body : undefined;
      const at = body?.indexOf(sourceId) ?? -1;
      if (at >= 0) return at;
      const row = rows.get(sourceId);
      if (row) return row.source.rows.indexOf(row.row);
      return Number.MAX_SAFE_INTEGER;
    };

    const resolveNode = (id: NotionId) => nodeIds.get(id);
    const built: SpaceNode[] = [];
    const orderQueue = new Map<Id, { sourceId: NotionId; weight: number }[]>();

    for (const sourceId of nodeSources) {
      const where = await parentFor(sourceId);
      if (!where) {
        report.failures.push({
          sourceId,
          title: titleOf(sourceId),
          message: 'No SPACE parent could be resolved',
        });
        continue;
      }
      const siblings = orderQueue.get(where.parent) ?? [];
      siblings.push({ sourceId, weight: orderWithin(sourceId) });
      orderQueue.set(where.parent, siblings);

      const placement = placements.get(sourceId);
      const page = pages.get(sourceId);
      const database = databases.get(sourceId);
      const links = [...(entityLinks.get(sourceId) ?? [])];
      const source: SourceRef = omit({
        system: 'notion' as const,
        sourceId,
        url: urlOf(sourceId),
        originalTitle: titleOf(sourceId) ?? '',
        path: pathOf(sourceId),
        importedAt: known.get(sourceId)?.importedAt ?? now,
        sourceCreatedAt: metaOf(sourceId).sourceCreatedAt,
        sourceUpdatedAt: metaOf(sourceId).sourceUpdatedAt,
      });

      if (page) {
        const converted = convertBody(page.body, sourceId, resolveNode, titleOf);
        for (const attachment of converted.attachments) {
          report.attachments.push(
            omit({
              pageId: sourceId,
              name: attachment.name,
              status: attachment.status,
              url: attachment.url,
            }),
          );
        }
        if (page.truncated) {
          report.failures.push({
            sourceId,
            title: page.title,
            message: 'Notion returned this page truncated; the imported body may be incomplete.',
          });
        }
        built.push({
          id: nodeIds.get(sourceId)!,
          parentId: where.parent,
          kind: 'page',
          title: placement?.title ?? (page.title.trim() || 'Untitled'),
          ...(page.icon ? { icon: page.icon } : {}),
          ...(hasBody(page) ? { body: converted.body, bodyFormat: 'notion' as const } : {}),
          order: 0,
          archived: where.archived,
          links,
          externalLinks: [],
          attachments: converted.attachments,
          source,
          createdAt: now,
          updatedAt: now,
        });
      } else if (database) {
        built.push({
          id: nodeIds.get(sourceId)!,
          parentId: where.parent,
          kind: 'table',
          title: placement?.title ?? (database.title.trim() || 'Untitled table'),
          order: 0,
          archived: where.archived,
          links,
          externalLinks: [],
          attachments: [],
          table: tableOf(database, resolveNode, entityLinks),
          source,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Orders, then write each node through the merge rules.
    const orderOf = new Map<NotionId, number>();
    for (const [parent, siblings] of orderQueue) {
      const base = await nextSpaceOrder(db, parent);
      const existingOrders = new Map<NotionId, number>();
      for (const s of siblings) {
        const id = known.get(s.sourceId)?.entityId;
        const node = id ? await db.spaceNodes.get(id) : undefined;
        if (node) existingOrders.set(s.sourceId, node.order);
      }
      let next = base;
      siblings
        .sort(
          (a, b) =>
            a.weight - b.weight ||
            (titleOf(a.sourceId) ?? '').localeCompare(titleOf(b.sourceId) ?? ''),
        )
        .forEach((s) => {
          const kept = existingOrders.get(s.sourceId);
          orderOf.set(s.sourceId, kept ?? next++);
        });
    }

    for (const node of built) {
      const sourceId = node.source!.sourceId;
      const order = orderOf.get(sourceId) ?? 0;
      // What the node says, not when or where it was written.
      const content = {
        parentId: node.parentId,
        kind: node.kind,
        title: node.title,
        icon: node.icon,
        body: node.body,
        archived: node.archived,
        links: node.links,
        attachments: node.attachments,
        table: node.table,
      };
      await upsert<SpaceNode>({
        table: db.spaceNodes,
        entityType: 'spaceNode',
        sourceId,
        meta: metaOf(sourceId),
        newId: node.id,
        content: { ...content, sourceUpdatedAt: node.source?.sourceUpdatedAt },
        build: (id, existing) =>
          parseSpaceNode({
            ...node,
            id,
            order: existing?.order ?? order,
            parentId: existing?.parentId ?? node.parentId,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          }),
      });
    }
  }

  /** A Notion database as a SPACE table. Rollups aren't resolvable and are left out. */
  function tableOf(
    database: NotionDatabase,
    resolveNode: (id: NotionId) => Id | undefined,
    entityLinks: Map<NotionId, EntityLink[]>,
  ) {
    const columns: SpaceColumn[] = [];
    const columnIds = new Map<string, string>();
    const rowsOut: SpaceRow[] = [];
    const typeOf = (p: NotionPropertySchema): SpaceColumnType | undefined => {
      switch (p.type) {
        case 'title':
        case 'text':
        case 'rich_text':
        case 'email':
        case 'phone_number':
        case 'person':
        case 'people':
        case 'file':
        case 'files':
        case 'formula':
        case 'auto_increment_id':
          return p.type === 'auto_increment_id' ? 'number' : 'text';
        case 'number':
          return 'number';
        case 'checkbox':
          return 'boolean';
        case 'select':
          return 'select';
        case 'status':
          return 'status';
        case 'multi_select':
          return 'multiSelect';
        case 'date':
        case 'created_time':
        case 'last_edited_time':
          return 'date';
        case 'url':
          return 'url';
        case 'relation':
          return 'link';
        default:
          return undefined; // rollup and anything unknown
      }
    };
    for (const source of database.dataSources) {
      const title = titleProperty(source.schema);
      const ordered = Object.values(source.schema).sort((a, b) =>
        a.name === title ? -1 : b.name === title ? 1 : 0,
      );
      for (const property of ordered) {
        const type = typeOf(property);
        if (!type || columnIds.has(property.name)) continue;
        let id =
          property.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'column';
        while (columns.some((c) => c.id === id)) id = `${id}-2`;
        columnIds.set(property.name, id);
        columns.push(
          omit({
            id,
            name: property.name,
            type,
            options: property.options?.map((o) => omit({ name: o.name, color: o.color })),
            description: property.description || undefined,
          }),
        );
      }
      for (const row of source.rows) {
        const id = rowId(row);
        if (!id || isSkipped(id)) continue;
        const cells: Record<string, SpaceCellValue> = {};
        for (const property of Object.values(source.schema)) {
          const columnId = columnIds.get(property.name);
          const type = typeOf(property);
          if (!columnId || !type) continue;
          const value = cellOf(row, property, type, resolveNode, entityLinks);
          if (value !== undefined) cells[columnId] = value;
        }
        const pageId = resolveNode(id);
        const links = entityLinks.get(id);
        rowsOut.push(omit({ id, cells, pageId, links: links?.length ? links : undefined }));
      }
    }
    return { columns, rows: rowsOut };
  }

  function cellOf(
    row: Row,
    property: NotionPropertySchema,
    type: SpaceColumnType,
    resolveNode: (id: NotionId) => Id | undefined,
    entityLinks: Map<NotionId, EntityLink[]>,
  ): SpaceCellValue | undefined {
    switch (type) {
      case 'number':
        return number(row, property.name);
      case 'boolean':
        return checkbox(row, property.name);
      case 'multiSelect': {
        const values = list(row, property.name);
        return values.length ? values : undefined;
      }
      case 'date': {
        if (property.type !== 'date') {
          const value = row[property.name];
          return typeof value === 'string' && value ? value : undefined;
        }
        const value = date(row, property.name);
        return value ? (value.end ? `${value.start}/${value.end}` : value.start) : undefined;
      }
      case 'link': {
        const links: EntityLink[] = [];
        for (const target of relation(row, property.name)) {
          const label = titleOf(target);
          const entity = entityLinks.get(target)?.[0];
          const node = resolveNode(target);
          const container = rows.get(target)?.database.id;
          const containerNode = container ? resolveNode(container) : undefined;
          if (entity) links.push(omit({ ...entity, label }));
          else if (node) links.push(omit({ type: 'spaceNode' as const, id: node, label }));
          else if (containerNode)
            links.push(
              omit({ type: 'spaceNode' as const, id: containerNode, rowId: target, label }),
            );
        }
        return links.length ? links : undefined;
      }
      default: {
        const value = row[property.name];
        if (typeof value === 'number') return String(value);
        return clean(text(row, property.name));
      }
    }
  }

  /* ---------------------------------------------------------- execute */

  try {
    await db.transaction('rw', tables, async () => {
      await run();
      if (options.dryRun) throw new DryRunRollback('dry run');
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return report;
}

function toIso(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}
