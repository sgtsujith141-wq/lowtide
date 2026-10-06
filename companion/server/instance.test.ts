// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AlreadyRunningError, instanceId, LOCK_FILE, portOwner, takeLock } from './instance';

/* v2.3 (ADR-073): one LOWTIDE per data folder, and safe ownership of its port. */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const dataDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'lowtide-instance-'));
  dirs.push(d);
  return d;
};
const info = (pid: number) => ({ pid, port: 4318, startedAt: '2026-10-07T00:00:00.000Z' });

describe('the data folder lock', () => {
  it('refuses a second live companion, and releases only its own lock', () => {
    const dir = dataDir();
    const first = takeLock(dir, info(111), { alive: () => true, isCompanion: () => true });
    expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')).pid).toBe(111);
    expect(() => takeLock(dir, info(222), { alive: () => true, isCompanion: () => true })).toThrow(
      AlreadyRunningError,
    );
    first.release();
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
  });

  it('takes over a lock whose process died, or whose pid now belongs to something else', () => {
    const dir = dataDir();
    takeLock(dir, info(111), { alive: () => true, isCompanion: () => true });
    const dead = takeLock(dir, info(222), { alive: () => false, isCompanion: () => true });
    expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')).pid).toBe(222);
    const reused = takeLock(dir, info(333), { alive: () => true, isCompanion: () => false });
    expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')).pid).toBe(333);
    dead.release(); // not its lock any more: nothing happens
    expect(existsSync(join(dir, LOCK_FILE))).toBe(true);
    reused.release();
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
    // An unreadable lock is stale too.
    writeFileSync(join(dir, LOCK_FILE), 'not json');
    takeLock(dir, info(444), { alive: () => true, isCompanion: () => true }).release();
  });
});

describe('who holds the port', () => {
  const dir = '/tmp/lowtide-data-for-port-test';
  const probe = (over: Partial<Parameters<typeof portOwner>[2]>) => ({
    health: async () => {
      throw new Error('nothing answers');
    },
    listener: () => undefined,
    isCompanion: () => false,
    command: () => undefined,
    ...over,
  });

  it('knows a free port, a healthy LOWTIDE for this data and one for other data', async () => {
    expect(await portOwner(4318, dir, probe({}))).toEqual({ kind: 'free' });
    const same = await portOwner(
      4318,
      dir,
      probe({
        health: async () => ({
          app: 'lowtide-companion',
          status: 'ok',
          checks: { runtime: { instance: instanceId(dir) } },
        }),
        listener: () => 42,
      }),
    );
    expect(same).toEqual({ kind: 'lowtide', healthy: true, sameData: true, pid: 42 });
    const other = await portOwner(
      4318,
      dir,
      probe({
        health: async () => ({ app: 'lowtide-companion', status: 'ok', checks: {} }),
      }),
    );
    expect(other).toMatchObject({ kind: 'lowtide', healthy: true, sameData: false });
  });

  it('tells a LOWTIDE that stopped answering from a program that isn’t LOWTIDE', async () => {
    const hung = await portOwner(4318, dir, probe({ listener: () => 7, isCompanion: () => true }));
    expect(hung).toEqual({ kind: 'lowtide', healthy: false, sameData: false, pid: 7 });
    const degraded = await portOwner(
      4318,
      dir,
      probe({ health: async () => ({ app: 'lowtide-companion', status: 'degraded' }) }),
    );
    expect(degraded).toMatchObject({ kind: 'lowtide', healthy: false });
    const stranger = await portOwner(
      4318,
      dir,
      probe({ listener: () => 9, command: () => '/usr/bin/python3 -m http.server 4318' }),
    );
    expect(stranger).toEqual({
      kind: 'other',
      pid: 9,
      command: '/usr/bin/python3 -m http.server 4318',
    });
  });
});
