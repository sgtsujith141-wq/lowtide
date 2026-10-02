import { useEffect, useState } from 'react';
import type { CompanionClient } from '../../db/companion/client';

/*
 * When the owner last opened the AI area on this device, so LOWTIDE can say
 * how many AI changes happened since. A per-device convenience: nothing is
 * stored anywhere else, and it simply starts over in a private window.
 */

const LAST_VISIT = 'lowtide.ai.lastVisit';

export function readLastVisit(): string | undefined {
  try {
    return localStorage.getItem(LAST_VISIT) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Marks the AI area as seen now (called when it opens). */
export function markAiVisited(at = new Date()) {
  try {
    localStorage.setItem(LAST_VISIT, at.toISOString());
  } catch {
    // Not remembered in a private window.
  }
}

/**
 * How many AI changes happened since the AI area was last opened on this
 * device (0 before the first visit: nothing to compare with). Live.
 */
export function useAiChangesSince(
  client: CompanionClient | null | undefined,
  since = readLastVisit(),
) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!client || !since) return;
    let alive = true;
    const load = () =>
      client.changes(500, since).then(
        (list) => alive && setCount(list.length),
        () => undefined,
      );
    void load();
    const off = client.onEvent((e) => {
      if (e.type === 'ai') void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [client, since]);
  return count;
}
