import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store-context.ts'
import { useToast } from '../lib/toast-context.ts'
import { splitLines, unrouted } from '../lib/model.ts'
import { href } from '../lib/router.ts'
import { PageHeader, Quiet } from '../components/ui.tsx'
import { ThingItem } from '../components/ThingItem.tsx'
import type { Thing } from '../lib/types.ts'

const DRAFT_KEY = 'lowtide.draft'

/** Keeps the half-written thought across reloads. Best effort: never throws. */
function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeDraft(value: string): void {
  try {
    if (value) localStorage.setItem(DRAFT_KEY, value)
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Storage is unavailable; the text stays in the field regardless.
  }
}

export function Dump() {
  const store = useStore()
  const toast = useToast()
  const [text, setText] = useState(readDraft)
  const [saving, setSaving] = useState(false)
  const [sessionIds, setSessionIds] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    area.current?.focus()
  }, [])

  useEffect(() => {
    writeDraft(text)
  }, [text])

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 160)}px`
  }, [text])

  const lines = splitLines(text)
  const multiline = lines.length > 1
  const captured = sessionIds
    .map((id) => store.things.find((t) => t.id === id))
    .filter((t): t is Thing => t != null && t.deletedAt == null)
  const queue = unrouted(store.things)

  async function save(mode: 'single' | 'lines') {
    if (!text.trim() || saving) return
    const payload = mode === 'lines' ? splitLines(text) : [text.trim()]
    setSaving(true)
    try {
      const created = await store.capture(payload)
      // Only now is it safe to clear the field.
      setText('')
      writeDraft('')
      setSessionIds((ids) => [...created.map((c) => c.id), ...ids])
      setStatus(
        created.length === 1 ? 'Saved. It is out of your head now.' : `Saved ${created.length} things.`,
      )
      area.current?.focus()
    } catch {
      setStatus('')
      toast.show(
        'That did not save, so your words are still in the box. Copy them somewhere safe before leaving this page.',
        { tone: 'problem' },
      )
    } finally {
      setSaving(false)
    }
  }

  async function remove(thing: Thing) {
    try {
      await store.softDeleteThing(thing.id)
      toast.show('Deleted.', {
        action: { label: 'Undo', run: () => store.restoreThing(thing.id) },
      })
    } catch {
      toast.show('That could not be deleted — nothing has changed.', { tone: 'problem' })
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="The dump"
        title="Put it down."
        lede="Write it the way it arrives. Spelling, order and neatness do not matter here — nothing you type is read by anything but you."
      />

      <section className="lt-card p-4 sm:p-6" aria-label="Capture">
        <label htmlFor="dump" className="lt-label">
          What is taking up room?
        </label>
        <textarea
          id="dump"
          ref={area}
          className="lt-field lt-prose min-h-40 w-full leading-relaxed"
          placeholder={'call the dentist\nthe Harrow deck is still unfinished\nI said I would send Priya the numbers by Friday'}
          value={text}
          disabled={saving}
          onChange={(e) => {
            setText(e.target.value)
            if (status) setStatus('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void save(multiline ? 'lines' : 'single')
              return
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void save('single')
              return
            }
            if (e.key === 'Escape') {
              e.currentTarget.blur()
            }
          }}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="lt-btn lt-btn-primary"
            disabled={!text.trim() || saving}
            onClick={() => void save('single')}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {multiline ? (
            <button
              type="button"
              className="lt-btn lt-btn-secondary"
              disabled={saving}
              onClick={() => void save('lines')}
            >
              Save {lines.length} lines separately
            </button>
          ) : null}
          <p className="ml-auto hidden text-[0.7rem] text-muted sm:block">
            <kbd className="font-mono">↵</kbd> save · <kbd className="font-mono">⇧↵</kbd> new line ·{' '}
            <kbd className="font-mono">⌘↵</kbd> save each line
          </p>
        </div>

        <p className="mt-3 min-h-5 text-sm text-accent-deep" role="status" aria-live="polite">
          {status}
        </p>
      </section>

      {captured.length > 0 ? (
        <section className="mt-10" aria-label="Captured in this sitting">
          <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-rule pb-2.5">
            <h2 className="lt-eyebrow">
              Down on paper<span className="ml-2 tabular-nums opacity-70">{captured.length}</span>
            </h2>
            <a href={href('/things')} className="lt-link text-xs">
              File them →
            </a>
          </div>
          <div className="lt-card px-4 sm:px-5">
            {captured.map((thing) => (
              <ThingItem
                key={thing.id}
                thing={thing}
                onSave={(next) => store.putThing(next)}
                onDelete={remove}
              />
            ))}
          </div>
        </section>
      ) : null}

      {queue.length > 0 ? (
        <section className="mt-10">
          <Quiet>
            {queue.length} thing{queue.length === 1 ? '' : 's'} {queue.length === 1 ? 'is' : 'are'}{' '}
            waiting to be filed.{' '}
            <a className="lt-link" href={href('/things')}>
              Go and file {queue.length === 1 ? 'it' : 'them'}
            </a>{' '}
            — or leave it for the end of the day.
          </Quiet>
        </section>
      ) : null}
    </div>
  )
}
