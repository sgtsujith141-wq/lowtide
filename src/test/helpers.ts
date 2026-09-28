import { afterEach } from 'vitest';
import { openDatabase, type LowtideDatabase } from '../db/database';
import type { Clock } from '../lib/time';

/**
 * A fresh, uniquely named database per test, deleted afterwards, so tests
 * never share state.
 */
export function setupTestDatabase(): () => LowtideDatabase {
  let db: LowtideDatabase | undefined;
  afterEach(async () => {
    if (db) await db.delete();
    db = undefined;
  });
  return () => {
    db = openDatabase(`lowtide-test-${crypto.randomUUID()}`);
    return db;
  };
}

/** A clock that returns `start`, then advances one minute per call. */
export function steppingClock(start = '2026-09-28T09:00:00.000Z'): Clock {
  let t = Date.parse(start);
  return () => {
    const now = new Date(t);
    t += 60_000;
    return now;
  };
}
