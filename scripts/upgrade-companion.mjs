#!/usr/bin/env node
/*
 * Upgrades a running LOWTIDE companion in place, with a measured, short
 * interruption (v2.1). Nothing here prints the owner token.
 *
 *   node scripts/upgrade-companion.mjs --old <running.js> [--new <next.js>] [--data <dir>] [--check-only]
 *
 * 1. Preflight: the companion answers; its counts are recorded.
 * 2. Backup: a consistent SQLite copy (VACUUM INTO) in <data>/backups, then
 *    `PRAGMA integrity_check` on the copy.
 * 3. Dry run: the new build migrates a scratch copy of that backup on another
 *    port; integrity and counts are checked.
 * 4. Rollback test: the old build starts on the migrated scratch copy and
 *    answers (migrations are additive, so the old build keeps working).
 * 5. Swap (skipped with --check-only): SIGTERM the running companion (it ends
 *    its event streams and closes SQLite), start the new build on the same
 *    port and data, and time the gap until /api/health answers again.
 * 6. Verify: health, schema version, counts, the event stream and the MCP
 *    endpoint. Prints the rollback command.
 *
 * The browser app reconnects its event stream on its own; MCP clients
 * reconnect on their next call.
 */
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const DATA = resolve(arg('data', join(homedir(), '.lowtide')));
const NEW = resolve(arg('new', join(REPO, 'companion/dist/lowtide-companion.js')));
const OLD = arg('old') && resolve(arg('old'));
const CWD = resolve(arg('cwd', REPO));
const CHECK_ONLY = process.argv.includes('--check-only');
if (!OLD)
  throw new Error(
    '--old <path to the build that is running now> is required (for the rollback test)',
  );
for (const f of [NEW, OLD]) if (!existsSync(f)) throw new Error(`missing build: ${f}`);

const config = JSON.parse(readFileSync(join(DATA, 'companion.json'), 'utf8'));
const PORT = config.port ?? 4318;
const BASE = `http://127.0.0.1:${PORT}`;
const now = () => performance.now();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const say = (...a) => console.log(...a);

async function get(base, path, token) {
  const r = await fetch(base + path, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function healthy(base) {
  try {
    return (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })).ok;
  } catch {
    return false;
  }
}
async function waitFor(check, ms, every = 10) {
  const end = now() + ms;
  while (now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, every));
  }
  return false;
}
function sqlite(file, fn) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
const integrity = (file) =>
  sqlite(file, (db) => db.prepare('pragma integrity_check').get().integrity_check);
const migrations = (file) =>
  sqlite(file, (db) =>
    db
      .prepare('select id from companion_migrations order by id')
      .all()
      .map((r) => r.id),
  );
/** Counts that must survive the upgrade unchanged (SPACE may gain its system pages). */
const KEEP = [
  'tasks',
  'projects',
  'milestones',
  'decisions',
  'hackathons',
  'workSessions',
  'events',
  'protectedTime',
];
function compare(before, after, label) {
  const diff = KEEP.filter((k) => before[k] !== after[k]).map(
    (k) => `${k} ${before[k]}→${after[k]}`,
  );
  if (diff.length) throw new Error(`${label}: counts changed: ${diff.join(', ')}`);
  say(`  ${label}: counts unchanged (${KEEP.map((k) => `${k} ${after[k] ?? 0}`).join(', ')})`);
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const exited = (pid, ms = 15_000) => waitFor(async () => !alive(pid), ms, 5);

function start(js, data, out) {
  const child = spawn(process.execPath, [js, '--data', data], {
    cwd: CWD,
    detached: true,
    stdio: ['ignore', 'ignore', out ?? 'ignore'],
  });
  child.unref();
  return child;
}
async function scratch(js, file, port, label) {
  const dir = mkdtempSync(join(tmpdir(), `lowtide-${label}-`));
  copyFileSync(file, join(dir, 'lowtide.sqlite'));
  const token = randomBytes(24).toString('hex');
  writeFileSync(
    join(dir, 'companion.json'),
    JSON.stringify({ port, ownerToken: token, workspaceDir: join(dir, 'workspace') }),
    { mode: 0o600 },
  );
  const t0 = now();
  const child = start(js, dir);
  const up = await waitFor(() => healthy(`http://127.0.0.1:${port}`), 60_000);
  if (!up) throw new Error(`${label}: the companion did not start on ${port}`);
  const ms = Math.round(now() - t0);
  const status = await get(`http://127.0.0.1:${port}`, '/api/status', token);
  const stop = async () => {
    process.kill(child.pid, 'SIGTERM');
    if (!(await exited(child.pid))) throw new Error(`${label}: the scratch companion did not exit`);
  };
  return { dir, ms, status, stop };
}

// 1. Preflight
say(`LOWTIDE companion upgrade — data ${DATA}, port ${PORT}`);
if (!(await healthy(BASE))) throw new Error(`no companion answers on ${PORT}`);
const pid = Number(
  execFileSync('lsof', ['-nP', '-t', `-iTCP:${PORT}`, '-sTCP:LISTEN'])
    .toString()
    .trim()
    .split('\n')[0],
);
const before = await get(BASE, '/api/status', config.ownerToken);
say(`1. running: pid ${pid}, schema ${before.schemaVersion}`);

// 2. Backup + integrity
mkdirSync(join(DATA, 'backups'), { recursive: true, mode: 0o700 });
const backup = join(DATA, 'backups', `pre-upgrade-${stamp}.sqlite`);
{
  const db = new DatabaseSync(join(DATA, 'lowtide.sqlite'), { readOnly: true });
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  db.close();
}
const ok = integrity(backup);
if (ok !== 'ok') throw new Error(`backup integrity: ${ok}`);
say(`2. backup ${backup} — integrity ok, migrations ${migrations(backup).join(',')}`);

// 3. Dry run of the new build on a copy
const dry = await scratch(NEW, backup, PORT + 79, 'dryrun');
compare(before.counts, dry.status.counts, '3. dry run');
await dry.stop();
const migrated = join(dry.dir, 'lowtide.sqlite');
if (integrity(migrated) !== 'ok') throw new Error('dry run: migrated copy failed integrity');
say(
  `   new build started (with migrations) in ${dry.ms} ms; schema ${dry.status.schemaVersion}; migrations ${migrations(migrated).join(',')}; integrity ok`,
);

// 4. Rollback: the old build on the migrated copy
const back = await scratch(OLD, migrated, PORT + 78, 'rollback');
compare(before.counts, back.status.counts, '4. rollback');
await back.stop();
say(`   old build runs on the migrated data (started in ${back.ms} ms)`);
for (const d of [dry.dir, back.dir]) rmSync(d, { recursive: true, force: true });

if (CHECK_ONLY) {
  say('Checks passed. --check-only: the running companion was not touched.');
  process.exit(0);
}

// 5. Swap
const log = openSync(join(DATA, 'companion.log'), 'a', 0o600);
const t0 = now();
process.kill(pid, 'SIGTERM');
const freed = await exited(pid);
if (!freed) throw new Error(`pid ${pid} did not exit; nothing was started`);
const t1 = now();
start(NEW, DATA, log);
const up = await waitFor(() => healthy(BASE), 60_000, 5);
const t2 = now();
if (!up) {
  say('The new build did not answer. Rolling back to the old build.');
  start(OLD, DATA, log);
  await waitFor(() => healthy(BASE), 30_000);
  throw new Error('upgrade failed; the old build is running again');
}
say(
  `5. swapped: old stopped in ${Math.round(t1 - t0)} ms, new answered after ${Math.round(t2 - t1)} ms — companion unavailable for ${Math.round(t2 - t0)} ms`,
);

// 6. Verify
const after = await get(BASE, '/api/status', config.ownerToken);
compare(before.counts, after.counts, '6. live');
const events = await fetch(`${BASE}/api/events`, {
  headers: { authorization: `Bearer ${config.ownerToken}` },
  signal: AbortSignal.timeout(3000),
});
const reader = events.body.getReader();
const first = await reader.read();
await reader.cancel();
const mcp = await fetch(`${BASE}/mcp`, { method: 'POST' });
say(
  `   schema ${after.schemaVersion}; migrations ${migrations(join(DATA, 'lowtide.sqlite')).join(',')}; event stream ${events.ok && !first.done ? 'open' : 'FAILED'}; MCP endpoint ${mcp.status === 401 ? 'answering (asks for a grant)' : mcp.status}`,
);
say(
  `Rollback, if ever needed: kill the companion on ${PORT}, then from ${CWD}: node ${OLD} --data ${DATA}`,
);
say(`(The old build runs on the upgraded data; the backup above is the pre-upgrade copy.)`);
