import { createContext, useContext } from 'react'
import type { Capsule, Handoff, Project, Snapshot, Thing } from './types.ts'
import type { CapsuleDraft, CloseDayInput } from './model.ts'

export interface StoreValue {
  ready: boolean
  /** Set when the database could not be opened at all. */
  loadError: string | null
  /** Set when the most recent write failed. Cleared on the next success. */
  storageError: string | null
  dismissStorageError(): void

  things: Thing[]
  projects: Project[]
  capsules: Capsule[]
  handoffs: Handoff[]

  capture(texts: string[]): Promise<Thing[]>
  putThing(thing: Thing): Promise<void>
  putThings(things: Thing[]): Promise<void>
  softDeleteThing(id: string): Promise<void>
  restoreThing(id: string): Promise<void>
  purgeThing(id: string): Promise<void>

  createProject(name: string, description?: string): Promise<Project>
  putProject(project: Project): Promise<void>
  softDeleteProject(id: string): Promise<void>
  restoreProject(id: string): Promise<void>

  saveCapsule(projectId: string, draft: CapsuleDraft): Promise<Capsule>

  closeDay(input: CloseDayInput): Promise<Handoff>

  /** Merges validated records. Existing records are never replaced. */
  importSnapshot(incoming: Snapshot): Promise<void>
  snapshot(): Snapshot
  clearEverything(): Promise<void>
  reload(): Promise<void>
}

export const StoreContext = createContext<StoreValue | null>(null)

export function useStore(): StoreValue {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useStore must be used inside <StoreProvider>')
  return value
}
