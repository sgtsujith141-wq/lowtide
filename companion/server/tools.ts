import * as z from 'zod/mini';
import { STORE_NAMES } from '../../src/db/migrations';
import { createRepositories, type BackupData, type Repositories } from '../../src/db/repositories';
import {
  buildContextPack,
  renderContextMarkdown,
  type ContextScope,
} from '../../src/features/context/pack';
import { projectRoot, projectSummaryJson } from '../../src/features/context/workspace';
import { summariseProject } from '../../src/features/projects/summary';
import { toLocalDate, toTimestamp } from '../../src/lib/time';
import {
  NOTE_KINDS,
  PRIVATE_EVENT_TYPES,
  PROJECT_STATES,
  type LedgerEvent,
  type Project,
  type ProjectItem,
} from '../../src/types/domain';
import type { Grant, Grants } from './grants';
import type { SqliteStore } from './sqlite/store';
import type { WorkspaceSync } from './workspace-sync';

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
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** The call isn't allowed for this connection (scope or permission). */
class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refusal';
  }
}

interface Outcome {
  value: unknown;
  entityType?: string;
  entityId?: string;
  before?: string;
  after?: string;
}

interface Env extends ToolServices {
  ctx: CallContext;
  at: Date;
  data(): Promise<BackupData>;
  /** Repositories that write as this AI client. */
  repos(): Repositories;
}

type Args = Record<string, unknown>;

interface Tool {
  name: string;
  title: string;
  description: string;
  write: boolean;
  input: z.ZodMiniType;
  run(env: Env, args: Args): Promise<Outcome>;
}

/* ------------------------------ arguments ------------------------------ */

const d = <T extends z.ZodMiniType>(schema: T, description: string): T => {
  (z.globalRegistry as { add(schema: unknown, meta: { description: string }): unknown }).add(
    schema,
    { description },
  );
  return schema;
};
const text = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));
const id = () => text(200);
const projectArg = () =>
  d(
    z.optional(id()),
    'Project id or slug. Optional for a project-scoped connection (defaults to its project).',
  );
const limitArg = (fallback: number) =>
  d(z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(200))), `Default ${fallback}.`);

/* ------------------------------- scoping ------------------------------- */

const isPrivate = (e: LedgerEvent) => PRIVATE_EVENT_TYPES.includes(e.type);

function scopeName(grant: Grant): string {
  return grant.scope === 'project' ? `project ${grant.projectId}` : grant.scope;
}

async function projectOf(env: Env, ref: string | undefined): Promise<Project> {
  const { grant } = env.ctx;
  const data = await env.data();
  if (grant.scope === 'project') {
    const own = data.projects.find((p) => p.id === grant.projectId);
    if (!own) throw new Refusal('This connection’s project no longer exists');
    if (ref !== undefined && ref !== own.id && ref !== own.slug) {
      throw new Refusal('That project is outside this connection’s scope');
    }
    return own;
  }
  if (ref === undefined) throw new Refusal('Name a project (its id or slug)');
  const project = data.projects.find((p) => p.id === ref || p.slug === ref);
  if (!project) throw new Refusal(`No project “${ref}”`);
  return project;
}

/** Projects this connection may see. */
async function visibleProjects(env: Env, ref?: string): Promise<Project[]> {
  if (ref !== undefined || env.ctx.grant.scope === 'project') return [await projectOf(env, ref)];
  return (await env.data()).projects;
}

async function itemOf(env: Env, itemId: string): Promise<ProjectItem> {
  const data = await env.data();
  const item = data.projectItems.find((i) => i.id === itemId);
  const visible = item && (await visibleProjects(env)).some((p) => p.id === item.projectId);
  if (!item || !visible) throw new Refusal(`No item ${itemId} in this connection’s scope`);
  return item;
}

function slugOf(data: BackupData, projectId: string | undefined) {
  return data.projects.find((p) => p.id === projectId)?.slug;
}

function granted(env: Env, category: Grant['sensitive'][number]) {
  return env.ctx.grant.scope === 'global' && env.ctx.grant.sensitive.includes(category);
}

function workspaceScope(env: Env, project?: Project) {
  return env.ctx.grant.scope === 'project' && project
    ? { kind: 'project' as const, root: projectRoot(project) }
    : { kind: 'workspace' as const };
}

/** A client-supplied instant, normalised; never in the future. */
function instant(env: Env, value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Refusal(`${field} isn’t a valid date and time`);
  if (parsed.getTime() > env.at.getTime() + 60_000) throw new Refusal(`${field} is in the future`);
  return toTimestamp(parsed);
}

const quote = (s: string, max = 80) => `“${s.length > max ? `${s.slice(0, max - 1)}…` : s}”`;

/* -------------------------------- reads -------------------------------- */

const readTools: Tool[] = [
  {
    name: 'get_context',
    title: 'Get context',
    description:
      'Scoped, current LOWTIDE context as Markdown: for a project, its objective, phase, next action, lanes, milestones, decisions, recent activity and documents; for a workspace or global connection without a project, every live project and hackathon. Start here.',
    write: false,
    input: z.strictObject({
      project: projectArg(),
      milestone: d(z.optional(id()), 'Narrow to one milestone of the project (optional).'),
      task: d(z.optional(id()), 'Narrow to one task of the project (optional).'),
    }),
    async run(env, args) {
      const data = await env.data();
      const { grant } = env.ctx;
      let scope: ContextScope;
      let entityId: string | undefined;
      if (args.project !== undefined || grant.scope === 'project') {
        const project = await projectOf(env, args.project as string | undefined);
        entityId = project.id;
        scope = {
          kind: 'project',
          projectId: project.id,
          ...(args.milestone ? { milestoneId: args.milestone as string } : {}),
          ...(args.task ? { taskId: args.task as string } : {}),
        };
      } else if (grant.scope === 'global') {
        const flags = Object.fromEntries(grant.sensitive.map((s) => [s, true]));
        scope = { kind: 'global', grants: flags };
      } else {
        scope = { kind: 'workspace' };
      }
      const pack = buildContextPack(data, scope, env.at, {
        documents: env.sync.humanDocuments(data.projects),
      });
      return {
        value: renderContextMarkdown(pack),
        ...(entityId ? { entityType: 'project', entityId } : {}),
      };
    },
  },
  {
    name: 'get_project',
    title: 'Get project',
    description:
      'One project in full: its fields, completion, milestones, open items by lane, recent decisions and notes.',
    write: false,
    input: z.strictObject({ project: projectArg() }),
    async run(env, args) {
      const data = await env.data();
      const project = await projectOf(env, args.project as string | undefined);
      const s = summariseProject(
        project,
        data.milestones,
        data.projectItems,
        data.tasks,
        data.workSessions,
        toLocalDate(env.at),
      );
      const superseded = new Set(data.decisions.map((x) => x.supersedesId).filter(Boolean));
      const open = data.projectItems.filter((i) => i.projectId === project.id && i.lane !== 'done');
      return {
        entityType: 'project',
        entityId: project.id,
        value: {
          ...project,
          workspacePath: projectRoot(project),
          completion: s.completion,
          milestones: s.milestones.map((m) => ({
            id: m.id,
            title: m.title,
            weight: m.weight,
            ...(m.dueOn ? { dueOn: m.dueOn } : {}),
            done: m.completedAt !== undefined,
          })),
          openItems: open
            .sort((a, b) => a.lane.localeCompare(b.lane) || a.order - b.order)
            .map((i) => ({
              id: i.id,
              kind: i.kind,
              lane: i.lane,
              title: i.title,
              ...(i.body ? { body: i.body } : {}),
              ...(i.waitingOn ? { waitingOn: i.waitingOn } : {}),
            })),
          recentDecisions: data.decisions
            .filter((x) => x.projectId === project.id)
            .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
            .slice(0, 10)
            .map((x) => ({
              id: x.id,
              title: x.title,
              decidedAt: x.decidedAt,
              status: superseded.has(x.id) ? 'superseded' : 'accepted',
            })),
          notes: data.notes
            .filter((n) => n.projectId === project.id)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((n) => ({
              id: n.id,
              kind: n.kind,
              title: n.title,
              author: n.author === 'ai-client' ? (n.client ?? 'AI client') : 'owner',
              createdAt: n.createdAt,
            })),
        },
      };
    },
  },
  {
    name: 'get_project_summary',
    title: 'Get project summary',
    description:
      'A compact machine-readable summary of one project: state, phase, next action, completion percent, lanes and recent activity.',
    write: false,
    input: z.strictObject({ project: projectArg() }),
    async run(env, args) {
      const project = await projectOf(env, args.project as string | undefined);
      return {
        entityType: 'project',
        entityId: project.id,
        value: projectSummaryJson(await env.data(), project, env.at),
      };
    },
  },
  {
    name: 'get_recent_activity',
    title: 'Get recent activity',
    description:
      'Recent LOWTIDE events, newest first (work sessions, completions, decisions, approvals, notes, AI sessions), for one project or everything this connection can see.',
    write: false,
    input: z.strictObject({ project: projectArg(), limit: limitArg(30) }),
    async run(env, args) {
      const data = await env.data();
      const projects = await visibleProjects(env, args.project as string | undefined);
      const ids = new Set(projects.map((p) => p.id));
      const onlyProjects = args.project !== undefined || env.ctx.grant.scope !== 'global';
      const collegeWork = new Set(
        data.workSessions.filter((w) => w.kind === 'college').map((w) => w.id),
      );
      const titles = new Map<string, string>();
      for (const t of data.tasks) titles.set(t.id, t.title);
      for (const m of data.milestones) titles.set(m.id, m.title);
      for (const i of data.projectItems) titles.set(i.id, i.title);
      for (const x of data.decisions) titles.set(x.id, x.title);
      for (const n of data.notes) titles.set(n.id, n.title);
      for (const p of data.projects) titles.set(p.id, p.name);
      for (const w of data.workSessions) if (w.intent) titles.set(w.id, w.intent);
      for (const a of data.aiSessions) titles.set(a.id, a.summary.split('\n')[0]!);
      const events = data.events
        .filter((e) => {
          if (e.projectId !== undefined) return ids.has(e.projectId) && !isPrivate(e);
          if (onlyProjects) return false;
          if (e.type === 'habit.logged') return granted(env, 'routines');
          if (e.type.startsWith('offtime.')) return granted(env, 'offTime');
          if (collegeWork.has(e.entityId)) return granted(env, 'college');
          return true;
        })
        .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
        .slice(0, (args.limit as number | undefined) ?? 30);
      return {
        value: events.map((e) => ({
          at: e.at,
          type: e.type,
          ...(titles.has(e.entityId) && e.entityType !== 'offTimeSession'
            ? { title: titles.get(e.entityId) }
            : {}),
          ...(e.projectId ? { project: slugOf(data, e.projectId) } : {}),
          by: e.source === 'ai-client' ? (e.actor ?? 'AI client') : 'owner',
          ...(Object.keys(e.data).length ? { data: e.data } : {}),
        })),
      };
    },
  },
  {
    name: 'get_waiting',
    title: 'Get waiting items',
    description: 'Open items waiting on someone or something, with what they wait on.',
    write: false,
    input: z.strictObject({ project: projectArg() }),
    async run(env, args) {
      const data = await env.data();
      const ids = new Set(
        (await visibleProjects(env, args.project as string | undefined)).map((p) => p.id),
      );
      return {
        value: data.projectItems
          .filter((i) => ids.has(i.projectId) && i.lane === 'waiting')
          .sort((a, b) => a.laneChangedAt.localeCompare(b.laneChangedAt))
          .map((i) => ({
            id: i.id,
            project: slugOf(data, i.projectId),
            title: i.title,
            ...(i.waitingOn ? { waitingOn: i.waitingOn } : {}),
            since: i.laneChangedAt,
          })),
      };
    },
  },
  {
    name: 'get_approval_requests',
    title: 'Get approval requests',
    description:
      'Approval requests. Open ones by default; set includeResolved to see resolved ones too.',
    write: false,
    input: z.strictObject({
      project: projectArg(),
      includeResolved: d(z.optional(z.boolean()), 'Include resolved requests.'),
    }),
    async run(env, args) {
      const data = await env.data();
      const ids = new Set(
        (await visibleProjects(env, args.project as string | undefined)).map((p) => p.id),
      );
      return {
        value: data.projectItems
          .filter(
            (i) =>
              ids.has(i.projectId) &&
              i.kind === 'approval' &&
              (args.includeResolved === true || i.lane !== 'done'),
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((i) => ({
            id: i.id,
            project: slugOf(data, i.projectId),
            title: i.title,
            ...(i.body ? { body: i.body } : {}),
            status: i.lane === 'done' ? 'resolved' : 'open',
            requestedAt: i.createdAt,
            ...(i.resolvedAt ? { resolvedAt: i.resolvedAt } : {}),
          })),
      };
    },
  },
  {
    name: 'get_parked',
    title: 'Get parked items',
    description: 'Parked items, and (outside a single-project scope) parked projects.',
    write: false,
    input: z.strictObject({ project: projectArg() }),
    async run(env, args) {
      const data = await env.data();
      const projects = await visibleProjects(env, args.project as string | undefined);
      const ids = new Set(projects.map((p) => p.id));
      return {
        value: {
          items: data.projectItems
            .filter((i) => ids.has(i.projectId) && i.lane === 'parked')
            .map((i) => ({
              id: i.id,
              project: slugOf(data, i.projectId),
              kind: i.kind,
              title: i.title,
              since: i.laneChangedAt,
            })),
          projects: projects
            .filter((p) => p.state === 'parked')
            .map((p) => ({ id: p.id, slug: p.slug, name: p.name, since: p.stateChangedAt })),
        },
      };
    },
  },
  {
    name: 'get_decisions',
    title: 'Get decisions',
    description:
      'A project’s decision record, newest first, with who recorded each and what it supersedes.',
    write: false,
    input: z.strictObject({ project: projectArg(), limit: limitArg(20) }),
    async run(env, args) {
      const data = await env.data();
      const project = await projectOf(env, args.project as string | undefined);
      const mine = data.decisions.filter((x) => x.projectId === project.id);
      const supersededBy = new Map(
        mine.filter((x) => x.supersedesId).map((x) => [x.supersedesId!, x.id]),
      );
      return {
        entityType: 'project',
        entityId: project.id,
        value: mine
          .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt) || b.id.localeCompare(a.id))
          .slice(0, (args.limit as number | undefined) ?? 20)
          .map((x) => ({
            id: x.id,
            title: x.title,
            decision: x.decision,
            ...(x.context ? { context: x.context } : {}),
            ...(x.consequences ? { consequences: x.consequences } : {}),
            decidedAt: x.decidedAt,
            recordedBy:
              x.origin === 'ai-client'
                ? (x.client ?? 'AI client')
                : x.origin === 'accepted-proposal'
                  ? 'owner (accepted an AI proposal)'
                  : 'owner',
            ...(x.supersedesId ? { supersedes: x.supersedesId } : {}),
            ...(supersededBy.has(x.id) ? { supersededBy: supersededBy.get(x.id) } : {}),
          })),
      };
    },
  },
  {
    name: 'get_tasks',
    title: 'Get tasks',
    description:
      'Tasks of a project (or of every project this connection can see). Open ones by default.',
    write: false,
    input: z.strictObject({
      project: projectArg(),
      status: d(z.optional(z.enum(['open', 'closed', 'all'])), 'Default open.'),
    }),
    async run(env, args) {
      const data = await env.data();
      const everything = env.ctx.grant.scope === 'global' && args.project === undefined;
      const ids = new Set(
        (await visibleProjects(env, args.project as string | undefined)).map((p) => p.id),
      );
      const status = (args.status as string | undefined) ?? 'open';
      return {
        value: data.tasks
          .filter((t) => (t.projectId !== undefined ? ids.has(t.projectId) : everything))
          .filter((t) =>
            status === 'all'
              ? true
              : status === 'open'
                ? t.status === 'todo' || t.status === 'doing'
                : t.status === 'done' || t.status === 'dropped',
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            ...(t.projectId ? { project: slugOf(data, t.projectId) } : {}),
            ...(t.milestoneId ? { milestone: t.milestoneId } : {}),
            ...(t.dueAt ? { dueAt: t.dueAt } : {}),
            ...(t.plannedFor ? { plannedFor: t.plannedFor } : {}),
            ...(t.completedAt ? { completedAt: t.completedAt } : {}),
            ...(t.notes ? { notes: t.notes } : {}),
          })),
      };
    },
  },
  {
    name: 'get_milestones',
    title: 'Get milestones',
    description: 'A project’s milestones in pipeline order, with weights and overall completion.',
    write: false,
    input: z.strictObject({ project: projectArg() }),
    async run(env, args) {
      const data = await env.data();
      const project = await projectOf(env, args.project as string | undefined);
      const s = summariseProject(
        project,
        data.milestones,
        data.projectItems,
        data.tasks,
        data.workSessions,
        toLocalDate(env.at),
      );
      return {
        entityType: 'project',
        entityId: project.id,
        value: {
          completion: s.completion,
          milestones: s.milestones.map((m) => ({
            id: m.id,
            title: m.title,
            order: m.order,
            weight: m.weight,
            ...(m.dueOn ? { dueOn: m.dueOn } : {}),
            ...(m.notes ? { notes: m.notes } : {}),
            ...(m.completedAt ? { completedAt: m.completedAt } : {}),
          })),
        },
      };
    },
  },
  {
    name: 'search_workspace',
    title: 'Search workspace',
    description:
      'Case-insensitive text search across the technical workspace files this connection can see (generated project files, decisions, notes and your own documents).',
    write: false,
    input: z.strictObject({
      query: d(text(200).check(z.minLength(2)), 'Text to find.'),
      limit: limitArg(30),
    }),
    async run(env, args) {
      const needle = (args.query as string).toLowerCase();
      const limit = (args.limit as number | undefined) ?? 30;
      const scope =
        env.ctx.grant.scope === 'project'
          ? workspaceScope(env, await projectOf(env, undefined))
          : workspaceScope(env);
      const matches: { path: string; line: number; text: string }[] = [];
      for (const path of env.sync.list(scope)) {
        if (matches.length >= limit) break;
        let content: string;
        try {
          content = env.sync.read(path, scope);
        } catch {
          continue;
        }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && matches.length < limit; i++) {
          if (lines[i]!.toLowerCase().includes(needle)) {
            matches.push({ path, line: i + 1, text: lines[i]!.trim().slice(0, 240) });
          }
        }
      }
      return { value: matches };
    },
  },
  {
    name: 'get_document',
    title: 'Get document',
    description:
      'Reads one text file from the technical workspace (a path relative to the workspace root, e.g. projects/<slug>/CONTEXT.md).',
    write: false,
    input: z.strictObject({ path: d(text(500), 'Workspace-relative path.') }),
    async run(env, args) {
      const scope =
        env.ctx.grant.scope === 'project'
          ? workspaceScope(env, await projectOf(env, undefined))
          : workspaceScope(env);
      try {
        return { value: env.sync.read(args.path as string, scope), entityType: 'document' };
      } catch (error) {
        throw new Refusal((error as Error).message);
      }
    },
  },
];

/* -------------------------------- writes ------------------------------- */

const writeTools: Tool[] = [
  {
    name: 'create_note',
    title: 'Create note',
    description:
      'Adds a note, handoff, summary or research document to a project, attributed to you. It appears in LOWTIDE and in the project’s workspace folder. Generated files (PROJECT.md, CONTEXT.md) can’t be written.',
    write: true,
    input: z.strictObject({
      project: projectArg(),
      title: text(200),
      body: d(text(100_000), 'Markdown.'),
      kind: d(z.optional(z.enum(NOTE_KINDS)), 'Default note.'),
    }),
    async run(env, args) {
      const project = await projectOf(env, args.project as string | undefined);
      const note = await env.repos().notes.create(project.id, {
        title: args.title as string,
        body: args.body as string,
        ...(args.kind ? { kind: args.kind as (typeof NOTE_KINDS)[number] } : {}),
      });
      return {
        value: { id: note.id, kind: note.kind, title: note.title },
        entityType: 'note',
        entityId: note.id,
        after: `${note.kind} ${quote(note.title)} in ${project.slug}`,
      };
    },
  },
  {
    name: 'record_decision',
    title: 'Record decision',
    description:
      'Records a decision for a project, attributed to you. Decisions are immutable; to change one, record a new decision that supersedes it.',
    write: true,
    input: z.strictObject({
      project: projectArg(),
      title: text(200),
      decision: text(10_000),
      context: z.optional(text(10_000)),
      consequences: z.optional(text(10_000)),
      supersedes: d(z.optional(id()), 'Id of an earlier decision of this project.'),
    }),
    async run(env, args) {
      const project = await projectOf(env, args.project as string | undefined);
      const decision = await env.repos().projects.recordDecision(project.id, {
        title: args.title as string,
        decision: args.decision as string,
        ...(args.context ? { context: args.context as string } : {}),
        ...(args.consequences ? { consequences: args.consequences as string } : {}),
        ...(args.supersedes ? { supersedesId: args.supersedes as string } : {}),
      });
      return {
        value: { id: decision.id, title: decision.title, decidedAt: decision.decidedAt },
        entityType: 'decision',
        entityId: decision.id,
        after: `decision ${quote(decision.title)} in ${project.slug}`,
      };
    },
  },
  {
    name: 'update_project',
    title: 'Update project',
    description:
      'Updates a project’s phase, next action or objective (an empty string clears it), and/or moves its state. Completing a project needs every milestone done; archiving is the owner’s decision.',
    write: true,
    input: z.strictObject({
      project: projectArg(),
      phase: z.optional(z.string().check(z.maxLength(200))),
      nextAction: z.optional(z.string().check(z.maxLength(500))),
      objective: z.optional(z.string().check(z.maxLength(2000))),
      state: z.optional(z.enum(PROJECT_STATES.filter((s) => s !== 'archived'))),
    }),
    async run(env, args) {
      const project = await projectOf(env, args.project as string | undefined);
      const fields = (['phase', 'nextAction', 'objective'] as const).filter(
        (f) => args[f] !== undefined,
      );
      if (!fields.length && args.state === undefined) {
        throw new Refusal('Nothing to change: give a phase, nextAction, objective or state');
      }
      const repos = env.repos();
      const store = env.store;
      const updated = await store.transaction<Project>(
        'rw',
        STORE_NAMES.map((name) => store[name]),
        async () => {
          let current = project;
          if (fields.length) {
            current = await repos.projects.update(
              project.id,
              Object.fromEntries(fields.map((f) => [f, (args[f] as string) || null])),
            );
          }
          if (args.state !== undefined && args.state !== current.state) {
            current = await repos.projects.setState(
              project.id,
              args.state as Exclude<Project['state'], 'archived'>,
            );
          }
          return current;
        },
      );
      const describe = (p: Project) =>
        [
          ...fields.map((f) => `${f}: ${p[f] ? quote(p[f]) : '(none)'}`),
          ...(args.state !== undefined ? [`state: ${p.state}`] : []),
        ].join('; ');
      return {
        value: {
          id: updated.id,
          state: updated.state,
          phase: updated.phase ?? null,
          nextAction: updated.nextAction ?? null,
          objective: updated.objective ?? null,
        },
        entityType: 'project',
        entityId: project.id,
        before: describe(project),
        after: describe(updated),
      };
    },
  },
  {
    name: 'complete_task',
    title: 'Complete task',
    description: 'Marks an open task done.',
    write: true,
    input: z.strictObject({ task: id() }),
    async run(env, args) {
      const data = await env.data();
      const task = data.tasks.find((t) => t.id === args.task);
      const ids = new Set((await visibleProjects(env)).map((p) => p.id));
      const visible =
        task &&
        (task.projectId !== undefined ? ids.has(task.projectId) : env.ctx.grant.scope === 'global');
      if (!task || !visible)
        throw new Refusal(`No task ${String(args.task)} in this connection’s scope`);
      const done = await env.repos().tasks.complete(task.id);
      return {
        value: {
          id: done.id,
          title: done.title,
          status: done.status,
          completedAt: done.completedAt,
        },
        entityType: 'task',
        entityId: task.id,
        before: `${quote(task.title)}: ${task.status}`,
        after: `${quote(done.title)}: ${done.status}`,
      };
    },
  },
  {
    name: 'complete_milestone',
    title: 'Complete milestone',
    description: 'Marks a milestone complete, which moves the project’s completion.',
    write: true,
    input: z.strictObject({ milestone: id() }),
    async run(env, args) {
      const data = await env.data();
      const milestone = data.milestones.find((m) => m.id === args.milestone);
      const ids = new Set((await visibleProjects(env)).map((p) => p.id));
      if (!milestone || !ids.has(milestone.projectId)) {
        throw new Refusal(`No milestone ${String(args.milestone)} in this connection’s scope`);
      }
      const done = await env.repos().projects.completeMilestone(milestone.id);
      return {
        value: { id: done.id, title: done.title, completedAt: done.completedAt },
        entityType: 'milestone',
        entityId: done.id,
        before: `${quote(milestone.title)}: ${milestone.completedAt ? 'complete' : 'open'}`,
        after: `${quote(done.title)}: complete`,
      };
    },
  },
  {
    name: 'request_approval',
    title: 'Request approval',
    description:
      'Asks the owner to approve something. It appears in the project’s Needs approval lane until the owner resolves it.',
    write: true,
    input: z.strictObject({
      project: projectArg(),
      title: text(200),
      body: d(z.optional(text(10_000)), 'What exactly needs approving, and why.'),
      milestone: d(z.optional(id()), 'A milestone of the project it relates to.'),
    }),
    async run(env, args) {
      const project = await projectOf(env, args.project as string | undefined);
      const item = await env.repos().projects.addItem(project.id, {
        kind: 'approval',
        title: args.title as string,
        ...(args.body ? { body: args.body as string } : {}),
        ...(args.milestone ? { milestoneId: args.milestone as string } : {}),
      });
      return {
        value: { id: item.id, title: item.title, lane: item.lane },
        entityType: 'projectItem',
        entityId: item.id,
        after: `approval request ${quote(item.title)} in ${project.slug}`,
      };
    },
  },
  {
    name: 'resolve_approval',
    title: 'Resolve approval',
    description:
      'Resolves an open approval request. Only when the owner explicitly allowed this connection to resolve approvals.',
    write: true,
    input: z.strictObject({ item: id() }),
    async run(env, args) {
      if (!env.ctx.grant.allowResolveApprovals) {
        throw new Refusal('The owner hasn’t allowed this connection to resolve approvals');
      }
      const item = await itemOf(env, args.item as string);
      if (item.kind !== 'approval') throw new Refusal('That item isn’t an approval request');
      const resolved = await env.repos().projects.resolveItem(item.id);
      return {
        value: { id: resolved.id, title: resolved.title, lane: resolved.lane },
        entityType: 'projectItem',
        entityId: item.id,
        before: `${quote(item.title)}: ${item.lane}`,
        after: `${quote(resolved.title)}: resolved`,
      };
    },
  },
  {
    name: 'park_item',
    title: 'Park item',
    description:
      'Parks an open project item (not an open approval or blocker, which only the owner resolves).',
    write: true,
    input: z.strictObject({ item: id() }),
    async run(env, args) {
      const item = await itemOf(env, args.item as string);
      const parked = await env.repos().projects.moveItem(item.id, 'parked');
      return {
        value: { id: parked.id, title: parked.title, lane: parked.lane },
        entityType: 'projectItem',
        entityId: item.id,
        before: `${quote(item.title)}: ${item.lane}`,
        after: `${quote(parked.title)}: parked`,
      };
    },
  },
  {
    name: 'resume_item',
    title: 'Resume item',
    description: 'Moves a parked item back to Next (default) or Working now.',
    write: true,
    input: z.strictObject({
      item: id(),
      lane: d(z.optional(z.enum(['next', 'working_now'])), 'Default next.'),
    }),
    async run(env, args) {
      const item = await itemOf(env, args.item as string);
      if (item.lane !== 'parked') throw new Refusal('That item isn’t parked');
      const lane = (args.lane as 'next' | 'working_now' | undefined) ?? 'next';
      const moved = await env.repos().projects.moveItem(item.id, lane);
      return {
        value: { id: moved.id, title: moved.title, lane: moved.lane },
        entityType: 'projectItem',
        entityId: item.id,
        before: `${quote(item.title)}: parked`,
        after: `${quote(moved.title)}: ${moved.lane}`,
      };
    },
  },
  {
    name: 'log_ai_session',
    title: 'Log AI session',
    description:
      'Records what this session actually did: a factual summary, result, next action, files, commits and handoff. Your client identity comes from this connection. Never include hidden reasoning.',
    write: true,
    input: z.strictObject({
      project: projectArg(),
      summary: d(text(4000), 'What was done, factually.'),
      startedAt: d(z.optional(text(40)), 'ISO 8601. Defaults to when this MCP session began.'),
      endedAt: d(z.optional(text(40)), 'ISO 8601. Defaults to now.'),
      task: d(z.optional(id()), 'A task of the project this session worked on.'),
      result: z.optional(text(4000)),
      nextAction: z.optional(text(1000)),
      filesTouched: z.optional(z.array(text(500)).check(z.maxLength(200))),
      commits: z.optional(z.array(text(200)).check(z.maxLength(100))),
      handoff: d(z.optional(text(10_000)), 'Notes for whoever picks this up next.'),
    }),
    async run(env, args) {
      const { grant } = env.ctx;
      const project =
        args.project !== undefined || grant.scope === 'project'
          ? await projectOf(env, args.project as string | undefined)
          : undefined;
      if (args.task !== undefined && !project) throw new Refusal('A task needs its project');
      const endedAt = args.endedAt
        ? instant(env, args.endedAt as string, 'endedAt')
        : toTimestamp(env.at);
      const startedAt = args.startedAt
        ? instant(env, args.startedAt as string, 'startedAt')
        : (env.ctx.sessionStartedAt ?? endedAt);
      const session = await env.repos().aiSessions.record({
        client: grant.label,
        scope: project ? 'project' : grant.scope,
        ...(project ? { projectId: project.id } : {}),
        startedAt,
        endedAt,
        summary: args.summary as string,
        ...(args.task ? { taskId: args.task as string } : {}),
        ...(args.result ? { result: args.result as string } : {}),
        ...(args.nextAction ? { nextAction: args.nextAction as string } : {}),
        ...(args.filesTouched ? { filesTouched: args.filesTouched as string[] } : {}),
        ...(args.commits ? { commits: args.commits as string[] } : {}),
        ...(args.handoff ? { handoff: args.handoff as string } : {}),
      });
      return {
        value: { id: session.id, startedAt: session.startedAt, endedAt: session.endedAt },
        entityType: 'aiSession',
        entityId: session.id,
        after: `session ${quote(session.summary)}`,
      };
    },
  },
];

export const TOOLS: readonly Tool[] = [...readTools, ...writeTools];

/** Tools this grant may call (write tools only for write access). */
export function toolsFor(grant: Grant) {
  return TOOLS.filter(
    (t) =>
      (!t.write || grant.access === 'write') &&
      (t.name !== 'resolve_approval' || grant.allowResolveApprovals),
  ).map((t) => {
    const inputSchema = z.toJSONSchema(t.input) as Record<string, unknown>;
    delete inputSchema.$schema; // plain JSON Schema for every client
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema,
      annotations: {
        readOnlyHint: !t.write,
        destructiveHint: false,
        openWorldHint: false,
      },
    };
  });
}

/** Runs one tool call for a grant, and audits it whatever happens. */
export async function callTool(
  services: ToolServices,
  ctx: CallContext,
  name: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  const { grant } = ctx;
  const tool = TOOLS.find((t) => t.name === name);
  const at = services.now();
  const audit = (
    result: 'ok' | 'refused' | 'error',
    extra: Partial<Outcome> & { message?: string } = {},
  ) =>
    services.grants.audit({
      grantId: grant.id,
      client: grant.label,
      clientKind: grant.clientKind,
      scope: scopeName(grant),
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
      operation: name.slice(0, 100),
      ...(extra.entityType ? { entityType: extra.entityType } : {}),
      ...(extra.entityId ? { entityId: extra.entityId } : {}),
      ...(extra.before ? { before: extra.before.slice(0, 500) } : {}),
      ...(extra.after ? { after: extra.after.slice(0, 500) } : {}),
      result,
      ...(extra.message ? { message: extra.message.slice(0, 500) } : {}),
    });
  const fail = (message: string): ToolResult => ({
    content: [{ type: 'text', text: message }],
    isError: true,
  });

  if (!tool || !toolsFor(grant).some((t) => t.name === name)) {
    const message = !tool
      ? `Unknown tool ${name}`
      : tool.write && grant.access !== 'write'
        ? 'This connection is read-only'
        : 'The owner hasn’t allowed this connection to resolve approvals';
    audit('refused', { message });
    return fail(message);
  }
  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const message = `Invalid arguments: ${parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`)
      .join('; ')}`;
    audit('refused', { message });
    return fail(message);
  }

  let snapshot: Promise<BackupData> | undefined;
  const env: Env = {
    ...services,
    ctx,
    at,
    data: () => (snapshot ??= readAll(services)),
    repos: () =>
      createRepositories(services.store, {
        clock: services.now,
        watch: services.store.watch,
        source: 'ai-client',
        actor: grant.label,
      }),
  };
  try {
    const outcome = await tool.run(env, parsed.data as Args);
    audit('ok', outcome);
    const value = outcome.value;
    return {
      content: [
        { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
      ],
    };
  } catch (error) {
    const refused = error instanceof Refusal;
    const message = refused
      ? (error as Error).message
      : error instanceof Error && /Error$/.test(error.name) && error.name !== 'Error'
        ? error.message
        : 'Something went wrong in LOWTIDE';
    audit(refused ? 'refused' : 'error', { message });
    return fail(message);
  }
}

async function readAll(services: ToolServices): Promise<BackupData> {
  const repos = createRepositories(services.store, { watch: services.store.watch });
  return (await repos.backup.exportBackup()).data;
}
