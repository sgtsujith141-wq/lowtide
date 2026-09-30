import 'fake-indexeddb/auto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NewGrant } from '../../src/db/companion/wire';
import { openDatabase } from '../../src/db/database';
import { createDexieRepositories, type Repositories } from '../../src/db/repositories';
import type { Clock } from '../../src/lib/time';
import { startCompanion, type Companion, type CompanionOptions } from './app';

/*
 * Shared test fixtures for the companion: a deterministic scenario that
 * touches every repository and every store, and a real LOWTIDE backup made
 * by running it on the browser's own (Dexie) implementation. Test-only.
 */

/** Deterministic ids and time, so two backends can produce identical records. */
export function deterministic(): { clock: Clock; newId: () => string } {
  let t = Date.parse('2026-09-28T09:00:00.000Z');
  let n = 0;
  return {
    clock: () => {
      const now = new Date(t);
      t += 60_000;
      return now;
    },
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  };
}

/** Exercises every repository and every store. */
export async function scenario(r: Repositories) {
  const p = await r.projects.create({ name: 'Engine', objective: 'Ship it', state: 'active' });
  const m1 = await r.projects.addMilestone(p.id, { title: 'Scope' });
  const m2 = await r.projects.addMilestone(p.id, {
    title: 'Build',
    weight: 3,
    dueOn: '2026-10-10',
  });
  await r.projects.completeMilestone(m1.id);
  const t1 = await r.tasks.create({ title: 'Wire the bus', projectId: p.id, milestoneId: m2.id });
  await r.tasks.create({ title: 'Loose task', dueAt: '2026-10-02T12:00:00.000Z', project: 'Misc' });
  await r.tasks.planFor(t1.id, '2026-09-29');
  const blocker = await r.projects.addItem(p.id, { kind: 'blocker', title: 'Key', taskId: t1.id });
  await r.projects.addItem(p.id, { kind: 'dependency', title: 'Review', waitingOn: 'a teammate' });
  const idea = await r.projects.addItem(p.id, { kind: 'idea', title: 'Plugins' });
  await r.projects.moveItem(idea.id, 'next');
  await r.projects.resolveItem(blocker.id);
  const d = await r.projects.recordDecision(p.id, { title: 'DB', decision: 'IndexedDB first' });
  await r.projects.recordDecision(p.id, { title: 'DB', decision: 'SQLite', supersedesId: d.id });
  await r.projects.setState(p.id, 'review');
  const w = await r.work.start({ kind: 'task', taskId: t1.id, intent: 'bus' });
  await r.work.pause(w.id);
  await r.work.resume(w.id);
  await r.work.finish(w.id, 'half');
  await r.tasks.complete(t1.id);
  const sleep = await r.offTime.start('sleep');
  await r.offTime.end(sleep.id);
  await r.offTime.declareDayOff('2026-10-04', 'rest');
  const habit = await r.habits.create({
    name: 'Read',
    category: 'personal',
    unit: 'minutes',
    target: 20,
  });
  await r.habits.setEntry(habit.id, '2026-09-28', 25, 'good');
  const gym = await r.habits.create({ name: 'Gym', category: 'fitness', unit: 'check' });
  await r.habits.setEntry(gym.id, '2026-09-28', 1);
  await r.habits.archive(gym.id);
  const thought = await r.inbox.capture('Call the bank\nabout the card');
  await r.inbox.convertToTask(thought.id);
  await r.inbox.capture('still thinking');
  const h = await r.hackathons.create({ name: 'Autumn hack', eventStart: '2026-10-04' });
  await r.hackathons.update(h.id, { researchStatus: 'in_progress', projectId: p.id });
  await r.protectedTime.create({ title: 'Dinner', date: '2026-09-30', kind: 'relationship' });
  await r.college.create({ kind: 'class', title: 'DBMS', date: '2026-09-28', status: 'attended' });
  await r.notes.create(p.id, { kind: 'research', title: 'Queues', body: '# Notes\n\nUse one.' });
  const [projectsSection] = await r.space.ensureRoots();
  const page = await r.space.create({
    parentId: projectsSection!.id,
    title: 'Engine notes',
    body: '# Engine',
    links: [{ type: 'project', id: p.id }],
  });
  await r.space.create({
    parentId: page.id,
    title: 'Parts',
    table: {
      columns: [{ id: 'name', name: 'Name', type: 'text' }],
      rows: [{ id: 'r1', cells: { name: 'Bolt' } }],
    },
  });
  await r.space.update(page.id, { body: '# Engine\n\nUpdated.' });
  await r.aiSessions.record({
    client: 'claude-code',
    scope: 'project',
    projectId: p.id,
    startedAt: '2026-09-28T10:00:00.000Z',
    endedAt: '2026-09-28T10:30:00.000Z',
    summary: 'Reviewed',
    commits: ['abc1234'],
  });
  return { projectId: p.id };
}

let counter = 0;

/** A backup file's text, exported by the app's own Dexie repositories. */
export async function fixtureBackupText(): Promise<{ text: string; projectId: string }> {
  const db = openDatabase(`lowtide-fixture-${++counter}-${Math.random()}`);
  try {
    const repositories = createDexieRepositories(db, deterministic());
    const { projectId } = await scenario(repositories);
    const document = await repositories.backup.exportBackup();
    return { text: JSON.stringify(document), projectId };
  } finally {
    db.close();
  }
}

/* ------------------------- a running companion ------------------------- */

export interface TestCompanion {
  companion: Companion;
  dataDir: string;
  ownerToken: string;
  projectId: string;
  owner(path: string, init?: RequestInit): Promise<Response>;
  grant(input: Partial<NewGrant> & Pick<NewGrant, 'scope' | 'access'>): Promise<string>;
  close(): Promise<void>;
}

/** A companion on a free port with a throwaway data folder, migrated from the fixture. */
export async function startTestCompanion(
  options: Partial<CompanionOptions> = {},
): Promise<TestCompanion> {
  const dataDir = mkdtempSync(join(tmpdir(), 'lowtide-companion-'));
  const companion = await startCompanion({
    dataDir,
    port: 0,
    database: ':memory:',
    syncDebounceMs: 10,
    ...options,
  });
  const ownerToken = companion.config.ownerToken;
  const owner = (path: string, init: RequestInit = {}) =>
    fetch(`${companion.url}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${ownerToken}`, ...(init.headers ?? {}) },
    });
  const { text, projectId } = await fixtureBackupText();
  const report = (await (await owner('/api/migrate', { method: 'POST', body: text })).json()) as {
    ok: boolean;
  };
  if (!report.ok) throw new Error('fixture migration failed');
  return {
    companion,
    dataDir,
    ownerToken,
    projectId,
    owner,
    async grant(input) {
      const response = await owner('/api/ai/grants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: 'Test client',
          clientKind: 'claude-code',
          ...(input.scope === 'project' ? { projectId } : {}),
          ...input,
        }),
      });
      if (!response.ok) throw new Error(`grant: ${response.status} ${await response.text()}`);
      return ((await response.json()) as { token: string }).token;
    },
    async close() {
      await companion.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

type JsonRpcReply = {
  id?: unknown;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

/** A minimal MCP client over the Streamable HTTP transport. */
export async function mcpClient(url: string, token: string, protocolVersion = '2025-06-18') {
  const session: { id?: string | undefined; version?: string | undefined } = {};
  let n = 0;
  const post = (message: unknown, headers: Record<string, string> = {}) =>
    fetch(`${url}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(session.id ? { 'mcp-session-id': session.id } : {}),
        ...(session.version ? { 'mcp-protocol-version': session.version } : {}),
        ...headers,
      },
      body: JSON.stringify(message),
    });
  const init = await post({
    jsonrpc: '2.0',
    id: ++n,
    method: 'initialize',
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'lowtide-test', version: '1.0' },
    },
  });
  const initialized = (await init.json()) as JsonRpcReply;
  session.id = init.headers.get('mcp-session-id') ?? undefined;
  session.version = initialized.result?.protocolVersion as string | undefined;
  const note = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    initialize: initialized,
    initializedStatus: note.status,
    get sessionId() {
      return session.id;
    },
    post,
    async request(method: string, params?: unknown): Promise<JsonRpcReply> {
      const response = await post({
        jsonrpc: '2.0',
        id: ++n,
        method,
        ...(params ? { params } : {}),
      });
      return (await response.json()) as JsonRpcReply;
    },
    /** Calls a tool; returns its text and whether it was an error. */
    async call(name: string, args: Record<string, unknown> = {}) {
      const reply = await this.request('tools/call', { name, arguments: args });
      if (reply.error) throw new Error(`${reply.error.code}: ${reply.error.message}`);
      const result = reply.result as { content: { text: string }[]; isError?: boolean };
      const text = result.content.map((c) => c.text).join('\n');
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { text, json: json as never, isError: result.isError === true };
    },
  };
}
