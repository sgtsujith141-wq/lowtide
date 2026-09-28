import { addDays, startOfDay } from 'date-fns';
import { useEffect, useState } from 'react';
import { toLocalDate } from '../lib/time';
import type { LocalDate } from '../types/domain';

/** Today's local date; re-renders just after local midnight. */
export function useToday(): LocalDate {
  const [today, setToday] = useState(() => toLocalDate(new Date()));
  useEffect(() => {
    const now = new Date();
    const untilMidnight = addDays(startOfDay(now), 1).getTime() - now.getTime() + 1000;
    const timer = setTimeout(() => setToday(toLocalDate(new Date())), untilMidnight);
    return () => clearTimeout(timer);
  }, [today]);
  return today;
}
