import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * One LOWTIDE per data folder, and safe ownership of its port (v2.3,
 * ADR-073). A lock file in the data folder keeps a second companion from
 * ever writing the same database; a lock left by a process that died is
 * taken over. Before listening, whoever holds the port is identified: a
 * healthy LOWTIDE serving the same data is reused (nothing new starts), a
 * LOWTIDE that no longer answers is stopped, and anything else is reported
 * and left alone. Nothing here ever kills a process it can't identify as a
 * LOWTIDE companion.
 */

export const LOCK_FILE = 'companion.lock';

export interface LockInfo {
  pid: number;
  port: number;
  startedAt: string;
}

/** A short, non-secret name for a data folder (in health), to tell instances apart. */
export function instanceId(dataDir: string): string {
  let path = dataDir;
  try {
    path = realpathSync(dataDir);
  } catch {
    // A data folder that doesn't exist yet is named by its path.
  }
  return createHash('sha256').update(path).digest('hex').slice(0, 12);
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The command line of a process, or undefined. */
export function commandOf(pid: number): string | undefined {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

/** True when the process is a LOWTIDE companion (by its command line). */
export function isCompanion(pid: number): boolean {
  return /lowtide-companion(\.js|\.ts)?\b|companion\/server\/main/.test(commandOf(pid) ?? '');
}

/** The process listening on a TCP port on this machine, if any. */
export function listenerOf(port: number): number | undefined {
  try {
    const out = execFileSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    }).trim();
    const pid = Number(out.split('\n')[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

export class AlreadyRunningError extends Error {
  constructor(readonly holder: LockInfo) {
    super(`LOWTIDE is already running for this data (pid ${holder.pid}, port ${holder.port})`);
    this.name = 'AlreadyRunningError';
  }
}

/**
 * Takes the data folder's lock for this process. Throws AlreadyRunningError
 * when another live LOWTIDE companion holds it; takes over a lock whose
 * process is gone (or is no longer a companion).
 */
export function takeLock(
  dataDir: string,
  info: LockInfo,
  check: { alive: (pid: number) => boolean; isCompanion: (pid: number) => boolean } = {
    alive,
    isCompanion,
  },
): { release(): void } {
  const file = join(dataDir, LOCK_FILE);
  const write = () => writeFileSync(file, `${JSON.stringify(info)}\n`, { flag: 'wx', mode: 0o600 });
  try {
    write();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let holder: LockInfo | undefined;
    try {
      holder = JSON.parse(readFileSync(file, 'utf8')) as LockInfo;
    } catch {
      holder = undefined;
    }
    if (
      holder &&
      holder.pid !== info.pid &&
      check.alive(holder.pid) &&
      check.isCompanion(holder.pid)
    ) {
      throw new AlreadyRunningError(holder);
    }
    rmSync(file, { force: true }); // stale: its process is gone
    write();
  }
  return {
    release() {
      try {
        const held = JSON.parse(readFileSync(file, 'utf8')) as LockInfo;
        if (held.pid === info.pid) rmSync(file, { force: true });
      } catch {
        // Already gone.
      }
    },
  };
}

export type PortOwner =
  | { kind: 'free' }
  | { kind: 'lowtide'; healthy: boolean; sameData: boolean; pid?: number }
  | { kind: 'other'; pid?: number; command?: string };

/** Who holds a port: nobody, a LOWTIDE (healthy or not, same data or not), or something else. */
export async function portOwner(
  port: number,
  dataDir: string,
  probe: {
    health: (port: number) => Promise<unknown>;
    listener: (port: number) => number | undefined;
    isCompanion: (pid: number) => boolean;
    command: (pid: number) => string | undefined;
  } = {
    health: async (p) => {
      const response = await fetch(`http://127.0.0.1:${p}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.json();
    },
    listener: listenerOf,
    isCompanion,
    command: commandOf,
  },
): Promise<PortOwner> {
  const pid = probe.listener(port);
  let health: { app?: string; status?: string; checks?: { runtime?: { instance?: string } } };
  try {
    health = (await probe.health(port)) as typeof health;
  } catch {
    health = {};
  }
  if (health.app === 'lowtide-companion') {
    return {
      kind: 'lowtide',
      healthy: health.status === 'ok' || health.status === undefined,
      sameData: health.checks?.runtime?.instance === instanceId(dataDir),
      ...(pid ? { pid } : {}),
    };
  }
  if (pid === undefined) return { kind: 'free' };
  if (probe.isCompanion(pid)) return { kind: 'lowtide', healthy: false, sameData: false, pid };
  const command = probe.command(pid);
  return { kind: 'other', pid, ...(command ? { command } : {}) };
}

/** Stops a LOWTIDE companion that no longer answers: SIGTERM, then SIGKILL after a wait. */
export async function stopCompanion(pid: number, waitMs = 10_000): Promise<boolean> {
  if (!isCompanion(pid)) return false;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return !alive(pid);
  }
  for (const end = Date.now() + waitMs; Date.now() < end;) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Gone already.
  }
  await new Promise((r) => setTimeout(r, 300));
  return !alive(pid);
}
