import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import { PROTECTED_TIME_KINDS, type LocalDate, type ProtectedTimeKind } from '../../types/domain';
import { KIND_LABEL } from './protected-time-kinds';

export interface ProtectedTimeDraft {
  title: string;
  date: LocalDate;
  kind: ProtectedTimeKind;
  notes: string;
}

/** Add/edit form for protected time, with a Day choice across the week. Escape cancels. */
export function ProtectedTimeForm({
  initial,
  days,
  formLabel,
  submitLabel,
  onSave,
  onCancel,
}: {
  initial: ProtectedTimeDraft;
  /** Days the entry can be placed on (this week). */
  days: readonly { date: LocalDate; heading: string; short: string }[];
  formLabel: string;
  submitLabel: string;
  /** Resolves when saved; rejects to keep the form open with an error. */
  onSave: (draft: ProtectedTimeDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<'empty' | 'failed' | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) return setError('empty');
    setSaving(true);
    try {
      await onSave(draft);
    } catch {
      setError('failed');
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      noValidate
      aria-label={formLabel}
      className="my-2 grid gap-3 rounded-md bg-surface p-2 sm:grid-cols-[1fr_11rem_9rem]"
    >
      <div>
        <label htmlFor={`${id}-title`} className={labelClass}>
          What’s it for?
        </label>
        <input
          id={`${id}-title`}
          value={draft.title}
          onChange={(e) => {
            setDraft({ ...draft, title: e.target.value });
            if (error === 'empty') setError(null);
          }}
          placeholder="Dinner together, call home, do nothing…"
          autoFocus
          autoComplete="off"
          aria-invalid={error === 'empty' || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${fieldClass} text-sm`}
        />
      </div>
      <div>
        <label htmlFor={`${id}-date`} className={labelClass}>
          Day
        </label>
        <select
          id={`${id}-date`}
          value={draft.date}
          onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          className={`${fieldClass} text-sm`}
        >
          {days.map((day) => (
            <option key={day.date} value={day.date}>
              {day.heading} · {day.short}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-kind`} className={labelClass}>
          Kind
        </label>
        <select
          id={`${id}-kind`}
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value as ProtectedTimeKind })}
          className={`${fieldClass} text-sm`}
        >
          {PROTECTED_TIME_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-3">
        <label htmlFor={`${id}-notes`} className={labelClass}>
          Note (optional)
        </label>
        <input
          id={`${id}-notes`}
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          autoComplete="off"
          className={`${fieldClass} text-sm`}
        />
      </div>
      {error && (
        <div className="sm:col-span-3">
          <ErrorNotice id={`${id}-error`}>
            {error === 'empty' ? 'Give it a short title.' : 'Couldn’t save that. It’s still here.'}
          </ErrorNotice>
        </div>
      )}
      <div className="flex justify-end gap-2 sm:col-span-3">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
