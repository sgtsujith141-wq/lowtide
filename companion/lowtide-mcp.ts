#!/usr/bin/env node
/*
 * lowtide-mcp: the stdio bridge for MCP clients that launch a local command
 * (Claude Code, Claude Desktop). It forwards each newline-delimited JSON-RPC
 * message to the running LOWTIDE companion's /mcp endpoint with this
 * client's grant token, and writes the replies back to stdout. It holds no
 * data and never touches the database: the companion does all the work and
 * all the checks.
 *
 *   LOWTIDE_TOKEN=<grant token> node lowtide-mcp.js [--url http://127.0.0.1:4318]
 *
 * If the companion restarts, the bridge opens a new session transparently.
 * While the client is attached it pings every minute, so LOWTIDE can show
 * the client as connected. If LOWTIDE isn't running at the default address
 * on macOS, the bridge asks launchd once to start the installed LOWTIDE
 * (v2.3); it never starts anything for any other address. Built-ins only,
 * so Node runs this file directly from source too.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const DEFAULT_URL = 'http://127.0.0.1:4318';
const base = (flag('url') ?? process.env.LOWTIDE_URL ?? DEFAULT_URL).replace(/\/$/, '');
const token = process.env.LOWTIDE_TOKEN ?? flag('token');
const KEEPALIVE_MS = 60_000;
const LABEL = process.env.LOWTIDE_LAUNCHD_LABEL ?? 'com.lowtide.companion';
const LAUNCHCTL = process.env.LOWTIDE_LAUNCHCTL ?? '/bin/launchctl';
const START_WAIT_MS = Number(process.env.LOWTIDE_START_WAIT_MS ?? 15_000);

type Message = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: unknown };

const log = (line: string) => process.stderr.write(`lowtide-mcp: ${line}\n`);
const out = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
const fail = (id: Message['id'], message: string) =>
  out({ jsonrpc: '2.0', id: id ?? null, error: { code: -32000, message } });

if (!token) {
  log('set LOWTIDE_TOKEN to the grant token LOWTIDE showed you (Settings → AI access)');
  process.exit(2);
}

let sessionId: string | undefined;
let protocolVersion: string | undefined;
let initialize: Message | undefined;
let keepalive: ReturnType<typeof setInterval> | undefined;
let pings = 0;

async function post(message: Message): Promise<{ status: number; body?: unknown }> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion;
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });
  const newSession = response.headers.get('mcp-session-id');
  if (newSession) sessionId = newSession;
  const text = await response.text();
  return { status: response.status, ...(text ? { body: JSON.parse(text) as unknown } : {}) };
}

/** Opens a session again after the companion restarted (or dropped it). */
async function reinitialize(): Promise<boolean> {
  if (!initialize) return false;
  sessionId = undefined;
  const reply = await post(initialize);
  if (reply.status !== 200 || !sessionId) return false;
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  log('reconnected to the companion with a new session');
  return true;
}

const run = (args: string[]) =>
  new Promise<boolean>((resolve) => execFile(LAUNCHCTL, args, (error) => resolve(!error)));

async function healthy(): Promise<boolean> {
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

let startAttempted = false;

/**
 * Asks launchd, once, to start the installed LOWTIDE: only for the default
 * address on macOS (LOWTIDE_AUTOSTART=1 forces it, =0 turns it off).
 */
async function startLowtide(): Promise<boolean> {
  const wanted =
    process.env.LOWTIDE_AUTOSTART === '1' ||
    (process.env.LOWTIDE_AUTOSTART !== '0' &&
      base === DEFAULT_URL &&
      process.platform === 'darwin');
  if (!wanted || startAttempted) return false;
  startAttempted = true;
  const domain = `gui/${process.getuid?.() ?? 501}`;
  const here = dirname(fileURLToPath(import.meta.url));
  const plist = [
    process.env.LOWTIDE_AGENT_PLIST,
    join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`),
    // The installed runtime: <LOWTIDE>/runtime/<build>/mcp/lowtide-mcp.js
    join(here, '..', '..', '..', 'launchd', `${LABEL}.plist`),
  ].find((p): p is string => typeof p === 'string' && existsSync(p));
  const started = (await run(['print', `${domain}/${LABEL}`]))
    ? await run(['kickstart', `${domain}/${LABEL}`])
    : plist
      ? await run(['bootstrap', domain, plist])
      : false;
  if (!started) return false;
  log('started LOWTIDE through launchd; waiting for it');
  for (const end = Date.now() + START_WAIT_MS; Date.now() < end;) {
    if (await healthy()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function forward(message: Message) {
  const isRequest = message.method !== undefined && message.id !== undefined && message.id !== null;
  try {
    if (message.method === 'initialize') {
      initialize = message;
      sessionId = undefined;
    }
    let reply = await post(message);
    if (reply.status === 404 && message.method !== 'initialize' && (await reinitialize())) {
      reply = await post(message);
    }
    if (message.method === 'initialize' && reply.status === 200) {
      const result = (reply.body as { result?: { protocolVersion?: string } }).result;
      protocolVersion = result?.protocolVersion;
      startKeepalive();
    }
    if (reply.status === 401) {
      if (isRequest)
        fail(
          message.id,
          'LOWTIDE refused this grant token (revoked or mistyped). Create a new one in LOWTIDE → AI.',
        );
      return;
    }
    if (reply.status === 429) {
      if (isRequest) fail(message.id, 'Too many requests to LOWTIDE; wait a minute.');
      return;
    }
    if (reply.body !== undefined && isRequest) out(reply.body);
  } catch {
    if (await startLowtide()) return forward(message);
    if (isRequest) {
      fail(
        message.id,
        `LOWTIDE isn’t reachable at ${base}. Open the LOWTIDE app (or turn on Settings → Start LOWTIDE at login), then try again.`,
      );
    }
  }
}

function startKeepalive() {
  if (keepalive) return;
  keepalive = setInterval(() => {
    const ping: Message = { jsonrpc: '2.0', id: `lowtide-keepalive-${++pings}`, method: 'ping' };
    post(ping)
      .then((reply) => (reply.status === 404 ? reinitialize() : undefined))
      .catch(() => undefined);
  }, KEEPALIVE_MS);
  keepalive.unref();
}

let queue: Promise<void> = Promise.resolve();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let message: Message;
  try {
    message = JSON.parse(line) as Message;
  } catch {
    out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  queue = queue.then(() => forward(message));
});
lines.on('close', () => {
  queue
    .then(async () => {
      if (keepalive) clearInterval(keepalive);
      if (sessionId) {
        await fetch(`${base}/mcp`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}`, 'mcp-session-id': sessionId },
        }).catch(() => undefined);
      }
    })
    .finally(() => process.exit(0));
});
