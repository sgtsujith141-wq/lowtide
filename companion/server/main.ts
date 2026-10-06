import { execFile, spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { startCompanion } from './app';
import { defaultDataDir, loadConfig, rotateOwnerToken } from './config';
import { AlreadyRunningError, portOwner, stopCompanion } from './instance';
import { LaunchError, openLowtide } from './launcher';
import { runtimePaths, setStartAtLogin, writeAgent, writeAppBundle } from './runtime';
import { runNotionImport, summarise } from './notion-import';

/*
 * lowtide-companion: runs the LOWTIDE companion on 127.0.0.1.
 *
 *   npm run companion                       start (data in ~/.lowtide)
 *   npm run companion -- --data <dir>       use another data directory
 *   npm run companion -- --port <n>         listen on another port (this run)
 *   npm run companion -- --workspace <dir>  sync the workspace elsewhere (this run)
 *   npm run companion -- pair               print the pairing link and exit
 *   npm run companion -- rotate-token       replace the owner token and exit
 *   npm run companion -- import-notion --snapshot <dir> --plan <file> [--dry-run]
 *                                           import a Notion snapshot (companion stopped)
 */

process.umask(0o077); // everything the companion writes is owner-only

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: 'string' },
    port: { type: 'string' },
    workspace: { type: 'string' },
    app: { type: 'string', default: 'http://localhost:5173' },
    frontend: { type: 'string' },
    home: { type: 'string' },
    label: { type: 'string' },
    node: { type: 'string' },
    apps: { type: 'string' },
    'launch-agents': { type: 'string' },
    icon: { type: 'string' },
    version: { type: 'string' },
    build: { type: 'string' },
    'start-at-login': { type: 'string' },
    snapshot: { type: 'string' },
    plan: { type: 'string' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const HELP = `lowtide-companion [pair | rotate-token] [--data <dir>] [--port <n>] [--workspace <dir>] [--app <url>] [--frontend <dir>]
lowtide-companion open [--data <dir>] [--port <n>]      open LOWTIDE (starting it first if needed)
lowtide-companion install-agent --node <path> [--home <dir>] [--label <l>] [--launch-agents <dir>] [--start-at-login yes|no]
lowtide-companion install-app --node <path> --version <v> --build <b> [--home <dir>] [--apps <dir>] [--icon <icns>]
lowtide-companion import-notion --snapshot <dir> --plan <file> [--dry-run] [--data <dir>]

Runs the local LOWTIDE companion: the SQLite store, the live workspace and the
MCP endpoint for AI clients, on 127.0.0.1 only.`;

function pairingLink(app: string, url: string, token: string) {
  return `${app.replace(/\/$/, '')}/settings#companion=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;
}

async function main() {
  if (values.help) {
    console.log(HELP);
    return;
  }
  const dataDir = values.data ?? defaultDataDir();
  const command = positionals[0];
  if (command === 'rotate-token') {
    rotateOwnerToken(dataDir);
    console.log('A new owner token was issued. Pair LOWTIDE again with: npm run companion -- pair');
    return;
  }
  if (command === 'pair') {
    const config = loadConfig(dataDir);
    const url = `http://127.0.0.1:${values.port ?? config.port}`;
    console.log(
      `Open this link in the browser where you use LOWTIDE:\n\n  ${pairingLink(values.app!, url, config.ownerToken)}\n`,
    );
    console.log('It carries your owner token: don’t share it or paste it anywhere else.');
    return;
  }
  const paths = () =>
    runtimePaths({
      ...(values.home ? { home: values.home } : {}),
      ...(values.label ? { label: values.label } : {}),
      ...(values['launch-agents'] ? { launchAgentsDir: values['launch-agents'] } : {}),
      ...(values.apps ? { appsDir: values.apps } : {}),
    });
  if (command === 'open') {
    // LOWTIDE.app (v2.3): open LOWTIDE, starting it first if needed.
    const config = loadConfig(dataDir);
    const port = values.port !== undefined ? Number(values.port) : config.port;
    const run = (file: string, args: string[]) =>
      new Promise<boolean>((resolve) => execFile(file, args, (error) => resolve(!error)));
    try {
      const { how } = await openLowtide(
        { port, ownerToken: config.ownerToken, paths: paths() },
        {
          async health(p) {
            try {
              const response = await fetch(`http://127.0.0.1:${p}/api/health`, {
                signal: AbortSignal.timeout(1500),
              });
              const body = (await response.json().catch(() => ({}))) as { app?: string };
              return body.app === 'lowtide-companion' ? body : 'other';
            } catch {
              return undefined;
            }
          },
          launchctl: (args) => run('/bin/launchctl', args),
          spawnCompanion() {
            spawn(process.execPath, [process.argv[1]!, '--data', dataDir, '--port', String(port)], {
              detached: true,
              stdio: 'ignore',
            }).unref();
          },
          async mintCode(p, token) {
            const response = await fetch(`http://127.0.0.1:${p}/api/pair-codes`, {
              method: 'POST',
              headers: { authorization: `Bearer ${token}` },
            });
            if (!response.ok) throw new LaunchError('LOWTIDE refused to open a pairing code.');
            return ((await response.json()) as { code: string }).code;
          },
          async open(url) {
            if (process.env.LOWTIDE_OPEN_WITH === 'print') {
              console.log(url);
              return;
            }
            if (!(await run('/usr/bin/open', [url]))) {
              throw new LaunchError('macOS couldn’t open the browser.');
            }
          },
          exists: existsSync,
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          uid: process.getuid?.() ?? 501,
        },
      );
      console.log(`LOWTIDE opened (${how}).`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }
  if (command === 'install-agent') {
    // The installer (v2.3): the launchd agent for the installed runtime.
    if (!values.node) throw new Error('install-agent needs --node');
    const p = paths();
    writeAgent({
      paths: p,
      node: values.node,
      dataDir,
      port: values.port !== undefined ? Number(values.port) : loadConfig(dataDir).port,
      startAtLogin: values['start-at-login'] !== 'no',
    });
    console.log(
      JSON.stringify({ plist: p.plist, startAtLogin: values['start-at-login'] !== 'no' }),
    );
    return;
  }
  if (command === 'start-at-login') {
    setStartAtLogin(paths(), positionals[1] === 'on');
    return;
  }
  if (command === 'install-app') {
    if (!values.node || !values.version || !values.build) {
      throw new Error('install-app needs --node, --version and --build');
    }
    const bundle = writeAppBundle({
      paths: paths(),
      node: values.node,
      dataDir,
      port: values.port !== undefined ? Number(values.port) : loadConfig(dataDir).port,
      version: values.version,
      build: values.build,
      ...(values.icon ? { icon: values.icon } : {}),
    });
    console.log(JSON.stringify({ app: bundle }));
    return;
  }
  if (command === 'import-notion') {
    if (!values.snapshot || !values.plan) {
      console.error('import-notion needs --snapshot <dir> and --plan <file>');
      process.exitCode = 2;
      return;
    }
    const run = await runNotionImport({
      dataDir,
      snapshotDir: values.snapshot,
      planFile: values.plan,
      dryRun: values['dry-run'] === true,
      ...(values.workspace ? { workspaceDir: values.workspace } : {}),
    });
    console.log(summarise(run));
    return;
  }
  if (command !== undefined) {
    console.error(`Unknown command ${command}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }

  const port = values.port !== undefined ? Number(values.port) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    console.error('--port must be a port number');
    process.exitCode = 2;
    return;
  }
  // Who holds the port (v2.3): reuse a healthy LOWTIDE for this data, stop one
  // that no longer answers, and never touch another program.
  const listenPort = port ?? loadConfig(dataDir).port;
  const owner = await portOwner(listenPort, dataDir);
  if (owner.kind === 'lowtide' && owner.healthy && owner.sameData) {
    console.log(`LOWTIDE is already running on port ${listenPort}; nothing to start.`);
    return;
  }
  if (owner.kind === 'lowtide' && owner.healthy) {
    console.error(
      `Port ${listenPort} is used by another LOWTIDE with different data. Stop it, or use --port.`,
    );
    process.exitCode = 1;
    return;
  }
  if (owner.kind === 'lowtide' && owner.pid !== undefined) {
    console.log(`A LOWTIDE on port ${listenPort} (pid ${owner.pid}) isn't answering; stopping it.`);
    if (!(await stopCompanion(owner.pid))) {
      console.error(`Couldn't stop the unresponsive LOWTIDE (pid ${owner.pid}).`);
      process.exitCode = 1;
      return;
    }
  }
  if (owner.kind === 'other') {
    console.error(
      `Port ${listenPort} is in use by another program${owner.pid ? ` (pid ${owner.pid}${owner.command ? `: ${owner.command.slice(0, 120)}` : ''})` : ''}. LOWTIDE doesn't stop other programs; free the port or use --port.`,
    );
    process.exitCode = 1;
    return;
  }

  // The built app next to this file in an installed runtime (runtime/<build>/frontend);
  // an installed runtime (it has a runtime.json) must have it to be healthy.
  const bundleDir = dirname(realpathSync(process.argv[1] ?? '.'));
  const frontendDir = values.frontend ?? join(bundleDir, '..', 'frontend');
  const requireFrontend =
    values.frontend !== undefined || existsSync(join(bundleDir, '..', 'runtime.json'));
  const companion: Awaited<ReturnType<typeof startCompanion>> = await startCompanion({
    dataDir,
    frontendDir,
    requireFrontend,
    ...(port !== undefined ? { port } : {}),
    ...(values.workspace ? { workspaceDir: values.workspace } : {}),
    log: (line) => console.log(`[${new Date().toISOString()}] ${line}`),
    // Restart (Settings): launchd brings back an agent that restarts on
    // failure; otherwise a fresh copy is started before this one exits.
    onRestart: () => {
      void companion.close().then(() => {
        if (process.env.LOWTIDE_LAUNCHD === '1' && process.env.LOWTIDE_KEEPALIVE === '1') {
          process.exit(75);
        }
        const child = spawn(process.execPath, process.argv.slice(1), {
          detached: true,
          stdio: 'ignore',
          env: process.env,
        });
        child.unref();
        process.exit(0);
      });
    },
  });
  console.log(`
  Data:       ${dataDir}
  Database:   ${companion.database}
  Workspace:  ${companion.sync.root}
  MCP:        ${companion.url}/mcp  (AI clients use their own grant tokens)

  To pair LOWTIDE with this companion, run: npm run companion -- pair
`);

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[${new Date().toISOString()}] ${signal}: closing`);
    companion.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  if (error instanceof AlreadyRunningError) {
    console.log(`${error.message}; nothing to start.`);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    /EADDRINUSE/.test(message)
      ? 'That port is already in use: is the companion already running? (Or use --port.)'
      : `The companion couldn’t start: ${message}`,
  );
  process.exitCode = 1;
});
