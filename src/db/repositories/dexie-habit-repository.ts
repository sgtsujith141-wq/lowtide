import { toTimestamp } from '../../lib/time';
import type { Habit, HabitUnit } from '../../types/domain';
import { habitEntrySchema, habitSchema } from '../schema';
import { InvalidInputError, RecordNotFoundError, RecordStateError } from './errors';
import { omitUndefined, resolveDeps, watchQuery, type RepositoryDeps } from './shared';
import type { HabitRepository } from './types';

/** Longest loggable day, in minutes. Anything above is a typo, not a day. */
export const MAX_MINUTES = 24 * 60;

function checkTarget(unit: HabitUnit, target: number | undefined) {
  if (target === undefined) return;
  if (unit === 'check') throw new InvalidInputError('A done-or-not habit has no target');
  if (!Number.isFinite(target) || target <= 0) {
    throw new InvalidInputError('A target must be a positive number');
  }
  if (unit === 'count' && !Number.isInteger(target)) {
    throw new InvalidInputError('A count target must be a whole number');
  }
  if (unit === 'minutes' && target > MAX_MINUTES) {
    throw new InvalidInputError(`A minutes target can't exceed ${MAX_MINUTES}`);
  }
}

/** Unit rules for a recorded entry (ADR-023). Zero is not an entry: clear instead. */
export function checkEntryValue(unit: HabitUnit, value: number) {
  const ok =
    unit === 'check'
      ? value === 1
      : unit === 'count'
        ? Number.isInteger(value) && value > 0
        : Number.isFinite(value) && value > 0 && value <= MAX_MINUTES;
  if (!ok) throw new InvalidInputError(`Not a valid ${unit} value: ${value}`);
}

export function createDexieHabitRepository(deps: RepositoryDeps): HabitRepository {
  const { db, clock, newId } = resolveDeps(deps);

  async function getHabit(id: string): Promise<Habit> {
    const habit = await db.habits.get(id);
    if (!habit) throw new RecordNotFoundError('Habit', id);
    return habit;
  }

  function setArchived(id: string, archived: boolean) {
    return db.transaction('rw', db.habits, async () => {
      const habit = habitSchema.parse({ ...(await getHabit(id)), archived });
      await db.habits.put(habit);
      return habit;
    });
  }

  return {
    async create(input) {
      checkTarget(input.unit, input.target);
      const habit = habitSchema.parse(
        omitUndefined({
          id: newId(),
          name: input.name.trim(),
          category: input.category,
          unit: input.unit,
          target: input.target,
          archived: false,
          createdAt: toTimestamp(clock()),
        }),
      );
      await db.habits.add(habit);
      return habit;
    },

    update(id, changes) {
      return db.transaction('rw', db.habits, async () => {
        const existing = await getHabit(id);
        const next: Record<string, unknown> = { ...existing };
        if (changes.name !== undefined) next.name = changes.name.trim();
        if (changes.category !== undefined) next.category = changes.category;
        if (changes.target !== undefined) {
          checkTarget(existing.unit, changes.target ?? undefined);
          next.target = changes.target ?? undefined;
        }
        const habit = habitSchema.parse(omitUndefined(next));
        await db.habits.put(habit);
        return habit;
      });
    },

    archive: (id) => setArchived(id, true),
    restore: (id) => setArchived(id, false),

    watchAll: watchQuery(() => db.habits.orderBy('createdAt').toArray()),

    setEntry(habitId, date, value, note) {
      return db.transaction('rw', db.habits, db.habitEntries, async () => {
        const habit = await getHabit(habitId);
        if (habit.archived) throw new RecordStateError(`Habit ${habitId} is archived`);
        checkEntryValue(habit.unit, value);
        const at = toTimestamp(clock());
        const existing = await db.habitEntries
          .where('[habitId+date]')
          .equals([habitId, date])
          .first();
        const entry = habitEntrySchema.parse(
          omitUndefined({
            id: existing?.id ?? newId(),
            habitId,
            date,
            value,
            note: note?.trim() || undefined,
            createdAt: existing?.createdAt ?? at,
            updatedAt: at,
          }),
        );
        // put() replaces by primary key; the unique [habitId+date] index is the
        // final guard against a second entry for the same day.
        await db.habitEntries.put(entry);
        return entry;
      });
    },

    clearEntry(habitId, date) {
      return db.transaction('rw', db.habits, db.habitEntries, async () => {
        await getHabit(habitId);
        await db.habitEntries.where('[habitId+date]').equals([habitId, date]).delete();
      });
    },

    watchEntries(start, end) {
      return watchQuery(() =>
        db.habitEntries.where('date').between(start, end, true, true).toArray(),
      );
    },
  };
}
