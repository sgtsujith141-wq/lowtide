// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepositories } from '../../src/db/repositories';
import type { AuditEntry, ClientStatus, Grant } from '../../src/db/companion/wire';
import { mcpClient, startTestCompanion, type TestCompanion } from './test-fixtures';

const running: TestCompanion[] = [];
afterEach(async () => {
  for (const t of running.splice(0)) await t.close();
});

async function start() {
  const t = await startTestCompanion();
  running.push(t);
  return t;
}

const READ_TOOLS = [
  'get_context',
  'get_project',
  'get_project_summary',
  'get_recent_activity',
  'get_waiting',
  'get_approval_requests',
  'get_parked',
  'get_decisions',
  'get_tasks',
  'get_milestones',
  'search_workspace',
  'get_document',
];
const WRITE_TOOLS = [
  'create_note',
  'record_decision',
  'update_project',
  'complete_task',
  'complete_milestone',
  'request_approval',
  'park_item',
  'resume_item',
  'log_ai_session',
];

async function audit(t: TestCompanion): Promise<AuditEntry[]> {
  return (await (await t.owner('/api/ai/audit?limit=500')).json()) as AuditEntry[];
}

function repos(t: TestCompanion) {
  return createRepositories(t.companion.store, { watch: t.companion.store.watch });
}

describe('MCP protocol (Streamable HTTP, JSON responses)', () => {
  it('negotiates, lists the tools each grant may use and keeps sessions per grant', async () => {
    const t = await start();
    const reader = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'project', access: 'read' }),
    );
    expect(reader.initialize.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'lowtide', version: expect.any(String) },
    });
    expect(reader.initialize.result!.instructions).toMatch(/read-only/);
    expect(reader.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(reader.initializedStatus).toBe(202);

    const listed = (await reader.request('tools/list')).result!.tools as { name: string }[];
    expect(listed.map((x) => x.name)).toEqual(READ_TOOLS);

    const writer = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'project', access: 'write' }),
    );
    const writable = ((await writer.request('tools/list')).result!.tools as { name: string }[]).map(
      (x) => x.name,
    );
    expect(writable).toEqual([...READ_TOOLS, ...WRITE_TOOLS]);
    const delegate = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'project', access: 'write', allowResolveApprovals: true }),
    );
    const all = ((await delegate.request('tools/list')).result!.tools as { name: string }[]).map(
      (x) => x.name,
    );
    expect(all).toContain('resolve_approval');

    const tool = listed.find((x) => x.name === 'get_project') as unknown as {
      inputSchema: Record<string, unknown>;
      annotations: Record<string, unknown>;
    };
    expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(tool.inputSchema).not.toHaveProperty('$schema');
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });

    expect((await reader.request('ping')).result).toEqual({});
    expect((await reader.request('resources/list')).error?.code).toBe(-32601);

    // Older clients get their own protocol version; unknown ones the latest.
    const old = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'workspace', access: 'read' }),
      '2024-11-05',
    );
    expect(old.initialize.result!.protocolVersion).toBe('2024-11-05');
    const odd = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'workspace', access: 'read' }),
      '1999-01-01',
    );
    expect(odd.initialize.result!.protocolVersion).toBe('2025-06-18');

    // Sessions: required, per grant, closable.
    const noSession = await fetch(`${t.companion.url}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await t.grant({ scope: 'workspace', access: 'read' })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(noSession.status).toBe(400);
    const stolen = await writer.post(
      { jsonrpc: '2.0', id: 9, method: 'tools/list' },
      { 'mcp-session-id': reader.sessionId! },
    );
    expect(stolen.status).toBe(404);
    const badVersion = await reader.post(
      { jsonrpc: '2.0', id: 10, method: 'ping' },
      { 'mcp-protocol-version': '2000-01-01' },
    );
    expect(badVersion.status).toBe(400);
    expect(
      (
        await fetch(`${t.companion.url}/mcp`, {
          headers: {
            authorization: `Bearer ${await t.grant({ scope: 'workspace', access: 'read' })}`,
          },
        })
      ).status,
    ).toBe(405);
    const token = await t.grant({ scope: 'workspace', access: 'read' });
    const closing = await mcpClient(t.companion.url, token);
    const del = await fetch(`${t.companion.url}/mcp`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}`, 'mcp-session-id': closing.sessionId! },
    });
    expect(del.status).toBe(204);
    expect((await closing.post({ jsonrpc: '2.0', id: 3, method: 'ping' })).status).toBe(404);
  });

  it('reads a project, requests approval, reads it back and resolves it, attributed and audited', async () => {
    const t = await start();
    const client = await mcpClient(
      t.companion.url,
      await t.grant({
        label: 'Claude Code',
        scope: 'project',
        access: 'write',
        allowResolveApprovals: true,
      }),
    );

    const project = await client.call('get_project');
    expect(project.isError).toBe(false);
    expect(project.json).toMatchObject({
      name: 'Engine',
      slug: 'engine',
      workspacePath: 'projects/engine',
    });
    const context = await client.call('get_context');
    expect(context.text).toMatch(/Engine/);
    expect(context.text).toMatch(/^<!-- Generated by LOWTIDE/);

    const requested = await client.call('request_approval', {
      title: 'Ship the SQLite store',
      body: 'Migration verified on a copy.',
    });
    expect(requested.isError).toBe(false);
    const itemId = (requested.json as { id: string }).id;
    const open = await client.call('get_approval_requests');
    expect(open.json).toEqual([
      expect.objectContaining({
        id: itemId,
        title: 'Ship the SQLite store',
        status: 'open',
        project: 'engine',
      }),
    ]);

    const resolved = await client.call('resolve_approval', { item: itemId });
    expect(resolved.json).toMatchObject({ id: itemId, lane: 'done' });
    const after = await client.call('get_approval_requests', { includeResolved: true });
    expect(after.json).toEqual([expect.objectContaining({ id: itemId, status: 'resolved' })]);

    // Canonical state and the ledger say who did it.
    const item = await t.companion.store.projectItems.get(itemId);
    expect(item).toMatchObject({ kind: 'approval', lane: 'done' });
    const events = (await t.companion.store.events.toArray()).filter((e) => e.entityId === itemId);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'project.approval_requested',
        source: 'ai-client',
        actor: 'Claude Code',
      }),
    ]);

    const log = await audit(t);
    const ops = log.map((e) => `${e.operation}:${e.result}`).reverse();
    expect(ops).toEqual([
      'get_project:ok',
      'get_context:ok',
      'request_approval:ok',
      'get_approval_requests:ok',
      'resolve_approval:ok',
      'get_approval_requests:ok',
    ]);
    const resolveEntry = log.find((e) => e.operation === 'resolve_approval')!;
    expect(resolveEntry).toMatchObject({
      client: 'Claude Code',
      clientKind: 'claude-code',
      entityType: 'projectItem',
      entityId: itemId,
      before: '“Ship the SQLite store”: needs_approval',
      after: '“Ship the SQLite store”: resolved',
      sessionId: client.sessionId,
      requestId: expect.any(String),
    });
    expect(resolveEntry.scope).toMatch(/^project /);
  });

  it('writes only through the domain rules, as an attributed AI client', async () => {
    const t = await start();
    const client = await mcpClient(
      t.companion.url,
      await t.grant({ label: 'Claude Code', scope: 'project', access: 'write' }),
    );
    const owner = repos(t);
    const earlier = new Set((await t.companion.store.events.toArray()).map((e) => e.id));
    const task = await owner.tasks.create({ title: 'Index the queue', projectId: t.projectId });
    const build = (await t.companion.store.milestones.toArray()).find((m) => m.title === 'Build')!;

    const note = await client.call('create_note', {
      title: 'Handoff',
      body: 'Next: wire the RPC.',
      kind: 'handoff',
    });
    const noteId = (note.json as { id: string }).id;
    expect(await t.companion.store.notes.get(noteId)).toMatchObject({
      author: 'ai-client',
      client: 'Claude Code',
      kind: 'handoff',
    });

    const decision = await client.call('record_decision', {
      title: 'Transport',
      decision: 'Streamable HTTP',
    });
    const decisionId = (decision.json as { id: string }).id;
    expect(await t.companion.store.decisions.get(decisionId)).toMatchObject({
      origin: 'ai-client',
      client: 'Claude Code',
    });

    const updated = await client.call('update_project', {
      nextAction: 'Write the bridge',
      state: 'active',
    });
    expect(updated.json).toMatchObject({ nextAction: 'Write the bridge', state: 'active' });
    const archive = await client.call('update_project', { state: 'archived' });
    expect(archive.isError).toBe(true);
    expect((await t.companion.store.projects.get(t.projectId))!.state).toBe('active');

    expect((await client.call('complete_task', { task: task.id })).json).toMatchObject({
      status: 'done',
    });
    expect((await client.call('complete_milestone', { milestone: build.id })).json).toMatchObject({
      id: build.id,
    });
    // Completing twice is idempotent (no second event); a closed task is refused by the domain.
    expect((await client.call('complete_milestone', { milestone: build.id })).isError).toBe(false);
    const completions = (await t.companion.store.events.toArray()).filter(
      (e) => e.type === 'milestone.completed' && e.entityId === build.id,
    );
    expect(completions).toHaveLength(1);
    expect((await client.call('complete_task', { task: task.id })).isError).toBe(true);

    const plugins = (await t.companion.store.projectItems.toArray()).find(
      (i) => i.title === 'Plugins',
    )!;
    expect((await client.call('park_item', { item: plugins.id })).json).toMatchObject({
      lane: 'parked',
    });
    expect((await client.call('get_parked')).json).toMatchObject({
      items: [expect.objectContaining({ id: plugins.id })],
    });
    expect(
      (await client.call('resume_item', { item: plugins.id, lane: 'working_now' })).json,
    ).toMatchObject({ lane: 'working_now' });
    expect((await client.call('resume_item', { item: plugins.id })).isError).toBe(true);

    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect((await client.call('log_ai_session', { summary: 'x', endedAt: future })).isError).toBe(
      true,
    );
    const session = await client.call('log_ai_session', {
      summary: 'Built the companion bridge.',
      result: 'Bridge works end to end.',
      nextAction: 'Pair the app.',
      filesTouched: ['companion/lowtide-mcp.ts'],
      commits: ['abc1234'],
      task: task.id,
    });
    const sessionId = (session.json as { id: string }).id;
    expect(await t.companion.store.aiSessions.get(sessionId)).toMatchObject({
      client: 'Claude Code',
      scope: 'project',
      projectId: t.projectId,
      taskId: task.id,
      commits: ['abc1234'],
    });

    // Every write produced the same ledger events the app would, attributed.
    const aiEvents = (await t.companion.store.events.toArray()).filter(
      (e) => !earlier.has(e.id) && e.source === 'ai-client',
    );
    expect(new Set(aiEvents.map((e) => e.actor))).toEqual(new Set(['Claude Code']));
    expect(aiEvents.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        'note.created',
        'decision.recorded',
        'project.updated',
        'task.completed',
        'milestone.completed',
        'project.item_parked',
        'ai.session.completed',
      ]),
    );

    const log = await audit(t);
    expect(log.find((e) => e.operation === 'update_project' && e.result === 'ok')).toMatchObject({
      before: expect.stringContaining('nextAction'),
      after: 'nextAction: “Write the bridge”; state: active',
    });
    expect(
      log
        .filter((e) => e.result !== 'ok')
        .map((e) => e.operation)
        .sort(),
    ).toEqual(['complete_task', 'log_ai_session', 'resume_item', 'update_project'].sort());
  });

  it('keeps every connection inside its scope and permissions, and audits refusals', async () => {
    const t = await start();
    const other = await repos(t).projects.create({ name: 'Side quest' });
    await t.companion.sync.sync();
    const reader = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'project', access: 'read' }),
    );

    for (const [name, args] of [
      ['get_project', { project: other.id }],
      ['get_project', { project: 'side-quest' }],
      ['get_decisions', { project: 'side-quest' }],
      ['get_document', { path: 'projects/side-quest/PROJECT.md' }],
      ['get_document', { path: '../companion.json' }],
      ['create_note', { title: 'x', body: 'y' }],
      ['resolve_approval', { item: 'x' }],
    ] as const) {
      const result = await reader.call(name, args);
      expect(result.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
    }
    const found = await reader.call('search_workspace', { query: 'Side quest' });
    expect(found.json).toEqual([]);
    expect(await reader.call('get_document', { path: 'projects/engine/PROJECT.md' })).toMatchObject(
      { isError: false },
    );

    const writer = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'workspace', access: 'write' }),
    );
    const approval = await writer.call('request_approval', { project: 'side-quest', title: 'Go?' });
    const refused = await writer.call('resolve_approval', {
      item: (approval.json as { id: string }).id,
    });
    expect(refused).toMatchObject({ isError: true, text: expect.stringMatching(/hasn’t allowed/) });
    expect((await writer.call('get_project', { project: 'side-quest' })).isError).toBe(false);
    const bad = await writer.call('create_note', { title: '', body: 'y', extra: true });
    expect(bad).toMatchObject({ isError: true, text: expect.stringMatching(/Invalid arguments/) });

    const refusals = (await audit(t)).filter((e) => e.result === 'refused');
    expect(refusals.length).toBeGreaterThanOrEqual(9);
    expect(refusals.every((e) => e.message)).toBe(true);
  });

  it('never exposes protected time, and private life data only as explicitly granted', async () => {
    const t = await start();
    const privateWords = ['Dinner', 'still thinking', 'DBMS', 'Gym'];
    const noPrivate = (text: string) => {
      for (const word of privateWords) expect(text, word).not.toContain(word);
    };

    const workspace = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'workspace', access: 'read' }),
    );
    noPrivate((await workspace.call('get_context')).text);
    noPrivate((await workspace.call('get_context', { project: 'engine' })).text);
    noPrivate((await workspace.call('get_recent_activity', { limit: 200 })).text);
    noPrivate((await workspace.call('get_tasks', { status: 'all' })).text);
    expect((await workspace.call('get_tasks', { status: 'all' })).text).not.toContain('Loose task');
    for (const word of privateWords) {
      expect((await workspace.call('search_workspace', { query: word })).json, word).toEqual([]);
    }
    const types = (
      (await workspace.call('get_recent_activity', { limit: 200 })).json as { type: string }[]
    ).map((e) => e.type);
    expect(types.some((x) => x.startsWith('offtime.') || x === 'habit.logged')).toBe(false);

    const global = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'global', access: 'read' }),
    );
    const globalContext = (await global.call('get_context')).text;
    noPrivate(globalContext);
    expect((await global.call('get_tasks', { status: 'all' })).text).toContain('Loose task');

    const trusted = await mcpClient(
      t.companion.url,
      await t.grant({
        scope: 'global',
        access: 'read',
        sensitive: ['routines', 'offTime', 'college', 'inbox'],
      }),
    );
    const everything = (await trusted.call('get_context')).text;
    expect(everything).toContain('Inbox (granted)');
    expect(everything).toContain('still thinking');
    expect(everything).toContain('Routines (granted)');
    expect(everything).not.toContain('Dinner'); // protected time: no grant reaches it
    const trustedTypes = (
      (await trusted.call('get_recent_activity', { limit: 200 })).json as { type: string }[]
    ).map((e) => e.type);
    expect(trustedTypes).toContain('habit.logged');

    // Nor is any of it anywhere in the synced workspace.
    await t.companion.sync.sync();
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
      });
    for (const file of walk(t.companion.sync.root)) noPrivate(readFileSync(file, 'utf8'));

    // A grant can't even be created with protected time.
    const refused = await t.owner('/api/ai/grants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'x',
        clientKind: 'other',
        scope: 'global',
        access: 'read',
        sensitive: ['protectedTime'],
      }),
    });
    expect(refused.status).toBe(400);
  });
});

describe('the companion HTTP boundary', () => {
  it('authenticates every request, never wildcards CORS and checks Host and Origin', async () => {
    const t = await start();
    const url = t.companion.url;
    const grantToken = await t.grant({ scope: 'workspace', access: 'read' });

    expect((await fetch(`${url}/api/status`)).status).toBe(401);
    expect(
      (await fetch(`${url}/api/status`, { headers: { authorization: `Bearer ${grantToken}` } }))
        .status,
    ).toBe(401);
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
    const ownerOnMcp = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t.ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(ownerOnMcp.status).toBe(401);

    const allowed = await t.owner('/api/status', { headers: { origin: 'http://localhost:5173' } });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const evil = await t.owner('/api/status', { headers: { origin: 'https://example.com' } });
    expect(evil.status).toBe(403);
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await fetch(`${url}/api/rpc`, {
      method: 'OPTIONS',
      headers: { origin: 'http://127.0.0.1:5173', 'access-control-request-method': 'POST' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization');

    // DNS rebinding: a foreign Host header is refused even from loopback.
    const { request } = await import('node:http');
    const rebound = await new Promise<number>((resolve) => {
      request(`${url}/api/health`, { headers: { host: 'attacker.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      }).end();
    });
    expect(rebound).toBe(403);

    // Revoking a grant stops its token at once.
    const grants = (await (await t.owner('/api/ai/grants')).json()) as Grant[];
    expect(JSON.stringify(grants)).not.toMatch(/token/i);
    const revoke = await t.owner(`/api/ai/grants/${grants[0]!.id}/revoke`, { method: 'POST' });
    expect(await revoke.json()).toEqual({ revoked: true });
    const after = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${grantToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(after.status).toBe(401);

    // Oversized bodies are refused before they're read in full.
    const writer = await mcpClient(url, await t.grant({ scope: 'workspace', access: 'write' }));
    const huge = await writer.post({
      jsonrpc: '2.0',
      id: 5,
      method: 'ping',
      padding: 'x'.repeat(1_100_000),
    });
    expect(huge.status).toBe(413);

    // Guessing tokens is throttled.
    let throttled = 0;
    for (let i = 0; i < 40; i++) {
      const r = await fetch(`${url}/api/status`, {
        headers: { authorization: `Bearer ${'x'.repeat(43)}` },
      });
      if (r.status === 429) throttled += 1;
    }
    expect(throttled).toBeGreaterThan(0);
  });

  it('streams changes to the app the moment an AI client writes', async () => {
    const t = await start();
    const controller = new AbortController();
    const stream = await t.owner('/api/events', { signal: controller.signal });
    expect(stream.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = stream.body!.pipeThrough(new TextDecoderStream()).getReader();
    const seen: string[] = [];
    const waitFor = async (predicate: (all: string) => boolean) => {
      while (!predicate(seen.join(''))) {
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        seen.push(value);
      }
    };
    await waitFor((all) => all.includes('event: hello'));

    const client = await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'project', access: 'write' }),
    );
    await client.call('create_note', { title: 'Live', body: 'Seen at once.' });
    await waitFor((all) => /event: change\ndata: \{"stores":\[[^\]]*"notes"/.test(all));
    await waitFor((all) => all.includes('event: ai'));
    controller.abort();
  });

  it('answers the owner’s repository calls by the shared contract only', async () => {
    const t = await start();
    const rpc = async (body: unknown) =>
      (await (
        await t.owner('/api/rpc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).json()) as { ok: boolean; value?: unknown; error?: { name: string; message: string } };

    const created = await rpc({
      repo: 'projects',
      member: 'create',
      args: [{ name: 'Owner made' }],
    });
    expect(created).toMatchObject({ ok: true, value: { name: 'Owner made', slug: 'owner-made' } });
    const all = await rpc({ repo: 'projects', member: 'watchAll', args: [] });
    expect((all.value as { name: string }[]).map((p) => p.name)).toContain('Owner made');
    expect(await rpc({ repo: 'tasks', member: 'get', args: ['nope'] })).toEqual({
      ok: true,
      value: null,
    });
    expect(await rpc({ repo: 'tasks', member: 'complete', args: ['nope'] })).toMatchObject({
      ok: false,
      error: { name: 'RecordNotFoundError' },
    });
    expect(await rpc({ repo: 'tasks', member: 'constructor', args: [] })).toMatchObject({
      ok: false,
      error: { name: 'RpcError' },
    });
    expect(await rpc({ repo: 'backup', member: 'inspect', args: ['{}'] })).toMatchObject({
      ok: false,
      error: { name: 'RpcError' },
    });
    expect(await rpc({ repo: '__proto__', member: 'x', args: [] })).toMatchObject({ ok: false });
    const forged = await rpc({
      repo: 'backup',
      member: 'restore',
      args: [{ exportedAt: 'now', data: { tasks: 'all of them' } }],
    });
    expect(forged).toMatchObject({ ok: false, error: { name: 'InvalidInputError' } });
    expect((await t.companion.store.projects.count()) > 0).toBe(true);

    const clients = (await (await t.owner('/api/ai/clients')).json()) as ClientStatus[];
    expect(clients.map((c) => c.kind)).toEqual(['claude-code', 'claude', 'chatgpt', 'other']);
    expect(clients.every((c) => !c.connected)).toBe(true);
    await mcpClient(
      t.companion.url,
      await t.grant({ scope: 'workspace', access: 'read', clientKind: 'chatgpt' }),
    );
    const now = (await (await t.owner('/api/ai/clients')).json()) as ClientStatus[];
    expect(now.find((c) => c.kind === 'chatgpt')).toMatchObject({
      connected: true,
      clientName: 'lowtide-test',
    });
    expect(now.find((c) => c.kind === 'claude')).toMatchObject({ connected: false });
  });
});
