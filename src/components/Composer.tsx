import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store-context.ts'
import type { Thing } from '../lib/types.ts'

const DRAFT_KEY = 'lowtide.draft'

/** Best-effort draft storage: an unsent thought should survive a refresh. */
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
    /* storage unavailable — the text is still in the field */
  }
}

/**
 * The notebook composer.
 *
 * Capture has to be instant and never lose a word, so:
 *  - Enter saves, Shift+Enter makes a new line, Cmd/Ctrl+Enter also saves.
 *  - The field is NEVER disabled while saving. Disabling it blurs it, and a
 *    blurred composer silently swallows the next thing you type — which is
 *    exactly the bug this component was rewritten to fix.
 *  - An IME composition (Japanese, Chinese, Korean input) must be able to use
 *    Enter to accept a candidate without submitting.
 *  - The field clears optimistically for the instant feel, and the text comes
 *    straight back if the write fails.
 */
export function Composer({
  onCaptured,
  autoFocus = false,
  placeholder = 'Type anything. It does not have to make sense yet.',
  rows = 4,
}: {
  onCaptured?: (things: Thing[]) => void
  autoFocus?: boolean
  placeholder?: string
  rows?: number
}) {
  const store = useStore()
  const [text, setText] = useState(readDraft)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const composing = useRef(false)
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!autoFocus) return
    // Only take focus where a keyboard is already there. On a phone, focusing on
    // load would throw the on-screen keyboard over the page before the person
    // has decided to write anything.
    const hasKeyboard =
      typeof window.matchMedia !== 'function' ||
      window.matchMedia('(hover: hover) and (pointer: fine)').matches
    if (hasKeyboard) area.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    writeDraft(text)
  }, [text])

  // The saved note fades on its own; it never lingers as decoration.
  useEffect(() => {
    if (savedAt == null) return
    const timer = setTimeout(() => setSavedAt(null), 2600)
    return () => clearTimeout(timer)
  }, [savedAt])

  const focusComposer = useCallback(() => {
    const el = area.current
    if (!el) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [])

  const submit = useCallback(async () => {
    if (saving) return
    const payload = text.trim()
    if (!payload) {
      // Nothing to keep — whitespace never becomes a thought.
      setText('')
      focusComposer()
      return
    }

    setSaving(true)
    setFailure(null)
    // Clear optimistically so the next thought can be typed straight away.
    setText('')
    writeDraft('')

    try {
      const created = await store.capture([payload])
      setSavedAt(Date.now())
      onCaptured?.(created)
    } catch {
      // Nothing was written, so the words come back exactly as they were.
      setText((typedSince) => (typedSince ? `${payload}\n${typedSince}` : payload))
      setFailure(
        'That did not save, so your words are back in the notebook. Nothing has been lost — try again.',
      )
    } finally {
      setSaving(false)
      requestAnimationFrame(focusComposer)
    }
  }, [focusComposer, onCaptured, saving, store, text])

  const modifierHint =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
      ? '⌘↵'
      : 'Ctrl+↵'

  return (
    <div className="relative">
      <label className="sr-only" htmlFor="composer">
        Write down what is on your mind. Press Enter to save it, Shift and Enter for a new line.
      </label>
      <textarea
        id="composer"
        ref={area}
        rows={rows}
        className="ruled written field w-full px-4 py-[0.4rem] text-[1.0625rem]"
        style={{ minHeight: `calc(${rows} * var(--rule-step))` }}
        placeholder={placeholder}
        value={text}
        aria-describedby="composer-hint"
        aria-invalid={failure ? true : undefined}
        onChange={(e) => {
          setText(e.target.value)
          if (failure) setFailure(null)
        }}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          // Mid-composition Enter belongs to the IME, not to us.
          const native = event.nativeEvent as KeyboardEvent & { isComposing?: boolean }
          if (composing.current || native.isComposing || event.keyCode === 229) return
          if (event.shiftKey) return // a new line inside one thought
          event.preventDefault()
          void submit()
        }}
      />

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          className="btn btn-solid"
          disabled={saving || !text.trim()}
          // Keep the caret in the notebook when the button is clicked.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void submit()}
        >
          {saving ? 'Putting it down…' : 'Put it down'}
        </button>

        <p id="composer-hint" className="text-[0.7rem] text-muted">
          <kbd className="font-mono">↵</kbd> saves · <kbd className="font-mono">⇧↵</kbd> new line ·{' '}
          <kbd className="font-mono">{modifierHint}</kbd> saves
        </p>

        <p className="ml-auto min-h-4 text-[0.75rem]" aria-live="polite">
          {savedAt ? (
            <span className="fade text-forest-deep">Saved</span>
          ) : null}
        </p>
      </div>

      {failure ? (
        <div role="alert" className="paper-2 mt-3 flex flex-wrap items-center gap-3 px-3 py-2.5">
          <p className="min-w-0 flex-1 text-[0.8125rem] text-brown">{failure}</p>
          <button type="button" className="btn btn-soft" onClick={() => void submit()}>
            Try again
          </button>
        </div>
      ) : null}
    </div>
  )
}
