import type { WorkSession } from '../../types/domain';

/**
 * Effective minutes of a work session: wall time minus pauses (architecture
 * §7). An open session counts up to `now`; an open pause up to `now` too.
 * Derived, never stored. Rounded down to whole minutes.
 */
export function activeMinutes(session: WorkSession, now: Date = new Date()): number {
  return Math.floor(activeMs(session, now) / 60_000);
}

export function activeMs(session: WorkSession, now: Date = new Date()): number {
  const end = session.endedAt ? Date.parse(session.endedAt) : now.getTime();
  let paused = 0;
  for (const pause of session.pauses) {
    const resumed = pause.resumedAt ? Date.parse(pause.resumedAt) : end;
    paused += Math.max(0, resumed - Date.parse(pause.at));
  }
  return Math.max(0, end - Date.parse(session.startedAt) - paused);
}

export function isPaused(session: WorkSession): boolean {
  const last = session.pauses.at(-1);
  return last !== undefined && last.resumedAt === undefined && session.endedAt === undefined;
}

/** "1:05:09" or "5:09". */
export function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
