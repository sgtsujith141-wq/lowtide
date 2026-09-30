import { toTimestamp } from '../../lib/time';
import type { CollegeItem } from '../../types/domain';
import { checkCollegeItem } from '../rules';
import { collegeItemSchema } from '../schema';
import { RecordNotFoundError } from './errors';
import { omitUndefined, resolveDeps, type RepositoryDeps } from './shared';
import type { CollegeRepository } from './types';

function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function save(record: Record<string, unknown>): CollegeItem {
  const item = collegeItemSchema.parse(omitUndefined(record));
  checkCollegeItem(item);
  return item;
}

export function createDexieCollegeRepository(deps: RepositoryDeps): CollegeRepository {
  const resolved = resolveDeps(deps);
  const { db, clock, newId, watch } = resolved;
  return {
    async create(input) {
      const at = toTimestamp(clock());
      const item = save({
        id: newId(),
        kind: input.kind,
        title: input.title.trim(),
        date: input.date,
        status: input.status ?? 'planned',
        course: optionalText(input.course),
        note: optionalText(input.note),
        createdAt: at,
        updatedAt: at,
      });
      await db.collegeItems.add(item);
      return item;
    },

    update(id, changes) {
      return db.transaction('rw', db.collegeItems, async () => {
        const existing = await db.collegeItems.get(id);
        if (!existing) throw new RecordNotFoundError('College item', id);
        const next: Record<string, unknown> = { ...existing, updatedAt: toTimestamp(clock()) };
        if (changes.title !== undefined) next.title = changes.title.trim();
        if (changes.date !== undefined) next.date = changes.date;
        if (changes.status !== undefined) next.status = changes.status;
        if (changes.course !== undefined) next.course = optionalText(changes.course);
        if (changes.note !== undefined) next.note = optionalText(changes.note);
        const item = save(next);
        await db.collegeItems.put(item);
        return item;
      });
    },

    async remove(id) {
      await db.collegeItems.delete(id);
    },

    watchRange(start, end) {
      return watch(async () =>
        (await db.collegeItems.where('date').between(start, end, true, true).toArray()).sort(
          (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
        ),
      );
    },
  };
}
