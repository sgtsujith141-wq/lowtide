/** "3 h 20 m", "45 m", "0 m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} m`;
  return m ? `${h} h ${m} m` : `${h} h`;
}
