import * as z from 'zod/mini';
import {
  buildContextPack,
  renderContextMarkdown,
  type ContextScope,
} from '../../../src/features/context/pack';
import { projectRoot, projectSummaryJson } from '../../../src/features/context/workspace';
import { summariseProject } from '../../../src/features/projects/summary';
import { buildSearch, searchDocs } from '../../../src/features/space/model';
import { toLocalDate, toTimestamp } from '../../../src/lib/time';
import { NOTE_KINDS, type LinkableType, type SpaceCellValue } from '../../../src/types/domain';

import {
  Refusal,
  d,
  text,
  id,
  projectArg,
  limitArg,
  isPrivate,
  projectOf,
  visibleProjects,
  slugOf,
  granted,
  workspaceScope,
  instant,
  quote,
  spaceView,
  pathText,
  titleEq,
  resolvePage,
  pageJson,
  checkMarkdown,
  MAINTAINED,
  cellValue,
  pageArg,
  ensurePath,
  type Tool,
  op,
} from './kit';

/* -------------------------------- reads -------------------------------- */

export const readTools: Tool[] = [
  {
    name: 'get_context',
    title: 'Get context',
    capability: 'projects.read',
    action: 'read context',
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
    capability: 'projects.read',
    action: 'read a project',
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
    capability: 'projects.read',
    action: 'read a project summary',
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
    capability: 'projects.read',
    action: 'read recent activity',
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
    capability: 'projects.read',
    action: 'read waiting items',
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
    capability: 'projects.read',
    action: 'read approval requests',
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
    capability: 'projects.read',
    action: 'read parked items',
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
    capability: 'decisions.read',
    action: 'read decisions',
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
    capability: 'tasks.read',
    action: 'read tasks',
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
    capability: 'projects.read',
    action: 'read milestones',
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
    capability: 'projects.read',
    action: 'search the workspace',
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
    capability: 'projects.read',
    action: 'read a workspace document',
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

export const writeTools: Tool[] = [
  {
    name: 'create_note',
    title: 'Create note',
    capability: 'sessions.log',
    action: 'create a note',
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
        changes: [
          {
            summary: `Wrote a ${note.kind} for ${project.name}: “${note.title}”`,
            entityType: 'note',
            entityId: note.id,
          },
        ],
      };
    },
  },
  {
    name: 'log_ai_session',
    title: 'Log AI session',
    capability: 'sessions.log',
    action: 'log an AI session',
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
        changes: [
          {
            summary: `Logged a session: ${quote(session.summary, 120)}`,
            entityType: 'aiSession',
            entityId: session.id,
          },
        ],
      };
    },
  },
];

export const spaceReadTools: Tool[] = [
  {
    name: 'get_space_tree',
    title: 'Get SPACE tree',
    capability: 'space.read',
    action: 'read the SPACE tree',
    description:
      'The SPACE hierarchy this connection can see: sections, pages and tables with their ids, a few levels deep. A project-scoped connection sees its project’s folder.',
    write: false,
    input: z.strictObject({
      under: d(z.optional(text(2000)), 'Start below this page (id or path). Default: the top.'),
      depth: d(
        z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(8))),
        'Levels to include. Default 3.',
      ),
      includeArchived: d(z.optional(z.boolean()), 'Include archived pages.'),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const start = args.under ? resolvePage(view, args.under as string) : view.home;
      if (env.ctx.grant.scope === 'project' && !start) {
        return {
          value: {
            tree: [],
            note: 'This project has no SPACE pages yet. create_space_page makes its folder.',
          },
        };
      }
      const depth = (args.depth as number | undefined) ?? 3;
      const walk = (parent: string, level: number): unknown[] =>
        (view.children.get(parent) ?? [])
          .filter((n) => view.visible(n) && (args.includeArchived === true || !n.archived))
          .map((n) => {
            const kids =
              view.children.get(n.id)?.filter((c) => view.visible(c) && !c.archived) ?? [];
            return {
              id: n.id,
              title: n.title,
              kind: n.kind,
              ...(n.archived ? { archived: true } : {}),
              ...(kids.length && level >= depth ? { more: kids.length } : {}),
              ...(kids.length && level < depth ? { children: walk(n.id, level + 1) } : {}),
            };
          });
      return {
        value: start
          ? {
              root: { id: start.id, title: start.title, path: pathText(view, start.id) },
              tree: walk(start.id, 1),
            }
          : { tree: walk('', 1) },
      };
    },
  },
  {
    name: 'get_space_page',
    title: 'Get SPACE page',
    capability: 'space.read',
    action: 'read a SPACE page',
    description:
      'One SPACE page in full: its content as Markdown and as blocks (with ids for update_space_block), a table’s columns and rows, links, subpages, revision and source.',
    write: false,
    input: z.strictObject({ page: pageArg() }),
    async run(env, args) {
      const view = await spaceView(env);
      const node = resolvePage(view, args.page as string);
      const data = await env.data();
      const sources = data.sourceRecords.filter(
        (s) => s.entityType === 'spaceNode' && s.entityId === node.id,
      );
      return { entityType: 'spaceNode', entityId: node.id, value: pageJson(view, node, sources) };
    },
  },
  {
    name: 'search_space',
    title: 'Search SPACE',
    capability: 'space.read',
    action: 'search SPACE',
    description:
      'Find SPACE pages and tables by title, content, table cells or where they came from. Returns ids, locations and a short excerpt.',
    write: false,
    input: z.strictObject({
      query: d(text(200).check(z.minLength(2)), 'Words to find (all must match).'),
      limit: limitArg(20),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const docs = buildSearch(view.nodes, { include: (n) => view.visible(n) });
      return {
        value: searchDocs(docs, args.query as string, (args.limit as number | undefined) ?? 20).map(
          (h) => ({
            id: h.id,
            title: h.title,
            kind: h.kind,
            location: h.location,
            excerpt: h.excerpt,
            ...(h.archived ? { archived: true } : {}),
          }),
        ),
      };
    },
  },
];

export const spaceWriteTools: Tool[] = [
  {
    name: 'create_space_page',
    title: 'Create SPACE page',
    capability: 'space.write',
    action: 'create a SPACE page',
    description:
      'Save something in SPACE at a path of titles, making any missing pages along it (a project’s standard sections such as Architecture or Planning are made in place). If the last page already exists, the Markdown is added to its end instead. Example path: "Projects / Engine / Architecture / Storage".',
    write: true,
    input: z.strictObject({
      path: d(
        text(2000),
        'Where it goes: titles separated by " / ". A project-scoped connection may start below its project.',
      ),
      markdown: d(
        z.optional(z.string().check(z.maxLength(200_000))),
        'The content, as Markdown (headings, lists, checklists, quotes, code).',
      ),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const parts = (args.path as string)
        .split('/')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length === 0) throw new Refusal('Give a path');
      const leafTitle = parts.at(-1)!;
      const { node: parent, created } = await ensurePath(env, view, parts.slice(0, -1));
      const repos = env.repos();
      const existing = (view.children.get(parent.id) ?? []).find(
        (n) => !n.archived && titleEq(n.title, leafTitle),
      );
      const blocks = args.markdown ? checkMarkdown(args.markdown as string) : [];
      if (existing) {
        if (blocks.length) await repos.space.appendBlocks(existing.id, blocks);
        return {
          entityType: 'spaceNode',
          entityId: existing.id,
          value: { id: existing.id, created: created, appended: blocks.length > 0 },
          after: `added to ${quote(pathText(view, existing.id))}`,
          changes: blocks.length
            ? [
                {
                  summary: `Added to “${existing.title}”`,
                  entityType: 'spaceNode',
                  entityId: existing.id,
                },
              ]
            : [],
        };
      }
      const page = await repos.space.create({ parentId: parent.id, title: leafTitle, blocks });
      return {
        entityType: 'spaceNode',
        entityId: page.id,
        value: { id: page.id, created: [...created, parts.join(' / ')] },
        after: `page ${quote(parts.join(' / '))}`,
        changes: [
          {
            summary: `Created page ${parts.join(' / ')}`,
            entityType: 'spaceNode',
            entityId: page.id,
            undo: [op('space', 'archive', page.id)],
          },
        ],
      };
    },
  },
  {
    name: 'create_space_subpage',
    title: 'Create SPACE subpage',
    capability: 'space.write',
    action: 'create a SPACE subpage',
    description: 'A new page inside an existing page or section, with optional Markdown content.',
    write: true,
    input: z.strictObject({
      parent: pageArg(),
      title: d(text(300), 'The new page’s title.'),
      markdown: d(z.optional(z.string().check(z.maxLength(200_000))), 'Content as Markdown.'),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const parent = resolvePage(view, args.parent as string);
      if (parent.kind === 'table') throw new Refusal('A table can’t hold pages');
      const page = await env.repos().space.create({
        parentId: parent.id,
        title: args.title as string,
        blocks: args.markdown ? checkMarkdown(args.markdown as string) : [],
      });
      return {
        entityType: 'spaceNode',
        entityId: page.id,
        value: { id: page.id },
        after: `page ${quote(`${pathText(view, parent.id)} / ${page.title}`)}`,
        changes: [
          {
            summary: `Created page ${pathText(view, parent.id)} / ${page.title}`,
            entityType: 'spaceNode',
            entityId: page.id,
            undo: [op('space', 'archive', page.id)],
          },
        ],
      };
    },
  },
  {
    name: 'append_space_blocks',
    title: 'Append to SPACE page',
    capability: 'space.write',
    action: 'write to a SPACE page',
    description:
      'Add Markdown content to the end of a SPACE page. Imported content stays as it was.',
    write: true,
    input: z.strictObject({ page: pageArg(), markdown: d(text(200_000), 'Content as Markdown.') }),
    async run(env, args) {
      const view = await spaceView(env);
      const node = resolvePage(view, args.page as string);
      const saved = await env
        .repos()
        .space.appendBlocks(node.id, checkMarkdown(args.markdown as string));
      return {
        entityType: 'spaceNode',
        entityId: node.id,
        value: { id: node.id, revision: saved.revision },
        after: `added to ${quote(node.title)}`,
        changes: [
          { summary: `Added to “${node.title}”`, entityType: 'spaceNode', entityId: node.id },
        ],
      };
    },
  },
  {
    name: 'update_space_block',
    title: 'Update SPACE block',
    capability: 'space.write',
    action: 'change a SPACE block',
    description:
      'Change one block of a page (its text, type or checkbox), by the block id from get_space_page. Read-only imported blocks can’t be changed.',
    write: true,
    input: z.strictObject({
      page: pageArg(),
      block: d(text(200), 'The block id.'),
      text: d(z.optional(z.string().check(z.maxLength(200_000))), 'New text (inline Markdown).'),
      type: d(
        z.optional(
          z.enum([
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
          ]),
        ),
        'New block type.',
      ),
      checked: d(z.optional(z.boolean()), 'For a checklist item.'),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const node = resolvePage(view, args.page as string);
      const changes: Record<string, unknown> = {};
      for (const k of ['text', 'type', 'checked'] as const)
        if (args[k] !== undefined) changes[k] = args[k];
      if (Object.keys(changes).length === 0) throw new Refusal('Nothing to change');
      const saved = await env.repos().space.updateBlock(node.id, args.block as string, changes);
      return {
        entityType: 'spaceNode',
        entityId: node.id,
        value: { id: node.id, revision: saved.revision },
        after: `changed a block of ${quote(node.title)}`,
        changes: [
          {
            summary: `Changed a block of “${node.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
          },
        ],
      };
    },
  },
  {
    name: 'add_space_table_row',
    title: 'Add SPACE table row',
    capability: 'space.write',
    action: 'add a database row',
    description:
      'Add a row to a SPACE table, with cells by column name (values must fit each column’s type).',
    write: true,
    input: z.strictObject({
      table: pageArg(),
      cells: d(z.record(z.string(), z.unknown()), 'Column name → value.'),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const node = resolvePage(view, args.table as string);
      if (!node.table) throw new Refusal('That page isn’t a table');
      const cells: Record<string, SpaceCellValue> = {};
      for (const [name, value] of Object.entries(args.cells as Record<string, unknown>)) {
        const column = node.table.columns.find((c) => titleEq(c.name, name));
        if (!column) throw new Refusal(`No column “${name}”`);
        if (value === null || value === undefined || value === '') continue;
        cells[column.id] = cellValue(column, value);
      }
      await env.repos().space.addRow(node.id, cells);
      return {
        entityType: 'spaceNode',
        entityId: node.id,
        value: { id: node.id, rows: node.table.rows.length + 1 },
        after: `row in ${quote(node.title)}`,
        changes: [
          { summary: `Added a row to “${node.title}”`, entityType: 'spaceNode', entityId: node.id },
        ],
      };
    },
  },
  {
    name: 'link_space_entity',
    title: 'Link SPACE page',
    capability: 'space.write',
    action: 'link a SPACE page',
    description:
      'Link a SPACE page to a project, task, milestone, decision, hackathon or another page this connection can see.',
    write: true,
    input: z.strictObject({
      page: pageArg(),
      type: d(
        z.enum([
          'project',
          'task',
          'milestone',
          'decision',
          'hackathon',
          'spaceNode',
          'projectItem',
        ]),
        'What to link.',
      ),
      id: d(id(), 'Its id (a project may also be given by slug; a page by path).'),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const node = resolvePage(view, args.page as string);
      const data = await env.data();
      const projects = new Set((await visibleProjects(env)).map((p) => p.id));
      const type = args.type as LinkableType;
      let targetId = args.id as string;
      let label: string | undefined;
      const inScope = (projectId: string | undefined) =>
        projectId !== undefined && projects.has(projectId);
      switch (type) {
        case 'project': {
          const p = data.projects.find((x) => x.id === targetId || x.slug === targetId);
          if (!p || !inScope(p.id)) throw new Refusal('No such project in this connection’s scope');
          targetId = p.id;
          label = p.name;
          break;
        }
        case 'task': {
          const t = data.tasks.find((x) => x.id === targetId);
          if (!t || !inScope(t.projectId))
            throw new Refusal('No such task in this connection’s scope');
          label = t.title;
          break;
        }
        case 'milestone': {
          const m = data.milestones.find((x) => x.id === targetId);
          if (!m || !inScope(m.projectId))
            throw new Refusal('No such milestone in this connection’s scope');
          label = m.title;
          break;
        }
        case 'decision': {
          const x = data.decisions.find((y) => y.id === targetId);
          if (!x || !inScope(x.projectId))
            throw new Refusal('No such decision in this connection’s scope');
          label = x.title;
          break;
        }
        case 'projectItem': {
          const x = data.projectItems.find((y) => y.id === targetId);
          if (!x || !inScope(x.projectId))
            throw new Refusal('No such item in this connection’s scope');
          label = x.title;
          break;
        }
        case 'hackathon': {
          if (env.ctx.grant.scope === 'project')
            throw new Refusal('Hackathons are outside a project-scoped connection');
          const h = data.hackathons.find((x) => x.id === targetId);
          if (!h) throw new Refusal('No such hackathon');
          label = h.name;
          break;
        }
        default: {
          const target = resolvePage(view, targetId);
          targetId = target.id;
          label = target.title;
        }
      }
      await env.repos().space.addLink(node.id, { type, id: targetId, ...(label ? { label } : {}) });
      return {
        entityType: 'spaceNode',
        entityId: node.id,
        value: { id: node.id, linked: { type, id: targetId } },
        after: `linked ${quote(node.title)} to ${quote(label ?? targetId)}`,
        changes: [
          {
            summary: `Linked “${node.title}” to ${label ?? targetId}`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [
              op('space', 'removeLink', node.id, {
                type,
                id: targetId,
                ...(label ? { label } : {}),
              }),
            ],
          },
        ],
      };
    },
  },
  {
    name: 'archive_space_page',
    title: 'Archive SPACE page',
    capability: 'space.archive',
    action: 'archive a SPACE page',
    description: 'Archive a SPACE page (the owner can restore it; nothing is deleted).',
    write: true,
    input: z.strictObject({ page: pageArg() }),
    async run(env, args) {
      const view = await spaceView(env);
      const node = resolvePage(view, args.page as string);
      if (MAINTAINED(node))
        throw new Refusal('LOWTIDE maintains that section; it can’t be archived');
      await env.repos().space.archive(node.id);
      return {
        entityType: 'spaceNode',
        entityId: node.id,
        value: { id: node.id, archived: true },
        after: `archived ${quote(node.title)}`,
        changes: [
          {
            summary: `Archived “${node.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [op('space', 'restore', node.id)],
          },
        ],
      };
    },
  },
];
