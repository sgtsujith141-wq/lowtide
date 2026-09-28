import type { Id } from '../types/domain';

/**
 * New record id: a random UUID v4.
 *
 * Random (not sequential) ids let records be created offline on any device
 * and merged later without collisions. `crypto.randomUUID` needs a secure
 * context (https or localhost), which is where LOWTIDE runs.
 */
export function newId(): Id {
  return crypto.randomUUID();
}
