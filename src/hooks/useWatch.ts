import { useEffect, useState } from 'react';
import type { Watch } from '../db/repositories';

export type Live<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: unknown };

/**
 * Subscribes a component to a repository `Watch` for as long as it is mounted.
 * Re-renders with fresh data whenever the underlying records change.
 * Pass a stable `watch` (repository methods are stable).
 */
export function useWatch<T>(watch: Watch<T>): Live<T> {
  const [state, setState] = useState<Live<T>>({ status: 'loading' });
  useEffect(
    () =>
      watch(
        (data) => setState({ status: 'ready', data }),
        (error) => setState({ status: 'error', error }),
      ),
    [watch],
  );
  return state;
}
