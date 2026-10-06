import type { RuntimePaths } from './runtime';

/*
 * What LOWTIDE.app does when it's clicked (v2.3, ADR-073): open the running
 * LOWTIDE, or start it first. It never opens a Terminal and never needs npm.
 *
 * 1. A LOWTIDE answering on the port is used as it is (even degraded, it
 *    serves the app). Another program on the port is reported, untouched.
 * 2. Otherwise launchd starts the installed runtime: kickstart when the agent
 *    is loaded, bootstrap its plist when it isn't. Without an agent (a
 *    development setup) the companion is started directly.
 * 3. Once healthy, a one-time pairing code (ADR-075) opens LOWTIDE already
 *    connected in the default browser.
 */

export interface Health {
  app?: string;
  status?: string;
}

export interface LauncherDeps {
  /** /api/health on the port; undefined when nothing answers; 'other' when it isn't LOWTIDE. */
  health(port: number): Promise<Health | 'other' | undefined>;
  launchctl(args: string[]): Promise<boolean>;
  spawnCompanion(): void;
  mintCode(port: number, ownerToken: string): Promise<string>;
  open(url: string): Promise<void>;
  exists(path: string): boolean;
  sleep(ms: number): Promise<void>;
  uid: number;
}

export type HowStarted = 'running' | 'kickstarted' | 'bootstrapped' | 'spawned';

export class LaunchError extends Error {
  override name = 'LaunchError';
}

export async function openLowtide(
  options: { port: number; ownerToken: string; paths: RuntimePaths; waitMs?: number },
  deps: LauncherDeps,
): Promise<{ url: string; how: HowStarted }> {
  const { port, paths } = options;
  const answering = async () => {
    const h = await deps.health(port);
    if (h === 'other') {
      throw new LaunchError(
        `Port ${port} is used by another program, so LOWTIDE can’t start there. Quit that program and open LOWTIDE again.`,
      );
    }
    return h?.app === 'lowtide-companion';
  };

  let how: HowStarted = 'running';
  if (!(await answering())) {
    const target = `gui/${deps.uid}/${paths.label}`;
    if (await deps.launchctl(['print', target])) {
      // Loaded but not answering: crashed, throttled or stuck. Start it again now.
      if (!(await deps.launchctl(['kickstart', '-k', target]))) {
        throw new LaunchError('launchd refused to start LOWTIDE.');
      }
      how = 'kickstarted';
    } else {
      const plist = [paths.agentLink, paths.plist].find((p) => deps.exists(p));
      if (plist) {
        if (!(await deps.launchctl(['bootstrap', `gui/${deps.uid}`, plist]))) {
          throw new LaunchError('launchd refused to load LOWTIDE’s agent.');
        }
        how = 'bootstrapped';
      } else {
        deps.spawnCompanion();
        how = 'spawned';
      }
    }
    let up = false;
    for (const end = Date.now() + (options.waitMs ?? 30_000); !up && Date.now() < end;) {
      await deps.sleep(250);
      up = await answering();
    }
    if (!up) {
      throw new LaunchError(
        `LOWTIDE didn’t start. Its logs are in ${paths.logs} and ~/.lowtide/companion.log.`,
      );
    }
  }
  const code = await deps.mintCode(port, options.ownerToken);
  const url = `http://127.0.0.1:${port}/#pair=${code}`;
  await deps.open(url);
  return { url, how };
}
