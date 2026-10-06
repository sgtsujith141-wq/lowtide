#!/usr/bin/env node
/*
 * npm run install:lowtide (v2.3, ADR-073): installs or updates LOWTIDE as a
 * normal Mac app. Run it from the development repository; afterwards daily
 * use needs no Terminal, no npm and no repository.
 *
 *   npm run install:lowtide [-- options]
 *     --check-only            build, stage and rehearse; change nothing that runs
 *     --build <dir>           install this build instead of building one
 *     --start-at-login yes|no (default yes)
 *     --home <dir>            installed runtime (default ~/Library/Application Support/LOWTIDE)
 *     --data <dir>            LOWTIDE's data (default ~/.lowtide; never moved or rewritten)
 *     --port <n>              default: the data folder's companion.json (4318)
 *     --label <l>             launchd label (default com.lowtide.companion)
 *     --apps <dir>            where LOWTIDE.app goes (default /Applications)
 *     --launch-agents <dir>   default ~/Library/LaunchAgents
 *     --node <path>           the Node that runs LOWTIDE (default: this one)
 *     --rollback-with <file>  companion build for the rollback test on a first install
 *
 * 1. Preflight: macOS, Node ≥ 22.22 outside any external volume, the port.
 * 2. Build (npm run build:lowtide) and stage it into <home>/runtime/<build>.
 * 3. Rehearse on a copy of the live database (a fresh backup, checked):
 *    the staged runtime migrates and serves it (health, app, MCP over HTTP
 *    and stdio with the same tools), counts unchanged, integrity ok; then the
 *    previous runtime runs on the migrated copy (the rollback test).
 * 4. Switch current → the new build (previous → the old one), write the
 *    launchd agent and LOWTIDE.app.
 * 5. Restart: launchd runs the installed runtime; the interruption is timed.
 * 6. Verify the live install: health, version, app, MCP, counts, events,
 *    and that launchd owns the process.
 * 7. If 5 or 6 fails: back to the previous runtime (or the companion that
 *    was running), and say so.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  openSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name) => argv.includes(`--${name}`);
const HOME = homedir();
const opts = {
  home: arg('home') ?? join(HOME, 'Library', 'Application Support', 'LOWTIDE'),
  data: arg('data') ?? join(HOME, '.lowtide'),
  label: arg('label') ?? 'com.lowtide.companion',
  launchAgents: arg('launch-agents') ?? join(HOME, 'Library', 'LaunchAgents'),
  apps: arg('apps') ?? '/Applications',
  node: realpathSync(arg('node') ?? process.execPath),
  startAtLogin: (arg('start-at-login') ?? 'yes') !== 'no',
  build: arg('build'),
  checkOnly: flag('check-only'),
  rollbackWith: arg('rollback-with'),
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const uid = process.getuid();
const target = `gui/${uid}/${opts.label}`;
/** Records that must survive unchanged (SPACE may gain LOWTIDE's own pages). */
const KEEP = {
  tasks: 'tasks',
  projects: 'projects',
  milestones: 'milestones',
  decisions: 'decisions',
  hackathons: 'hackathons',
  workSessions: 'work_sessions',
  events: 'events',
  protectedTime: 'protected_time',
};
const report = { startedAt: new Date().toISOString(), options: { ...opts }, steps: [] };
const say = (line) => {
  console.log(line);
  report.steps.push(line);
};
class Stop extends Error {}
const fail = (message) => {
  throw new Stop(message);
};

/* ------------------------------- helpers -------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const launchctl = (...args) => spawnSync('/bin/launchctl', args, { encoding: 'utf8' });
const listener = (port) => {
  const r = spawnSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  const pid = Number(r.stdout.trim().split('\n')[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
};
const commandOf = (pid) =>
  spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
const isCompanion = (pid) => /lowtide-companion|companion\/server\/main/.test(commandOf(pid));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function health(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return await r.json();
  } catch {
    return undefined;
  }
}
async function waitFor(check, ms, every = 50) {
  for (const end = now() + ms; now() < end;) {
    const value = await check();
    if (value) return value;
    await sleep(every);
  }
  return undefined;
}
const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
function vacuumInto(from, to) {
  const db = new DatabaseSync(from, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${to.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}
function integrity(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare('PRAGMA integrity_check').get().integrity_check;
  } finally {
    db.close();
  }
}
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const compare = (before, after, label) => {
  const diff = Object.keys(KEEP)
    .filter((k) => (before[k] ?? 0) !== (after[k] ?? 0))
    .map((k) => `${k} ${before[k] ?? 0}→${after[k] ?? 0}`);
  if (diff.length) fail(`${label}: counts changed: ${diff.join(', ')}`);
};
/** Exact counts straight from a database file (a backup). */
function fileCounts(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Object.fromEntries(
      Object.entries(KEEP).map(([store, table]) => [
        store,
        db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,
      ]),
    );
  } finally {
    db.close();
  }
}
/** Healthy enough to install: the database, the app, the API and MCP (workspace conflicts don't count). */
const installable = (h) =>
  h?.app === 'lowtide-companion' &&
  ['database', 'frontend', 'api', 'mcp'].every((k) => h.checks?.[k]?.ok === true);
async function owner(port, token, path, init = {}) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!r.ok) fail(`${path} answered ${r.status}`);
  return r.json();
}
/** A companion on a throwaway data folder (a copy of a database), on a free port. */
async function scratchCompanion(js, sqliteFile, label) {
  const dir = mkdtempSync(join(tmpdir(), `lowtide-install-${label}-`));
  cpSync(sqliteFile, join(dir, 'lowtide.sqlite'));
  const port = await freePort();
  const token = randomBytes(32).toString('base64url');
  writeFileSync(
    join(dir, 'companion.json'),
    JSON.stringify({ port, ownerToken: token, workspaceDir: join(dir, 'workspace') }),
    { mode: 0o600 },
  );
  const t0 = now();
  const child = spawn(opts.node, [js, '--data', dir, '--port', String(port)], {
    cwd: dir,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => (stderr += c));
  const up = await waitFor(async () => {
    const h = await health(port);
    return h?.app === 'lowtide-companion' ? h : undefined;
  }, 60_000);
  if (!up) {
    child.kill('SIGKILL');
    fail(
      `${label}: ${basename(js)} didn't start on a copy of the data${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}`,
    );
  }
  return {
    dir,
    port,
    token,
    health: up,
    startMs: Math.round(now() - t0),
    async stop() {
      child.kill('SIGTERM');
      await waitFor(() => child.exitCode !== null || child.signalCode !== null, 15_000);
    },
  };
}
/** One MCP exchange over HTTP. */
async function mcpHttp(port, token) {
  const base = `http://127.0.0.1:${port}/mcp`;
  let session;
  let n = 0;
  const post = async (message) => {
    const r = await fetch(base, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-06-18' } : {}),
      },
      body: JSON.stringify(message),
    });
    session = r.headers.get('mcp-session-id') ?? session;
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : undefined };
  };
  const init = await post({
    jsonrpc: '2.0',
    id: ++n,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'lowtide-installer', version: '1' },
    },
  });
  if (init.status !== 200) fail(`MCP initialize answered ${init.status}`);
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const tools = (await post({ jsonrpc: '2.0', id: ++n, method: 'tools/list' })).body.result.tools;
  const caps = (
    await post({
      jsonrpc: '2.0',
      id: ++n,
      method: 'tools/call',
      params: { name: 'get_lowtide_capabilities', arguments: {} },
    })
  ).body.result;
  return { tools: tools.map((t) => t.name).sort(), caps: JSON.parse(caps.content[0].text) };
}
/** The same over the stdio bridge, the way Claude Code runs it. */
async function mcpStdio(bridge, port, token) {
  const child = spawn(opts.node, [bridge, '--url', `http://127.0.0.1:${port}`], {
    env: { ...process.env, LOWTIDE_TOKEN: token, LOWTIDE_AUTOSTART: '0' },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const replies = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const m = JSON.parse(line);
    replies.get(m.id)?.(m);
  });
  const request = (id, method, params) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`stdio: no reply to ${method}`)), 15_000);
      replies.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`,
      );
    });
  try {
    await request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'lowtide-installer', version: '1' },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    );
    const tools = (await request(2, 'tools/list')).result.tools;
    return tools.map((t) => t.name).sort();
  } finally {
    child.kill();
  }
}

/* -------------------------------- steps --------------------------------- */

async function main() {
  // 1. Preflight
  if (process.platform !== 'darwin')
    fail('install:lowtide sets LOWTIDE up as a macOS app; this isn’t macOS');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 22))
    fail(`Node ${process.versions.node} is too old (LOWTIDE needs 22.22 or later)`);
  if (opts.node.startsWith('/Volumes/'))
    fail(`Node at ${opts.node} is on an external volume; pass --node with a Node on this Mac`);
  if (!existsSync(join(opts.data, 'companion.json')))
    fail(`${opts.data} has no companion.json: start LOWTIDE’s companion once first`);
  const config = readJson(join(opts.data, 'companion.json'));
  const port = Number(arg('port') ?? config.port ?? 4318);
  const liveDb = join(opts.data, 'lowtide.sqlite');
  if (!existsSync(liveDb)) fail(`${liveDb} doesn’t exist`);
  const holder = listener(port);
  const running = await health(port);
  if (holder && running?.app !== 'lowtide-companion' && !isCompanion(holder)) {
    fail(
      `port ${port} is used by another program (pid ${holder}: ${commandOf(holder).slice(0, 100)}); LOWTIDE won’t stop it`,
    );
  }
  const runningScript = holder && isCompanion(holder) ? commandOf(holder) : undefined;
  say(
    `1. preflight: Node ${process.versions.node} at ${opts.node}; data ${opts.data}; port ${port}${running ? ` (LOWTIDE ${running.version} running, pid ${holder})` : ' (nothing running)'}`,
  );
  report.port = port;
  report.before = {
    version: running?.version ?? null,
    pid: holder ?? null,
    command: runningScript ?? null,
  };

  // 2. Build and stage
  let buildDir = opts.build;
  if (!buildDir) {
    say('2. building (npm run build:lowtide)');
    const out = execFileSync(process.execPath, [join(REPO, 'scripts', 'build-lowtide.mjs')], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    buildDir = out.trim().split('\n').pop();
  }
  const manifest = readJson(join(buildDir, 'runtime.json'));
  const staged = opts.checkOnly ? buildDir : join(opts.home, 'runtime', manifest.build);
  if (!opts.checkOnly) {
    mkdirSync(join(opts.home, 'runtime'), { recursive: true, mode: 0o700 });
    mkdirSync(join(opts.home, 'logs'), { recursive: true, mode: 0o700 });
    rmSync(staged, { recursive: true, force: true });
    cpSync(buildDir, staged, { recursive: true });
  }
  const stagedJs = join(staged, 'companion', 'lowtide-companion.js');
  say(`   ${opts.checkOnly ? 'build' : 'staged'} ${manifest.build} at ${staged}`);
  report.build = manifest.build;

  // 3. Rehearse on a copy of the live data
  mkdirSync(join(opts.data, 'backups'), { recursive: true, mode: 0o700 });
  const backup = join(opts.data, 'backups', `pre-install-${stamp}.sqlite`);
  vacuumInto(liveDb, backup);
  const backupIntegrity = integrity(backup);
  if (backupIntegrity !== 'ok') fail(`the backup failed its integrity check: ${backupIntegrity}`);
  say(`3. backup ${backup}: integrity ok`);
  report.backup = backup;
  const backupCounts = fileCounts(backup);
  const dry = await scratchCompanion(stagedJs, backup, 'dryrun');
  try {
    const h = dry.health;
    if (h.version !== manifest.version) fail(`the new runtime reports ${h.version}`);
    if (!installable(h)) fail(`the new runtime isn’t healthy: ${JSON.stringify(h.checks)}`);
    const status = await owner(dry.port, dry.token, '/api/status');
    compare(backupCounts, status.counts, 'dry run');
    const page = await fetch(`http://127.0.0.1:${dry.port}/projects`);
    if (page.status !== 200 || !(await page.text()).includes('lowtide-served-by'))
      fail('the new runtime doesn’t serve the app');
    if ((await fetch(`http://127.0.0.1:${dry.port}/mcp`, { method: 'POST' })).status !== 401)
      fail('/mcp doesn’t ask for a grant');
    const grant = await owner(dry.port, dry.token, '/api/ai/grants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'Installer check',
        clientKind: 'other',
        scope: 'global',
        preset: 'full',
        capabilities: undefined,
        access: 'write',
      }),
    });
    const http = await mcpHttp(dry.port, grant.token);
    if (http.caps.lowtide?.version !== manifest.version) fail('MCP reports another version');
    const stdio = await mcpStdio(join(staged, 'mcp', 'lowtide-mcp.js'), dry.port, grant.token);
    if (JSON.stringify(stdio) !== JSON.stringify(http.tools))
      fail('stdio and HTTP list different tools');
    say(
      `   dry run: the new runtime started on a copy in ${dry.startMs} ms; health ok, schema ${h.checks.database.schemaVersion}; counts unchanged; app served; MCP over HTTP and stdio list the same ${http.tools.length} tools`,
    );
    report.dryRun = {
      startMs: dry.startMs,
      tools: http.tools.length,
      schema: h.checks.database.schemaVersion,
    };
  } finally {
    await dry.stop();
  }
  const migrated = join(dry.dir, 'lowtide.sqlite');
  if (integrity(migrated) !== 'ok') fail('the migrated copy failed its integrity check');
  const currentLink = join(opts.home, 'current');
  const previousTarget = existsSync(currentLink) ? realpathSync(currentLink) : undefined;
  const rollbackJs =
    (previousTarget && join(previousTarget, 'companion', 'lowtide-companion.js')) ??
    opts.rollbackWith ??
    runningScript?.match(/(\/\S*lowtide-companion\.js)/)?.[1];
  if (rollbackJs && existsSync(rollbackJs)) {
    const back = await scratchCompanion(rollbackJs, migrated, 'rollback');
    try {
      const status = await owner(back.port, back.token, '/api/status');
      compare(backupCounts, status.counts, 'rollback test');
      say(
        `   rollback test: ${rollbackJs} runs on the migrated copy (started in ${back.startMs} ms), counts unchanged`,
      );
      report.rollbackTest = { with: rollbackJs, ok: true };
    } finally {
      await back.stop();
    }
  } else {
    say('   rollback test: no earlier build to run (nothing was installed or running)');
    report.rollbackTest = { ok: null };
  }
  rmSync(dry.dir, { recursive: true, force: true });
  if (opts.checkOnly) {
    say('Checks passed. --check-only: nothing that runs was changed.');
    return;
  }

  // 4. Switch, agent, app
  const swapLink = (link, to) => {
    const tmp = `${link}.tmp-${process.pid}`;
    rmSync(tmp, { force: true });
    symlinkSync(to, tmp);
    renameSync(tmp, link);
  };
  const previousLink = join(opts.home, 'previous');
  const oldPrevious = existsSync(previousLink) ? readlinkSync(previousLink) : undefined;
  if (previousTarget && previousTarget !== realpathSync(staged))
    swapLink(previousLink, previousTarget);
  swapLink(currentLink, join('runtime', manifest.build));
  const agentLink = join(opts.launchAgents, `${opts.label}.plist`);
  const oldAgent = existsSync(agentLink) ? readFileSync(agentLink) : undefined;
  if (oldAgent) {
    mkdirSync(join(opts.home, 'launchd'), { recursive: true, mode: 0o700 });
    writeFileSync(join(opts.home, 'launchd', `${opts.label}.plist.before-${stamp}`), oldAgent);
  }
  // Until the restart, a failure puts everything back as it was: nothing that runs changed yet.
  const unswitch = (why) => {
    if (previousTarget) swapLink(currentLink, previousTarget);
    else rmSync(currentLink, { force: true });
    if (oldPrevious) swapLink(previousLink, oldPrevious);
    else rmSync(previousLink, { force: true });
    if (oldAgent) writeFileSync(agentLink, oldAgent);
    else rmSync(agentLink, { force: true });
    fail(`${why}; the links and the agent were put back, and the running LOWTIDE wasn’t touched`);
  };
  const cli = (...args) =>
    execFileSync(opts.node, [join(currentLink, 'companion', 'lowtide-companion.js'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, LOWTIDE_HOME: opts.home },
    });
  const common = [
    '--home',
    opts.home,
    '--data',
    opts.data,
    '--port',
    String(port),
    '--label',
    opts.label,
    '--node',
    opts.node,
  ];
  let app;
  try {
    cli(
      'install-agent',
      ...common,
      '--launch-agents',
      opts.launchAgents,
      '--start-at-login',
      opts.startAtLogin ? 'yes' : 'no',
    );
    const icon = join(currentLink, 'app', 'LOWTIDE.icns');
    app = JSON.parse(
      cli(
        'install-app',
        ...common,
        '--apps',
        opts.apps,
        '--version',
        manifest.version,
        '--build',
        manifest.build,
        ...(existsSync(icon) ? ['--icon', icon] : []),
      ).trim(),
    ).app;
  } catch (error) {
    unswitch(`couldn’t write the agent or LOWTIDE.app (${String(error.message).split('\n')[0]})`);
  }
  spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { stdio: 'ignore' });
  say(
    `4. current → ${manifest.build}${previousTarget ? `, previous → ${basename(previousTarget)}` : ''}; launchd agent written (start at login ${opts.startAtLogin ? 'on' : 'off'}); ${app}`,
  );
  report.app = app;

  // 5. Restart under launchd, timed
  const plistToLoad = opts.startAtLogin
    ? agentLink
    : join(opts.home, 'launchd', `${opts.label}.plist`);
  const t0 = now();
  let stoppedAt = t0;
  const restore = async (why) => {
    say(`ROLLING BACK: ${why}`);
    launchctl('bootout', target);
    if (previousTarget) {
      swapLink(currentLink, previousTarget);
      launchctl('bootstrap', `gui/${uid}`, plistToLoad);
    } else {
      // A first install: put back the agent file and the companion that was running.
      if (oldAgent) writeFileSync(agentLink, oldAgent);
      else rmSync(agentLink, { force: true });
      if (runningScript) {
        const [node, ...rest] = runningScript.split(' ');
        const log = openSync(join(opts.data, 'companion.log'), 'a', 0o600);
        spawn(node, rest, { detached: true, stdio: ['ignore', log, log] }).unref();
      }
    }
    const back = await waitFor(
      async () => (await health(port))?.app === 'lowtide-companion',
      60_000,
      100,
    );
    report.rolledBack = { ok: Boolean(back) };
    fail(
      `${why}; ${back ? 'the previous LOWTIDE is running again' : 'LOWTIDE is NOT running: start it from the previous runtime'}`,
    );
  };
  // The live counts at the last moment before the switch: nothing can change while it's down.
  const liveCounts = running
    ? (await owner(port, config.ownerToken, '/api/status')).counts
    : undefined;
  if (launchctl('print', target).status === 0) {
    launchctl('bootout', target);
    await waitFor(async () => !listener(port), 15_000);
    stoppedAt = now();
  } else if (holder && isCompanion(holder)) {
    process.kill(holder, 'SIGTERM');
    if (!(await waitFor(async () => !alive(holder), 15_000))) {
      process.kill(holder, 'SIGKILL');
      await waitFor(async () => !alive(holder), 5_000);
    }
    stoppedAt = now();
  }
  const boot = launchctl('bootstrap', `gui/${uid}`, plistToLoad);
  if (boot.status !== 0) await restore(`launchd refused the agent: ${boot.stderr.trim()}`);
  const up = await waitFor(
    async () => {
      const h = await health(port);
      return installable(h) && h.version === manifest.version ? h : undefined;
    },
    60_000,
    5,
  );
  const t1 = now();
  if (!up) await restore('the installed LOWTIDE didn’t become healthy');
  const downtime = Math.round(t1 - stoppedAt);
  say(
    `5. LOWTIDE ${manifest.version} answering under launchd: old stopped ${Math.round(stoppedAt - t0)} ms after the switch began; unavailable for ${downtime} ms`,
  );
  report.downtimeMs = downtime;

  // 6. Verify
  const pid = listener(port);
  const job = launchctl('print', target).stdout;
  const jobPid = Number(/\bpid = (\d+)/.exec(job)?.[1]);
  if (!pid || jobPid !== pid)
    await restore(`the process on port ${port} (${pid}) isn’t launchd’s (${jobPid || 'none'})`);
  const cmd = commandOf(pid);
  if (!cmd.includes(join(opts.home, 'current')))
    await restore(`the running LOWTIDE isn’t the installed runtime: ${cmd}`);
  const status = await owner(port, config.ownerToken, '/api/status');
  if (liveCounts) compare(liveCounts, status.counts, 'live');
  const page = await fetch(`http://127.0.0.1:${port}/settings`);
  if (page.status !== 200 || !(await page.text()).includes('lowtide-served-by'))
    await restore('the app isn’t served');
  const mcp = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST' });
  if (mcp.status !== 401) await restore(`/mcp answered ${mcp.status} without a grant`);
  const events = await fetch(`http://127.0.0.1:${port}/api/events`, {
    headers: { authorization: `Bearer ${config.ownerToken}` },
    signal: AbortSignal.timeout(3000),
  });
  const first = await events.body.getReader().read();
  if (!events.ok || first.done) await restore('the live event stream didn’t open');
  say(
    `6. verified: launchd runs pid ${pid} from the installed runtime; health ok (schema ${up.checks.database.schemaVersion}); counts unchanged; app, MCP (asks for a grant) and live events answer`,
  );
  report.after = { version: manifest.version, pid, command: cmd };

  // Keep current and previous; remove older builds.
  const keep = new Set([
    realpathSync(currentLink),
    existsSync(join(opts.home, 'previous')) ? realpathSync(join(opts.home, 'previous')) : '',
  ]);
  for (const name of readdirSync(join(opts.home, 'runtime'))) {
    const dir = join(opts.home, 'runtime', name);
    if (!keep.has(realpathSync(dir)) && lstatSync(dir).isDirectory())
      rmSync(dir, { recursive: true, force: true });
  }
  say(`Installed LOWTIDE ${manifest.version} (${manifest.build}). Open it with ${app}.`);
}

main()
  .then(() => {
    report.ok = true;
  })
  .catch((error) => {
    report.ok = false;
    report.error = error.message;
    console.error(error instanceof Stop ? `INSTALL STOPPED: ${error.message}` : error);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      mkdirSync(join(opts.home, 'logs'), { recursive: true, mode: 0o700 });
      writeFileSync(
        join(opts.home, 'logs', `install-${stamp}.json`),
        `${JSON.stringify(report, null, 2)}\n`,
        { mode: 0o600 },
      );
    } catch {
      // The report is a convenience.
    }
  });
