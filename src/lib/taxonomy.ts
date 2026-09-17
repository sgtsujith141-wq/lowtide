import type { ThingKind } from './types.ts'

export interface KindMeta {
  kind: ThingKind
  label: string
  /** One line: what this drawer is for. */
  blurb: string
  /** Single-key shortcut used by the router keyboard interface. */
  hotkey: string
}

export const KINDS: KindMeta[] = [
  { kind: 'action', label: 'Action', blurb: 'Something you will do yourself.', hotkey: '1' },
  {
    kind: 'commitment',
    label: 'Commitment',
    blurb: 'You told someone this would happen. Has a date.',
    hotkey: '2',
  },
  {
    kind: 'waiting',
    label: 'Waiting on',
    blurb: "It's with someone else. Note who.",
    hotkey: '3',
  },
  { kind: 'idea', label: 'Idea', blurb: 'Worth keeping. Nothing owed.', hotkey: '4' },
  {
    kind: 'onmymind',
    label: 'On my mind',
    blurb: 'Taking up room. Not yet a task.',
    hotkey: '5',
  },
  { kind: 'project', label: 'Project', blurb: 'Bigger than one action.', hotkey: '6' },
  { kind: 'archive', label: 'Archive', blurb: 'Put it down. Keep the record.', hotkey: '7' },
]

const BY_KIND = new Map<ThingKind, KindMeta>(KINDS.map((k) => [k.kind, k]))

export function kindMeta(kind: ThingKind): KindMeta {
  const found = BY_KIND.get(kind)
  if (!found) throw new Error(`Unknown kind: ${kind}`)
  return found
}

export function kindLabel(kind: ThingKind | null): string {
  return kind ? kindMeta(kind).label : 'Unrouted'
}
