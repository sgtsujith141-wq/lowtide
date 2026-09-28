import { newId } from '../../lib/ids';
import { systemClock, type Clock } from '../../lib/time';
import type { Id } from '../../types/domain';
import type { LowtideDatabase } from '../database';

export interface RepositoryDeps {
  db: LowtideDatabase;
  clock?: Clock;
  newId?: () => Id;
}

export function resolveDeps(deps: RepositoryDeps): Required<RepositoryDeps> {
  return { clock: systemClock, newId, ...deps };
}

/**
 * Drops keys whose value is `undefined`, so optional fields are omitted from
 * stored records rather than persisted as `undefined`.
 */
export function omitUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
