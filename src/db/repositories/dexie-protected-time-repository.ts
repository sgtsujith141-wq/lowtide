import { protectedTimeSchema } from '../schema';
import { RecordNotFoundError } from './errors';
import { omitUndefined, resolveDeps, watchQuery, type RepositoryDeps } from './shared';
import type { ProtectedTimeRepository } from './types';

function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function createDexieProtectedTimeRepository(deps: RepositoryDeps): ProtectedTimeRepository {
  const { db, newId } = resolveDeps(deps);

  return {
    async create(input) {
      const entry = protectedTimeSchema.parse(
        omitUndefined({
          id: newId(),
          title: input.title.trim(),
          date: input.date,
          kind: input.kind,
          notes: optionalText(input.notes),
        }),
      );
      await db.protectedTime.add(entry);
      return entry;
    },

    update(id, changes) {
      return db.transaction('rw', db.protectedTime, async () => {
        const existing = await db.protectedTime.get(id);
        if (!existing) throw new RecordNotFoundError('ProtectedTime', id);
        const next: Record<string, unknown> = { ...existing };
        if (changes.title !== undefined) next.title = changes.title.trim();
        if (changes.date !== undefined) next.date = changes.date;
        if (changes.kind !== undefined) next.kind = changes.kind;
        if (changes.notes !== undefined) next.notes = optionalText(changes.notes);
        const entry = protectedTimeSchema.parse(omitUndefined(next));
        await db.protectedTime.put(entry);
        return entry;
      });
    },

    remove(id) {
      return db.transaction('rw', db.protectedTime, async () => {
        if (!(await db.protectedTime.get(id))) throw new RecordNotFoundError('ProtectedTime', id);
        await db.protectedTime.delete(id);
      });
    },

    watchForDate(date) {
      return watchQuery(async () =>
        (await db.protectedTime.where('date').equals(date).toArray()).sort(
          (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
        ),
      );
    },
  };
}
