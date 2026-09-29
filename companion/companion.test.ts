// @vitest-environment node
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { handleMessage } from './mcp.ts';
import { callTool } from './tools.ts';
import { AccessError, Workspace } from './workspace.ts';

/*
 * The companion against a real workspace folder on disk (a minimal export:
 * the same layout buildWorkspace writes, tested separately in src/test).
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'lowtide-ws-'));
  dirs.push(root);
  const files: Record<string, string> = {
    '.lowtide/manifest.json': JSON.stringify({
      format: 'lowtide-workspace',
      version: 1,
      projects: [
        { slug: 'engine', id: '1', name: 'Engine', archived: false },
        { slug: 'other', id: '2', name: 'Other', archived: false },
        { slug: 'old', id: '3', name: 'Old', archived: true },
      ],
    }),
    'README.md': '# LOWTIDE workspace',
    'projects/engine/PROJECT.md': '# Engine\n\n- State: Active',
    'projects/engine/CONTEXT.md': '# Context: PROJECT: Engine\n\nThe event bus is next.',
    'projects/engine/.lowtide/summary.json': JSON.stringify({
      name: 'Engine',
      state: 'active',
      phase: 'Build',
      completionPercent: 25,
      nextAction: 'Wire the bus',
      lanes: {
        working_now: [{ title: 'Loader' }],
        waiting: [{ title: 'Design review', waitingOn: 'a teammate' }],
        needs_approval: [{ title: 'Sign off API' }],
      },
      recentActivity: [
        { at: '2026-09-28T10:00:00.000Z', type: 'milestone.completed', title: 'Scope' },
      ],
      minutesThisWeek: 90,
    }),
    'projects/other/CONTEXT.md': '# Other project secret plan',
    'archive/projects/old/PROJECT.md': '# Old',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const NOW = () => new Date('2026-09-30T08:00:00.000Z');
const textOf = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join('\n');

describe('workspace access', () => {
  it('refuses a folder that is not an exported workspace, and an unknown project', () => {
    const empty = mkdtempSync(join(tmpdir(), 'lowtide-empty-'));
    dirs.push(empty);
    expect(() => new Workspace(empty, { kind: 'workspace' })).toThrow(AccessError);
    expect(() => new Workspace(workspace(), { kind: 'project', slug: 'nope' })).toThrow(
      /No project/,
    );
  });

  it('keeps a project-scoped connection inside its project', () => {
    const ws = new Workspace(workspace(), { kind: 'project', slug: 'engine' }, NOW);
    expect(textOf(callTool(ws, 'get_context', {}))).toContain('The event bus is next.');
    const other = callTool(ws, 'get_context', { project: 'other' });
    expect(other.isError).toBe(true);
    expect(textOf(other)).toMatch(/scoped to "engine"/);
    expect(callTool(ws, 'get_document', { path: 'projects/other/CONTEXT.md' }).isError).toBe(true);
    expect(callTool(ws, 'get_document', { path: 'README.md' }).isError).toBe(true);
    // Search never reaches other projects.
    expect(textOf(callTool(ws, 'search_workspace', { query: 'secret plan' }))).toBe('No matches.');
  });

  it('refuses paths outside the workspace, including through links', () => {
    const root = workspace();
    const outside = mkdtempSync(join(tmpdir(), 'lowtide-outside-'));
    dirs.push(outside);
    writeFileSync(join(outside, 'secret.md'), 'outside secret');
    symlinkSync(outside, join(root, 'projects', 'engine', 'docs-link'));
    const ws = new Workspace(root, { kind: 'workspace' }, NOW);
    for (const path of [
      '../etc/passwd',
      '/etc/passwd',
      'projects/../../x',
      'projects/engine/docs-link/secret.md',
    ]) {
      const result = callTool(ws, 'get_document', { path });
      expect(result.isError, path).toBe(true);
    }
    expect(textOf(callTool(ws, 'get_document', { path: 'projects/other/CONTEXT.md' }))).toContain(
      'secret plan',
    );
  });

  it('answers summary, waiting, approvals and recent activity from the summary file', () => {
    const ws = new Workspace(workspace(), { kind: 'project', slug: 'engine' }, NOW);
    expect(textOf(callTool(ws, 'get_project_summary', {}))).toContain(
      'Completion: 25% of milestone weight',
    );
    expect(textOf(callTool(ws, 'get_waiting', {}))).toBe('- Design review (waiting on a teammate)');
    expect(textOf(callTool(ws, 'get_approval_requests', {}))).toBe('- Sign off API');
    expect(textOf(callTool(ws, 'get_recent_activity', {}))).toContain('milestone.completed: Scope');
  });

  it('creates notes without overwriting, and audit-logs every write', () => {
    const root = workspace();
    const ws = new Workspace(root, { kind: 'project', slug: 'engine' }, NOW);
    const first = textOf(
      callTool(ws, 'create_note', { title: 'Bus design', body: 'Use a queue.' }),
    );
    const second = textOf(callTool(ws, 'create_note', { title: 'Bus design', body: 'Second.' }));
    expect(first).toBe('Created projects/engine/docs/notes/2026-09-30-bus-design.md.');
    expect(second).toBe('Created projects/engine/docs/notes/2026-09-30-bus-design-2.md.');
    expect(
      readFileSync(join(root, 'projects/engine/docs/notes/2026-09-30-bus-design.md'), 'utf8'),
    ).toBe('# Bus design\n\nUse a queue.\n');
    const logged = textOf(
      callTool(ws, 'log_ai_session', {
        client: 'claude-code',
        summary: 'Refactored',
        filesTouched: ['a.ts'],
      }),
    );
    expect(logged).toMatch(/^Recorded at projects\/engine\/ai\/sessions\/2026-09-30-claude-code-/);
    const audit = readFileSync(join(root, '.lowtide/audit.log'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(audit.map((a) => a.tool)).toEqual(['create_note', 'create_note', 'log_ai_session']);
    expect(audit[0]).toMatchObject({ at: '2026-09-30T08:00:00.000Z', project: 'engine' });
  });

  it('refuses LOWTIDE record changes it can’t make yet, changing nothing', () => {
    const root = workspace();
    const ws = new Workspace(root, { kind: 'project', slug: 'engine' }, NOW);
    for (const tool of [
      'record_decision',
      'update_project',
      'complete_task',
      'request_approval',
      'park_item',
    ]) {
      const result = callTool(ws, tool, {});
      expect(result.isError, tool).toBe(true);
      expect(textOf(result)).toMatch(/isn’t available yet.*Nothing was changed/);
    }
    expect(existsSync(join(root, 'projects/engine/docs'))).toBe(false);
  });
});

describe('MCP protocol', () => {
  it('initializes, lists tools and calls one', () => {
    const ws = new Workspace(workspace(), { kind: 'project', slug: 'engine' }, NOW);
    const init = handleMessage(ws, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't' } },
    });
    expect(init).toMatchObject({
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'lowtide' },
        capabilities: { tools: {} },
      },
    });
    expect(handleMessage(ws, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    const list = handleMessage(ws, { jsonrpc: '2.0', id: 2, method: 'tools/list' }) as {
      result: { tools: { name: string }[] };
    };
    expect(list.result.tools.map((t) => t.name)).toEqual([
      'get_context',
      'get_project',
      'get_project_summary',
      'get_recent_activity',
      'get_waiting',
      'get_approval_requests',
      'search_workspace',
      'get_document',
      'create_note',
      'log_ai_session',
      'record_decision',
      'update_project',
      'complete_task',
      'request_approval',
      'park_item',
    ]);
    const call = handleMessage(ws, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_waiting', arguments: {} },
    });
    expect(call).toMatchObject({ id: 3, result: { content: [{ type: 'text' }] } });
    expect(handleMessage(ws, { jsonrpc: '2.0', id: 4, method: 'resources/list' })).toMatchObject({
      error: { code: -32601 },
    });
  });

  it('runs as a real stdio process under Node (no network)', async () => {
    const root = workspace();
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, 'lowtide-mcp.ts'), '--workspace', root, '--project', 'engine'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const lines: string[] = [];
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split('\n');
      buffer = parts.pop()!;
      lines.push(...parts.filter(Boolean));
    });
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_context', arguments: {} },
    });
    const deadline = Date.now() + 10_000;
    while (lines.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    child.kill();
    const [init, context] = lines.map((l) => JSON.parse(l));
    expect(init.result.serverInfo.name).toBe('lowtide');
    expect(context.result.content[0].text).toContain('The event bus is next.');
  });

  it('refuses to start without a project or an explicit workspace scope', async () => {
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, 'lowtide-mcp.ts'), '--workspace', workspace()],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).toBe(2);
  });
});
