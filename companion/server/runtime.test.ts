// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LaunchError, openLowtide, type LauncherDeps } from './launcher';
import {
  agentPlist,
  installedRuntimeOf,
  runtimePaths,
  setStartAtLogin,
  startsAtLogin,
  writeAgent,
  writeAppBundle,
} from './runtime';
import { SystemService } from './system';
import { tunnelStatus } from './tunnel';

/*
 * v2.3 (ADR-073): the installed runtime, its launchd agent, LOWTIDE.app and
 * the launcher, all in throwaway folders. Nothing here touches the real
 * LaunchAgents, /Applications or any running LOWTIDE.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'lowtide runtime ')); // a space, like Application Support
  dirs.push(root);
  const paths = runtimePaths({
    home: join(root, 'Application Support', 'LOWTIDE'),
    label: 'com.lowtide.test',
    launchAgentsDir: join(root, 'LaunchAgents'),
    appsDir: join(root, 'Applications'),
  });
  return { root, paths };
}
const lint = (file: string) => {
  if (process.platform !== 'darwin') return;
  expect(spawnSync('/usr/bin/plutil', ['-lint', file]).status, file).toBe(0);
};

describe('the installed runtime layout and its agent', () => {
  it('runs the installed copy through current, never a repository, and restarts it on failure', () => {
    const { paths } = sandbox();
    const plist = agentPlist({
      paths,
      node: '/usr/local/bin/node',
      dataDir: '/Users/x/.lowtide',
      port: 4318,
    });
    expect(plist).toContain(
      `<string>${paths.home}/current/companion/lowtide-companion.js</string>`,
    );
    expect(plist).toContain('<string>/usr/local/bin/node</string>');
    expect(plist).toMatch(/<key>RunAtLoad<\/key><true\/>/);
    expect(plist).toMatch(
      /<key>KeepAlive<\/key>\s*<dict><key>SuccessfulExit<\/key><false\/><\/dict>/,
    );
    expect(plist).toContain('<key>LimitLoadToSessionType</key><string>Aqua</string>');
    expect(plist).toContain(`<string>${paths.home}/logs/companion.out.log</string>`);
    expect(plist).toContain('<key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>');
    expect(plist).not.toMatch(/\/Volumes\//);
  });

  it('writes the agent, and start at login adds or removes only its LaunchAgents copy', () => {
    const { paths } = sandbox();
    writeAgent({
      paths,
      node: '/usr/local/bin/node',
      dataDir: '/tmp/d',
      port: 4318,
      startAtLogin: true,
    });
    lint(paths.plist);
    expect(startsAtLogin(paths)).toBe(true);
    expect(readFileSync(paths.agentLink, 'utf8')).toBe(readFileSync(paths.plist, 'utf8'));
    expect(statSync(paths.plist).mode & 0o777).toBe(0o644);
    setStartAtLogin(paths, false);
    expect(startsAtLogin(paths)).toBe(false);
    expect(existsSync(paths.plist)).toBe(true); // kept, so the app can still start it
    setStartAtLogin(paths, true);
    expect(startsAtLogin(paths)).toBe(true);
  });

  it('knows when it runs from an installed runtime', () => {
    const { paths } = sandbox();
    const build = join(paths.runtimeDir, '2.3.0-test');
    mkdirSync(join(build, 'companion'), { recursive: true });
    const file = join(build, 'companion', 'lowtide-companion.js');
    expect(installedRuntimeOf(file)).toBeUndefined();
    writeFileSync(
      join(build, 'runtime.json'),
      JSON.stringify({ version: '2.3.0', build: '2.3.0-test', builtAt: 'now', node: '>=22.22' }),
    );
    expect(installedRuntimeOf(file)).toMatchObject({ home: paths.home, build: '2.3.0-test' });
  });

  it('Settings turns start at login on and off for the installed agent', () => {
    const { paths } = sandbox();
    writeAgent({
      paths,
      node: '/usr/local/bin/node',
      dataDir: '/tmp/d',
      port: 4318,
      startAtLogin: false,
    });
    const service = new SystemService(
      mkdtempSync(join(tmpdir(), 'lowtide-data-')),
      { node: '/usr/local/bin/node', script: 'x', port: 4318, cwd: '/' },
      { platform: 'darwin', installed: { paths, build: 'b1', version: '2.3.0' } },
    );
    expect(service.autostart()).toMatchObject({
      enabled: false,
      restartOnFailure: true,
      installed: { build: 'b1', version: '2.3.0' },
    });
    expect(service.setAutostart(true, false)).toMatchObject({
      enabled: true,
      restartOnFailure: true,
    });
    expect(existsSync(paths.agentLink)).toBe(true);
    expect(service.setAutostart(false, true).enabled).toBe(false);
  });
});

describe('LOWTIDE.app', () => {
  it('is a valid app bundle whose launcher runs the installed runtime', () => {
    const { root, paths } = sandbox();
    const bundle = writeAppBundle({
      paths,
      node: process.execPath,
      dataDir: join(root, 'data dir'),
      port: 4999,
      version: '2.3.0',
      build: '2.3.0-test',
    });
    const info = join(bundle, 'Contents', 'Info.plist');
    lint(info);
    expect(readFileSync(info, 'utf8')).toContain('<string>com.lowtide.app</string>');
    const exe = join(bundle, 'Contents', 'MacOS', 'LOWTIDE');
    expect(statSync(exe).mode & 0o111).not.toBe(0);
    expect(spawnSync('/bin/sh', ['-n', exe]).status).toBe(0);
    const script = readFileSync(exe, 'utf8');
    expect(script).not.toMatch(/\/Volumes\//);

    // With a stand-in launcher: it gets the data folder and port, and the run is logged.
    mkdirSync(join(paths.current, 'companion'), { recursive: true });
    mkdirSync(paths.logs, { recursive: true });
    writeFileSync(
      paths.companion,
      'console.log("LOWTIDE opened (running).", JSON.stringify(process.argv.slice(2)));',
    );
    const ok = spawnSync(exe, [], {
      encoding: 'utf8',
      env: { ...process.env, LOWTIDE_NO_ALERT: '1' },
    });
    expect(ok.status).toBe(0);
    const log = readFileSync(join(paths.logs, 'launcher.log'), 'utf8');
    expect(log).toContain('LOWTIDE opened (running).');
    expect(log).toContain(
      JSON.stringify(['open', '--data', join(root, 'data dir'), '--port', '4999']),
    );

    writeFileSync(paths.companion, 'console.error("LOWTIDE didn’t start."); process.exit(1);');
    const failed = spawnSync(exe, [], {
      encoding: 'utf8',
      env: { ...process.env, LOWTIDE_NO_ALERT: '1' },
    });
    expect(failed.status).toBe(1);
    expect(readFileSync(join(paths.logs, 'launcher.log'), 'utf8')).toContain('didn’t start');
  });

  it('is signed ad hoc when codesign is available', () => {
    if (process.platform !== 'darwin') return;
    const { paths } = sandbox();
    const bundle = writeAppBundle({
      paths,
      node: process.execPath,
      dataDir: '/tmp/d',
      port: 4318,
      version: '2.3.0',
      build: 'b',
    });
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', bundle]);
    expect(spawnSync('/usr/bin/codesign', ['--verify', bundle]).status).toBe(0);
  });
});

describe('the launcher (what clicking LOWTIDE.app does)', () => {
  function deps(state: {
    up: boolean;
    loaded?: boolean;
    other?: boolean;
    comesUp?: boolean;
    plist?: boolean;
  }) {
    const calls: string[] = [];
    const d: LauncherDeps = {
      async health() {
        if (state.other) return 'other';
        return state.up ? { app: 'lowtide-companion', status: 'ok' } : undefined;
      },
      async launchctl(args) {
        calls.push(`launchctl ${args.join(' ')}`);
        if (args[0] === 'print') return Boolean(state.loaded);
        if (state.comesUp !== false) state.up = true;
        return true;
      },
      spawnCompanion() {
        calls.push('spawn');
        state.up = true;
      },
      async mintCode() {
        calls.push('mint');
        return 'C'.repeat(43);
      },
      async open(url) {
        calls.push(`open ${url}`);
      },
      exists: () => Boolean(state.plist),
      sleep: async () => undefined,
      uid: 501,
    };
    return { d, calls };
  }
  const opts = () => ({
    port: 4318,
    ownerToken: 'o'.repeat(43),
    paths: sandbox().paths,
    waitMs: 50,
  });

  it('opens a running LOWTIDE paired, without touching launchd', async () => {
    const { d, calls } = deps({ up: true });
    const result = await openLowtide(opts(), d);
    expect(result).toEqual({
      url: `http://127.0.0.1:4318/#pair=${'C'.repeat(43)}`,
      how: 'running',
    });
    expect(calls).toEqual(['mint', `open ${result.url}`]);
  });

  it('kickstarts a loaded agent, bootstraps an unloaded one, or starts a dev companion', async () => {
    const loaded = deps({ up: false, loaded: true });
    expect((await openLowtide(opts(), loaded.d)).how).toBe('kickstarted');
    expect(loaded.calls[1]).toBe('launchctl kickstart -k gui/501/com.lowtide.test');
    const unloaded = deps({ up: false, loaded: false, plist: true });
    expect((await openLowtide(opts(), unloaded.d)).how).toBe('bootstrapped');
    expect(unloaded.calls[1]).toMatch(/^launchctl bootstrap gui\/501 .*com\.lowtide\.test\.plist$/);
    const dev = deps({ up: false, loaded: false, plist: false });
    expect((await openLowtide(opts(), dev.d)).how).toBe('spawned');
  });

  it('refuses when another program holds the port, and says so when LOWTIDE doesn’t come up', async () => {
    await expect(openLowtide(opts(), deps({ up: false, other: true }).d)).rejects.toThrow(
      /used by another program/,
    );
    const stuck = deps({ up: false, loaded: true, comesUp: false });
    await expect(openLowtide(opts(), stuck.d)).rejects.toBeInstanceOf(LaunchError);
    expect(stuck.calls).not.toContain('mint');
  });
});

describe('the ChatGPT connection status', () => {
  it('is not configured, and names the supported tunnel clients it finds', async () => {
    expect(await tunnelStatus({ path: '/nowhere', exists: () => false })).toEqual({
      status: 'not-configured',
      clientsInstalled: [],
      docs: 'docs/integrations/CHATGPT-MCP.md',
    });
    const found = await tunnelStatus({ path: '/x', exists: (p) => p === '/x/cloudflared' });
    expect(found.clientsInstalled).toEqual(['cloudflared']);
  });
});
