import { parseArgs } from 'node:util';
import { startCompanion } from './app';
import { defaultDataDir, loadConfig, rotateOwnerToken } from './config';

/*
 * lowtide-companion: runs the LOWTIDE companion on 127.0.0.1.
 *
 *   npm run companion                       start (data in ~/.lowtide)
 *   npm run companion -- --data <dir>       use another data directory
 *   npm run companion -- --port <n>         listen on another port (this run)
 *   npm run companion -- --workspace <dir>  sync the workspace elsewhere (this run)
 *   npm run companion -- pair               print the pairing link and exit
 *   npm run companion -- rotate-token       replace the owner token and exit
 */

process.umask(0o077); // everything the companion writes is owner-only

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: 'string' },
    port: { type: 'string' },
    workspace: { type: 'string' },
    app: { type: 'string', default: 'http://localhost:5173' },
    help: { type: 'boolean', short: 'h' },
  },
});

const HELP = `lowtide-companion [pair | rotate-token] [--data <dir>] [--port <n>] [--workspace <dir>] [--app <url>]

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
  const companion = await startCompanion({
    dataDir,
    ...(port !== undefined ? { port } : {}),
    ...(values.workspace ? { workspaceDir: values.workspace } : {}),
    log: (line) => console.log(`[${new Date().toISOString()}] ${line}`),
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
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    /EADDRINUSE/.test(message)
      ? 'That port is already in use: is the companion already running? (Or use --port.)'
      : `The companion couldn’t start: ${message}`,
  );
  process.exitCode = 1;
});
