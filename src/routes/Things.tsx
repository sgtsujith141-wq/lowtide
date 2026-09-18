import { useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store-context.ts'
import { useToast } from '../lib/toast-context.ts'
import { live, unrouted } from '../lib/model.ts'
import { KINDS } from '../lib/taxonomy.ts'
import { suggestionEngine } from '../lib/suggestions.ts'
import { nowMs } from '../lib/clock.ts'
import { href } from '../lib/router.ts'
import { Composer } from '../components/Composer.tsx'
import { ThoughtRow } from '../components/ThoughtRow.tsx'
import { Empty, PageHead, Panel, Quiet, SectionHead } from '../components/ui.tsx'
import type { Thing, ThingKind } from '../lib/types.ts'

type Filter = 'all' | 'done' | ThingKind

export function Things() {
  const store = useStore()
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)

  const queue = unrouted(store.things)

  const filed = useMemo(() => {
    const q = query.trim().toLowerCase()
    return live(store.things)
      .filter((t) => t.kind != null)
      .filter((t) => (filter === 'done' ? t.status === 'done' : t.status === 'open'))
      .filter((t) => (filter === 'all' || filter === 'done' ? true : t.kind === filter))
      .filter((t) => (q ? `${t.text} ${t.note} ${t.waitingOn}`.toLowerCase().includes(q) : true))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [filter, query, store.things])

  const grouped = useMemo(() => {
    const map = new Map<ThingKind, Thing[]>()
    for (const thing of filed) {
      const list = map.get(thing.kind as ThingKind) ?? []
      list.push(thing)
      map.set(thing.kind as ThingKind, list)
    }
    return map
  }, [filed])

  const doneCount = live(store.things).filter((t) => t.kind != null && t.status === 'done').length

  async function remove(thing: Thing) {
    try {
      await store.softDeleteThing(thing.id)
      toast.show('Put in the bin.', {
        action: { label: 'Undo', run: () => store.restoreThing(thing.id) },
      })
    } catch {
      toast.show('That could not be deleted — nothing has changed.', { tone: 'problem' })
    }
  }

  return (
    <div>
      <PageHead
        eyebrow="My things"
        title="Everything you put down."
        lede="Filing says what something is. It is not a promise to do it, and you can change your mind at any time."
        actions={
          <button type="button" className="btn btn-soft" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Close the notebook' : 'Add something'}
          </button>
        }
      />

      {adding ? (
        <Panel className="rise mb-5 !p-3">
          <Composer autoFocus rows={3} placeholder="Anything else on your mind?" />
        </Panel>
      ) : null}

      {queue.length > 0 ? <FilingPass queue={queue} onDelete={remove} /> : null}

      <section className="mt-7">
        <SectionHead count={filed.length}>{filter === 'done' ? 'Finished' : 'Filed'}</SectionHead>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
              Everything
            </Chip>
            {KINDS.map((meta) => {
              const count = live(store.things).filter(
                (t) => t.kind === meta.kind && t.status === 'open',
              ).length
              if (!count) return null
              return (
                <Chip key={meta.kind} active={filter === meta.kind} onClick={() => setFilter(meta.kind)}>
                  {meta.label} <span className="ml-1 tabular-nums opacity-60">{count}</span>
                </Chip>
              )
            })}
            {doneCount > 0 ? (
              <Chip active={filter === 'done'} onClick={() => setFilter('done')}>
                Finished <span className="ml-1 tabular-nums opacity-60">{doneCount}</span>
              </Chip>
            ) : null}
          </div>
          <div className="ml-auto w-full sm:w-52">
            <label className="sr-only" htmlFor="thing-search">
              Search your things
            </label>
            <input
              id="thing-search"
              type="search"
              className="field"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {filed.length === 0 ? (
          <Empty>
            {query || filter !== 'all'
              ? 'Nothing here matches that.'
              : 'Nothing filed yet. What you file will collect here.'}
          </Empty>
        ) : (
          <div className="grid gap-5">
            {KINDS.filter((meta) => grouped.has(meta.kind)).map((meta) => (
              <section key={meta.kind}>
                <h3 className="eyebrow mb-1.5">
                  {meta.label}
                  <span className="ml-1.5 tabular-nums opacity-65">
                    {grouped.get(meta.kind)?.length ?? 0}
                  </span>
                </h3>
                <Panel className="!py-1">
                  {(grouped.get(meta.kind) ?? []).map((thing) => (
                    <ThoughtRow key={thing.id} thing={thing} onDelete={remove} />
                  ))}
                </Panel>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Chip({
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
      className={`chip ${active ? 'chip-green' : ''}`}
    >
      {children}
    </button>
  )
}

/** One quiet pass over what has not been filed. 1–7 files, J/K moves. */
function FilingPass({ queue, onDelete }: { queue: Thing[]; onDelete: (t: Thing) => void }) {
  const store = useStore()
  const toast = useToast()
  const refs = useRef<(HTMLLIElement | null)[]>([])

  async function file(thing: Thing, kind: ThingKind, index: number) {
    try {
      await store.putThing({
        ...thing,
        kind,
        classifiedAt: thing.classifiedAt ?? nowMs(),
        updatedAt: nowMs(),
      })
      requestAnimationFrame(() => {
        const next = refs.current[index] ?? refs.current[Math.max(0, index - 1)]
        next?.focus()
      })
    } catch {
      toast.show('That could not be filed — it is still waiting.', { tone: 'problem' })
    }
  }

  return (
    <section aria-labelledby="filing-heading" className="rise">
      <SectionHead
        count={queue.length}
        action={<span className="hidden text-[0.7rem] text-muted sm:inline">1–7 to file · J/K to move</span>}
      >
        <span id="filing-heading">To file</span>
      </SectionHead>

      {suggestionEngine ? null : (
        <Quiet className="mb-2.5">
          Filing is yours. LOWTIDE has no suggestion engine in this build and will not guess what
          your words mean.
        </Quiet>
      )}

      <ul className="grid gap-2">
        {queue.map((thing, index) => (
          <li
            key={thing.id}
            tabIndex={0}
            ref={(el) => {
              refs.current[index] = el
            }}
            className="paper px-3 py-1 outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--color-forest)]"
            onKeyDown={(event) => {
              const target = event.target as HTMLElement
              if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
              if (event.metaKey || event.ctrlKey || event.altKey) return
              const meta = KINDS.find((k) => k.hotkey === event.key)
              if (meta) {
                event.preventDefault()
                void file(thing, meta.kind, index)
                return
              }
              if (event.key === 'j' || event.key === 'ArrowDown') {
                event.preventDefault()
                refs.current[index + 1]?.focus()
              }
              if (event.key === 'k' || event.key === 'ArrowUp') {
                event.preventDefault()
                refs.current[index - 1]?.focus()
              }
            }}
          >
            <ThoughtRow thing={thing} onDelete={onDelete} />
          </li>
        ))}
      </ul>

      <Quiet className="mt-2.5">
        Leaving these for later is fine.{' '}
        <a className="link" href={href('/')}>
          Back to the notebook
        </a>
      </Quiet>
    </section>
  )
}
