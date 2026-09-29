import { toTimestamp } from '../../lib/time';
import type { Habit } from '../../types/domain';
import { checkEntryValue, checkHabitTarget } from '../rules';
import { habitEntrySchema, habitSchema } from '../schema';
import { RecordNotFoundError, RecordStateError } from './errors';
import { appendEvent, deleteEventsFor } from './ledger';
import { omitUndefined, resolveDeps, watchQuery, type RepositoryDeps } from './shared';
import type { HabitRepository } from './types';

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
      checkHabitTarget(input.unit, input.target);
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
          checkHabitTarget(existing.unit, changes.target ?? undefined);
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
      return db.transaction('rw', db.habits, db.habitEntries, db.events, async () => {
        const habit = await getHabit(habitId);
        if (habit.archived) throw new RecordStateError(`Habit ${habitId} is archived`);
        checkEntryValue(habit.unit, value);
        const now = clock();
        const at = toTimestamp(now);
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
        await appendEvent(db, newId, now, {
          type: 'habit.logged',
          entityId: entry.id,
          data: { habitId, date },
        });
        return entry;
      });
    },

    clearEntry(habitId, date) {
      return db.transaction('rw', db.habits, db.habitEntries, db.events, async () => {
        await getHabit(habitId);
        const entry = await db.habitEntries.where('[habitId+date]').equals([habitId, date]).first();
        if (!entry) return;
        await db.habitEntries.delete(entry.id);
        await deleteEventsFor(db, 'habitEntry', entry.id);
      });
    },

    watchEntries(start, end) {
      return watchQuery(() =>
        db.habitEntries.where('date').between(start, end, true, true).toArray(),
      );
    },
  };
}
