import { Check, X } from 'lucide-react';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { IconButton } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass } from '../../components/ui/styles';
import { useRepositories } from '../../hooks/useRepositories';
import type { Habit, HabitEntry, LocalDate } from '../../types/domain';
import { habitLevel } from './intensity';
import { levelClass } from '../../components/shared/grid-palette';
import { habitPalette } from './palette';

/**
 * Today's quick log for one habit. `check`: one press toggles. `count` and
 * `minutes`: type an amount; Enter or leaving the field saves it (replacing
 * today's amount), since phone number pads often have no Enter key. The clear
 * button removes today's entry. Nothing is logged without you typing or tapping.
 */
export function HabitLogRow({
  habit,
  entry,
  today,
  onChange,
}: {
  habit: Habit;
  entry: HabitEntry | undefined;
  today: LocalDate;
  onChange: (message: string) => void;
}) {
  const { habits } = useRepositories();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const level = habitLevel(habit, entry);

  // Controls stay enabled while saving: disabling a focused control drops
  // keyboard focus. Double submits are ignored here instead.
  async function run(action: () => Promise<unknown>, message: string) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await action();
      onChange(message);
      return true;
    } catch {
      setError('Couldn’t save that. Nothing changed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const square = (
    <span
      aria-hidden
      className={`size-3 shrink-0 rounded-[2px] ${levelClass(habitPalette(habit), level)}`}
    />
  );

  if (habit.unit === 'check') {
    const done = Boolean(entry);
    return (
      <li className="border-b border-line py-1.5">
        <button
          type="button"
          aria-pressed={done}
          onClick={() =>
            void run(
              () =>
                done ? habits.clearEntry(habit.id, today) : habits.setEntry(habit.id, today, 1),
              done ? `${habit.name}: cleared for today` : `${habit.name}: done today`,
            )
          }
          className="group flex w-full items-center gap-2.5 rounded-md py-0.5 text-left"
        >
          {square}
          <span className="min-w-0 flex-1 break-words">{habit.name}</span>
          <span
            className={`grid size-6 place-items-center rounded-full border transition-colors ${
              done
                ? 'border-accent-ink bg-accent-ink text-on-accent'
                : 'border-line-strong text-transparent group-hover:border-accent'
            }`}
          >
            <Check aria-hidden className="size-3.5" strokeWidth={3} />
          </span>
        </button>
        {error && <ErrorNotice>{error}</ErrorNotice>}
      </li>
    );
  }

  return (
    <AmountRow
      habit={habit}
      entry={entry}
      today={today}
      busy={busy}
      error={error}
      square={square}
      setError={setError}
      run={run}
    />
  );
}

function AmountRow({
  habit,
  entry,
  today,
  busy,
  error,
  square,
  setError,
  run,
}: {
  habit: Habit;
  entry: HabitEntry | undefined;
  today: LocalDate;
  busy: boolean;
  error: string | null;
  square: ReactNode;
  setError: (error: string | null) => void;
  run: (action: () => Promise<unknown>, message: string) => Promise<boolean>;
}) {
  const { habits } = useRepositories();
  const saved = entry ? String(entry.value) : '';
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? saved;
  const id = useId();
  const unitWord = habit.unit === 'minutes' ? 'min' : '';
  const input = useRef<HTMLInputElement>(null);

  async function commit() {
    if (busy) return;
    const trimmed = value.trim();
    if (trimmed === saved) return setDraft(null);
    if (trimmed === '' || Number(trimmed) === 0) {
      if (
        entry &&
        (await run(() => habits.clearEntry(habit.id, today), `${habit.name}: cleared for today`))
      ) {
        setDraft(null);
      }
      return;
    }
    const amount = Number(trimmed);
    const valid =
      Number.isFinite(amount) &&
      amount > 0 &&
      (habit.unit === 'count' ? Number.isInteger(amount) : amount <= 1440);
    if (!valid) {
      setError(
        habit.unit === 'count'
          ? 'Enter a whole number above 0.'
          : 'Enter minutes between 1 and 1440.',
      );
      return;
    }
    const label = habit.unit === 'minutes' ? `${amount} min` : String(amount);
    if (
      await run(() => habits.setEntry(habit.id, today, amount), `${habit.name}: ${label} today`)
    ) {
      setDraft(null);
    }
  }

  return (
    <li className="border-b border-line py-1.5">
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void commit();
        }}
        noValidate
        className="flex items-center gap-2.5"
      >
        {square}
        <label htmlFor={`${id}-amount`} className="min-w-0 flex-1 break-words">
          {habit.name}
        </label>
        <input
          id={`${id}-amount`}
          aria-label={`${habit.name}, ${habit.unit === 'minutes' ? 'minutes' : 'count'} today`}
          type="number"
          inputMode={habit.unit === 'count' ? 'numeric' : 'decimal'}
          min={1}
          step={habit.unit === 'count' ? 1 : 'any'}
          value={value}
          ref={input}
          placeholder="–"
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void commit();
            }
          }}
          onBlur={() => {
            if (draft !== null) void commit();
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
          className={`${fieldClass} max-w-20 shrink-0 py-1 text-right text-sm tabular-nums`}
        />
        <span id={`${id}-hint`} className="w-16 shrink-0 text-xs text-fg-muted tabular-nums">
          {unitWord}
          {habit.target ? ` / ${habit.target}` : ''}
          <span className="sr-only">. Saves on Enter or when you leave the field.</span>
        </span>
        <IconButton
          label={`Clear today’s ${habit.name}`}
          icon={<X aria-hidden className="size-4" />}
          disabled={!entry}
          className={entry ? '' : 'invisible'}
          onClick={() =>
            void run(
              () => habits.clearEntry(habit.id, today),
              `${habit.name}: cleared for today`,
            ).then((ok) => {
              if (!ok) return;
              setDraft(null);
              // The clear button disappears with the entry; keep focus in the row.
              input.current?.focus();
            })
          }
        />
      </form>
      {error && <ErrorNotice id={`${id}-error`}>{error}</ErrorNotice>}
    </li>
  );
}
