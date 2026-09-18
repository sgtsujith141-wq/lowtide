import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { StoreContext } from './store-context.ts'
import type { StoreValue } from './store-context.ts'
import { repo } from './repo.ts'
import { describeStorageFailure, writeMeta } from './db.ts'
import type { WriteBatch } from './db.ts'
import { makeCapsule, makeHandoff, makeProject, makeThing } from './model.ts'
import type { CapsuleDraft, CloseDayInput } from './model.ts'
import { newId } from './ids.ts'
import type { Project, Snapshot, Thing } from './types.ts'

const EMPTY: Snapshot = { things: [], projects: [], capsules: [], handoffs: [] }

export function StoreProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  // Mutations need the newest snapshot synchronously, before React re-renders.
  // The ref is written wherever the snapshot is written, never during render.
  const snapshotRef = useRef(snapshot)

  const load = useCallback(async () => {
    try {
      const next = await repo.load()
      snapshotRef.current = next
      setSnapshot(next)
      setLoadError(null)
      void writeMeta('lastOpenedAt', Date.now())
    } catch (error) {
      setLoadError(describeStorageFailure(error))
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    // Loading from IndexedDB is exactly what an effect is for: synchronising
    // with an external system. The state it sets is the result of that read.
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  /**
   * Commit-then-update. If the write throws, in-memory state is left untouched
   * and the error is both surfaced and re-thrown, so a caller holding unsaved
   * text (the Dump) can keep it on screen.
   */
  const commit = useCallback(async (batch: WriteBatch, apply: (s: Snapshot) => Snapshot) => {
    try {
      await repo.commit(batch)
      setStorageError(null)
      setSnapshot((current) => {
        const next = apply(current)
        snapshotRef.current = next
        return next
      })
    } catch (error) {
      setStorageError(describeStorageFailure(error))
      throw error
    }
  }, [])

  const value = useMemo<StoreValue>(() => {
    const mergeThings = (updates: Thing[]) => (s: Snapshot) => ({
      ...s,
      things: upsert(s.things, updates),
    })

    return {
      ready,
      loadError,
      storageError,
      dismissStorageError: () => setStorageError(null),
      things: snapshot.things,
      projects: snapshot.projects,
      capsules: snapshot.capsules,
      handoffs: snapshot.handoffs,

      async capture(texts) {
        const batchId = newId('b')
        const now = Date.now()
        const created = texts
          .map((text) => text.trim())
          .filter(Boolean)
          .map((text, i) => makeThing(text, batchId, now + i))
        if (!created.length) return []
        await commit({ things: created }, mergeThings(created))
        return created
      },

      async putThing(thing) {
        await commit({ things: [thing] }, mergeThings([thing]))
      },

      async putThings(things) {
        if (!things.length) return
        await commit({ things }, mergeThings(things))
      },

      async softDeleteThing(id) {
        const found = snapshotRef.current.things.find((t) => t.id === id)
        if (!found) return
        const next = { ...found, deletedAt: Date.now(), updatedAt: Date.now() }
        await commit({ things: [next] }, mergeThings([next]))
      },

      async restoreThing(id) {
        const found = snapshotRef.current.things.find((t) => t.id === id)
        if (!found) return
        const next = { ...found, deletedAt: null, updatedAt: Date.now() }
        await commit({ things: [next] }, mergeThings([next]))
      },

      async purgeThing(id) {
        await commit({ deletes: [{ store: 'things', id }] }, (s) => ({
          ...s,
          things: s.things.filter((t) => t.id !== id),
        }))
      },

      async createProject(name, description = '') {
        const project = makeProject(name, description)
        await commit({ projects: [project] }, (s) => ({
          ...s,
          projects: upsert(s.projects, [project]),
        }))
        return project
      },

      async putProject(project) {
        await commit({ projects: [project] }, (s) => ({
          ...s,
          projects: upsert(s.projects, [project]),
        }))
      },

      async softDeleteProject(id) {
        const found = snapshotRef.current.projects.find((p) => p.id === id)
        if (!found) return
        const next = { ...found, deletedAt: Date.now(), updatedAt: Date.now() }
        await commit({ projects: [next] }, (s) => ({ ...s, projects: upsert(s.projects, [next]) }))
      },

      async restoreProject(id) {
        const found = snapshotRef.current.projects.find((p) => p.id === id)
        if (!found) return
        const next = { ...found, deletedAt: null, updatedAt: Date.now() }
        await commit({ projects: [next] }, (s) => ({ ...s, projects: upsert(s.projects, [next]) }))
      },

      async saveCapsule(projectId, draft: CapsuleDraft) {
        const capsule = makeCapsule(projectId, draft)
        const project = snapshotRef.current.projects.find((p) => p.id === projectId)
        const touched: Project[] = project
          ? [{ ...project, updatedAt: capsule.savedAt }]
          : []
        await commit({ capsules: [capsule], projects: touched }, (s) => ({
          ...s,
          capsules: upsert(s.capsules, [capsule]),
          projects: touched.length ? upsert(s.projects, touched) : s.projects,
        }))
        return capsule
      },

      async closeDay(input: CloseDayInput) {
        const handoff = makeHandoff(input)
        await commit({ handoffs: [handoff] }, (s) => ({
          ...s,
          handoffs: upsert(s.handoffs, [handoff]),
        }))
        return handoff
      },

      async importSnapshot(incoming) {
        const existing = snapshotRef.current
        const known = {
          things: new Set(existing.things.map((t) => t.id)),
          projects: new Set(existing.projects.map((p) => p.id)),
          capsules: new Set(existing.capsules.map((c) => c.id)),
          handoffs: new Set(existing.handoffs.map((h) => h.id)),
        }
        const batch: WriteBatch = {
          things: incoming.things.filter((t) => !known.things.has(t.id)),
          projects: incoming.projects.filter((p) => !known.projects.has(p.id)),
          capsules: incoming.capsules.filter((c) => !known.capsules.has(c.id)),
          handoffs: incoming.handoffs.filter((h) => !known.handoffs.has(h.id)),
        }
        await commit(batch, (s) => ({
          things: upsert(s.things, batch.things ?? []),
          projects: upsert(s.projects, batch.projects ?? []),
          capsules: upsert(s.capsules, batch.capsules ?? []),
          handoffs: upsert(s.handoffs, batch.handoffs ?? []),
        }))
      },

      snapshot: () => snapshotRef.current,

      async clearEverything() {
        try {
          await repo.clear()
          setSnapshot(EMPTY)
          snapshotRef.current = EMPTY
          setStorageError(null)
        } catch (error) {
          setStorageError(describeStorageFailure(error))
          throw error
        }
      },

      reload: load,
    }
  }, [commit, load, loadError, ready, snapshot, storageError])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

function upsert<T extends { id: string }>(list: T[], updates: T[]): T[] {
  if (!updates.length) return list
  const map = new Map(list.map((item) => [item.id, item]))
  for (const update of updates) map.set(update.id, update)
  return [...map.values()]
}
