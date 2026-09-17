import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Thing } from '../lib/types.ts'
import { editThingText } from '../lib/model.ts'
import { formatStamp } from '../lib/dates.ts'

/**
 * One captured thought. The text shown is always the user's own; editing keeps
 * the first version, which stays viewable underneath.
 */
export function ThingItem({
  thing,
  onSave,
  onDelete,
  meta,
  children,
  tone = 'plain',
}: {
  thing: Thing
  onSave: (next: Thing) => Promise<void> | void
  onDelete?: (thing: Thing) => Promise<void> | void
  meta?: ReactNode
  children?: ReactNode
  tone?: 'plain' | 'card'
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(thing.text)
  const [showOriginal, setShowOriginal] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing) return
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [editing])

  async function commit() {
    const next = editThingText(thing, draft)
    if (next !== thing && next.text) await onSave(next)
    setEditing(false)
  }

  const wrapper =
    tone === 'card'
      ? 'lt-card p-4 sm:p-5'
      : 'border-b border-rule py-4 last:border-b-0'

  return (
    <article className={wrapper}>
      {editing ? (
        <div>
          <label className="sr-only" htmlFor={`edit-${thing.id}`}>
            Edit this thought
          </label>
          <textarea
            id={`edit-${thing.id}`}
            ref={ref}
            className="lt-field lt-prose"
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
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void commit()
              }
            }}
          />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" className="lt-btn lt-btn-primary px-3 py-1.5 text-xs" onClick={() => void commit()}>
              Save
            </button>
            <button
              type="button"
              className="lt-btn lt-btn-quiet text-xs"
              onClick={() => {
                setDraft(thing.text)
                setEditing(false)
              }}
            >
              Cancel
            </button>
            <span className="ml-auto text-[0.7rem] text-muted">⌘↵ to save · Esc to cancel</span>
          </div>
        </div>
      ) : (
        <p className="lt-prose">{thing.text}</p>
      )}

      {thing.originalText && !editing ? (
        <div className="mt-2">
          <button
            type="button"
            className="text-[0.7rem] text-muted underline decoration-rule underline-offset-2 hover:text-accent-deep"
            onClick={() => setShowOriginal((v) => !v)}
            aria-expanded={showOriginal}
          >
            {showOriginal ? 'Hide what you first wrote' : 'Edited — see what you first wrote'}
          </button>
          {showOriginal ? (
            <p className="lt-inset lt-prose mt-2 px-3 py-2 text-[0.9375rem] text-muted">
              {thing.originalText}
            </p>
          ) : null}
        </div>
      ) : null}

      {children}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[0.7rem] text-muted">{formatStamp(thing.createdAt)}</span>
        {meta}
        <span className="flex-1" />
        {!editing ? (
          <>
            <button
              type="button"
              className="lt-btn lt-btn-quiet text-xs"
              onClick={() => {
                setDraft(thing.text)
                setEditing(true)
              }}
            >
              Edit
            </button>
            {onDelete ? (
              <button
                type="button"
                className="lt-btn lt-btn-quiet text-xs"
                onClick={() => void onDelete(thing)}
              >
                Delete
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  )
}
