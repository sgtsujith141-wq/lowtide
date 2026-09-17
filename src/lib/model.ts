import { newId } from './ids.ts'
import { DAY_MS, startOfDay } from './dates.ts'
import type { Capsule, CapsuleLink, Handoff, Project, Thing, ThingKind } from './types.ts'

/* ------------------------------------------------------------------ *
 * Pure factories and selectors. No IO here, which keeps the rules of
 * the product testable without a browser.
 * ------------------------------------------------------------------ */

export function makeThing(text: string, batchId: string | null = null, now = Date.now()): Thing {
  return {
    id: newId('t'),
    text,
    originalText: null,
    note: '',
    kind: null,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    classifiedAt: null,
    completedAt: null,
    dueAt: null,
    waitingOn: '',
    returnAt: null,
    returnedAt: null,
    projectId: null,
    deletedAt: null,
    batchId,
  }
}

/** Splits pasted text into one thought per line, preserving each line verbatim. */
export function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** Editing keeps the first version of the text forever. */
export function editThingText(thing: Thing, text: string, now = Date.now()): Thing {
  const trimmed = text.trim()
  if (trimmed === thing.text) return thing
  return {
    ...thing,
    text: trimmed,
    originalText: thing.originalText ?? thing.text,
    updatedAt: now,
  }
}

export interface ClassifyPatch {
  kind: ThingKind
  dueAt?: number | null
  waitingOn?: string
  projectId?: string | null
  note?: string
  returnAt?: number | null
}

/** Classification is always re-doable; nothing about the original is lost. */
export function classifyThing(thing: Thing, patch: ClassifyPatch, now = Date.now()): Thing {
  return {
    ...thing,
    kind: patch.kind,
    classifiedAt: thing.classifiedAt ?? now,
    updatedAt: now,
    dueAt: patch.dueAt !== undefined ? patch.dueAt : thing.dueAt,
    waitingOn: patch.waitingOn !== undefined ? patch.waitingOn : thing.waitingOn,
    projectId: patch.projectId !== undefined ? patch.projectId : thing.projectId,
    note: patch.note !== undefined ? patch.note : thing.note,
    returnAt: patch.returnAt !== undefined ? patch.returnAt : thing.returnAt,
  }
}

export function makeProject(name: string, now = Date.now()): Project {
  return {
    id: newId('p'),
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
  }
}

export interface CapsuleDraft {
  status: string
  lastCompleted: string
  blocker: string
  lastDecision: string
  nextAction: string
  notes: string
  links: CapsuleLink[]
}

export const EMPTY_CAPSULE_DRAFT: CapsuleDraft = {
  status: '',
  lastCompleted: '',
  blocker: '',
  lastDecision: '',
  nextAction: '',
  notes: '',
  links: [],
}

/** Saving a capsule never edits the previous one — it adds a new version. */
export function makeCapsule(projectId: string, draft: CapsuleDraft, now = Date.now()): Capsule {
  return {
    id: newId('c'),
    projectId,
    status: draft.status.trim(),
    lastCompleted: draft.lastCompleted.trim(),
    blocker: draft.blocker.trim(),
    lastDecision: draft.lastDecision.trim(),
    nextAction: draft.nextAction.trim(),
    notes: draft.notes.trim(),
    links: draft.links
      .filter((l) => l.url.trim() || l.label.trim())
      .map((l) => ({ id: l.id || newId('l'), label: l.label.trim(), url: l.url.trim() })),
    savedAt: now,
  }
}

export function draftFromCapsule(capsule: Capsule | null): CapsuleDraft {
  if (!capsule) return { ...EMPTY_CAPSULE_DRAFT, links: [] }
  return {
    status: capsule.status,
    lastCompleted: capsule.lastCompleted,
    blocker: capsule.blocker,
    lastDecision: capsule.lastDecision,
    nextAction: capsule.nextAction,
    notes: capsule.notes,
    links: capsule.links.map((l) => ({ ...l })),
  }
}

export function isCapsuleEmpty(draft: CapsuleDraft): boolean {
  return (
    !draft.status.trim() &&
    !draft.lastCompleted.trim() &&
    !draft.blocker.trim() &&
    !draft.lastDecision.trim() &&
    !draft.nextAction.trim() &&
    !draft.notes.trim() &&
    draft.links.every((l) => !l.url.trim() && !l.label.trim())
  )
}

export function capsulesFor(capsules: Capsule[], projectId: string): Capsule[] {
  return capsules
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => b.savedAt - a.savedAt)
}

export function latestCapsule(capsules: Capsule[], projectId: string): Capsule | null {
  return capsulesFor(capsules, projectId)[0] ?? null
}

/* ------------------------------------------------------------------ *
 * Selectors
 * ------------------------------------------------------------------ */

export function live(things: Thing[]): Thing[] {
  return things.filter((t) => t.deletedAt == null)
}

export function deleted(things: Thing[]): Thing[] {
  return things.filter((t) => t.deletedAt != null).sort((a, b) => b.deletedAt! - a.deletedAt!)
}

/** Captured but not yet routed. The Dump's queue. */
export function unrouted(things: Thing[]): Thing[] {
  return live(things)
    .filter((t) => t.kind == null && t.status === 'open')
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** A parked item whose day has arrived (or passed) and that hasn't been cleared. */
export function isTicketDue(thing: Thing, now = Date.now()): boolean {
  return (
    thing.deletedAt == null &&
    thing.status === 'open' &&
    thing.returnAt != null &&
    thing.returnedAt == null &&
    thing.returnAt <= startOfDay(now)
  )
}

export function dueTickets(things: Thing[], now = Date.now()): Thing[] {
  return live(things)
    .filter((t) => isTicketDue(t, now))
    .sort((a, b) => (a.returnAt ?? 0) - (b.returnAt ?? 0))
}

export function parkedTickets(things: Thing[], now = Date.now()): Thing[] {
  return live(things)
    .filter(
      (t) =>
        t.status === 'open' &&
        t.returnAt != null &&
        t.returnedAt == null &&
        t.returnAt > startOfDay(now),
    )
    .sort((a, b) => (a.returnAt ?? 0) - (b.returnAt ?? 0))
}

/** Commitments with a date, soonest first. Overdue ones come first of all. */
export function commitments(things: Thing[]): Thing[] {
  return live(things)
    .filter((t) => t.kind === 'commitment' && t.status === 'open')
    .sort((a, b) => {
      if (a.dueAt == null && b.dueAt == null) return a.createdAt - b.createdAt
      if (a.dueAt == null) return 1
      if (b.dueAt == null) return -1
      return a.dueAt - b.dueAt
    })
}

/** Commitments due within `days` (default 7), plus anything already overdue. */
export function approaching(things: Thing[], days = 7, now = Date.now()): Thing[] {
  const horizon = startOfDay(now) + days * DAY_MS
  return commitments(things).filter((t) => t.dueAt != null && t.dueAt <= horizon)
}

export function overdue(things: Thing[], now = Date.now()): Thing[] {
  const today = startOfDay(now)
  return commitments(things).filter((t) => t.dueAt != null && t.dueAt < today)
}

export function openByKind(things: Thing[], kind: ThingKind): Thing[] {
  return live(things)
    .filter((t) => t.kind === kind && t.status === 'open')
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function thingsForProject(things: Thing[], projectId: string): Thing[] {
  return live(things)
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/* ------------------------------------------------------------------ *
 * Closure
 * ------------------------------------------------------------------ */

export interface CloseDayInput {
  nextActionIds: string[]
  note: string
  leftUnclassified: number
  savedProjectIds: string[]
  dueSoonIds: string[]
}

export function makeHandoff(input: CloseDayInput, now = Date.now()): Handoff {
  return {
    id: newId('h'),
    closedAt: now,
    note: input.note.trim(),
    nextActionIds: [...input.nextActionIds],
    leftUnclassified: input.leftUnclassified,
    savedProjectIds: [...input.savedProjectIds],
    dueSoonIds: [...input.dueSoonIds],
  }
}

export function latestHandoff(handoffs: Handoff[]): Handoff | null {
  return [...handoffs].sort((a, b) => b.closedAt - a.closedAt)[0] ?? null
}

/** How many next actions a closure suggests choosing. Small on purpose. */
export const NEXT_ACTION_LIMIT = 3
