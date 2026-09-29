import { useEffect, useState } from 'react';

/**
 * The current time, refreshed every `ms` while `active`. Timers derive from
 * stored start times and this clock, never from a counter, so a sleeping
 * laptop neither loses nor invents time.
 */
export function useNow(active: boolean, ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(timer);
  }, [active, ms]);
  return now;
}
