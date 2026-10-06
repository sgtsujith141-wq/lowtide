// @vitest-environment node
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CompanionClient, createCompanionRepositories } from '../../src/db/companion/client';
import type { ProjectItem } from '../../src/types/domain';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRESET } from '../../src/db/companion/wire';
import { mcpClient, startTestCompanion, type TestCompanion } from './test-fixtures';

/*
 * A real MCP session over stdio, the way Claude Code runs a local server:
 * the bridge process is spawned, spoken to in newline-delimited JSON-RPC,
 * and forwards to the running companion. Meanwhile the app's own companion
 * repositories watch the same project and must see every AI change live.
 */

const BRIDGE = fileURLToPath(new URL('../lowtide-mcp.ts', import.meta.url));

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Reply = {
  id: unknown;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

function spawnBridge(url: string, token: string, env: Record<string, string> = {}) {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [BRIDGE, '--url', url], {
    env: { ...process.env, LOWTIDE_TOKEN: token, NODE_NO_WARNINGS: '1', ...env },
    stdio: 'pipe',
  });
  const waiting = new Map<unknown, (reply: Reply) => void>();
  const stderr: string[] = [];
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
  createInterface({ input: child.stdout }).on('line', (line) => {
    const reply = JSON.parse(line) as Reply;
    waiting.get(reply.id)?.(reply);
  });
  let n = 0;
  const exited = once(child, 'exit');
  cleanups.push(() => {
    if (child.exitCode === null) child.kill();
  });
  return {
    child,
    stderr,
    exited,
    notify(method: string) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
    },
    request(method: string, params?: unknown): Promise<Reply> {
      const id = ++n;
      return new Promise<Reply>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no reply to ${method}: ${stderr.join('')}`)),
          10_000,
        );
        waiting.set(id, (reply) => {
          clearTimeout(timer);
          resolve(reply);
        });
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`,
        );
      });
    },
    async tool(name: string, args: Record<string, unknown> = {}) {
      const reply = await this.request('tools/call', { name, arguments: args });
      const result = reply.result as { content: { text: string }[]; isError?: boolean };
      const text = result.content[0]!.text;
      return {
        isError: result.isError === true,
        text,
        json: (() => {
          try {
            return JSON.parse(text) as unknown;
          } catch {
            return undefined;
          }
        })(),
      };
    },
  };
}

async function started(): Promise<TestCompanion> {
  const t = await startTestCompanion();
  cleanups.push(() => t.close());
  return t;
}

describe('a real MCP session through the stdio bridge', () => {
  it('reads a project, requests approval, reads it back, resolves it, and the app sees it live', async () => {
    const t = await started();
    const token = await t.grant({
      label: 'Claude Code',
      clientKind: 'claude-code',
      scope: 'project',
      access: 'write',
      allowResolveApprovals: true,
    });

    // The app, in companion mode, watching the project's items.
    const app = new CompanionClient({ url: t.companion.url, token: t.ownerToken });
    cleanups.push(() => app.stop());
    const repositories = createCompanionRepositories(app);
    const seen: ProjectItem[][] = [];
    const stop = repositories.projects.watchItems(t.projectId)((items) => seen.push(items));
    cleanups.push(stop);
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    await expect.poll(() => app.state).toBe('open');

    const bridge = spawnBridge(t.companion.url, token);
    const init = await bridge.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'claude-code', version: 'test' },
    });
    expect(init.result).toMatchObject({
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'lowtide' },
    });
    bridge.notify('notifications/initialized');
    const tools = (await bridge.request('tools/list')).result!.tools as { name: string }[];
    expect(tools.map((x) => x.name)).toContain('resolve_approval');

    // 1. Read a project.
    const project = await bridge.tool('get_project');
    expect(project.json).toMatchObject({ name: 'Engine' });

    // 2. Create an approval request.
    const requested = await bridge.tool('request_approval', {
      title: 'Merge the companion',
      body: 'All tests green.',
    });
    const itemId = (requested.json as { id: string }).id;

    // The app sees it without reloading or polling.
    await expect
      .poll(() => seen.at(-1)?.find((i) => i.id === itemId)?.lane, { timeout: 5000 })
      .toBe('needs_approval');

    // 3. Read it back.
    const open = await bridge.tool('get_approval_requests');
    expect(open.json).toEqual([expect.objectContaining({ id: itemId, status: 'open' })]);

    // 4. Resolve it (this grant was explicitly allowed to).
    const resolved = await bridge.tool('resolve_approval', { item: itemId });
    expect(resolved.json).toMatchObject({ lane: 'done' });

    // 5. The app sees that too.
    await expect
      .poll(() => seen.at(-1)?.find((i) => i.id === itemId)?.lane, { timeout: 5000 })
      .toBe('done');

    // The audit log in the app's AI area shows who did what.
    const audit = await app.audit();
    expect(audit.filter((e) => e.client === 'Claude Code').map((e) => e.operation)).toEqual(
      expect.arrayContaining([
        'get_project',
        'request_approval',
        'get_approval_requests',
        'resolve_approval',
      ]),
    );
    const clients = await app.clients();
    expect(clients.find((c) => c.kind === 'claude-code')).toMatchObject({
      connected: true,
      clientName: 'claude-code',
    });

    // If the companion forgets the session (e.g. it restarted), the bridge opens a new one.
    t.companion.mcp.dropGrant((await app.grants())[0]!.id);
    expect((await bridge.tool('get_project_summary')).json).toMatchObject({ slug: 'engine' });
    expect(bridge.stderr.join('')).toMatch(/reconnected/);

    // Closing stdin ends the session and the process.
    bridge.child.stdin.end();
    const [code] = await bridge.exited;
    expect(code).toBe(0);
  });

  it('answers calmly when the token is refused or the companion is down', async () => {
    const t = await started();
    const refused = spawnBridge(t.companion.url, 'not-a-real-token-but-long-enough-000');
    const reply = await refused.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'x', version: '1' },
    });
    expect(reply.error?.message).toMatch(/refused this grant token/);

    const down = spawnBridge('http://127.0.0.1:9', 'not-a-real-token-but-long-enough-000');
    const unreachable = await down.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'x', version: '1' },
    });
    expect(unreachable.error?.message).toMatch(/isn’t reachable/);
  });
  it('serves the same tools and the same refusals as the HTTP endpoint (stdio ↔ HTTP parity)', async () => {
    const t = await started();
    const initialize = {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'parity', version: '1' },
    };
    for (const grant of [
      {
        scope: 'global' as const,
        access: 'write' as const,
        capabilities: PRESET.full.capabilities,
        sensitive: PRESET.full.sensitive,
        preset: 'full' as const,
      },
      { scope: 'project' as const, access: 'read' as const },
    ]) {
      const token = await t.grant(grant);
      const http = await mcpClient(t.companion.url, token);
      const stdio = spawnBridge(t.companion.url, token);
      await stdio.request('initialize', initialize);
      stdio.notify('notifications/initialized');
      const viaStdio = (await stdio.request('tools/list')).result!.tools;
      const viaHttp = (await http.request('tools/list')).result!.tools;
      expect(viaStdio).toEqual(viaHttp);
      const refusedStdio = await stdio.tool('create_project', { name: 'Parity check' });
      const refusedHttp = await http.call('create_project', { name: 'Parity check' });
      expect(refusedStdio.isError).toBe(refusedHttp.isError);
      if (grant.access === 'read') {
        expect(refusedStdio.text).toBe('Cannot create Project. Grant lacks projects.create.');
        expect(refusedHttp.text).toBe(refusedStdio.text);
      }
    }
  });

  it('asks launchd once to start LOWTIDE when it isn’t running, and only when asked to', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lowtide-launchctl-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const calls = join(dir, 'calls.txt');
    const launchctl = join(dir, 'launchctl');
    // A fake launchctl: the agent isn't loaded (print fails); bootstrap succeeds.
    writeFileSync(
      launchctl,
      `#!/bin/sh\necho "$@" >> '${calls}'\n[ "$1" = print ] && exit 113\nexit 0\n`,
    );
    chmodSync(launchctl, 0o755);
    const plist = join(dir, 'agent.plist');
    writeFileSync(plist, '<plist/>');
    const bridge = spawnBridge('http://127.0.0.1:9', 'not-a-real-token-but-long-enough-000', {
      LOWTIDE_AUTOSTART: '1',
      LOWTIDE_LAUNCHCTL: launchctl,
      LOWTIDE_AGENT_PLIST: plist,
      LOWTIDE_LAUNCHD_LABEL: 'com.lowtide.test',
      LOWTIDE_START_WAIT_MS: '300',
    });
    const reply = await bridge.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'x', version: '1' },
    });
    expect(reply.error?.message).toMatch(/isn’t reachable/);
    const lines = readFileSync(calls, 'utf8').trim().split('\n');
    expect(lines[0]).toMatch(/^print gui\/\d+\/com\.lowtide\.test$/);
    expect(lines[1]).toMatch(
      new RegExp(`^bootstrap gui/\\d+ ${plist.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`),
    );
    // Once per bridge: a second request doesn't ask again.
    await bridge.request('ping');
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(2);

    // Without LOWTIDE_AUTOSTART, a non-default address never starts anything.
    const quiet = spawnBridge('http://127.0.0.1:9', 'not-a-real-token-but-long-enough-000', {
      LOWTIDE_LAUNCHCTL: launchctl,
      LOWTIDE_AGENT_PLIST: plist,
    });
    await quiet.request('ping');
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toHaveLength(2);
  });
});
