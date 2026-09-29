import { AccessError, type Workspace } from './workspace.ts';

/*
 * The companion's MCP tools (ADR-055). Reads come from the exported
 * workspace. Writes only add new files to the workspace (a note, an AI
 * session record) and are audit-logged. Tools that would change LOWTIDE's
 * own records are listed but not available yet: LOWTIDE's canonical data
 * lives in the browser (ADR-040, stage 1), so they return an error and
 * change nothing.
 */

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; items?: { type: string } }>;
    required?: string[];
  };
  run?: (ws: Workspace, args: Record<string, unknown>) => ToolResult;
}

const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] });
const fail = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }], isError: true });

const PROJECT = {
  type: 'string',
  description: 'Project slug. Optional (and must match) when the connection is project-scoped.',
};

function str(args: Record<string, unknown>, key: string, required = true): string | undefined {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim())
    throw new AccessError(`"${key}" must be a non-empty string`);
  return value;
}

function slugOf(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'untitled'
  );
}

interface Summary {
  name: string;
  state: string;
  phase?: string;
  objective?: string;
  nextAction?: string;
  completionPercent: number | null;
  lanes: Record<string, { title: string; waitingOn?: string }[]>;
  recentActivity: { at: string; type: string; title?: string }[];
  minutesThisWeek: number;
}

function summaryOf(ws: Workspace, project: string | undefined): Summary {
  const { dir } = ws.projectDir(project);
  return JSON.parse(ws.read(`${dir}/.lowtide/summary.json`)) as Summary;
}

function laneText(items: { title: string; waitingOn?: string }[] | undefined): string {
  return items?.length
    ? items
        .map((i) => `- ${i.title}${i.waitingOn ? ` (waiting on ${i.waitingOn})` : ''}`)
        .join('\n')
    : 'None.';
}

const pending =
  (what: string): ToolDef['run'] =>
  (ws, args) => {
    ws.audit({
      tool: what,
      refused: 'not available until the companion owns storage',
      args: Object.keys(args),
    });
    return fail(
      `${what} isn’t available yet. LOWTIDE’s records live in the browser app (ADR-040, stage 1), so the companion can’t change them. Nothing was changed. Ask the owner to do it in LOWTIDE, or write a note with create_note.`,
    );
  };

export const TOOLS: ToolDef[] = [
  {
    name: 'get_context',
    description:
      'The project’s CONTEXT.md: objective, state, progress, lanes, decisions, activity.',
    inputSchema: { type: 'object', properties: { project: PROJECT } },
    run: (ws, args) =>
      text(ws.read(`${ws.projectDir(str(args, 'project', false)).dir}/CONTEXT.md`)),
  },
  {
    name: 'get_project',
    description: 'The project’s PROJECT.md: state, milestones and board.',
    inputSchema: { type: 'object', properties: { project: PROJECT } },
    run: (ws, args) =>
      text(ws.read(`${ws.projectDir(str(args, 'project', false)).dir}/PROJECT.md`)),
  },
  {
    name: 'get_project_summary',
    description: 'A short structured summary: state, phase, completion, next action, lane counts.',
    inputSchema: { type: 'object', properties: { project: PROJECT } },
    run: (ws, args) => {
      const s = summaryOf(ws, str(args, 'project', false));
      const counts = Object.entries(s.lanes)
        .map(([lane, items]) => `${lane}: ${items.length}`)
        .join(', ');
      return text(
        [
          `${s.name} (${s.state})${s.phase ? `, phase ${s.phase}` : ''}`,
          `Completion: ${s.completionPercent === null ? 'no milestones yet' : `${s.completionPercent}% of milestone weight`}`,
          ...(s.objective ? [`Objective: ${s.objective}`] : []),
          ...(s.nextAction ? [`Next action: ${s.nextAction}`] : []),
          `Lanes: ${counts}`,
          `Work this week: ${s.minutesThisWeek} min`,
        ].join('\n'),
      );
    },
  },
  {
    name: 'get_recent_activity',
    description: 'Recent project activity from LOWTIDE’s timeline (newest first).',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        limit: { type: 'number', description: 'At most this many (default 10).' },
      },
    },
    run: (ws, args) => {
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(50, args.limit)) : 10;
      const s = summaryOf(ws, str(args, 'project', false));
      const lines = s.recentActivity
        .slice(0, limit)
        .map(
          (a) =>
            `- ${a.at.slice(0, 16).replace('T', ' ')} ${a.type}${a.title ? `: ${a.title}` : ''}`,
        );
      return text(lines.length ? lines.join('\n') : 'No activity recorded yet.');
    },
  },
  {
    name: 'get_waiting',
    description: 'What the project is waiting on.',
    inputSchema: { type: 'object', properties: { project: PROJECT } },
    run: (ws, args) => text(laneText(summaryOf(ws, str(args, 'project', false)).lanes.waiting)),
  },
  {
    name: 'get_approval_requests',
    description: 'What needs the owner’s approval.',
    inputSchema: { type: 'object', properties: { project: PROJECT } },
    run: (ws, args) =>
      text(laneText(summaryOf(ws, str(args, 'project', false)).lanes.needs_approval)),
  },
  {
    name: 'search_workspace',
    description: 'Case-insensitive search of the Markdown, JSON and text files in scope.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to find.' },
        limit: { type: 'number', description: 'At most this many matches (default 30).' },
      },
      required: ['query'],
    },
    run: (ws, args) => {
      const query = str(args, 'query')!.toLowerCase();
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(100, args.limit)) : 30;
      const hits: string[] = [];
      for (const path of ws.list()) {
        const lines = ws.read(path).split('\n');
        lines.forEach((line, i) => {
          if (hits.length < limit && line.toLowerCase().includes(query)) {
            hits.push(`${path}:${i + 1}: ${line.trim().slice(0, 200)}`);
          }
        });
        if (hits.length >= limit) break;
      }
      return text(hits.length ? hits.join('\n') : 'No matches.');
    },
  },
  {
    name: 'get_document',
    description: 'Reads one file in scope, by its workspace-relative path.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'e.g. projects/engine/docs/notes/…' } },
      required: ['path'],
    },
    run: (ws, args) => text(ws.read(str(args, 'path')!)),
  },
  {
    name: 'create_note',
    description:
      'Adds a new Markdown note to the project’s docs/notes folder in the workspace. Never overwrites; audit-logged.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        title: { type: 'string', description: 'Note title.' },
        body: { type: 'string', description: 'Markdown body (up to 64 KB).' },
      },
      required: ['title', 'body'],
    },
    run: (ws, args) => {
      const { slug, dir } = ws.projectDir(str(args, 'project', false));
      const title = str(args, 'title')!.trim();
      const body = str(args, 'body')!;
      const base = `${dir}/docs/notes/${ws.today()}-${slugOf(title)}`;
      let path = `${base}.md`;
      for (let n = 2; ; n++) {
        try {
          ws.create(path, `# ${title}\n\n${body}\n`, { tool: 'create_note', project: slug });
          break;
        } catch (e) {
          if (!(e instanceof AccessError) || !/overwrite/.test(e.message) || n > 50) throw e;
          path = `${base}-${n}.md`;
        }
      }
      return text(`Created ${path}.`);
    },
  },
  {
    name: 'log_ai_session',
    description:
      'Records this AI session in the project’s ai/sessions folder of the workspace (audit-logged). It appears in LOWTIDE itself once importing workspace sessions is built.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT,
        client: { type: 'string', description: 'Your client name, e.g. claude-code.' },
        summary: { type: 'string', description: 'What was done.' },
        filesTouched: { type: 'array', items: { type: 'string' }, description: 'Paths changed.' },
      },
      required: ['client', 'summary'],
    },
    run: (ws, args) => {
      const { slug, dir } = ws.projectDir(str(args, 'project', false));
      const client = str(args, 'client')!.trim();
      const summary = str(args, 'summary')!;
      const files = Array.isArray(args.filesTouched)
        ? args.filesTouched.filter((f): f is string => typeof f === 'string').slice(0, 200)
        : [];
      const at = new Date().toISOString();
      const path = `${dir}/ai/sessions/${ws.today()}-${slugOf(client)}-${Math.random().toString(36).slice(2, 8)}.md`;
      ws.create(
        path,
        [
          `# AI session: ${client}`,
          '',
          `- Reported: ${at}`,
          `- Project: ${slug}`,
          '',
          summary,
          '',
          ...(files.length ? ['## Files touched', '', ...files.map((f) => `- ${f}`), ''] : []),
        ].join('\n'),
        { tool: 'log_ai_session', project: slug, client },
      );
      return text(`Recorded at ${path}. (Pending: LOWTIDE doesn't import workspace sessions yet.)`);
    },
  },
  {
    name: 'record_decision',
    description: '[Not available yet] Record a decision in LOWTIDE. Use create_note meanwhile.',
    inputSchema: { type: 'object', properties: { project: PROJECT } },
    run: pending('record_decision'),
  },
  {
    name: 'update_project',
    description: '[Not available yet] Change a project’s state or details in LOWTIDE.',
    inputSchema: { type: 'object', properties: { project: PROJECT } },
    run: pending('update_project'),
  },
  {
    name: 'complete_task',
    description: '[Not available yet] Complete a task in LOWTIDE.',
    inputSchema: { type: 'object', properties: { project: PROJECT } },
    run: pending('complete_task'),
  },
  {
    name: 'request_approval',
    description: '[Not available yet] Ask the owner for approval in LOWTIDE.',
    inputSchema: { type: 'object', properties: { project: PROJECT } },
    run: pending('request_approval'),
  },
  {
    name: 'park_item',
    description: '[Not available yet] Park a board item in LOWTIDE.',
    inputSchema: { type: 'object', properties: { project: PROJECT } },
    run: pending('park_item'),
  },
];

export function callTool(ws: Workspace, name: string, args: Record<string, unknown>): ToolResult {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool?.run) return fail(`Unknown tool ${name}`);
  try {
    return tool.run(ws, args);
  } catch (e) {
    if (e instanceof AccessError || e instanceof SyntaxError) return fail(e.message);
    throw e;
  }
}
