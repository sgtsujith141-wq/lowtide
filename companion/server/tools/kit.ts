import * as z from 'zod/mini';
import { type BackupData, type Repositories } from '../../../src/db/repositories';
import { projectRoot } from '../../../src/features/context/workspace';
import { SLOT_TITLES } from '../../../src/db/import/notion/types';
import { PROJECT_SPACE_SLOTS, type NewSpaceBlock } from '../../../src/db/repositories';
import { blocksOf, blocksToMarkdown, linksOf, parseBody } from '../../../src/lib/space-blocks';
import { toTimestamp } from '../../../src/lib/time';
import {
  PRIVATE_EVENT_TYPES,
  type Decision,
  type Hackathon,
  type Milestone,
  type Task,
  type LedgerEvent,
  type Project,
  type ProjectItem,
  type SourceRecord,
  type SpaceCellValue,
  type SpaceNode,
} from '../../../src/types/domain';
import type { Capability, SensitiveCategory } from '../../../src/db/companion/wire';
import type { ChangeGuard, Grant, Grants, InverseOp } from '../grants';
import type { Checkpoints } from '../checkpoints';
import type { SqliteStore } from '../sqlite/store';
import type { WorkspaceSync } from '../workspace-sync';

/*
 * The MCP tools (ADR-059). Reads work from one consistent snapshot of
 * canonical state, cut down to the connection's scope. Writes go through the
 * domain repositories as an attributed AI client, so every rule, ledger event
 * and progress snapshot is exactly what the app itself would produce, and
 * the owner sees who did it. Every call, refused or failed ones included, is
 * written to the audit log.
 *
 * Scopes: a PROJECT grant sees one project; WORKSPACE sees every technical
 * project and hackathon; GLOBAL adds non-project tasks and activity, plus the
 * private categories the owner ticked for that grant. Protected time is
 * reachable from no scope at all.
 */

export interface CallContext {
  grant: Grant;
  sessionId?: string;
  requestId?: string;
  /** When this MCP session began: the default start of a logged AI session. */
  sessionStartedAt?: string;
}

export interface ToolServices {
  store: SqliteStore;
  grants: Grants;
  sync: WorkspaceSync;
  now: () => Date;
  /** Named database copies before big changes (absent in some tests). */
  checkpoints?: Checkpoints;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** The call isn't allowed for this connection (scope or permission). */
export class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refusal';
  }
}

/** One reviewable change a tool made, and how to undo it if that's possible. */
export interface ChangeNote {
  /** "Created project Media Engine": what the owner reads in the AI area. */
  summary: string;
  entityType?: string;
  entityId?: string;
  undo?: InverseOp[];
  guard?: ChangeGuard;
}

export interface Outcome {
  value: unknown;
  entityType?: string;
  entityId?: string;
  before?: string;
  after?: string;
  /** The changes, for review (and undo). Writes without one are logged by summary only. */
  changes?: ChangeNote[];
}

export interface Env extends ToolServices {
  ctx: CallContext;
  at: Date;
  /** True while a dry run: everything happens, then is rolled back. */
  dryRun: boolean;
  data(): Promise<BackupData>;
  /** Repositories that write as this AI client. */
  repos(): Repositories;
  /** Whether the grant has a capability (and, for private data, the category). */
  can(capability: Capability, category?: SensitiveCategory): boolean;
  /** Refuses unless the grant has it: "Cannot <action>. Grant lacks <capability>." */
  require(capability: Capability, action: string, category?: SensitiveCategory): void;
  /** Runs several writes as one: all of them happen, or none. */
  atomic<T>(work: () => Promise<T>): Promise<T>;
}

export type Args = Record<string, unknown>;

export interface Tool {
  name: string;
  title: string;
  description: string;
  write: boolean;
  /** Every capability the tool needs. */
  capability: Capability | readonly Capability[];
  /** What it does, for refusals: "create Project". */
  action: string;
  /** A private category it needs (global grants only). */
  category?: SensitiveCategory;
  /** Accepts `dryRun: true`: everything is checked and done, then rolled back. */
  dryRun?: boolean;
  /** Takes a checkpoint first when it changes this many things or more. */
  checkpointAt?: number;
  input: z.ZodMiniType;
  run(env: Env, args: Args): Promise<Outcome>;
}

export const needs = (tool: Pick<Tool, 'capability'>): readonly Capability[] =>
  typeof tool.capability === 'string' ? [tool.capability] : tool.capability;

/** The refusal text for a missing capability. */
export function lacks(action: string, capability: Capability | string): string {
  return `Cannot ${action}. Grant lacks ${capability}.`;
}

export const dryRunArg = () =>
  d(
    z.optional(z.boolean()),
    'true: check and preview the change without making it (nothing is saved).',
  );

/* ------------------------------ arguments ------------------------------ */

export const d = <T extends z.ZodMiniType>(schema: T, description: string): T => {
  (z.globalRegistry as { add(schema: unknown, meta: { description: string }): unknown }).add(
    schema,
    { description },
  );
  return schema;
};
export const text = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));
export const id = () => text(200);
export const projectArg = () =>
  d(
    z.optional(id()),
    'Project id or slug. Optional for a project-scoped connection (defaults to its project).',
  );
export const limitArg = (fallback: number) =>
  d(z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(200))), `Default ${fallback}.`);

/* ------------------------------- scoping ------------------------------- */

export const isPrivate = (e: LedgerEvent) => PRIVATE_EVENT_TYPES.includes(e.type);

export function scopeName(grant: Grant): string {
  return grant.scope === 'project' ? `project ${grant.projectId}` : grant.scope;
}

export const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * One record by id, exact name, or a unique close match; never a guess.
 * Ambiguous refs are refused with the candidates, so the client can choose.
 */
export function resolveOne<T>(
  list: readonly T[],
  ref: string,
  kind: string,
  idOf: (t: T) => string,
  names: (t: T) => (string | undefined)[],
  describe: (t: T) => string,
): T {
  const byId = list.find((t) => idOf(t) === ref);
  if (byId) return byId;
  const wanted = norm(ref);
  if (!wanted) throw new Refusal(`Name the ${kind}`);
  const exact = list.filter((t) => names(t).some((n) => n !== undefined && norm(n) === wanted));
  if (exact.length === 1) return exact[0]!;
  const close =
    exact.length > 1
      ? exact
      : list.filter((t) => names(t).some((n) => n !== undefined && norm(n).includes(wanted)));
  if (close.length === 1) return close[0]!;
  if (close.length === 0) throw new Refusal(`No ${kind} “${ref}” in this connection’s scope`);
  throw new Refusal(
    `“${ref}” matches ${close.length} ${kind}s; name one by id: ${close
      .slice(0, 8)
      .map(describe)
      .join('; ')}`,
  );
}

export async function projectOf(env: Env, ref: string | undefined): Promise<Project> {
  const { grant } = env.ctx;
  const data = await env.data();
  if (grant.scope === 'project') {
    const own = data.projects.find((p) => p.id === grant.projectId);
    if (!own) throw new Refusal('This connection’s project no longer exists');
    if (ref !== undefined && ref !== own.id && ref !== own.slug && norm(ref) !== norm(own.name)) {
      throw new Refusal('That project is outside this connection’s scope');
    }
    return own;
  }
  if (ref === undefined) throw new Refusal('Name a project (its id, slug or name)');
  return resolveOne(
    data.projects,
    ref,
    'project',
    (p) => p.id,
    (p) => [p.slug, p.name],
    (p) => `${p.name} (${p.id}, ${p.slug})`,
  );
}

/** Projects this connection may see. */
export async function visibleProjects(env: Env, ref?: string): Promise<Project[]> {
  if (ref !== undefined || env.ctx.grant.scope === 'project') return [await projectOf(env, ref)];
  return (await env.data()).projects;
}

export async function itemOf(env: Env, itemId: string): Promise<ProjectItem> {
  const data = await env.data();
  const item = data.projectItems.find((i) => i.id === itemId);
  const visible = item && (await visibleProjects(env)).some((p) => p.id === item.projectId);
  if (!item || !visible) throw new Refusal(`No item ${itemId} in this connection’s scope`);
  return item;
}

export function slugOf(data: BackupData, projectId: string | undefined) {
  return data.projects.find((p) => p.id === projectId)?.slug;
}

export function granted(env: Env, category: Grant['sensitive'][number]) {
  return env.ctx.grant.scope === 'global' && env.ctx.grant.sensitive.includes(category);
}

export function workspaceScope(env: Env, project?: Project) {
  return env.ctx.grant.scope === 'project' && project
    ? { kind: 'project' as const, root: projectRoot(project) }
    : { kind: 'workspace' as const };
}

/** A client-supplied instant, normalised; never in the future. */
export function instant(env: Env, value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Refusal(`${field} isn’t a valid date and time`);
  if (parsed.getTime() > env.at.getTime() + 60_000) throw new Refusal(`${field} is in the future`);
  return toTimestamp(parsed);
}

export const quote = (s: string, max = 80) => `“${s.length > max ? `${s.slice(0, max - 1)}…` : s}”`;

/* -------------------------------- SPACE -------------------------------- */

/*
 * SPACE over MCP (v2 PHASE 014, ADR-067). An AI client can find, read and
 * write pages in the parts of SPACE its grant covers:
 * - PROJECT: its project's folder (made when first written);
 * - WORKSPACE: Projects, Hackathons, Ideas and Archive;
 * - GLOBAL: everything, except College without the college permission and
 *   Personal without the Personal SPACE permission.
 * Writes go through the SPACE repository as the AI client (attributed in the
 * page history and on each block). Sections LOWTIDE maintains (the roots,
 * project folders and slots) can't be renamed or archived from here.
 */

export interface SpaceView {
  nodes: SpaceNode[];
  byId: Map<string, SpaceNode>;
  children: Map<string, SpaceNode[]>;
  path(id: string): SpaceNode[];
  visible(node: SpaceNode): boolean;
  /** The folder a project-scoped connection works in, if it exists. */
  home?: SpaceNode;
}

export async function spaceView(env: Env): Promise<SpaceView> {
  const data = await env.data();
  const nodes = data.spaceNodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, SpaceNode[]>();
  for (const n of nodes) {
    const key = n.parentId && byId.has(n.parentId) ? n.parentId : '';
    children.set(key, [...(children.get(key) ?? []), n]);
  }
  for (const list of children.values())
    list.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const path = (id: string) => {
    const out: SpaceNode[] = [];
    const seen = new Set<string>();
    for (let at = byId.get(id); at && !seen.has(at.id); at = byId.get(at.parentId ?? '')) {
      seen.add(at.id);
      out.unshift(at);
    }
    return out;
  };
  const { grant } = env.ctx;
  const rootKey = (n: SpaceNode) => path(n.id)[0]?.key;
  const visible = (n: SpaceNode): boolean => {
    const keys = path(n.id).map((p) => p.key);
    const root = rootKey(n);
    // LOWTIDE's own section (templates, the operating guide) is open to every connection.
    if (root === 'lowtide') return true;
    if (grant.scope === 'project') return keys.includes(`project:${grant.projectId}`);
    if (root === 'personal') return granted(env, 'personalSpace');
    if (root === 'college') return grant.scope === 'global' && granted(env, 'college');
    if (grant.scope === 'workspace')
      return ['projects', 'areas', 'hackathons', 'ideas', 'archive'].includes(root ?? '');
    return true;
  };
  const home =
    grant.scope === 'project'
      ? nodes.find((n) => n.key === `project:${grant.projectId}`)
      : undefined;
  return { nodes, byId, children, path, visible, ...(home ? { home } : {}) };
}

export const pathText = (view: SpaceView, id: string) =>
  view
    .path(id)
    .map((p) => p.title)
    .join(' / ');

export const titleEq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A page by id or by its path of titles ("Projects / Engine / Architecture"). */
export function resolvePage(view: SpaceView, ref: string): SpaceNode {
  const byId = view.byId.get(ref);
  if (byId) {
    if (!view.visible(byId)) throw new Refusal('That page is outside this connection’s scope');
    return byId;
  }
  const parts = ref
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  let level = view.home ? (view.children.get(view.home.id) ?? []) : (view.children.get('') ?? []);
  let found: SpaceNode | undefined;
  for (const [i, part] of parts.entries()) {
    found = level.find((n) => !n.archived && titleEq(n.title, part));
    if (!found && i === 0 && view.home && titleEq(view.home.title, part)) found = view.home;
    if (!found && i === 0) {
      found = (view.children.get('') ?? []).find(
        (n) => !n.archived && titleEq(n.title, part) && view.visible(n),
      );
    }
    if (!found && i === 0 && parts.length === 1) {
      // A bare title: unique among the pages this connection can see.
      const named = view.nodes.filter(
        (n) => !n.archived && titleEq(n.title, part) && view.visible(n),
      );
      if (named.length === 1) return named[0]!;
      if (named.length > 1) {
        throw new Refusal(
          `“${part}” matches ${named.length} pages; name one by id or path: ${named
            .slice(0, 8)
            .map((n) => `${pathText(view, n.id)} (${n.id})`)
            .join('; ')}`,
        );
      }
    }
    if (!found) throw new Refusal(`No page “${parts.slice(0, i + 1).join(' / ')}” here`);
    level = view.children.get(found.id) ?? [];
  }
  if (!found || !view.visible(found))
    throw new Refusal(`No page “${ref}” in this connection’s scope`);
  return found;
}

export function pageJson(view: SpaceView, node: SpaceNode, sources: SourceRecord[]) {
  const blocks = blocksOf(node);
  const table = node.table
    ? {
        columns: node.table.columns.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          ...(c.options?.length ? { options: c.options.map((o) => o.name) } : {}),
          ...(c.targets?.length ? { targets: c.targets } : {}),
          ...(c.rollup ? { rollup: c.rollup } : {}),
          ...(c.formula ? { formula: c.formula } : {}),
        })),
        ...(node.table.views?.length
          ? { views: node.table.views.map((v) => ({ id: v.id, name: v.name, type: v.type })) }
          : {}),
        rows: node.table.rows.slice(0, 200).map((r) => ({
          id: r.id,
          ...Object.fromEntries(
            node
              .table!.columns.filter((c) => r.cells[c.id] !== undefined)
              .map((c) => [c.name, r.cells[c.id]]),
          ),
        })),
        ...(node.table.rows.length > 200 ? { truncated: node.table.rows.length - 200 } : {}),
      }
    : undefined;
  const last = node.edits?.at(-1);
  const canonical = sources.find((s) => s.role === 'canonical');
  return {
    id: node.id,
    title: node.title,
    kind: node.kind === 'section' ? 'folder' : node.kind === 'table' ? 'database' : node.kind,
    ...(node.description ? { description: node.description } : {}),
    ...(node.pinnedAt ? { pinned: true } : {}),
    ...(node.key ? { maintainedByLowtide: true } : {}),
    path: pathText(view, node.id),
    archived: node.archived,
    revision: node.revision ?? 0,
    updatedAt: node.updatedAt,
    ...(last
      ? { lastEditedBy: last.by === 'ai-client' ? (last.client ?? 'AI client') : 'owner' }
      : {}),
    markdown: blocksToMarkdown(blocks),
    blocks: blocks.map((b) => ({
      id: b.id,
      type: b.type,
      ...(b.text !== undefined ? { text: b.text } : {}),
      ...(b.checked !== undefined ? { checked: b.checked } : {}),
      ...(b.link ? { link: b.link } : {}),
      ...(b.type === 'fallback' ? { readOnly: true } : {}),
    })),
    ...(table ? { table } : {}),
    links: linksOf(node),
    subpages: (view.children.get(node.id) ?? [])
      .filter((c) => !c.archived && view.visible(c))
      .map((c) => ({ id: c.id, title: c.title, kind: c.kind })),
    ...(canonical
      ? {
          source: {
            system: canonical.system,
            originalTitle: canonical.originalTitle,
            ...(canonical.url ? { url: canonical.url } : {}),
          },
        }
      : {}),
  };
}

export function checkMarkdown(markdown: string) {
  const blocks = parseBody(markdown);
  if (blocks.length === 0) throw new Refusal('There’s nothing to write');
  if (blocks.length > 500) throw new Refusal('That’s more than 500 blocks; write it in parts');
  return blocks.map((b): NewSpaceBlock => {
    const copy: NewSpaceBlock = { ...b };
    delete copy.id;
    return copy;
  });
}

export const MAINTAINED = (n: SpaceNode) => n.key !== undefined;

/** A column value from an AI client, made to fit the column's type. */
export function cellValue(column: { type: string; name: string }, value: unknown): SpaceCellValue {
  const fail = () => {
    throw new Refusal(`“${column.name}” takes a ${column.type} value`);
  };
  switch (column.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) fail();
      return n;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 'yes') return true;
      if (value === 'false' || value === 'no') return false;
      return fail() as never;
    case 'multiSelect':
      if (Array.isArray(value) && value.every((v) => typeof v === 'string'))
        return value as string[];
      if (typeof value === 'string')
        return value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
      return fail() as never;
    case 'link':
      throw new Refusal(`“${column.name}” holds links; use link_space_entity on the page instead`);
    default:
      if (typeof value !== 'string' && typeof value !== 'number') fail();
      return String(value);
  }
}

export const pageArg = () =>
  d(text(2000), 'A page id, or its path of titles such as "Projects / Engine / Architecture".');

/** Finds or makes each page along a path; returns the last. */
export async function ensurePath(
  env: Env,
  view: SpaceView,
  parts: string[],
): Promise<{ node: SpaceNode; created: string[] }> {
  const repos = env.repos();
  const data = await env.data();
  const created: string[] = [];
  const { grant } = env.ctx;
  let parent: SpaceNode | undefined;
  let level: SpaceNode[];
  if (grant.scope === 'project') {
    parent = view.home ?? (await repos.space.ensureProjectSpace(grant.projectId!));
    if (!view.home) created.push(parent.title);
    level = view.children.get(parent.id) ?? [];
    // A full path ("Projects / Engine / …") is accepted too.
    if (parts[0] && titleEq(parts[0], 'Projects')) parts = parts.slice(1);
    if (parts[0] && titleEq(parts[0], parent.title)) parts = parts.slice(1);
  } else {
    level = view.children.get('') ?? [];
  }
  for (const [i, part] of parts.entries()) {
    let next = level.find((n) => !n.archived && titleEq(n.title, part));
    if (!next && !parent)
      throw new Refusal(
        `“${part}” isn’t a SPACE section (use Projects, Areas, Hackathons, Ideas, College, Personal or Archive)`,
      );
    if (!next && parent) {
      const project = /^project:([^:]+)$/.exec(parent.key ?? '')?.[1];
      const slot = PROJECT_SPACE_SLOTS.find((s) => titleEq(SLOT_TITLES[s], part));
      if (project && slot) next = await repos.space.ensureProjectSpace(project, slot);
      else if (parent.key === 'projects') {
        const p = data.projects.find((x) => titleEq(x.name, part) || x.slug === part.toLowerCase());
        if (!p)
          throw new Refusal(`No project “${part}”; projects are made in LOWTIDE, not from SPACE`);
        next = await repos.space.ensureProjectSpace(p.id);
      } else {
        next = await repos.space.create({ parentId: parent.id, title: part, blocks: [] });
      }
      created.push(parts.slice(0, i + 1).join(' / '));
    }
    if (!view.visible(next!) && !(grant.scope === 'project')) {
      // A fresh node isn't in the snapshot yet; check its root instead.
      const root = view.path(parent?.id ?? next!.id)[0];
      if (root && !view.visible(root))
        throw new Refusal('That part of SPACE is outside this connection’s scope');
    }
    parent = next!;
    level = view.children.get(parent.id) ?? [];
  }
  if (!parent) throw new Refusal('Give a path below a section');
  return { node: parent, created };
}

/* --------------------------- v2.1 resolution --------------------------- */

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day argument (`YYYY-MM-DD`), or '' to clear. */
export const dayArg = (what: string) =>
  d(
    z.optional(z.string().check(z.maxLength(10))),
    `${what} as YYYY-MM-DD; an empty string clears it.`,
  );

export function checkDay(value: string, field: string): string {
  if (!LOCAL_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Refusal(`${field} must be a date like 2026-11-04`);
  }
  return value;
}

/** Whether a task is in this connection's scope. */
export async function taskVisible(env: Env, task: Task): Promise<boolean> {
  if (task.projectId === undefined) return env.ctx.grant.scope === 'global';
  return (await visibleProjects(env)).some((p) => p.id === task.projectId);
}

/** A task by id or title (within a project when given), in scope. */
export async function resolveTask(env: Env, ref: string, projectRef?: string): Promise<Task> {
  const data = await env.data();
  const project = projectRef !== undefined ? await projectOf(env, projectRef) : undefined;
  const visible: Task[] = [];
  for (const t of data.tasks) {
    if (project && t.projectId !== project.id) continue;
    if (await taskVisible(env, t)) visible.push(t);
  }
  // Prefer open tasks when a title is used.
  const byId = visible.find((t) => t.id === ref);
  if (byId) return byId;
  const open = visible.filter((t) => t.status === 'todo' || t.status === 'doing');
  try {
    return resolveOne(
      open,
      ref,
      'open task',
      (t) => t.id,
      (t) => [t.title],
      describeTask(data),
    );
  } catch (error) {
    if (!(error instanceof Refusal) || !/^No open task/.test(error.message)) throw error;
    return resolveOne(
      visible,
      ref,
      'task',
      (t) => t.id,
      (t) => [t.title],
      describeTask(data),
    );
  }
}

const describeTask = (data: BackupData) => (t: Task) =>
  `${t.title} (${t.id}${t.projectId ? `, ${slugOf(data, t.projectId)}` : ''}, ${t.status})`;

/** A milestone of a project by id or title. Archived ones only when asked. */
export async function resolveMilestone(
  env: Env,
  ref: string,
  projectRef?: string,
  includeArchived = false,
): Promise<Milestone> {
  const data = await env.data();
  const visible = new Set((await visibleProjects(env, projectRef)).map((p) => p.id));
  const list = data.milestones.filter(
    (m) => visible.has(m.projectId) && (includeArchived || m.archivedAt === undefined),
  );
  return resolveOne(
    list,
    ref,
    'milestone',
    (m) => m.id,
    (m) => [m.title],
    (m) => `${m.title} (${m.id}, ${slugOf(data, m.projectId)})`,
  );
}

/** Hackathons are outside a project-scoped connection. */
export async function hackathonsInScope(env: Env, includeArchived = true): Promise<Hackathon[]> {
  if (env.ctx.grant.scope === 'project') {
    throw new Refusal('Hackathons are outside a project-scoped connection');
  }
  const data = await env.data();
  return data.hackathons.filter((h) => includeArchived || h.archivedAt === undefined);
}

export async function resolveHackathon(env: Env, ref: string): Promise<Hackathon> {
  return resolveOne(
    await hackathonsInScope(env),
    ref,
    'hackathon',
    (h) => h.id,
    (h) => [h.name],
    (h) => `${h.name} (${h.id})`,
  );
}

export async function resolveDecision(
  env: Env,
  ref: string,
  projectRef?: string,
): Promise<Decision> {
  const data = await env.data();
  const visible = new Set((await visibleProjects(env, projectRef)).map((p) => p.id));
  return resolveOne(
    data.decisions.filter((x) => visible.has(x.projectId)),
    ref,
    'decision',
    (x) => x.id,
    (x) => [x.title],
    (x) => `${x.title} (${x.id}, ${slugOf(data, x.projectId)}, ${x.decidedAt.slice(0, 10)})`,
  );
}

/** A project item (approval, blocker, waiting, idea…) by id or title, in scope. */
export async function resolveItem(
  env: Env,
  ref: string,
  options: {
    project?: string | undefined;
    kinds?: readonly ProjectItem['kind'][];
    open?: boolean;
  } = {},
): Promise<ProjectItem> {
  const data = await env.data();
  const visible = new Set((await visibleProjects(env, options.project)).map((p) => p.id));
  const list = data.projectItems.filter(
    (i) =>
      visible.has(i.projectId) &&
      (!options.kinds || options.kinds.includes(i.kind)) &&
      (options.open === undefined || (i.lane !== 'done') === options.open),
  );
  return resolveOne(
    list,
    ref,
    options.kinds?.length === 1 ? options.kinds[0]! : 'item',
    (i) => i.id,
    (i) => [i.title],
    (i) => `${i.title} (${i.id}, ${slugOf(data, i.projectId)}, ${i.lane})`,
  );
}

/** Field values for a change guard: what the record holds now (undefined = unset). */
export function pick<T extends object>(record: T, fields: readonly (keyof T)[]) {
  return Object.fromEntries(fields.map((f) => [f, record[f] ?? null])) as Record<string, unknown>;
}

/** An inverse repository call. */
export const op = (repo: string, member: string, ...args: unknown[]) => ({ repo, member, args });
