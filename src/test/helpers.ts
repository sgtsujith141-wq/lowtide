import { cleanup } from '@testing-library/react';
import { afterEach, expect, vi } from 'vitest';
import { openDatabase, type LowtideDatabase } from '../db/database';
import type { Watch } from '../db/repositories';
import type { Clock } from '../lib/time';

/**
 * A fresh, uniquely named database per test, deleted afterwards, so tests
 * never share state.
 */
export function setupTestDatabase(): () => LowtideDatabase {
  let db: LowtideDatabase | undefined;
  afterEach(async () => {
    // Unmount first so no live subscription outlives its database.
    cleanup();
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

/** Subscribes to a `Watch` and records every emission, for reactivity tests. */
export function recordWatch<T>(watch: Watch<T>) {
  const values: T[] = [];
  const errors: unknown[] = [];
  const stop = watch(
    (value) => values.push(value),
    (error) => errors.push(error),
  );
  return {
    values,
    errors,
    stop,
    /** Latest emission once it satisfies `predicate`. */
    async until(predicate: (value: T) => boolean): Promise<T> {
      return vi.waitFor(() => {
        const latest = values.at(-1);
        if (latest === undefined || !predicate(latest)) throw new Error('not yet');
        return latest;
      });
    },
  };
}

/**
 * Asserts focus, waiting for it: components move focus in effects that run
 * just after render, so an element found by `findBy…` may not be focused yet
 * at that instant (PHASE 006: two intermittent failures traced to this).
 */
export async function expectFocus(
  target: Element | Promise<Element> | (() => Element | null),
): Promise<void> {
  if (typeof target === 'function') {
    await vi.waitFor(() => expect(target()).toHaveFocus());
    return;
  }
  const element = await target;
  await vi.waitFor(() => expect(element).toHaveFocus());
}
