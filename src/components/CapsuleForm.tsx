import { useState } from 'react'
import { useStore } from '../lib/store-context.ts'
import { useToast } from '../lib/toast-context.ts'
import { draftFromCapsule, isCapsuleEmpty, type CapsuleDraft } from '../lib/model.ts'
import { newId } from '../lib/ids.ts'
import { Field, GrowTextarea } from './ui.tsx'
import type { Capsule } from '../lib/types.ts'

const PROMPTS: {
  key: keyof Omit<CapsuleDraft, 'links'>
  label: string
  placeholder: string
  hint?: string
  rows?: number
}[] = [
  {
    key: 'status',
    label: 'Where it stands',
    placeholder: 'Halfway through the second draft; the client has seen nothing yet.',
    rows: 2,
  },
  {
    key: 'lastCompleted',
    label: 'What you last finished',
    placeholder: 'Rewrote the opening section and cut the pricing slide.',
    rows: 2,
  },
  {
    key: 'blocker',
    label: "What's in the way",
    placeholder: 'Waiting on the revised figures from finance.',
    hint: 'Leave empty if nothing is blocking it.',
    rows: 2,
  },
  {
    key: 'lastDecision',
    label: 'The last decision you made',
    placeholder: 'Decided to drop the case study rather than shorten it.',
    hint: 'This is the one that is hardest to reconstruct later.',
    rows: 2,
  },
  {
    key: 'nextAction',
    label: 'The exact next action',
    placeholder: 'Open slide 12 and write the three-line summary.',
    hint: 'Concrete enough that you could start without thinking.',
    rows: 2,
  },
  {
    key: 'notes',
    label: 'Notes worth keeping',
    placeholder: 'Anything you would otherwise have to work out again.',
    rows: 3,
  },
]

/**
 * "Save my place": writes a new capsule version. Previous versions are never
 * touched, so nothing written here can be lost by writing again.
 */
export function CapsuleForm({
  projectId,
  previous,
  onSaved,
  submitLabel = 'Save my place',
}: {
  projectId: string
  previous: Capsule | null
  onSaved?: (capsule: Capsule) => void
  submitLabel?: string
}) {
  const store = useStore()
  const toast = useToast()
  const [draft, setDraft] = useState<CapsuleDraft>(() => draftFromCapsule(previous))
  const [saving, setSaving] = useState(false)

  const set = (key: keyof Omit<CapsuleDraft, 'links'>) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }))

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (isCapsuleEmpty(draft) || saving) return
    setSaving(true)
    try {
      const capsule = await store.saveCapsule(projectId, draft)
      onSaved?.(capsule)
    } catch {
      toast.show('Your place could not be saved. Everything you wrote is still on screen.', {
        tone: 'problem',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="grid gap-5">
      {PROMPTS.map((prompt) => (
        <Field
          key={prompt.key}
          label={prompt.label}
          hint={prompt.hint}
          htmlFor={`capsule-${prompt.key}`}
        >
          <GrowTextarea
            id={`capsule-${prompt.key}`}
            value={draft[prompt.key]}
            onChange={set(prompt.key)}
            minRows={prompt.rows ?? 2}
            placeholder={prompt.placeholder}
            className="lt-prose"
          />
        </Field>
      ))}

      <fieldset>
        <legend className="lt-label">Links</legend>
        <div className="grid gap-2">
          {draft.links.map((link, index) => (
            <div key={link.id} className="flex flex-wrap items-center gap-2">
              <input
                className="lt-field w-full sm:w-44"
                placeholder="Label"
                aria-label={`Link ${index + 1} label`}
                value={link.label}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    links: d.links.map((l) => (l.id === link.id ? { ...l, label: e.target.value } : l)),
                  }))
                }
              />
              <input
                className="lt-field min-w-0 flex-1"
                placeholder="https:// or a path on this machine"
                aria-label={`Link ${index + 1} address`}
                value={link.url}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    links: d.links.map((l) => (l.id === link.id ? { ...l, url: e.target.value } : l)),
                  }))
                }
              />
              <button
                type="button"
                className="lt-btn lt-btn-quiet text-xs"
                onClick={() =>
                  setDraft((d) => ({ ...d, links: d.links.filter((l) => l.id !== link.id) }))
                }
              >
                Remove
              </button>
            </div>
          ))}
          <div>
            <button
              type="button"
              className="lt-btn lt-btn-secondary text-xs"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  links: [...d.links, { id: newId('l'), label: '', url: '' }],
                }))
              }
            >
              Add a link
            </button>
          </div>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
        <button type="submit" className="lt-btn lt-btn-primary" disabled={isCapsuleEmpty(draft) || saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        <p className="text-xs text-muted">
          {previous
            ? 'Saving keeps the earlier version in this project’s history.'
            : 'This becomes the first entry in this project’s history.'}
        </p>
      </div>
    </form>
  )
}
