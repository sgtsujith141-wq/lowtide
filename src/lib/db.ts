import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Capsule, Handoff, Op, OpEntity, Project, Snapshot, Thing } from './types.ts'

export const DB_NAME = 'lowtide'
export const DB_VERSION = 1

interface LowtideSchema extends DBSchema {
  things: { key: string; value: Thing; indexes: { byCreated: number } }
  projects: { key: string; value: Project; indexes: { byUpdated: number } }
  capsules: { key: string; value: Capsule; indexes: { byProject: string; bySaved: number } }
  handoffs: { key: string; value: Handoff; indexes: { byClosed: number } }
  meta: { key: string; value: { key: string; value: unknown } }
  oplog: { key: number; value: Op }
}

/** A storage problem we can explain to a person, with the cause kept for logs. */
export class StorageError extends Error {
  readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'StorageError'
    this.cause = cause
  }
}

export function describeStorageFailure(error: unknown): string {
  const name = (error as { name?: string } | null)?.name
  if (error instanceof StorageError) return error.message
  if (name === 'QuotaExceededError') {
    return 'This browser has run out of space for LOWTIDE. Export a backup, then remove some archived items to free space.'
  }
  if (name === 'InvalidStateError' || name === 'SecurityError') {
    return 'This browser is blocking local storage — private browsing and “block site data” settings both do this. Nothing you type here can be saved until that is changed.'
  }
  if (name === 'VersionError') {
    return 'A newer version of LOWTIDE has already opened this database in another tab. Close the other tabs and reload.'
  }
  return error instanceof Error && error.message
    ? `Local storage failed: ${error.message}`
    : 'Local storage failed for an unknown reason.'
}

let dbPromise: Promise<IDBPDatabase<LowtideSchema>> | null = null

export function getDb(): Promise<IDBPDatabase<LowtideSchema>> {
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(
        new StorageError(
          'This browser does not provide IndexedDB, so LOWTIDE cannot keep anything between visits.',
        ),
      )
    }
    dbPromise = openDB<LowtideSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('things')) {
          const things = db.createObjectStore('things', { keyPath: 'id' })
          things.createIndex('byCreated', 'createdAt')
        }
        if (!db.objectStoreNames.contains('projects')) {
          const projects = db.createObjectStore('projects', { keyPath: 'id' })
          projects.createIndex('byUpdated', 'updatedAt')
        }
        if (!db.objectStoreNames.contains('capsules')) {
          const capsules = db.createObjectStore('capsules', { keyPath: 'id' })
          capsules.createIndex('byProject', 'projectId')
          capsules.createIndex('bySaved', 'savedAt')
        }
        if (!db.objectStoreNames.contains('handoffs')) {
          const handoffs = db.createObjectStore('handoffs', { keyPath: 'id' })
          handoffs.createIndex('byClosed', 'closedAt')
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains('oplog')) {
          db.createObjectStore('oplog', { keyPath: 'seq', autoIncrement: true })
        }
      },
      blocked() {
        // Another tab is holding an older version open.
      },
      terminated() {
        dbPromise = null
      },
    }).catch((error) => {
      dbPromise = null
      throw new StorageError(describeStorageFailure(error), error)
    })
  }
  return dbPromise
}

export function closeDb(): void {
  const pending = dbPromise
  dbPromise = null
  void pending?.then((db) => db.close()).catch(() => undefined)
}

type EntityStore = 'things' | 'projects' | 'capsules' | 'handoffs'

const ENTITY_OF: Record<EntityStore, OpEntity> = {
  things: 'thing',
  projects: 'project',
  capsules: 'capsule',
  handoffs: 'handoff',
}

type RecordOf<S extends EntityStore> = LowtideSchema[S]['value']

/**
 * A single write batch, in one transaction, alongside its op-log entries.
 * Every mutation in the app funnels through here, which is what makes a future
 * sync engine (or an audit view) possible without touching call sites.
 */
export interface WriteBatch {
  things?: Thing[]
  projects?: Project[]
  capsules?: Capsule[]
  handoffs?: Handoff[]
  deletes?: { store: EntityStore; id: string }[]
  meta?: { key: string; value: unknown }[]
}

export async function write(batch: WriteBatch): Promise<void> {
  const db = await getDb()
  const stores: (EntityStore | 'meta' | 'oplog')[] = ['oplog']
  if (batch.things?.length) stores.push('things')
  if (batch.projects?.length) stores.push('projects')
  if (batch.capsules?.length) stores.push('capsules')
  if (batch.handoffs?.length) stores.push('handoffs')
  if (batch.meta?.length) stores.push('meta')
  for (const del of batch.deletes ?? []) {
    if (!stores.includes(del.store)) stores.push(del.store)
  }

  try {
    const tx = db.transaction(stores as never, 'readwrite')
    const ts = Date.now()
    const oplog = tx.objectStore('oplog' as never) as unknown as {
      add(value: Op): Promise<number>
    }

    const putAll = async <S extends EntityStore>(store: S, records: RecordOf<S>[] | undefined) => {
      if (!records?.length) return
      const os = tx.objectStore(store as never) as unknown as {
        put(value: RecordOf<S>): Promise<string>
      }
      for (const record of records) {
        await os.put(record)
        await oplog.add({ ts, entity: ENTITY_OF[store], id: record.id, type: 'put' })
      }
    }

    await putAll('things', batch.things)
    await putAll('projects', batch.projects)
    await putAll('capsules', batch.capsules)
    await putAll('handoffs', batch.handoffs)

    if (batch.meta?.length) {
      const os = tx.objectStore('meta' as never) as unknown as {
        put(value: { key: string; value: unknown }): Promise<string>
      }
      for (const entry of batch.meta) await os.put(entry)
    }

    for (const del of batch.deletes ?? []) {
      const os = tx.objectStore(del.store as never) as unknown as {
        delete(key: string): Promise<void>
      }
      await os.delete(del.id)
      await oplog.add({ ts, entity: ENTITY_OF[del.store], id: del.id, type: 'delete' })
    }

    await tx.done
  } catch (error) {
    throw new StorageError(describeStorageFailure(error), error)
  }
}

export async function readSnapshot(): Promise<Snapshot> {
  const db = await getDb()
  try {
    const [things, projects, capsules, handoffs] = await Promise.all([
      db.getAll('things'),
      db.getAll('projects'),
      db.getAll('capsules'),
      db.getAll('handoffs'),
    ])
    return { things, projects, capsules, handoffs }
  } catch (error) {
    throw new StorageError(describeStorageFailure(error), error)
  }
}

/**
 * The change log, oldest first. The UI does not use it; it exists so that a
 * later sync engine (or a diagnostic view) has an ordered record of every
 * write this device has made.
 */
export async function readOps(limit?: number): Promise<Op[]> {
  const db = await getDb()
  const all = await db.getAll('oplog')
  return limit == null ? all : all.slice(-limit)
}

export async function readMeta<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await getDb()
    const row = await db.get('meta', key)
    return row ? (row.value as T) : fallback
  } catch {
    return fallback
  }
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  await write({ meta: [{ key, value }] })
}

/** Removes every LOWTIDE record. Only ever called from an explicit, confirmed action. */
export async function wipeAll(): Promise<void> {
  const db = await getDb()
  try {
    const tx = db.transaction(
      ['things', 'projects', 'capsules', 'handoffs', 'oplog'] as never,
      'readwrite',
    )
    for (const store of ['things', 'projects', 'capsules', 'handoffs', 'oplog']) {
      await (tx.objectStore(store as never) as unknown as { clear(): Promise<void> }).clear()
    }
    await tx.done
  } catch (error) {
    throw new StorageError(describeStorageFailure(error), error)
  }
}
