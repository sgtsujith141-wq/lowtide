import { useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store-context.ts'
import { useToast } from '../lib/toast-context.ts'
import { live, unrouted } from '../lib/model.ts'
import { KINDS, kindLabel } from '../lib/taxonomy.ts'
import { suggestionEngine } from '../lib/suggestions.ts'
import { formatDay, relativeDay, startOfDay } from '../lib/dates.ts'
import { href } from '../lib/router.ts'
import { EmptyNote, PageHeader, Quiet, SectionTitle, Tag } from '../components/ui.tsx'
import { ThingItem } from '../components/ThingItem.tsx'
import { ThingDetails } from '../components/ThingDetails.tsx'
import type { Thing, ThingKind } from '../lib/types.ts'
import { nowMs, useNow } from '../lib/clock.ts'

type Filter = 'all' | ThingKind

export function Things() {
  const store = useStore()
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [showClosed, setShowClosed] = useState(false)

  const queue = unrouted(store.things)

  const filed = useMemo(() => {
    const q = query.trim().toLowerCase()
    return live(store.things)
      .filter((t) => t.kind != null)
      .filter((t) => (showClosed ? true : t.status === 'open'))
      .filter((t) => (filter === 'all' ? true : t.kind === filter))
      .filter((t) => (q ? `${t.text} ${t.note} ${t.waitingOn}`.toLowerCase().includes(q) : true))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [filter, query, showClosed, store.things])

  const grouped = useMemo(() => {
    const map = new Map<ThingKind, Thing[]>()
    for (const thing of filed) {
      const list = map.get(thing.kind as ThingKind) ?? []
      list.push(thing)
      map.set(thing.kind as ThingKind, list)
    }
    return map
  }, [filed])

  async function remove(thing: Thing) {
    try {
      await store.softDeleteThing(thing.id)
      toast.show('Deleted.', { action: { label: 'Undo', run: () => store.restoreThing(thing.id) } })
    } catch {
      toast.show('That could not be deleted — nothing has changed.', { tone: 'problem' })
    }
  }

  const closedCount = live(store.things).filter((t) => t.kind != null && t.status !== 'open').length

  return (
    <div>
      <PageHeader
        eyebrow="My things"
        title="Everything you put down."
        lede="Filing is a decision about what something is, not a promise to do it. Every choice here can be changed later."
        actions={
          <a className="lt-btn lt-btn-secondary" href={href('/dump')}>
            Add more
          </a>
        }
      />

      {queue.length > 0 ? <RouterDeck queue={queue} onDelete={remove} /> : null}

      <section className="mt-12">
        <SectionTitle count={filed.length}>Filed</SectionTitle>

        <div className="mb-6 flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              Everything
            </FilterChip>
            {KINDS.map((meta) => {
              const count = live(store.things).filter(
                (t) => t.kind === meta.kind && (showClosed || t.status === 'open'),
              ).length
              if (!count) return null
              return (
                <FilterChip
                  key={meta.kind}
                  active={filter === meta.kind}
                  onClick={() => setFilter(meta.kind)}
                >
                  {meta.label} <span className="ml-1 tabular-nums opacity-60">{count}</span>
                </FilterChip>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-48 flex-1">
              <label className="sr-only" htmlFor="thing-search">
                Search your things
              </label>
              <input
                id="thing-search"
                type="search"
                className="lt-field"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-accent)]"
                checked={showClosed}
                onChange={(e) => setShowClosed(e.target.checked)}
              />
              Show finished ({closedCount})
            </label>
          </div>
        </div>

        {filed.length === 0 ? (
          <EmptyNote>
            {query || filter !== 'all'
              ? 'Nothing here matches that.'
              : 'Nothing filed yet. Anything you file will collect here.'}
          </EmptyNote>
        ) : (
          <div className="grid gap-8">
            {KINDS.filter((meta) => grouped.has(meta.kind)).map((meta) => (
              <section key={meta.kind} aria-label={meta.label}>
                <h3 className="lt-eyebrow mb-3">
                  {meta.label}
                  <span className="ml-2 tabular-nums opacity-70">
                    {grouped.get(meta.kind)?.length ?? 0}
                  </span>
                </h3>
                <div className="grid gap-3">
                  {(grouped.get(meta.kind) ?? []).map((thing) => (
                    <FiledThing key={thing.id} thing={thing} onDelete={remove} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`lt-btn px-2.5 py-1 text-xs ${active ? 'lt-btn-primary' : 'lt-btn-secondary'}`}
    >
      {children}
    </button>
  )
}

/** The mental load router: one keyboard-driven pass over what is unfiled. */
function RouterDeck({ queue, onDelete }: { queue: Thing[]; onDelete: (t: Thing) => void }) {
  const store = useStore()
  const toast = useToast()
  const refs = useRef<(HTMLLIElement | null)[]>([])

  async function fileIt(thing: Thing, kind: ThingKind, index: number) {
    try {
      await store.putThing({
        ...thing,
        kind,
        classifiedAt: thing.classifiedAt ?? nowMs(),
        updatedAt: nowMs(),
      })
      // Keep the keyboard where the hand is: the next unfiled card.
      requestAnimationFrame(() => {
        const next = refs.current[index] ?? refs.current[Math.max(0, index - 1)]
        next?.focus()
      })
    } catch {
      toast.show('That could not be filed — it is still waiting.', { tone: 'problem' })
    }
  }

  function moveFocus(from: number, delta: number) {
    const next = refs.current[from + delta]
    if (next) next.focus()
  }

  return (
    <section aria-labelledby="router-heading" className="lt-rise">
      <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-rule pb-2.5">
        <h2 id="router-heading" className="lt-eyebrow">
          To file<span className="ml-2 tabular-nums opacity-70">{queue.length}</span>
        </h2>
        <p className="hidden text-xs text-muted sm:block">Press 1–7 · J and K to move</p>
      </div>

      {suggestionEngine ? null : (
        <Quiet className="mb-4">
          Filing is yours to do. LOWTIDE ships no suggestion engine in this milestone, and it will
          not guess on your behalf.
        </Quiet>
      )}

      <ul className="grid gap-3">
        {queue.map((thing, index) => (
          <li
            key={thing.id}
            tabIndex={0}
            ref={(el) => {
              refs.current[index] = el
            }}
            className="lt-card p-4 outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] sm:p-5"
            onKeyDown={(event) => {
              const target = event.target as HTMLElement
              const tag = target.tagName
              if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
              if (event.metaKey || event.ctrlKey || event.altKey) return
              const meta = KINDS.find((k) => k.hotkey === event.key)
              if (meta) {
                event.preventDefault()
                void fileIt(thing, meta.kind, index)
                return
              }
              if (event.key === 'j' || event.key === 'ArrowDown') {
                event.preventDefault()
                moveFocus(index, 1)
              }
              if (event.key === 'k' || event.key === 'ArrowUp') {
                event.preventDefault()
                moveFocus(index, -1)
              }
            }}
          >
            <p className="lt-prose">{thing.text}</p>
            <p className="mt-1.5 text-[0.7rem] text-muted">{formatDay(thing.createdAt)}</p>
            <div className="mt-3.5 flex flex-wrap gap-1.5">
              {KINDS.map((meta) => (
                <button
                  key={meta.kind}
                  type="button"
                  className="lt-btn lt-btn-secondary px-2.5 py-1 text-xs"
                  title={meta.blurb}
                  onClick={() => void fileIt(thing, meta.kind, index)}
                >
                  <span className="hidden font-mono text-[0.65rem] text-muted sm:inline">{meta.hotkey}</span>
                  {meta.label}
                </button>
              ))}
              <button
                type="button"
                className="lt-btn lt-btn-quiet ml-auto text-xs"
                onClick={() => onDelete(thing)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function FiledThing({ thing, onDelete }: { thing: Thing; onDelete: (t: Thing) => void }) {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const now = useNow()
  const project = thing.projectId
    ? store.projects.find((p) => p.id === thing.projectId)
    : null
  const overdue = thing.dueAt != null && thing.dueAt < startOfDay(now) && thing.status === 'open'

  return (
    <div className="lt-card p-4 sm:p-5">
      <ThingItem
        thing={thing}
        onSave={(next) => store.putThing(next)}
        onDelete={onDelete}
        meta={
          <>
            <Tag tone="accent">{kindLabel(thing.kind)}</Tag>
            {thing.status === 'done' ? <Tag>Done</Tag> : null}
            {thing.dueAt != null ? (
              <Tag tone={overdue ? 'attention' : 'calm'}>
                {overdue ? 'Was due' : 'Due'} {relativeDay(thing.dueAt, now)}
              </Tag>
            ) : null}
            {thing.waitingOn ? <Tag>With {thing.waitingOn}</Tag> : null}
            {thing.returnAt != null && thing.returnedAt == null ? (
              <Tag>Back {relativeDay(thing.returnAt)}</Tag>
            ) : null}
            {project ? <Tag>{project.name}</Tag> : null}
            <button
              type="button"
              className="lt-btn lt-btn-quiet text-xs"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? 'Hide details' : 'Details'}
            </button>
          </>
        }
      >
        {open ? (
          <ThingDetails
            thing={thing}
            projects={store.projects}
            onPatch={(next) => store.putThing(next)}
          />
        ) : thing.note ? (
          <p className="lt-inset mt-3 px-3 py-2 text-sm text-muted">{thing.note}</p>
        ) : null}
      </ThingItem>
    </div>
  )
}
