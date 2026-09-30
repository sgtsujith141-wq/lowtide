import { useCallback, useContext, useSyncExternalStore } from 'react';
import { CompanionContext, type CompanionState } from '../app/companion-context';
import type { StreamState } from '../db/companion/client';

/** The storage backend in use and, in companion mode, its client. */
export function useCompanion(): CompanionState {
  return useContext(CompanionContext);
}

const nothing = () => () => undefined;

/** The companion event stream's state ('stopped' in browser mode). */
export function useCompanionConnection(): StreamState {
  const { client } = useCompanion();
  const subscribe = useCallback(
    (onChange: () => void) => (client ? client.onState(onChange) : nothing()),
    [client],
  );
  return useSyncExternalStore(subscribe, () => client?.state ?? 'stopped');
}
