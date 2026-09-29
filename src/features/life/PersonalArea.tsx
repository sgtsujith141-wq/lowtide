import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useRepositories } from '../../hooks/useRepositories';
import type { Habit, HabitCategory, HabitEntry, LocalDate } from '../../types/domain';
import { HabitForm } from '../rhythm/HabitForm';
import { HabitLogRow } from '../rhythm/HabitLogRow';

/**
 * Today's log for a set of routines (by category), with a way to add one.
 * Reuses Rhythm's rows and form, so a routine behaves the same everywhere.
 */
export function RoutineLog({
  title,
  habits,
  entries,
  today,
  defaultCategory,
  addLabel,
  empty,
  onChange,
}: {
  title: string;
  habits: readonly Habit[];
  entries: ReadonlyMap<string, HabitEntry>;
  today: LocalDate;
  defaultCategory: HabitCategory;
  addLabel: string;
  empty: string;
  onChange: (message: string) => void;
}) {
  const { habits: repo } = useRepositories();
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <div className="flex min-h-8 items-end justify-between gap-3 border-b border-line pb-1">
        <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{title}</h3>
        {!adding && (
          <Button
            ref={addButton}
            variant="ghost"
            onClick={() => setAdding(true)}
            className="-mr-2.5 h-7"
          >
            <Plus aria-hidden className="size-4" /> {addLabel}
          </Button>
        )}
      </div>
      {adding && (
        <HabitForm
          initial={{ name: '', category: defaultCategory, unit: 'check', target: '' }}
          unitLocked={false}
          submitLabel="Add"
          formLabel={addLabel}
          onSave={async ({ name, category, unit, target }) => {
            const habit = await repo.create({
              name,
              category,
              unit,
              ...(target === null ? {} : { target }),
            });
            setAdding(false);
            onChange(`Added ${habit.name}.`);
          }}
          onCancel={() => {
            setAdding(false);
            requestAnimationFrame(() => addButton.current?.focus());
          }}
        />
      )}
      {habits.length === 0 && !adding ? (
        <p className="py-2 text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul>
          {habits.map((habit) => (
            <HabitLogRow
              key={habit.id}
              habit={habit}
              entry={entries.get(habit.id)}
              today={today}
              onChange={onChange}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
