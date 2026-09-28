import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import {
  HABIT_CATEGORIES,
  HABIT_UNITS,
  type HabitCategory,
  type HabitUnit,
} from '../../types/domain';
import { CATEGORY_LABEL, UNIT_LABEL } from './labels';

export interface HabitDraft {
  name: string;
  category: HabitCategory;
  unit: HabitUnit;
  target: string;
}

/**
 * Create or edit a habit: name, broad category, unit, optional target. The
 * unit is fixed once created (`unitLocked`), since it defines what entries mean.
 */
export function HabitForm({
  initial,
  unitLocked,
  submitLabel,
  formLabel,
  onSave,
  onCancel,
}: {
  initial: HabitDraft;
  unitLocked: boolean;
  submitLabel: string;
  formLabel: string;
  onSave: (draft: {
    name: string;
    category: HabitCategory;
    unit: HabitUnit;
    target: number | null;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();
  const targetable = draft.unit !== 'check';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) return setError('Give it a name.');
    let target: number | null = null;
    if (targetable && draft.target.trim()) {
      target = Number(draft.target);
      const ok =
        Number.isFinite(target) &&
        target > 0 &&
        (draft.unit === 'count' ? Number.isInteger(target) : target <= 1440);
      if (!ok) {
        return setError(
          draft.unit === 'count'
            ? 'A target is a whole number above 0, or leave it empty.'
            : 'A target is 1–1440 minutes, or leave it empty.',
        );
      }
    }
    setSaving(true);
    try {
      await onSave({ name: draft.name, category: draft.category, unit: draft.unit, target });
    } catch {
      setError('Couldn’t save that. It’s still here.');
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
      className="my-2 grid gap-3 rounded-md bg-paper-sunken p-2 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <label htmlFor={`${id}-name`} className={labelClass}>
          Name
        </label>
        <input
          id={`${id}-name`}
          value={draft.name}
          onChange={(e) => {
            setDraft({ ...draft, name: e.target.value });
            setError(null);
          }}
          placeholder="Coding, DSA, Gym, Read…"
          autoFocus
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${fieldClass} text-sm`}
        />
      </div>
      <div>
        <label htmlFor={`${id}-category`} className={labelClass}>
          Category
        </label>
        <select
          id={`${id}-category`}
          value={draft.category}
          onChange={(e) => setDraft({ ...draft, category: e.target.value as HabitCategory })}
          className={`${fieldClass} text-sm`}
        >
          {HABIT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-unit`} className={labelClass}>
          Record as
        </label>
        <select
          id={`${id}-unit`}
          value={draft.unit}
          disabled={unitLocked}
          onChange={(e) => setDraft({ ...draft, unit: e.target.value as HabitUnit, target: '' })}
          className={`${fieldClass} text-sm disabled:opacity-60`}
        >
          {HABIT_UNITS.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABEL[u]}
            </option>
          ))}
        </select>
      </div>
      {targetable && (
        <div>
          <label htmlFor={`${id}-target`} className={labelClass}>
            Daily target (optional)
          </label>
          <input
            id={`${id}-target`}
            type="number"
            inputMode="numeric"
            min={1}
            value={draft.target}
            onChange={(e) => {
              setDraft({ ...draft, target: e.target.value });
              setError(null);
            }}
            placeholder={draft.unit === 'minutes' ? 'e.g. 60' : 'e.g. 3'}
            className={`${fieldClass} text-sm`}
          />
        </div>
      )}
      {error && (
        <div className="sm:col-span-2">
          <ErrorNotice id={`${id}-error`}>{error}</ErrorNotice>
        </div>
      )}
      <div className="flex items-end justify-end gap-2 sm:col-span-2">
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
