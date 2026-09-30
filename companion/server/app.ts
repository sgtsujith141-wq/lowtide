import { createHash, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_NAMES } from '../../src/db/migrations';
import { createRepositories } from '../../src/db/repositories';
import { loadConfig, type CompanionConfig } from './config';
import {
  CLIENT_KINDS,
  clientStatuses,
  Grants,
  SENSITIVE,
  type Grant,
  type NewGrant,
} from './grants';
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

export const COMPANION_VERSION = '1.0.0';

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

function parseGrant(body: unknown, projectIds: Set<string>): NewGrant {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Expected a grant');
  const b = body as Record<string, unknown>;
  const label = typeof b.label === 'string' ? b.label.trim().slice(0, 80) : '';
  if (!CLIENT_KINDS.includes(b.clientKind as never)) throw new HttpError(400, 'Choose a client');
  if (!['project', 'workspace', 'global'].includes(b.scope as string)) {
    throw new HttpError(400, 'Choose a scope');
  }
  if (b.access !== 'read' && b.access !== 'write') throw new HttpError(400, 'Choose access');
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
    access: b.access,
    allowResolveApprovals: b.allowResolveApprovals === true,
    sensitive: sensitive as NonNullable<NewGrant['sensitive']>,
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
  const log = options.log ?? (() => undefined);
  const database = options.database ?? join(options.dataDir, 'lowtide.sqlite');

  const store = new SqliteStore(database);
  if (database !== ':memory:' && existsSync(database)) chmodSync(database, 0o600);
  const grants = new Grants(store.sql, now);
  const owner = createRepositories(store, { watch: store.watch, clock: now });
  const sync = new WorkspaceSync(store, owner, config.workspaceDir, now, options.syncDebounceMs);
  await sync.start();
  const mcp = new McpServer({ store, grants, sync, now }, COMPANION_VERSION);
  const limiter = new RateLimiter();
  const streams = new Set<ServerResponse>();
  const startedAt = now().toISOString();
  let port = config.port;

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

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
      startedAt,
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
    if (method === 'GET' && path === '/api/events') return openStream(req, res, cors);
    if (method === 'POST' && path === '/api/rpc') {
      const body = await json();
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
    if (origin !== undefined && !config.allowedOrigins.includes(origin)) {
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

    if (req.method === 'GET' && path === '/api/health') {
      return send(res, 200, { app: 'lowtide-companion', version: COMPANION_VERSION }, cors);
    }

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
      const sessionId = req.headers['mcp-session-id'];
      const protocolVersion = req.headers['mcp-protocol-version'];
      if (req.method === 'DELETE') {
        const reply = mcp.delete(grant, typeof sessionId === 'string' ? sessionId : undefined);
        return send(res, reply.status, reply.body, cors);
      }
      if (req.method !== 'POST') {
        return send(res, 405, undefined, { ...cors, allow: 'POST, DELETE' });
      }
      let body: unknown;
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
      const reply = await mcp.post(
        grant,
        {
          ...(typeof sessionId === 'string' ? { sessionId } : {}),
          ...(typeof protocolVersion === 'string' ? { protocolVersion } : {}),
        },
        body,
      );
      return send(res, reply.status, reply.body, { ...cors, ...(reply.headers ?? {}) });
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
