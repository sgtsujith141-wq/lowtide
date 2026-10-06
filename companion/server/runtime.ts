import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/*
 * The installed LOWTIDE runtime on macOS (v2.3, ADR-073): a copy of the
 * built app, companion and MCP bridge in Application Support that never
 * depends on the development repository, the launchd agent that runs it,
 * and LOWTIDE.app, the launcher a person clicks. User data stays where it
 * always was (~/.lowtide); none of this ever touches it.
 *
 *   ~/Library/Application Support/LOWTIDE/
 *     runtime/<build>/   frontend/  companion/lowtide-companion.js
 *                        mcp/lowtide-mcp.js  app/  runtime.json
 *     current  -> runtime/<build>     (what runs)
 *     previous -> runtime/<build>     (the rollback)
 *     launchd/com.lowtide.companion.plist   (the agent, always kept here)
 *     logs/                           (launchd output, launcher log)
 *   ~/Library/LaunchAgents/com.lowtide.companion.plist  (a copy: start at login)
 *   /Applications/LOWTIDE.app
 */

export const DEFAULT_LABEL = 'com.lowtide.companion';
export const APP_BUNDLE_ID = 'com.lowtide.app';

export interface RuntimePaths {
  home: string;
  runtimeDir: string;
  current: string;
  previous: string;
  logs: string;
  launchdDir: string;
  /** The agent's canonical plist (always present once installed). */
  plist: string;
  /** Its copy in ~/Library/LaunchAgents: present exactly when it starts at login. */
  agentLink: string;
  /** Stable paths through `current`, for the agent, the launcher and MCP clients. */
  companion: string;
  bridge: string;
  appBundle: string;
  label: string;
}

export function runtimePaths(
  options: { home?: string; label?: string; launchAgentsDir?: string; appsDir?: string } = {},
): RuntimePaths {
  const home =
    options.home ??
    process.env.LOWTIDE_HOME ??
    join(homedir(), 'Library', 'Application Support', 'LOWTIDE');
  const label = options.label ?? process.env.LOWTIDE_LAUNCHD_LABEL ?? DEFAULT_LABEL;
  const current = join(home, 'current');
  return {
    home,
    runtimeDir: join(home, 'runtime'),
    current,
    previous: join(home, 'previous'),
    logs: join(home, 'logs'),
    launchdDir: join(home, 'launchd'),
    plist: join(home, 'launchd', `${label}.plist`),
    agentLink: join(
      options.launchAgentsDir ??
        process.env.LOWTIDE_LAUNCH_AGENTS_DIR ??
        join(homedir(), 'Library', 'LaunchAgents'),
      `${label}.plist`,
    ),
    companion: join(current, 'companion', 'lowtide-companion.js'),
    bridge: join(current, 'mcp', 'lowtide-mcp.js'),
    appBundle: join(options.appsDir ?? '/Applications', 'LOWTIDE.app'),
    label,
  };
}

export interface RuntimeManifest {
  version: string;
  build: string;
  commit?: string;
  builtAt: string;
  node: string;
}

/**
 * The installed runtime this file belongs to, when it runs from one
 * (<home>/runtime/<build>/companion/<file>); undefined in development.
 */
export function installedRuntimeOf(
  bundleFile: string,
): { home: string; build: string; manifest: RuntimeManifest } | undefined {
  const buildDir = dirname(dirname(bundleFile));
  const manifestFile = join(buildDir, 'runtime.json');
  if (!existsSync(manifestFile)) return undefined;
  try {
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as RuntimeManifest;
    return { home: dirname(dirname(buildDir)), build: manifest.build, manifest };
  } catch {
    return undefined;
  }
}

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The launchd agent for the installed runtime: started at load (login, or a
 * bootstrap by the launcher), restarted when it exits unexpectedly, only in
 * a GUI login session, with a minimal environment and its own log.
 */
export function agentPlist(options: {
  paths: RuntimePaths;
  node: string;
  dataDir: string;
  port: number;
}): string {
  const { paths } = options;
  const args = [
    options.node,
    paths.companion,
    '--data',
    options.dataDir,
    '--port',
    String(options.port),
  ];
  const log = join(paths.logs, 'companion.out.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(paths.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${xml(paths.home)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LOWTIDE_LAUNCHD</key><string>1</string>
    <key>LOWTIDE_KEEPALIVE</key><string>1</string>
    <key>LOWTIDE_HOME</key><string>${xml(paths.home)}</string>
    <key>LOWTIDE_LAUNCHD_LABEL</key><string>${xml(paths.label)}</string>
    <key>LOWTIDE_LAUNCH_AGENTS_DIR</key><string>${xml(dirname(paths.agentLink))}</string>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

/** Writes the canonical agent plist, and its LaunchAgents copy when it should start at login. */
export function writeAgent(options: {
  paths: RuntimePaths;
  node: string;
  dataDir: string;
  port: number;
  startAtLogin: boolean;
}): void {
  const { paths } = options;
  mkdirSync(paths.launchdDir, { recursive: true, mode: 0o700 });
  mkdirSync(paths.logs, { recursive: true, mode: 0o700 });
  const plist = agentPlist(options);
  writeFileSync(paths.plist, plist, { mode: 0o644 });
  setStartAtLogin(paths, options.startAtLogin);
}

/**
 * Start at login on: the agent's copy in ~/Library/LaunchAgents (loaded at
 * every login). Off: the copy is removed; the running LOWTIDE keeps running,
 * and LOWTIDE.app still starts it (supervised) from the canonical plist.
 */
export function setStartAtLogin(paths: RuntimePaths, on: boolean): void {
  if (!on) {
    rmSync(paths.agentLink, { force: true });
    return;
  }
  if (!existsSync(paths.plist)) throw new Error('LOWTIDE isn’t installed: no launchd agent to use');
  mkdirSync(dirname(paths.agentLink), { recursive: true });
  writeFileSync(paths.agentLink, readFileSync(paths.plist), { mode: 0o644 });
}

export function startsAtLogin(paths: RuntimePaths): boolean {
  return existsSync(paths.agentLink);
}

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** LOWTIDE.app's executable: run the launcher, show an alert if it can't open LOWTIDE. */
export function appLauncherScript(options: {
  paths: RuntimePaths;
  node: string;
  dataDir: string;
  port: number;
}): string {
  const { paths } = options;
  return `#!/bin/sh
# LOWTIDE.app: opens LOWTIDE, starting it first if it isn't running.
# Written by the LOWTIDE installer; it runs the installed runtime, never a repository.
NODE=${sh(options.node)}
LAUNCHER=${sh(paths.companion)}
LOG=${sh(join(paths.logs, 'launcher.log'))}
export LOWTIDE_HOME=${sh(paths.home)}
export LOWTIDE_LAUNCHD_LABEL=${sh(paths.label)}
export LOWTIDE_LAUNCH_AGENTS_DIR=${sh(dirname(paths.agentLink))}
alert() {
  [ -n "$LOWTIDE_NO_ALERT" ] && return 0
  /usr/bin/osascript -e 'on run argv' -e 'display alert (item 1 of argv) message (item 2 of argv) as critical' -e 'end run' "$1" "$2" >/dev/null 2>&1
}
if [ ! -x "$NODE" ] || [ ! -f "$LAUNCHER" ]; then
  alert "LOWTIDE isn’t installed" "Install it again from the LOWTIDE repository with: npm run install:lowtide"
  exit 1
fi
OUT=$("$NODE" "$LAUNCHER" open --data ${sh(options.dataDir)} --port ${options.port} 2>&1)
STATUS=$?
printf '%s %s\\n' "$(/bin/date '+%Y-%m-%dT%H:%M:%S')" "$(printf '%s' "$OUT" | /usr/bin/tail -n 1)" >> "$LOG"
if [ $STATUS -ne 0 ]; then
  alert "LOWTIDE couldn’t open" "$(printf '%s' "$OUT" | /usr/bin/tail -n 1)"
  exit 1
fi
`;
}

export function appInfoPlist(version: string, build: string, hasIcon: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>LOWTIDE</string>
  <key>CFBundleDisplayName</key><string>LOWTIDE</string>
  <key>CFBundleIdentifier</key><string>${APP_BUNDLE_ID}</string>
  <key>CFBundleExecutable</key><string>LOWTIDE</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${xml(version)}</string>
  <key>CFBundleVersion</key><string>${xml(build)}</string>${hasIcon ? '\n  <key>CFBundleIconFile</key><string>LOWTIDE</string>' : ''}
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;
}

/** Writes LOWTIDE.app (replacing an older one). The icon is optional. */
export function writeAppBundle(options: {
  paths: RuntimePaths;
  node: string;
  dataDir: string;
  port: number;
  version: string;
  build: string;
  icon?: string;
}): string {
  const bundle = options.paths.appBundle;
  rmSync(bundle, { recursive: true, force: true });
  mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(bundle, 'Contents', 'Resources'), { recursive: true });
  const hasIcon = Boolean(options.icon && existsSync(options.icon));
  if (hasIcon) {
    writeFileSync(
      join(bundle, 'Contents', 'Resources', 'LOWTIDE.icns'),
      readFileSync(options.icon!),
    );
  }
  writeFileSync(
    join(bundle, 'Contents', 'Info.plist'),
    appInfoPlist(options.version, options.build, hasIcon),
  );
  const executable = join(bundle, 'Contents', 'MacOS', 'LOWTIDE');
  writeFileSync(executable, appLauncherScript(options));
  chmodSync(executable, 0o755);
  return bundle;
}
