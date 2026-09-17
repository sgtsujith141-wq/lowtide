import { useEffect, useState } from 'react'

/**
 * One place where "now" enters the app.
 *
 * Event handlers call `nowMs()` when something actually happens; components
 * that *display* elapsed time use `useNow()`, which re-reads the clock on a
 * timer and when the tab is shown again. That keeps "due today" honest in a tab
 * that has been left open across midnight, and keeps render pure.
 */
export function nowMs(): number {
  return Date.now()
}

export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(nowMs)

  useEffect(() => {
    const tick = () => setNow(nowMs())
    const timer = setInterval(tick, intervalMs)
    const onVisibility = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [intervalMs])

  return now
}
