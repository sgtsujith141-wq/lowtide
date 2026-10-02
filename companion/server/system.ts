import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/*
 * The companion as a background service (v2.1): its log file, and an
 * optional macOS LaunchAgent that starts it at login (and, if asked,
 * restarts it when it fails). Writing the agent never starts a second copy:
 * it takes effect at the next login, or when the owner restarts the
 * companion from Settings.
 */

export const AGENT_LABEL = 'com.lowtide.companion';
const LOG_LIMIT = 1_000_000;

export interface AutostartStatus {
  supported: boolean;
  enabled: boolean;
  restartOnFailure: boolean;
  /** This process was started by launchd (from the agent). */
  managed: boolean;
  agentPath: string;
}

export class SystemService {
  readonly logFile: string;
  readonly agentPath: string;

  constructor(
    private readonly dataDir: string,
    private readonly program: { node: string; script: string; port: number; cwd: string },
    options: { launchAgentsDir?: string; platform?: string } = {},
  ) {
    this.logFile = join(dataDir, 'companion.log');
    this.agentPath = join(
      options.launchAgentsDir ?? join(homedir(), 'Library', 'LaunchAgents'),
      `${AGENT_LABEL}.plist`,
    );
    this.platform = options.platform ?? process.platform;
  }

  private readonly platform: string;

  /** Appends a line, keeping the file under a megabyte (one older file kept). */
  log(line: string) {
    try {
      if (existsSync(this.logFile) && statSync(this.logFile).size > LOG_LIMIT) {
        renameSync(this.logFile, `${this.logFile}.1`);
      }
      appendFileSync(this.logFile, `${line}\n`, { mode: 0o600 });
    } catch {
      // Logging never breaks the companion.
    }
  }

  /** The last `lines` lines of the log. */
  tail(lines = 200): string[] {
    try {
      const text = readFileSync(this.logFile, 'utf8');
      return text.trimEnd().split('\n').slice(-lines);
    } catch {
      return [];
    }
  }

  autostart(): AutostartStatus {
    const supported = this.platform === 'darwin';
    let enabled = false;
    let restartOnFailure = false;
    if (supported && existsSync(this.agentPath)) {
      enabled = true;
      restartOnFailure = readFileSync(this.agentPath, 'utf8').includes('<key>SuccessfulExit</key>');
    }
    return {
      supported,
      enabled,
      restartOnFailure,
      managed: process.env.LOWTIDE_LAUNCHD === '1',
      agentPath: this.agentPath,
    };
  }

  /** Writes (or removes) the LaunchAgent. */
  setAutostart(enabled: boolean, restartOnFailure: boolean): AutostartStatus {
    if (this.platform !== 'darwin') throw new Error('Starting at login is only set up on macOS');
    if (!enabled) {
      rmSync(this.agentPath, { force: true });
      return this.autostart();
    }
    const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const args = [
      this.program.node,
      this.program.script,
      '--data',
      this.dataDir,
      '--port',
      String(this.program.port),
    ];
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${x(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${x(this.program.cwd)}</string>
  <key>RunAtLoad</key><true/>
${restartOnFailure ? '  <key>KeepAlive</key>\n  <dict><key>SuccessfulExit</key><false/></dict>\n  <key>ThrottleInterval</key><integer>10</integer>' : '  <key>KeepAlive</key><false/>'}
  <key>EnvironmentVariables</key>
  <dict><key>LOWTIDE_LAUNCHD</key><string>1</string>${restartOnFailure ? '<key>LOWTIDE_KEEPALIVE</key><string>1</string>' : ''}</dict>
  <key>StandardOutPath</key><string>${x(this.logFile)}</string>
  <key>StandardErrorPath</key><string>${x(this.logFile)}</string>
</dict>
</plist>
`;
    mkdirSync(join(this.agentPath, '..'), { recursive: true });
    writeFileSync(this.agentPath, plist, { mode: 0o644 });
    return this.autostart();
  }
}
