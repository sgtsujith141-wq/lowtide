import { Plus } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import { useRepositories } from '../../hooks/useRepositories';
import { formatDuration } from '../../lib/duration';
import type { Habit, HabitEntry, LocalDate } from '../../types/domain';
import { HabitForm } from '../rhythm/HabitForm';

/**
 * The gym, simply: a session done today, of a type (each type is a fitness
 * routine), with a duration and an optional note. Stays off Home (ADR-043);
 * never required for a strong day (ADR-037).
 */
export function GymArea({
  types,
  entries,
  today,
  onChange,
}: {
  types: readonly Habit[];
  entries: ReadonlyMap<string, HabitEntry>;
  today: LocalDate;
  onChange: (message: string) => void;
}) {
  const { habits } = useRepositories();
  const [typeId, setTypeId] = useState('');
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const ids = { type: useId(), minutes: useId(), note: useId() };
  const chosen = types.find((t) => t.id === (typeId || types[0]?.id));
  const logged = types.filter((t) => entries.has(t.id));

  async function log(event: FormEvent) {
    event.preventDefault();
    if (!chosen) return;
    setError(null);
    const value = chosen.unit === 'check' ? 1 : Number(minutes);
    if (chosen.unit !== 'check' && !(Number.isFinite(value) && value > 0)) {
      return setError(chosen.unit === 'minutes' ? 'How many minutes?' : 'How many?');
    }
    try {
      await habits.setEntry(chosen.id, today, value, note);
      onChange(`Logged ${chosen.name}.`);
      setMinutes('');
      setNote('');
    } catch {
      setError('Couldn’t log that. Nothing changed.');
    }
  }

  return (
    <div className="space-y-4">
      {types.length === 0 && !adding ? (
        <p className="text-sm text-ink-muted">
          Add the kinds of session you do (strength, cardio, yoga…) to log them here.
        </p>
      ) : (
        types.length > 0 && (
          <form
            aria-label="Log a gym session"
            onSubmit={(e) => void log(e)}
            className="grid max-w-xl gap-3 sm:grid-cols-[1fr_7rem] sm:items-end"
          >
            <div>
              <label htmlFor={ids.type} className={labelClass}>
                Type
              </label>
              <select
                id={ids.type}
                value={chosen?.id ?? ''}
                onChange={(e) => setTypeId(e.target.value)}
                className={fieldClass}
              >
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            {chosen && chosen.unit !== 'check' && (
              <div>
                <label htmlFor={ids.minutes} className={labelClass}>
                  {chosen.unit === 'minutes' ? 'Minutes' : 'Count'}
                </label>
                <input
                  id={ids.minutes}
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  className={fieldClass}
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <label htmlFor={ids.note} className={labelClass}>
                Note (optional)
              </label>
              <input
                id={ids.note}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={fieldClass}
              />
            </div>
            {error && <ErrorNotice>{error}</ErrorNotice>}
            <div>
              <Button type="submit" variant="primary">
                Log session
              </Button>
            </div>
          </form>
        )
      )}

      {logged.length > 0 && (
        <ul aria-label="Today’s gym" className="divide-y divide-line text-sm">
          {logged.map((t) => {
            const entry = entries.get(t.id)!;
            return (
              <li key={t.id} className="flex items-baseline gap-2 py-1.5">
                <span className="font-medium">{t.name}</span>
                <span className="text-ink-muted">
                  {t.unit === 'minutes'
                    ? formatDuration(entry.value)
                    : t.unit === 'count'
                      ? `× ${entry.value}`
                      : 'done'}
                </span>
                {entry.note && (
                  <span className="min-w-0 truncate text-ink-muted">· {entry.note}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <HabitForm
          initial={{ name: '', category: 'fitness', unit: 'minutes', target: '' }}
          unitLocked={false}
          submitLabel="Add"
          formLabel="New gym type"
          onSave={async ({ name, category, unit, target }) => {
            const habit = await habits.create({
              name,
              category,
              unit,
              ...(target === null ? {} : { target }),
            });
            setAdding(false);
            setTypeId(habit.id);
            onChange(`Added ${habit.name}.`);
          }}
          onCancel={() => {
            setAdding(false);
            requestAnimationFrame(() => addButton.current?.focus());
          }}
        />
      ) : (
        <Button ref={addButton} variant="ghost" onClick={() => setAdding(true)}>
          <Plus aria-hidden className="size-4" /> New gym type
        </Button>
      )}
    </div>
  );
}
