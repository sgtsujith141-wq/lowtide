/**
 * LOWTIDE domain model.
 *
 * Everything is a plain, serialisable record with a string id and millisecond
 * timestamps, so the same shapes can travel over a network later without a
 * rewrite. Records are never mutated in place in storage: writes replace the
 * whole record and append to an op log (see `db.ts`) that a future sync engine
 * can replay.
 */

export type ThingKind =
  | 'action'
  | 'commitment'
  | 'waiting'
  | 'idea'
  | 'onmymind'
  | 'project'
  | 'archive'

export type ThingStatus = 'open' | 'done'

export interface Thing {
  id: string
  /** What the user typed, kept verbatim. Edits move the previous text to `originalText`. */
  text: string
  /** The first version of the text, retained the moment an edit happens. */
  originalText: string | null
  /** Optional detail the user adds while routing. Never replaces `text`. */
  note: string
  /** null means "captured but not routed yet". Always editable. */
  kind: ThingKind | null
  status: ThingStatus
  createdAt: number
  updatedAt: number
  classifiedAt: number | null
  completedAt: number | null
  /** Commitment due date, stored as the start of a local day. */
  dueAt: number | null
  /** Who a `waiting` item is waiting on. */
  waitingOn: string
  /** Return ticket: parked until this local day. */
  returnAt: number | null
  /** Set when a return ticket has been seen and cleared by the user. */
  returnedAt: number | null
  /** Link to a project capsule, for actions that belong to a project. */
  projectId: string | null
  /** Soft delete, so deletion is undoable. */
  deletedAt: number | null
  /** Where this came from: one paste of the Dump shares a batch id. */
  batchId: string | null
}

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  archivedAt: number | null
  deletedAt: number | null
}

export interface CapsuleLink {
  id: string
  label: string
  url: string
}

/**
 * A Black Box capsule: one immutable snapshot of a project's context.
 * "Editing" a capsule writes a new version; older versions are kept as history.
 */
export interface Capsule {
  id: string
  projectId: string
  /** Where the project stands right now. */
  status: string
  lastCompleted: string
  blocker: string
  lastDecision: string
  /** The one concrete thing to do next. */
  nextAction: string
  notes: string
  links: CapsuleLink[]
  savedAt: number
}

/** The record written when a day is closed. Purely a record of what was true. */
export interface Handoff {
  id: string
  closedAt: number
  /** A note to the version of you that comes back. */
  note: string
  /** The small set of things chosen for next time. */
  nextActionIds: string[]
  /** Honest counts of what was deliberately left unfinished. */
  leftUnclassified: number
  /** Project capsules saved during this closure. */
  savedProjectIds: string[]
  /** Commitments that were due or approaching at close. */
  dueSoonIds: string[]
}

export interface MetaRecord {
  key: string
  value: unknown
}

export type OpEntity = 'thing' | 'project' | 'capsule' | 'handoff' | 'meta'

/** Append-only change log. Not read by the UI; it exists so sync can be added later. */
export interface Op {
  seq?: number
  ts: number
  entity: OpEntity
  id: string
  type: 'put' | 'delete'
}

export interface Snapshot {
  things: Thing[]
  projects: Project[]
  capsules: Capsule[]
  handoffs: Handoff[]
}

export const KIND_VALUES: ThingKind[] = [
  'action',
  'commitment',
  'waiting',
  'idea',
  'onmymind',
  'project',
  'archive',
]

export function isThingKind(value: unknown): value is ThingKind {
  return typeof value === 'string' && (KIND_VALUES as string[]).includes(value)
}
