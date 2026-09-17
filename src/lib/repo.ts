import { readSnapshot, write, wipeAll, type WriteBatch } from './db.ts'
import type { Snapshot } from './types.ts'

/**
 * The persistence seam.
 *
 * Today this is a thin pass-through to IndexedDB. A cloud adapter later
 * implements the same two calls (plus the op log already being recorded in
 * `db.ts`) without any component needing to change.
 */
export interface Repo {
  load(): Promise<Snapshot>
  commit(batch: WriteBatch): Promise<void>
  clear(): Promise<void>
}

export const localRepo: Repo = {
  load: readSnapshot,
  commit: write,
  clear: wipeAll,
}

export const repo: Repo = localRepo
