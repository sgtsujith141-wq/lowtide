import { useMemo } from 'react';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import type { LocalDate } from '../../types/domain';
import { summariseDays, type DaySummary } from './days';

/** Live day summaries for `start..end`, derived from records on every change. */
export function useDaySummaries(
  start: LocalDate,
  end: LocalDate,
): { status: 'loading' | 'error' | 'ready'; days: Map<LocalDate, DaySummary> } {
  const { activity } = useRepositories();
  const watch = useMemo(() => activity.watchSources(start, end), [activity, start, end]);
  const sources = useWatch(watch);
  const days = useMemo(
    () => (sources.status === 'ready' ? summariseDays(sources.data, start, end) : new Map()),
    [sources, start, end],
  );
  return { status: sources.status, days };
}
