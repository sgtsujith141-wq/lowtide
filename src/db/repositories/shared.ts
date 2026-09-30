import { liveQuery } from 'dexie';
import { newId } from '../../lib/ids';
import { systemClock, type Clock } from '../../lib/time';
import type { EventSource, Id } from '../../types/domain';
import type { LowtideDatabase } from '../database';
import type { Watch } from './types';

export interface RepositoryDeps {
  db: LowtideDatabase;
  clock?: Clock;
  newId?: () => Id;
  /** Who is writing: the app (the owner) or an attributed AI client (ADR-056). */
  source?: EventSource;
  /** The AI client's name, when `source` is `ai-client`. */
  actor?: string;
  /** Turns a query into a live `Watch` (Dexie: liveQuery; SQLite: change listeners). */
  watch?: <T>(query: () => Promise<T>) => Watch<T>;
}

export interface ResolvedDeps {
  db: LowtideDatabase;
  clock: Clock;
  newId: () => Id;
  source: EventSource;
  actor: string | undefined;
  watch: <T>(query: () => Promise<T>) => Watch<T>;
}

export function resolveDeps(deps: RepositoryDeps): ResolvedDeps {
  return {
    db: deps.db,
    clock: deps.clock ?? systemClock,
    newId: deps.newId ?? newId,
    source: deps.source ?? 'app',
    actor: deps.actor,
    watch: deps.watch ?? watchQuery,
  };
}

/**
 * Drops keys whose value is `undefined`, so optional fields are omitted from
 * stored records rather than persisted as `undefined`.
 */
export function omitUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Adapts a Dexie live query to the storage-agnostic `Watch` contract. Dexie
 * re-runs `query` whenever a write (in this tab or another) touches the data
 * it read, so every repository write is observed without manual refreshes.
 */
export function watchQuery<T>(query: () => Promise<T>): Watch<T> {
  return (onChange, onError) => {
    const subscription = liveQuery(query).subscribe({
      next: onChange,
      error: (error: unknown) => onError?.(error),
    });
    return () => subscription.unsubscribe();
  };
}
