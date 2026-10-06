import * as z from 'zod/mini';
import { buildSearch, searchDocs } from '../../../src/features/space/model';
import {
  CAPABILITIES,
  CAPABILITY_LABEL,
  SENSITIVE,
  type Capability,
} from '../../../src/db/companion/wire';
import { SCHEMA_VERSION } from '../../../src/db/schema';
import { LOWTIDE_VERSION } from '../../../src/lib/version';
import { MATRIX } from './matrix';
import {
  limitArg,
  norm,
  slugOf,
  spaceView,
  taskVisible,
  text,
  visibleProjects,
  type Tool,
} from './kit';

/*
 * Self-description (v2.1): what this connection can do, a search across
 * everything it can see, and the changes it made recently. So an AI client
 * never has to guess its capabilities.
 */

const CONSTRAINTS = [
  'Protected Time is never available to any AI client.',
  'Nothing is ever fabricated: no work sessions, completions, history or progress you didn’t verify. Completion times are never back-dated.',
  'Project progress comes only from milestones (completed weight over total weight).',
  'Decisions are immutable: change one by superseding it (supersede_decision).',
  'Nothing is deleted over MCP: projects, tasks, pages, folders and hackathons are archived and can be restored.',
  'Creating is idempotent: if a project, task, milestone, hackathon, folder or database with that name is already there, it is returned instead of a duplicate.',
  'Refer to things by id, exact title or path; a unique close match also works. Ambiguous names are refused with the candidates.',
  'Structural tools accept dryRun: true to preview. For broad reorganisations, preview first and show the owner the plan.',
  'SPACE writes respect page revisions: pass baseRevision and a write against an older revision is refused instead of overwriting.',
  'Use structured records (tasks, milestones, decisions, blockers) for project state, and SPACE for documents that reference them.',
  'Every call is audited; every change is shown to the owner, who can undo it.',
  'End a working session with document_project_session (or log_ai_session): facts only, never hidden reasoning.',
];

export const metaTools: Tool[] = [
  {
    name: 'get_lowtide_capabilities',
    title: 'Get LOWTIDE capabilities',
    capability: [],
    action: 'read capabilities',
    description:
      'Start here: what this connection may read and change (its scope, permissions and private categories), every LOWTIDE record type and the tools that read, create, update, move or archive it (or why it is restricted), the rules to follow, and where the Claude Operating Guide is.',
    write: false,
    input: z.strictObject({}),
    async run(env) {
      const { grant } = env.ctx;
      const { TOOLS, refusalFor } = await import('../tools');
      const usable = new Set(
        TOOLS.filter((t) => refusalFor(grant, t) === undefined).map((t) => t.name),
      );
      const data = await env.data();
      const project = grant.projectId
        ? data.projects.find((p) => p.id === grant.projectId)
        : undefined;
      const guide = data.spaceNodes.find((n) => n.key === 'lowtide:guide');
      // Compact: an operation's tools when this grant can use them, otherwise why not.
      const cell = (c: unknown) => {
        const tools = typeof c === 'string' ? [c] : Array.isArray(c) ? (c as string[]) : undefined;
        if (!tools) return (c as { restricted: string }).restricted;
        return tools.some((x) => usable.has(x.split(' ')[0]!))
          ? tools.join(', ')
          : 'not with this connection';
      };
      return {
        value: {
          lowtide: {
            version: LOWTIDE_VERSION,
            schemaVersion: SCHEMA_VERSION,
            mcpServer: { name: 'lowtide', version: LOWTIDE_VERSION },
          },
          connection: {
            name: grant.label,
            client: grant.clientKind,
            grant: grant.id,
            scope:
              grant.scope === 'project'
                ? `one project: ${project?.name ?? grant.projectId}`
                : grant.scope === 'workspace'
                  ? 'every project and hackathon, and SPACE outside College and Personal'
                  : 'everything except Protected Time',
            preset: grant.preset,
            allowed: CAPABILITIES.filter((c: Capability) => grant.capabilities.includes(c)).map(
              (c) => `${c} (${CAPABILITY_LABEL[c]})`,
            ),
            notAllowed: CAPABILITIES.filter((c: Capability) => !grant.capabilities.includes(c)),
            privateCategories: SENSITIVE.filter(
              (s) => grant.scope === 'global' && grant.sensitive.includes(s),
            ),
            tools: usable.size,
          },
          entities: MATRIX.map((row) => ({
            entity: row.entity,
            ...Object.fromEntries(Object.entries(row.mcp).map(([op, c]) => [op, cell(c)])),
          })),
          rules: CONSTRAINTS,
          refusals:
            'A refusal says what was refused, why, and the permission it needs: “Cannot create Project. Grant lacks projects.create.”',
          guide: guide
            ? {
                page: guide.id,
                path: 'LOWTIDE / AI / Claude Operating Guide',
                read: 'get_space_page',
              }
            : {
                note: 'The Claude Operating Guide appears in SPACE once the companion has started.',
              },
        },
      };
    },
  },
  {
    name: 'search_lowtide',
    title: 'Search LOWTIDE',
    capability: [],
    action: 'search LOWTIDE',
    description:
      'One search across everything this connection may read: projects, tasks, milestones, decisions, hackathons, SPACE pages, database rows and their provenance. Each hit has its type, location, project and an excerpt.',
    write: false,
    input: z.strictObject({ query: text(200).check(z.minLength(2)), limit: limitArg(30) }),
    async run(env, args) {
      const data = await env.data();
      const words = norm(args.query as string)
        .split(' ')
        .filter(Boolean);
      const hit = (...texts: (string | undefined)[]) => {
        const hay = norm(texts.filter(Boolean).join(' '));
        return words.every((w) => hay.includes(w));
      };
      const excerpt = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').slice(0, 160);
      const out: Record<string, unknown>[] = [];
      const projects = env.can('projects.read') ? await visibleProjects(env) : [];
      const visible = new Set(projects.map((p) => p.id));
      for (const p of projects)
        if (hit(p.name, p.description, p.objective, p.nextAction))
          out.push({
            type: 'project',
            id: p.id,
            title: p.name,
            location: `Projects / ${p.name}`,
            project: p.slug,
            excerpt: excerpt(p.description ?? p.objective),
          });
      if (env.can('projects.read'))
        for (const m of data.milestones)
          if (visible.has(m.projectId) && hit(m.title, m.notes))
            out.push({
              type: 'milestone',
              id: m.id,
              title: m.title,
              project: slugOf(data, m.projectId),
              excerpt: excerpt(m.notes),
            });
      if (env.can('tasks.read'))
        for (const t of data.tasks)
          if (hit(t.title, t.notes) && (await taskVisible(env, t)))
            out.push({
              type: 'task',
              id: t.id,
              title: t.title,
              status: t.status,
              ...(t.projectId ? { project: slugOf(data, t.projectId) } : {}),
              excerpt: excerpt(t.notes),
            });
      if (env.can('decisions.read'))
        for (const x of data.decisions)
          if (visible.has(x.projectId) && hit(x.title, x.decision, x.context))
            out.push({
              type: 'decision',
              id: x.id,
              title: x.title,
              project: slugOf(data, x.projectId),
              excerpt: excerpt(x.decision),
            });
      if (env.can('hackathons.read') && env.ctx.grant.scope !== 'project')
        for (const h of data.hackathons)
          if (hit(h.name, h.problemStatement, h.notes, h.nextAction))
            out.push({
              type: 'hackathon',
              id: h.id,
              title: h.name,
              excerpt: excerpt(h.problemStatement ?? h.nextAction),
            });
      if (env.can('space.read')) {
        const view = await spaceView(env);
        const docs = buildSearch(view.nodes, { include: (n) => view.visible(n) });
        for (const h of searchDocs(docs, args.query as string, 50))
          out.push({
            type: h.kind === 'table' ? 'database' : h.kind === 'section' ? 'folder' : 'page',
            id: h.id,
            title: h.title,
            location: h.location,
            excerpt: h.excerpt,
          });
      }
      return { value: out.slice(0, (args.limit as number | undefined) ?? 30) };
    },
  },
  {
    name: 'get_my_changes',
    title: 'Get my recent changes',
    capability: [],
    action: 'read this connection’s changes',
    description:
      'What this connection changed recently, newest first, as the owner sees it (and whether the owner undid it).',
    write: false,
    input: z.strictObject({ limit: limitArg(50) }),
    async run(env, args) {
      const limit = (args.limit as number | undefined) ?? 50;
      return {
        value: env.grants
          .changes(500)
          .filter((c) => c.grantId === env.ctx.grant.id)
          .slice(0, limit)
          .map((c) => ({
            at: c.at,
            summary: c.summary,
            ...(c.revertedAt ? { undoneByOwner: c.revertedAt } : {}),
          })),
      };
    },
  },
];
