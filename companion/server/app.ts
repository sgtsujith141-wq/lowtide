import { createHash, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_NAMES } from '../../src/db/migrations';
import { LOWTIDE_VERSION } from '../../src/lib/version';
import { createRepositories } from '../../src/db/repositories';
import { CLAUDE_GUIDE } from '../../src/features/space/guide';
import {
  CAPABILITIES,
  GRANT_PRESETS,
  type Capability,
  type GrantChanges,
  type GrantPreset,
} from '../../src/db/companion/wire';
import { Checkpoints } from './checkpoints';
import { loadConfig, type CompanionConfig } from './config';
import { SystemService } from './system';
import {
  CLIENT_KINDS,
  clientStatuses,
  Grants,
  SENSITIVE,
  type Grant,
  type NewGrant,
} from './grants';
import { loadFrontend } from './frontend';
import { PairCodes } from './pairing';
import { McpServer } from './mcp';
import { isEmpty, migrateIntoCompanion, migrationInfo } from './migrate';
import { dispatch, toWireError } from './rpc';
import { getMeta } from './sqlite/migrations';
import { SqliteStore } from './sqlite/store';
import { WorkspaceSync } from './workspace-sync';

/*
 * The LOWTIDE companion daemon (ADR-058, ADR-059). One process owns the
 * SQLite database; everything else talks to it over HTTP on 127.0.0.1:
 *
 *   /api/*   the LOWTIDE app, with the owner token (repository RPC, the live
 *            event stream, migration, AI grants and audit, workspace)
 *   /mcp     AI clients, each with its own scoped grant token
 *
 * Defences: loopback-only listening; a Host check against DNS rebinding; an
 * Origin allow-list (never a wildcard); bearer tokens compared in constant
 * time; per-token rate limits; body size limits; JSON-only bodies.
 */

/** The companion reports LOWTIDE's version (v2.3). */
export const COMPANION_VERSION = LOWTIDE_VERSION;

/** The stdio bridge AI clients launch (companion/lowtide-mcp.ts), from source or dist. */
export const BRIDGE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'lowtide-mcp.ts');

export interface CompanionOptions {
  dataDir: string;
  /** 0 picks a free port (tests). Defaults to the config's port. */
  port?: number;
  /** A file path or ':memory:'. Defaults to <dataDir>/lowtide.sqlite. */
  database?: string;
  workspaceDir?: string;
  allowedOrigins?: string[];
  now?: () => Date;
  syncDebounceMs?: number;
  log?: (line: string) => void;
  /** How to restart this process (main.ts); absent: restart isn't offered. */
  onRestart?: () => void;
  /** Where the LaunchAgent goes (tests). */
  launchAgentsDir?: string;
  /** What the LaunchAgent runs (defaults to this process). */
  program?: { node: string; script: string; cwd: string };
  /** The built app to serve at / (v2.3); absent: the companion serves no app. */
  frontendDir?: string;
  /** This is an installed runtime: a missing app makes it unhealthy (v2.3). */
  requireFrontend?: boolean;
}

export interface Companion {
  url: string;
  port: number;
  config: CompanionConfig;
  database: string;
  store: SqliteStore;
  grants: Grants;
  sync: WorkspaceSync;
  mcp: McpServer;
  close(): Promise<void>;
}

const OWNER_BODY_LIMIT = 64 * 1024 * 1024;
const MCP_BODY_LIMIT = 1024 * 1024;
const OWNER_PER_MINUTE = 6000;
const GRANT_PER_MINUTE = 240;
const FAILED_AUTH_PER_MINUTE = 30;
const HEARTBEAT_MS = 25_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Fixed-window counters per key. */
class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  take(key: string, limit: number, now: number): boolean {
    const w = this.windows.get(key);
    if (!w || now - w.start >= 60_000) {
      this.windows.set(key, { start: now, count: 1 });
      if (this.windows.size > 1000) {
        for (const [k, v] of this.windows) if (now - v.start >= 60_000) this.windows.delete(k);
      }
      return true;
    }
    w.count += 1;
    return w.count <= limit;
  }
}

const digest = (value: string) => createHash('sha256').update(value).digest();

function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  const match = header && /^Bearer ([A-Za-z0-9._~+/=-]{16,200})$/.exec(header);
  return match ? match[1] : undefined;
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new HttpError(413, 'Request body too large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Body isn’t valid JSON');
  }
}

function send(
  res: ServerResponse,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  if (body === undefined) {
    res.writeHead(status, { 'cache-control': 'no-store', ...headers });
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(text);
}

function parseCapabilities(value: unknown): Capability[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((c) => !CAPABILITIES.includes(c as Capability))) {
    throw new HttpError(400, 'Unknown permission');
  }
  return value as Capability[];
}

function parsePreset(value: unknown): GrantPreset | undefined {
  if (value === undefined) return undefined;
  if (value !== 'custom' && !GRANT_PRESETS.includes(value as never)) {
    throw new HttpError(400, 'Unknown preset');
  }
  return value as GrantPreset;
}

function parseGrantChanges(body: unknown, projectIds: Set<string>): GrantChanges {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Expected changes');
  const b = body as Record<string, unknown>;
  const out: GrantChanges = {};
  if (typeof b.label === 'string') out.label = b.label.trim().slice(0, 80);
  if (b.scope !== undefined) {
    if (!['project', 'workspace', 'global'].includes(b.scope as string))
      throw new HttpError(400, 'Choose a scope');
    out.scope = b.scope as GrantChanges['scope'] & string;
  }
  if (b.projectId !== undefined) {
    if (!projectIds.has(b.projectId as string))
      throw new HttpError(400, 'Choose an existing project');
    out.projectId = b.projectId as string;
  }
  if (b.sensitive !== undefined) {
    if (!Array.isArray(b.sensitive) || b.sensitive.some((x) => !SENSITIVE.includes(x as never)))
      throw new HttpError(400, 'Unknown private category');
    out.sensitive = b.sensitive as NonNullable<GrantChanges['sensitive']>;
  }
  const capabilities = parseCapabilities(b.capabilities);
  if (capabilities) out.capabilities = capabilities;
  const preset = parsePreset(b.preset);
  if (preset) out.preset = preset;
  return out;
}

function parseGrant(body: unknown, projectIds: Set<string>): NewGrant {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Expected a grant');
  const b = body as Record<string, unknown>;
  const label = typeof b.label === 'string' ? b.label.trim().slice(0, 80) : '';
  if (!CLIENT_KINDS.includes(b.clientKind as never)) throw new HttpError(400, 'Choose a client');
  if (!['project', 'workspace', 'global'].includes(b.scope as string)) {
    throw new HttpError(400, 'Choose a scope');
  }
  const capabilities = parseCapabilities(b.capabilities);
  const preset = parsePreset(b.preset);
  if (!capabilities && b.access !== 'read' && b.access !== 'write')
    throw new HttpError(400, 'Choose access');
  if (b.scope === 'project' && !projectIds.has(b.projectId as string)) {
    throw new HttpError(400, 'Choose an existing project');
  }
  const sensitive = Array.isArray(b.sensitive) ? b.sensitive : [];
  if (sensitive.some((s) => !SENSITIVE.includes(s as never))) {
    throw new HttpError(400, 'Unknown private category');
  }
  return {
    label,
    clientKind: b.clientKind as NewGrant['clientKind'],
    scope: b.scope as NewGrant['scope'],
    ...(b.scope === 'project' ? { projectId: b.projectId as string } : {}),
    ...(b.access === 'read' || b.access === 'write' ? { access: b.access } : {}),
    allowResolveApprovals: b.allowResolveApprovals === true,
    sensitive: sensitive as NonNullable<NewGrant['sensitive']>,
    ...(capabilities ? { capabilities } : {}),
    ...(preset ? { preset } : {}),
  };
}

export async function startCompanion(options: CompanionOptions): Promise<Companion> {
  const stored = loadConfig(options.dataDir);
  const config: CompanionConfig = {
    ...stored,
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.workspaceDir ? { workspaceDir: options.workspaceDir } : {}),
    ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {}),
  };
  const now = options.now ?? (() => new Date());
  const system = new SystemService(
    options.dataDir,
    {
      ...(options.program ?? {
        node: process.execPath,
        script: process.argv[1] ?? '',
        cwd: process.cwd(),
      }),
      port: config.port,
    },
    options.launchAgentsDir ? { launchAgentsDir: options.launchAgentsDir } : {},
  );
  const log = (line: string) => {
    options.log?.(line);
    system.log(`[${now().toISOString()}] ${line}`);
  };
  const database = options.database ?? join(options.dataDir, 'lowtide.sqlite');

  const store = new SqliteStore(database);
  if (database !== ':memory:' && existsSync(database)) chmodSync(database, 0o600);
  const grants = new Grants(store.sql, now);
  const owner = createRepositories(store, { watch: store.watch, clock: now });
  const sync = new WorkspaceSync(store, owner, config.workspaceDir, now, options.syncDebounceMs);
  await sync.start();
  const checkpoints =
    database === ':memory:' ? undefined : new Checkpoints(store, options.dataDir, now);
  // The top-level SPACE sections (so a section added by an upgrade, such as
  // Areas, is there for MCP before the app opens SPACE) and LOWTIDE's own
  // pages (templates, the AI operating guide); never into an empty companion,
  // which a migration must fill first.
  if (!(await isEmpty(store))) {
    await owner.space.ensureRoots();
    await owner.space.ensureSystemPages(CLAUDE_GUIDE);
  }
  const mcp = new McpServer(
    { store, grants, sync, now, ...(checkpoints ? { checkpoints } : {}) },
    COMPANION_VERSION,
  );
  const frontend = loadFrontend(options.frontendDir);
  // SQLite's own consistency check, at startup and at most once a minute after.
  let integrity = { result: 'not checked', at: 0 };
  const checkIntegrity = () => {
    if (database !== ':memory:' && now().getTime() - integrity.at < 60_000) return integrity;
    const row = store.sql.prepare('PRAGMA quick_check').get() as { quick_check: string };
    integrity = { result: row.quick_check, at: now().getTime() };
    return integrity;
  };
  if (checkIntegrity().result !== 'ok') {
    log(`database integrity check FAILED: ${integrity.result} (${database})`);
  }
  const pairCodes = new PairCodes(() => now().getTime());
  const limiter = new RateLimiter();
  const streams = new Set<ServerResponse>();
  const startedAt = now().toISOString();
  let port = config.port;

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  // The app the companion serves itself is always an allowed origin.
  const ownOrigins = () => new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  function owned(req: IncomingMessage) {
    const token = bearer(req);
    if (!token || !sameSecret(token, config.ownerToken)) return false;
    return true;
  }

  function grantOf(req: IncomingMessage): Grant | undefined {
    return grants.authenticate(bearer(req));
  }

  async function status() {
    const counts = Object.fromEntries(
      await Promise.all(STORE_NAMES.map(async (n) => [n, await store[n].count()] as const)),
    );
    return {
      app: 'lowtide-companion',
      version: COMPANION_VERSION,
      schemaVersion: Number(getMeta(store.sql, 'lowtide_schema_version')),
      empty: await isEmpty(store),
      migration: migrationInfo(store) ?? null,
      counts,
      dataDir: options.dataDir,
      database,
      workspaceDir: sync.root,
      bridge: BRIDGE_PATH,
      mcpUrl: `http://127.0.0.1:${port}/mcp`,
      appUrl: frontend ? `http://127.0.0.1:${port}/` : null,
      startedAt,
    };
  }

  /**
   * Machine-readable health (v2.3), without secrets or paths: whether each
   * part of LOWTIDE works. `app` and `version` stay first for older checks.
   */
  function health() {
    const db = checkIntegrity();
    const conflicts = sync.lastReport?.conflicts.length ?? 0;
    const checks = {
      runtime: { ok: true, node: process.version, pid: process.pid },
      database: {
        ok: db.result === 'ok',
        integrity: db.result,
        schemaVersion: Number(getMeta(store.sql, 'lowtide_schema_version')),
      },
      frontend: { ok: Boolean(frontend) || !options.requireFrontend, served: Boolean(frontend) },
      api: { ok: true },
      sse: { ok: true, clients: streams.size },
      mcp: { ok: true, path: '/mcp', sessions: mcp.sessionCount },
      workspace: { ok: conflicts === 0, conflicts, lastSync: sync.lastReport?.at ?? null },
    };
    return {
      app: 'lowtide-companion' as const,
      version: COMPANION_VERSION,
      status: Object.values(checks).every((c) => c.ok) ? 'ok' : 'degraded',
      startedAt,
      uptimeSeconds: Math.round((now().getTime() - Date.parse(startedAt)) / 1000),
      checks,
    };
  }

  function openStream(req: IncomingMessage, res: ServerResponse, cors: Record<string, string>) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...cors,
    });
    const write = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    write('hello', { version: COMPANION_VERSION });
    const offStore = store.onChange((changes) => write('change', { stores: [...changes] }));
    const offAi = grants.onChange((what) => write('ai', { what }));
    const offSync = sync.onSynced((report) =>
      write('workspace', {
        at: report.at,
        written: report.written.length,
        removed: report.removed.length,
        conflicts: report.conflicts,
      }),
    );
    const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    streams.add(res);
    const close = () => {
      clearInterval(beat);
      offStore();
      offAi();
      offSync();
      streams.delete(res);
    };
    req.on('close', close);
    res.on('error', close);
  }

  /** Undoes AI changes, newest first, each only if nothing changed it since. */
  async function revert(ids: string[]) {
    const changes = ids
      .map((id) => grants.change(id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined)
      .sort((a, b) => b.at.localeCompare(a.at));
    if (!changes.length) throw new HttpError(404, 'No such change');
    for (const change of changes) {
      if (change.revertedAt) throw new HttpError(409, 'That change was already undone');
      if (!change.inverse?.length)
        throw new HttpError(409, 'That change can’t be undone automatically');
    }
    await store.transaction(
      'rw',
      STORE_NAMES.map((n) => store[n]),
      async () => {
        for (const change of changes) {
          const guard = change.guard;
          if (guard) {
            if (!(STORE_NAMES as readonly string[]).includes(guard.store))
              throw new HttpError(409, 'That change can’t be undone automatically');
            const record = (await (
              store as unknown as Record<string, { get(id: string): Promise<unknown> }>
            )[guard.store]!.get(guard.id)) as Record<string, unknown> | undefined;
            const moved =
              !record ||
              (guard.revision !== undefined && (record.revision ?? 0) !== guard.revision) ||
              (guard.updatedAt !== undefined && record.updatedAt !== guard.updatedAt) ||
              Object.entries(guard.fields ?? {}).some(
                ([k, v]) => JSON.stringify(record[k] ?? null) !== JSON.stringify(v ?? null),
              );
            if (moved) {
              throw new HttpError(
                409,
                `“${change.summary}” can’t be undone: it changed after that. Change it by hand.`,
              );
            }
          }
          for (const inverse of change.inverse!) {
            const args = await Promise.all(
              inverse.args.map(async (a) =>
                a && typeof a === 'object' && '$revision' in (a as object)
                  ? ((await store.spaceNodes.get((a as { $revision: string }).$revision))
                      ?.revision ?? 0)
                  : a,
              ),
            );
            try {
              await dispatch(owner, { repo: inverse.repo, member: inverse.member, args });
            } catch (error) {
              throw new HttpError(
                409,
                `“${change.summary}” can’t be undone: ${(error as Error).message ?? 'LOWTIDE refused it'}`,
              );
            }
          }
        }
      },
    );
    for (const change of changes) {
      grants.markReverted(change.id);
      log(`undid AI change: ${change.summary}`);
    }
    return changes.map((c) => grants.changes(500).find((x) => x.id === c.id));
  }

  async function ownerRoute(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    url: URL,
    cors: Record<string, string>,
  ) {
    const method = req.method ?? 'GET';
    const json = async () => parseJson(await readBody(req, OWNER_BODY_LIMIT));
    const ok = (body: unknown) => send(res, 200, body, cors);

    if (method === 'GET' && path === '/api/status') return ok(await status());
    // A one-time code for the app launcher to open LOWTIDE paired (ADR-075).
    if (method === 'POST' && path === '/api/pair-codes') return ok(pairCodes.create());
    if (method === 'GET' && path === '/api/events') return openStream(req, res, cors);
    if (method === 'POST' && path === '/api/rpc') {
      const body = await json();
      const call = body as { repo?: unknown; member?: unknown };
      if (call?.repo === 'backup' && call.member === 'restore' && checkpoints) {
        // A restore replaces everything: keep a way back first.
        await checkpoints.create('Before restoring a backup', 'owner', true);
      }
      try {
        return ok({ ok: true, value: (await dispatch(owner, body)) ?? null });
      } catch (error) {
        const wire = toWireError(error);
        if (wire.name === 'Error') log(`rpc error: ${(error as Error)?.stack ?? String(error)}`);
        return ok({ ok: false, error: wire });
      }
    }
    if (method === 'POST' && path === '/api/migrate') {
      const text = await readBody(req, OWNER_BODY_LIMIT);
      const report = await migrateIntoCompanion(store, text, { dataDir: options.dataDir, now });
      log(`migration ${report.ok ? 'completed' : `refused: ${report.problem}`}`);
      return ok(report);
    }
    if (method === 'GET' && path === '/api/ai/grants') return ok(grants.list());
    if (method === 'POST' && path === '/api/ai/grants') {
      const projects = new Set((await store.projects.toArray()).map((p) => p.id));
      const created = grants.create(parseGrant(await json(), projects));
      log(
        `AI grant created: ${created.grant.label} (${created.grant.scope}, ${created.grant.access})`,
      );
      return ok(created);
    }
    const grantPath = /^\/api\/ai\/grants\/([0-9a-f-]{36})$/.exec(path);
    if (method === 'POST' && grantPath) {
      const projects = new Set((await store.projects.toArray()).map((p) => p.id));
      try {
        const updated = grants.update(grantPath[1]!, parseGrantChanges(await json(), projects));
        log(`AI grant changed: ${updated.label} (${updated.scope}, ${updated.preset})`);
        return ok(updated);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, (error as Error).message);
      }
    }
    if (method === 'GET' && path === '/api/ai/changes') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500);
      const since = url.searchParams.get('since') ?? undefined;
      return ok(grants.changes(limit, since));
    }
    const revertOne = /^\/api\/ai\/changes\/([0-9a-f-]{36})\/revert$/.exec(path);
    if (method === 'POST' && revertOne) return ok(await revert([revertOne[1]!]));
    const revertBatch = /^\/api\/ai\/changes\/batch\/([0-9a-f-]{36})\/revert$/.exec(path);
    if (method === 'POST' && revertBatch) {
      const ids = grants
        .changes(500)
        .filter((c) => c.batchId === revertBatch[1] && c.revertible)
        .map((c) => c.id);
      return ok(await revert(ids));
    }
    if (method === 'GET' && path === '/api/checkpoints') return ok(checkpoints?.list() ?? []);
    if (method === 'POST' && path === '/api/checkpoints') {
      if (!checkpoints) throw new HttpError(501, 'Checkpoints need a database file');
      const body = (await json()) as { name?: unknown };
      const name =
        typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : 'Checkpoint';
      const cp = await checkpoints.create(name, 'owner');
      log(`checkpoint taken: ${cp.name}`);
      return ok(cp);
    }
    const checkpointAction =
      /^\/api\/checkpoints\/([0-9TZ-]+-[a-z0-9-]{1,60})\/(restore|remove)$/.exec(path);
    if (method === 'POST' && checkpointAction) {
      if (!checkpoints) throw new HttpError(501, 'Checkpoints need a database file');
      const [, cpId, action] = checkpointAction;
      const known = checkpoints.list().find((c) => c.id === cpId);
      if (!known) throw new HttpError(404, 'No such checkpoint');
      if (action === 'remove') {
        checkpoints.remove(cpId!);
        return ok({ removed: true });
      }
      // Restoring is a normal, validated backup restore, with a checkpoint first.
      await checkpoints.create(`Before restoring ${known.name}`, 'owner', true);
      const inspection = owner.backup.inspect(await checkpoints.readAsBackup(cpId!));
      if (!inspection.ok)
        throw new HttpError(422, `That checkpoint can’t be restored (${inspection.problem})`);
      await owner.backup.restore(inspection.backup);
      log(`restored checkpoint: ${known.name}`);
      return ok({ restored: known });
    }
    if (method === 'GET' && path === '/api/health/details') {
      const check = store.sql.prepare('PRAGMA quick_check').get() as { quick_check: string };
      return ok({
        companion: { running: true, version: COMPANION_VERSION, startedAt, pid: process.pid },
        database: {
          healthy: check.quick_check === 'ok',
          detail: check.quick_check,
          path: database,
          schemaVersion: Number(getMeta(store.sql, 'lowtide_schema_version')),
        },
        mcp: {
          available: true,
          url: `http://127.0.0.1:${port}/mcp`,
          bridge: BRIDGE_PATH,
          sessions: mcp.sessionCount,
        },
        frontend: { served: Boolean(frontend), dir: frontend?.dir ?? null },
        workspace: {
          healthy: !(sync.lastReport?.conflicts.length ?? 0),
          dir: sync.root,
          lastSync: sync.lastReport?.at ?? null,
          conflicts: sync.lastReport?.conflicts ?? [],
        },
        autostart: system.autostart(),
        restart: Boolean(options.onRestart),
      });
    }
    if (method === 'GET' && path === '/api/system/logs') {
      const lines = Math.min(
        Math.max(Number(url.searchParams.get('lines') ?? 200) || 200, 1),
        2000,
      );
      return ok({ file: system.logFile, lines: system.tail(lines) });
    }
    if (method === 'POST' && path === '/api/system/autostart') {
      const body = (await json()) as { enabled?: unknown; restartOnFailure?: unknown };
      try {
        const status = system.setAutostart(body?.enabled === true, body?.restartOnFailure === true);
        log(
          `start at login ${status.enabled ? 'on' : 'off'}${status.restartOnFailure ? ', restart on failure' : ''}`,
        );
        return ok(status);
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
    }
    if (method === 'POST' && path === '/api/system/restart') {
      if (!options.onRestart) throw new HttpError(501, 'This companion can’t restart itself');
      log('restart requested from LOWTIDE');
      setTimeout(() => options.onRestart!(), 150);
      return ok({ restarting: true });
    }
    const revoke = /^\/api\/ai\/grants\/([0-9a-f-]{36})\/revoke$/.exec(path);
    if (method === 'POST' && revoke) {
      const revoked = grants.revoke(revoke[1]!);
      mcp.dropGrant(revoke[1]!);
      return ok({ revoked });
    }
    if (method === 'GET' && path === '/api/ai/audit') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500);
      return ok(grants.auditLog(limit));
    }
    if (method === 'GET' && path === '/api/ai/clients') {
      return ok(clientStatuses(grants.list(), grants.sightings(), now()));
    }
    if (method === 'GET' && path === '/api/workspace') {
      return ok({ dir: sync.root, git: await sync.gitStatus(), lastSync: sync.lastReport ?? null });
    }
    if (method === 'POST' && path === '/api/workspace/git-init') {
      const git = await sync.gitInit();
      log('workspace git repository initialised (no remote)');
      return ok(git);
    }
    throw new HttpError(404, 'Not found');
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const at = now().getTime();
    if (!allowedHosts().has(req.headers.host ?? '')) {
      return send(res, 403, { error: 'Unexpected Host' });
    }
    const origin = req.headers.origin;
    if (
      origin !== undefined &&
      !config.allowedOrigins.includes(origin) &&
      !ownOrigins().has(origin)
    ) {
      return send(res, 403, { error: 'Origin not allowed' });
    }
    const cors: Record<string, string> = origin
      ? {
          'access-control-allow-origin': origin,
          'access-control-expose-headers': 'mcp-session-id',
          vary: 'Origin',
        }
      : {};
    if (req.method === 'OPTIONS') {
      return send(res, 204, undefined, {
        ...cors,
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers':
          'authorization, content-type, mcp-session-id, mcp-protocol-version, last-event-id',
        'access-control-max-age': '600',
        ...(req.headers['access-control-request-private-network'] === 'true'
          ? { 'access-control-allow-private-network': 'true' }
          : {}),
      });
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const path = url.pathname;

    if (req.method === 'GET' && path === '/api/health') return send(res, 200, health(), cors);

    if (path === '/mcp') {
      const grant = grantOf(req);
      if (!grant) {
        if (!limiter.take(`fail:${req.socket.remoteAddress}`, FAILED_AUTH_PER_MINUTE, at)) {
          return send(res, 429, { error: 'Too many attempts' }, cors);
        }
        return send(
          res,
          401,
          { error: 'A valid LOWTIDE grant token is required' },
          {
            ...cors,
            'www-authenticate': 'Bearer realm="lowtide"',
          },
        );
      }
      if (!limiter.take(`grant:${grant.id}`, GRANT_PER_MINUTE, at)) {
        return send(
          res,
          429,
          { error: 'Too many requests; slow down' },
          { ...cors, 'retry-after': '60' },
        );
      }
      for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
      if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
        return send(res, 405, undefined, { ...cors, allow: 'POST, GET, DELETE' });
      }
      let body: unknown;
      if (req.method === 'POST') {
        try {
          body = JSON.parse(await readBody(req, MCP_BODY_LIMIT));
        } catch (error) {
          if (error instanceof HttpError) throw error;
          return send(
            res,
            400,
            { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
            cors,
          );
        }
      }
      const reply = await mcp.handle(grant, req, res, body);
      if (reply) return send(res, reply.status, reply.body, cors);
      return;
    }

    // The page the companion served exchanges a one-time code for the owner
    // token: only from the companion's own origin, and each code only once.
    if (req.method === 'POST' && path === '/api/pair') {
      if (!origin || !ownOrigins().has(origin)) {
        return send(res, 403, { error: 'Pairing works only from the app LOWTIDE serves' }, cors);
      }
      const body = parseJson(await readBody(req, 4096)) as { code?: unknown } | null;
      if (!pairCodes.claim(body?.code)) {
        if (!limiter.take(`fail:${req.socket.remoteAddress}`, FAILED_AUTH_PER_MINUTE, at)) {
          return send(res, 429, { error: 'Too many attempts' }, cors);
        }
        return send(res, 401, { error: 'That pairing code has expired; open LOWTIDE again' }, cors);
      }
      log('the app was paired with a one-time code');
      return send(res, 200, { url: `http://127.0.0.1:${port}`, token: config.ownerToken }, cors);
    }

    if (path.startsWith('/api/')) {
      if (!owned(req)) {
        if (!limiter.take(`fail:${req.socket.remoteAddress}`, FAILED_AUTH_PER_MINUTE, at)) {
          return send(res, 429, { error: 'Too many attempts' }, cors);
        }
        return send(res, 401, { error: 'Pair LOWTIDE with this companion first' }, cors);
      }
      if (!limiter.take('owner', OWNER_PER_MINUTE, at)) {
        return send(res, 429, { error: 'Too many requests' }, { ...cors, 'retry-after': '60' });
      }
      return ownerRoute(req, res, path, url, cors);
    }
    if (frontend?.serve(req, res, path)) return;
    return send(res, 404, { error: 'Not found' }, cors);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        send(res, error.status, { error: error.message });
        return;
      }
      log(`request failed: ${(error as Error)?.stack ?? String(error)}`);
      send(res, 500, { error: 'Something went wrong in the LOWTIDE companion' });
    });
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 120_000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;
  log(`LOWTIDE companion ${COMPANION_VERSION} listening on ${url}`);

  return {
    url,
    port,
    config: { ...config, port },
    database,
    store,
    grants,
    sync,
    mcp,
    async close() {
      await mcp.closeAll();
      await sync.stop();
      for (const res of streams) res.end();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      store.close();
    },
  };
}
