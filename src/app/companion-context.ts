import { createContext } from 'react';
import { saveBackend, type Backend } from '../db/companion/backend';
import { CompanionClient, type CompanionConnection } from '../db/companion/client';

/** Which backend is in use, and (in companion mode) the owner's client for its admin API. */
export interface CompanionState {
  backend: Backend;
  client: CompanionClient | null;
  /** Makes a client for a companion being paired (tests supply their own). */
  connect?: (connection: CompanionConnection) => CompanionClient;
  /** Remembers the new backend and restarts the app on it (tests supply their own). */
  switchTo?: (backend: Backend) => void;
}

export const connectCompanion = (connection: CompanionConnection) =>
  new CompanionClient(connection);

export function switchBackend(backend: Backend) {
  saveBackend(backend);
  window.location.assign('/settings');
}

export const CompanionContext = createContext<CompanionState>({
  backend: { kind: 'browser' },
  client: null,
});
