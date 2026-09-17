/** Date helpers. Everything is local-time; dates are stored as start-of-day ms. */

export const DAY_MS = 86_400_000

export function startOfDay(input: number | Date = Date.now()): number {
  const d = new Date(input)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function todayStart(): number {
  return startOfDay()
}

/** "2026-09-17" for <input type="date">. */
export function toDateInput(ts: number | null): string {
  if (ts == null) return ''
  const d = new Date(ts)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Parses "2026-09-17" as a local start-of-day. Returns null for empty/invalid. */
export function fromDateInput(value: string): number | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [, y, m, d] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  if (Number.isNaN(date.getTime())) return null
  return startOfDay(date)
}

export function daysUntil(ts: number, from: number = Date.now()): number {
  return Math.round((startOfDay(ts) - startOfDay(from)) / DAY_MS)
}

/** "today", "tomorrow", "in 3 days", "3 days ago" — plain, never alarming. */
export function relativeDay(ts: number, from: number = Date.now()): string {
  const diff = daysUntil(ts, from)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  if (diff > 0) return `in ${diff} days`
  return `${Math.abs(diff)} days ago`
}

export function formatDay(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function formatDayLong(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function formatStamp(ts: number): string {
  return `${formatDay(ts)} · ${formatTime(ts)}`
}

/** A quiet greeting keyed to the clock. No encouragement, no exclamation marks. */
export function partOfDay(ts: number = Date.now()): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date(ts).getHours()
  if (hour < 5) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}
