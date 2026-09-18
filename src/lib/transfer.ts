import { newId } from './ids.ts'
import { isThingKind, type Capsule, type Handoff, type Project, type Snapshot, type Thing } from './types.ts'

/* ------------------------------------------------------------------ *
 * Export / import.
 *
 * Exports are plain JSON. Imports are validated field by field, never trusted,
 * and always MERGED — an import cannot overwrite or drop a record that is
 * already here. Anything unreadable is reported rather than silently dropped.
 * ------------------------------------------------------------------ */

export const EXPORT_APP = 'lowtide'
export const EXPORT_VERSION = 2

export interface ExportFile {
  app: typeof EXPORT_APP
  version: number
  exportedAt: number
  data: Snapshot
}

export function buildExport(snapshot: Snapshot, now = Date.now()): ExportFile {
  return {
    app: EXPORT_APP,
    version: EXPORT_VERSION,
    exportedAt: now,
    data: {
      things: snapshot.things,
      projects: snapshot.projects,
      capsules: snapshot.capsules,
      handoffs: snapshot.handoffs,
    },
  }
}

export function exportFilename(now = Date.now()): string {
  const d = new Date(now)
  const p = (n: number) => `${n}`.padStart(2, '0')
  return `lowtide-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`
}

/* ---------------------------- validation --------------------------- */

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

export interface ImportPreview {
  /** Which format the file was recognised as. */
  format: 'lowtide-v2' | 'lowtide-v1' | 'unknown'
  /** Records that parsed cleanly and are not already present. */
  incoming: Snapshot
  counts: { things: number; projects: number; capsules: number; handoffs: number }
  /** Records skipped because an item with that id is already stored. */
  duplicates: number
  /** Human-readable notes: what was repaired, what was skipped and why. */
  problems: string[]
  exportedAt: number | null
  ok: boolean
}

function coerceThing(raw: unknown, problems: string[], index: number): Thing | null {
  if (!raw || typeof raw !== 'object') {
    problems.push(`Item ${index + 1} was not an object and was skipped.`)
    return null
  }
  const r = raw as Record<string, unknown>
  const text = str(r.text ?? r.body ?? r.content ?? r.title ?? r.note)
  if (!text.trim()) {
    problems.push(`Item ${index + 1} had no text and was skipped.`)
    return null
  }
  const createdAt = num(r.createdAt ?? r.created ?? r.ts, Date.now())
  const kindRaw = r.kind ?? r.bucket ?? r.category ?? r.type
  const kind = isThingKind(kindRaw) ? kindRaw : legacyKind(kindRaw)
  if (kindRaw != null && kind == null) {
    problems.push(`Item ${index + 1} had an unknown category (“${String(kindRaw)}”); it was kept as unrouted.`)
  }
  const statusRaw = str(r.status)
  const done = r.done === true || statusRaw === 'done' || statusRaw === 'complete'
  return {
    id: str(r.id) || newId('t'),
    text,
    originalText: strOrNull(r.originalText),
    note: str(r.note === text ? '' : r.note),
    kind,
    status: done ? 'done' : 'open',
    createdAt,
    updatedAt: num(r.updatedAt ?? r.modified, createdAt),
    classifiedAt: numOrNull(r.classifiedAt),
    completedAt: numOrNull(r.completedAt ?? r.doneAt),
    dueAt: numOrNull(r.dueAt ?? r.due ?? r.dueDate),
    waitingOn: str(r.waitingOn ?? r.who),
    returnAt: numOrNull(r.returnAt ?? r.snoozeUntil ?? r.parkedUntil),
    returnedAt: numOrNull(r.returnedAt),
    projectId: strOrNull(r.projectId),
    deletedAt: numOrNull(r.deletedAt),
    batchId: strOrNull(r.batchId),
  }
}

/** Maps names an earlier prototype may have used onto this milestone's kinds. */
function legacyKind(value: unknown): Thing['kind'] {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase().replace(/[\s_-]+/g, '')
  const table: Record<string, Thing['kind']> = {
    task: 'action',
    todo: 'action',
    do: 'action',
    action: 'action',
    promise: 'commitment',
    commitment: 'commitment',
    owed: 'commitment',
    waiting: 'waiting',
    waitingon: 'waiting',
    waitingfor: 'waiting',
    blocked: 'waiting',
    idea: 'idea',
    someday: 'idea',
    maybe: 'idea',
    onmymind: 'onmymind',
    mind: 'onmymind',
    worry: 'onmymind',
    noise: 'onmymind',
    project: 'project',
    archive: 'archive',
    archived: 'archive',
    done: 'archive',
  }
  return table[v] ?? null
}

function coerceProject(raw: unknown, problems: string[], index: number): Project | null {
  if (!raw || typeof raw !== 'object') {
    problems.push(`Project ${index + 1} was not an object and was skipped.`)
    return null
  }
  const r = raw as Record<string, unknown>
  const name = str(r.name ?? r.title)
  if (!name.trim()) {
    problems.push(`Project ${index + 1} had no name and was skipped.`)
    return null
  }
  const createdAt = num(r.createdAt ?? r.created, Date.now())
  return {
    id: str(r.id) || newId('p'),
    name,
    description: str(r.description ?? r.summary),
    createdAt,
    updatedAt: num(r.updatedAt, createdAt),
    archivedAt: numOrNull(r.archivedAt),
    deletedAt: numOrNull(r.deletedAt),
  }
}

function coerceCapsule(raw: unknown, problems: string[], index: number): Capsule | null {
  if (!raw || typeof raw !== 'object') {
    problems.push(`Capsule ${index + 1} was not an object and was skipped.`)
    return null
  }
  const r = raw as Record<string, unknown>
  const projectId = str(r.projectId ?? r.project)
  if (!projectId) {
    problems.push(`Capsule ${index + 1} was not attached to a project and was skipped.`)
    return null
  }
  const links = Array.isArray(r.links)
    ? r.links
        .map((l) => {
          if (typeof l === 'string') return { id: newId('l'), label: l, url: l }
          if (l && typeof l === 'object') {
            const lr = l as Record<string, unknown>
            return { id: str(lr.id) || newId('l'), label: str(lr.label ?? lr.title), url: str(lr.url ?? lr.href) }
          }
          return null
        })
        .filter((l): l is { id: string; label: string; url: string } => l != null)
    : []
  return {
    id: str(r.id) || newId('c'),
    projectId,
    status: str(r.status),
    lastCompleted: str(r.lastCompleted ?? r.lastDone),
    blocker: str(r.blocker ?? r.blockedBy),
    lastDecision: str(r.lastDecision ?? r.decision),
    nextAction: str(r.nextAction ?? r.next),
    notes: str(r.notes),
    links,
    savedAt: num(r.savedAt ?? r.updatedAt ?? r.createdAt, Date.now()),
  }
}

function coerceHandoff(raw: unknown, problems: string[], index: number): Handoff | null {
  if (!raw || typeof raw !== 'object') {
    problems.push(`Hand-off ${index + 1} was not an object and was skipped.`)
    return null
  }
  const r = raw as Record<string, unknown>
  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  return {
    id: str(r.id) || newId('h'),
    closedAt: num(r.closedAt ?? r.at, Date.now()),
    note: str(r.note),
    nextActionIds: ids(r.nextActionIds),
    leftUnclassified: num(r.leftUnclassified, 0),
    savedProjectIds: ids(r.savedProjectIds),
    dueSoonIds: ids(r.dueSoonIds),
  }
}

/**
 * Reads any supported backup.
 *
 * Recognised shapes:
 *  - this app's export: `{ app: "lowtide", version: 2, data: {...} }`
 *  - a v1 prototype backup: the JSON that lived under the `lowtide.v1` storage
 *    key, either as the bare object or wrapped in `{ "lowtide.v1": {...} }`.
 *    Field names are matched leniently because the prototype's exact spelling
 *    is not guaranteed; anything unreadable is listed in `problems`.
 */
export function previewImport(rawText: string, existing: Snapshot): ImportPreview {
  const problems: string[] = []
  const empty: ImportPreview = {
    format: 'unknown',
    incoming: { things: [], projects: [], capsules: [], handoffs: [] },
    counts: { things: 0, projects: 0, capsules: 0, handoffs: 0 },
    duplicates: 0,
    problems,
    exportedAt: null,
    ok: false,
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch (error) {
    problems.push(
      `This file is not valid JSON, so nothing can be read from it. (${
        error instanceof Error ? error.message : 'parse error'
      })`,
    )
    return empty
  }

  if (!parsed || typeof parsed !== 'object') {
    problems.push('This file does not contain a LOWTIDE backup.')
    return empty
  }

  const root = parsed as Record<string, unknown>
  const wrapped = root['lowtide.v1'] ?? root.lowtide ?? null
  const body = (
    wrapped && typeof wrapped === 'object' ? wrapped : root.data && typeof root.data === 'object' ? root.data : root
  ) as Record<string, unknown>

  let format: ImportPreview['format'] = 'unknown'
  if (root.app === EXPORT_APP && num(root.version, 0) >= 2) format = 'lowtide-v2'
  else if (wrapped || root.version === 1 || root.version === '1' || typeof root.items !== 'undefined')
    format = 'lowtide-v1'

  const rawThings = firstArray(body, ['things', 'items', 'thoughts', 'entries', 'dump', 'captures'])
  const rawProjects = firstArray(body, ['projects', 'blackBoxes', 'blackbox'])
  const rawCapsules = firstArray(body, ['capsules', 'contexts', 'blackBoxCapsules'])
  const rawHandoffs = firstArray(body, ['handoffs', 'closures', 'days'])

  if (!rawThings && !rawProjects && !rawCapsules && !rawHandoffs) {
    problems.push(
      'No LOWTIDE records were found in this file. Expected a “things” or “projects” list.',
    )
    return { ...empty, format }
  }

  if (format === 'unknown') format = 'lowtide-v1'

  const things = (rawThings ?? [])
    .map((r, i) => coerceThing(r, problems, i))
    .filter((t): t is Thing => t != null)
  const projects = (rawProjects ?? [])
    .map((r, i) => coerceProject(r, problems, i))
    .filter((p): p is Project => p != null)
  const capsules = (rawCapsules ?? [])
    .map((r, i) => coerceCapsule(r, problems, i))
    .filter((c): c is Capsule => c != null)
  const handoffs = (rawHandoffs ?? [])
    .map((r, i) => coerceHandoff(r, problems, i))
    .filter((h): h is Handoff => h != null)

  // Never overwrite what is already stored: same id means "already here".
  const seen = {
    things: new Set(existing.things.map((t) => t.id)),
    projects: new Set(existing.projects.map((p) => p.id)),
    capsules: new Set(existing.capsules.map((c) => c.id)),
    handoffs: new Set(existing.handoffs.map((h) => h.id)),
  }
  let duplicates = 0
  const keepThings = things.filter((t) => (seen.things.has(t.id) ? (duplicates++, false) : true))
  const keepProjects = projects.filter((p) =>
    seen.projects.has(p.id) ? (duplicates++, false) : true,
  )
  const keepCapsules = capsules.filter((c) =>
    seen.capsules.has(c.id) ? (duplicates++, false) : true,
  )
  const keepHandoffs = handoffs.filter((h) =>
    seen.handoffs.has(h.id) ? (duplicates++, false) : true,
  )

  // A capsule whose project is missing everywhere would be unreachable.
  const projectIds = new Set([
    ...existing.projects.map((p) => p.id),
    ...keepProjects.map((p) => p.id),
  ])
  const reachableCapsules = keepCapsules.filter((c) => {
    if (projectIds.has(c.projectId)) return true
    problems.push(`A saved capsule referred to a project that is not in this file; it was skipped.`)
    return false
  })

  const counts = {
    things: keepThings.length,
    projects: keepProjects.length,
    capsules: reachableCapsules.length,
    handoffs: keepHandoffs.length,
  }

  return {
    format,
    incoming: {
      things: keepThings,
      projects: keepProjects,
      capsules: reachableCapsules,
      handoffs: keepHandoffs,
    },
    counts,
    duplicates,
    problems,
    exportedAt: numOrNull(root.exportedAt),
    ok: counts.things + counts.projects + counts.capsules + counts.handoffs > 0,
  }
}

function firstArray(body: Record<string, unknown>, keys: string[]): unknown[] | null {
  for (const key of keys) {
    const value = body[key]
    if (Array.isArray(value)) return value
  }
  return null
}
