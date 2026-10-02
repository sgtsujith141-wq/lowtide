/*
 * How the modes say time (v2 PHASE 015). Always derived from stored start
 * times and the clock, never counted, so a sleeping laptop neither loses
 * nor invents time.
 */

const two = (n: number) => String(n).padStart(2, '0');

/** "01:42:18" from milliseconds. */
export function longClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
}

/** "07:14:32": time since `from`. */
export function sinceClock(from: string, now: Date): string {
  return longClock(now.getTime() - Date.parse(from));
}

/** "1h 42m", "42m", "0m". */
export function shortDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(minutes / 60);
  return h ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}

/** "12:41 AM" or "00:41", in the viewer's locale. */
export const timeOfDay = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
