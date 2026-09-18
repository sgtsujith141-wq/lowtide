import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store-context.ts'
import { useToast } from '../lib/toast-context.ts'
import { KINDS, kindLabel } from '../lib/taxonomy.ts'
import { editThingText } from '../lib/model.ts'
import { DAY_MS, formatDay, fromDateInput, relativeDay, startOfDay, toDateInput } from '../lib/dates.ts'
import { nowMs, useNow } from '../lib/clock.ts'
import { Menu, type MenuItem } from './Menu.tsx'
import type { Thing } from '../lib/types.ts'

/**
 * One thought on the page. Compact by default; every decision about it is made
 * in place — a small menu or a strip that opens under the line, never a modal.
 */
export function ThoughtRow({
  thing,
  onDelete,
  showKind = true,
}: {
  thing: Thing
  onDelete?: (thing: Thing) => void
  showKind?: boolean
}) {
  const store = useStore()
  const toast = useToast()
  const now = useNow()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(thing.text)
  const [panel, setPanel] = useState<'park' | 'due' | 'project' | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  // Only a thought that was just written settles onto the page. Re-running the
  // animation on every render would move rows under the reader's pointer.
  const [fresh] = useState(() => nowMs() - thing.createdAt < 2000)
  const [menuOpen, setMenuOpen] = useState(false)
  const editRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing) return
    const el = editRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [editing])

  const project = thing.projectId ? store.projects.find((p) => p.id === thing.projectId) : null
  const isOverdue = thing.dueAt != null && thing.dueAt < startOfDay(now) && thing.status === 'open'
  const parked = thing.returnAt != null && thing.returnedAt == null

  async function patch(changes: Partial<Thing>) {
    try {
      await store.putThing({ ...thing, ...changes, updatedAt: nowMs() })
    } catch {
      toast.show('That could not be saved — nothing has changed.', { tone: 'problem' })
    }
  }

  async function commitEdit() {
    const next = editThingText(thing, draft)
    if (next !== thing && next.text) {
      try {
        await store.putThing(next)
      } catch {
        toast.show('That edit could not be saved. Your text is still here.', { tone: 'problem' })
        return
      }
    }
    setEditing(false)
  }

  const kindItems: MenuItem[] = KINDS.map((meta) => ({
    key: meta.kind,
    label: meta.label,
    hint: meta.hotkey,
    checked: thing.kind === meta.kind,
    onSelect: () =>
      void patch({ kind: meta.kind, classifiedAt: thing.classifiedAt ?? nowMs() }),
  }))

  const actionItems: MenuItem[] = [
    { key: 'edit', label: 'Edit the words', onSelect: () => { setDraft(thing.text); setEditing(true) } },
    thing.status === 'open'
      ? { key: 'done', label: 'Mark it done', onSelect: () => void patch({ status: 'done', completedAt: nowMs() }) }
      : { key: 'reopen', label: 'Reopen it', onSelect: () => void patch({ status: 'open', completedAt: null }) },
    { key: 'park', label: parked ? 'Change when it returns' : 'Put it aside until…', onSelect: () => setPanel('park') },
    { key: 'due', label: thing.dueAt ? 'Change the date' : 'Give it a date…', onSelect: () => setPanel('due') },
    { key: 'project', label: project ? 'Move to another project' : 'Add to a project…', onSelect: () => setPanel('project') },
  ]
  if (onDelete) {
    actionItems.push({ key: 'delete', label: 'Delete', onSelect: () => onDelete(thing) })
  }

  const liveProjects = store.projects.filter((p) => p.deletedAt == null && p.archivedAt == null)

  return (
    <article
      className={`group border-b border-line-soft py-2.5 last:border-b-0 ${fresh ? 'settle' : ''} ${
        menuOpen ? 'relative z-20' : ''
      }`}
    >
      {editing ? (
        <div>
          <label className="sr-only" htmlFor={`edit-${thing.id}`}>
            Edit this thought
          </label>
          <textarea
            id={`edit-${thing.id}`}
            ref={editRef}
            className="field written w-full"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${e.target.scrollHeight}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setDraft(thing.text)
                setEditing(false)
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void commitEdit()
              }
            }}
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button type="button" className="btn btn-solid" onClick={() => void commitEdit()}>
              Save
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setDraft(thing.text)
                setEditing(false)
              }}
            >
              Cancel
            </button>
            <span className="ml-auto text-[0.68rem] text-muted">↵ save · Esc cancel</span>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <p
            className={`written min-w-0 flex-1 ${
              thing.status === 'done' ? 'text-muted line-through decoration-line' : ''
            }`}
          >
            {thing.text}
          </p>

          <div className="flex shrink-0 items-center gap-1.5">
            {showKind ? (
              <Menu
                label={`File “${thing.text.slice(0, 40)}”`}
                items={kindItems}
                align="right"
                onOpenChange={setMenuOpen}
                triggerClassName={`chip ${thing.kind ? 'chip-green' : 'chip-sand'}`}
              >
                {thing.kind ? kindLabel(thing.kind) : 'File it'}
                <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="m6 9.5 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Menu>
            ) : null}

            <Menu
              label={`More for “${thing.text.slice(0, 40)}”`}
              items={actionItems}
              align="right"
              onOpenChange={setMenuOpen}
              triggerClassName="btn btn-ghost px-1.5 opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="19" cy="12" r="1.6" />
              </svg>
            </Menu>
          </div>
        </div>
      )}

      {/* meta line */}
      {!editing ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.7rem] text-muted">
          <span>{formatDay(thing.createdAt)}</span>
          {thing.dueAt != null ? (
            <span className={isOverdue ? 'text-brown' : ''}>
              · {isOverdue ? 'was due' : 'due'} {relativeDay(thing.dueAt, now)}
            </span>
          ) : null}
          {parked ? <span>· back {relativeDay(thing.returnAt as number, now)}</span> : null}
          {thing.waitingOn ? <span>· with {thing.waitingOn}</span> : null}
          {project ? <span>· {project.name}</span> : null}
          {thing.status === 'done' ? <span>· done</span> : null}
          {thing.originalText ? (
            <button
              type="button"
              className="underline decoration-line underline-offset-2 hover:text-forest-deep"
              aria-expanded={showOriginal}
              onClick={() => setShowOriginal((v) => !v)}
            >
              · edited
            </button>
          ) : null}
        </div>
      ) : null}

      {showOriginal && thing.originalText ? (
        <p className="paper-2 written mt-1.5 px-2.5 py-1.5 text-[0.875rem] text-muted">
          First written: {thing.originalText}
        </p>
      ) : null}

      {thing.note ? (
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">{thing.note}</p>
      ) : null}

      {/* in-place strips instead of dialogs */}
      {panel ? (
        <div className="paper-2 rise mt-2 flex flex-wrap items-center gap-2 px-3 py-2">
          {panel === 'park' ? (
            <>
              <label className="text-[0.75rem] text-muted" htmlFor={`park-${thing.id}`}>
                Bring it back on
              </label>
              <input
                id={`park-${thing.id}`}
                type="date"
                className="field w-auto"
                value={toDateInput(thing.returnAt)}
                min={toDateInput(startOfDay(now))}
                onChange={(e) => void patch({ returnAt: fromDateInput(e.target.value), returnedAt: null })}
              />
              <button
                type="button"
                className="chip"
                onClick={() => void patch({ returnAt: startOfDay(now) + DAY_MS, returnedAt: null })}
              >
                tomorrow
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => void patch({ returnAt: startOfDay(now) + 7 * DAY_MS, returnedAt: null })}
              >
                next week
              </button>
              {thing.returnAt != null ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void patch({ returnAt: null, returnedAt: null })}
                >
                  Cancel the ticket
                </button>
              ) : null}
            </>
          ) : null}

          {panel === 'due' ? (
            <>
              <label className="text-[0.75rem] text-muted" htmlFor={`due-${thing.id}`}>
                Due
              </label>
              <input
                id={`due-${thing.id}`}
                type="date"
                className="field w-auto"
                value={toDateInput(thing.dueAt)}
                onChange={(e) => void patch({ dueAt: fromDateInput(e.target.value) })}
              />
              <button type="button" className="chip" onClick={() => void patch({ dueAt: startOfDay(now) })}>
                today
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => void patch({ dueAt: startOfDay(now) + DAY_MS })}
              >
                tomorrow
              </button>
              {thing.dueAt != null ? (
                <button type="button" className="btn btn-ghost" onClick={() => void patch({ dueAt: null })}>
                  Clear
                </button>
              ) : null}
            </>
          ) : null}

          {panel === 'project' ? (
            liveProjects.length > 0 ? (
              <>
                <label className="text-[0.75rem] text-muted" htmlFor={`project-${thing.id}`}>
                  Part of
                </label>
                <select
                  id={`project-${thing.id}`}
                  className="field w-auto"
                  value={thing.projectId ?? ''}
                  onChange={(e) => void patch({ projectId: e.target.value || null })}
                >
                  <option value="">Nothing in particular</option>
                  {liveProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <p className="text-[0.75rem] text-muted">
                No projects yet — start one on the Projects page.
              </p>
            )
          ) : null}

          <button type="button" className="btn btn-ghost ml-auto" onClick={() => setPanel(null)}>
            Done
          </button>
        </div>
      ) : null}
    </article>
  )
}
