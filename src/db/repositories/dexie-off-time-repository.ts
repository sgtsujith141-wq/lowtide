import { fromLocalDate, toLocalDate, toTimestamp } from '../../lib/time';
import type { Id, OffTimeSession } from '../../types/domain';
import { checkOffTime } from '../rules';
import { offTimeSessionSchema } from '../schema';
import { RecordNotFoundError, RecordStateError } from './errors';
import { appendEvent, deleteEventsFor } from './ledger';
import { omitUndefined, resolveDeps, watchQuery, type RepositoryDeps } from './shared';
import type { OffTimeRepository } from './types';

export function createDexieOffTimeRepository(deps: RepositoryDeps): OffTimeRepository {
  const { db, clock, newId } = resolveDeps(deps);
  const tables = [db.offTimeSessions, db.workSessions, db.events];

  const findOpen = () =>
    db.offTimeSessions.filter((o) => o.kind !== 'day_off' && o.endedAt === undefined).first();

  async function getWindow(id: Id): Promise<OffTimeSession> {
    const session = await db.offTimeSessions.get(id);
    if (!session || session.kind === 'day_off') throw new RecordNotFoundError('Off time', id);
    return session;
  }

  async function save(record: Record<string, unknown>) {
    const session = offTimeSessionSchema.parse(omitUndefined(record));
    checkOffTime(session);
    await db.offTimeSessions.put(session);
    return session;
  }

  return {
    start(kind, note) {
      return db.transaction('rw', tables, async () => {
        const now = clock();
        if (await db.workSessions.filter((s) => s.endedAt === undefined).first()) {
          throw new RecordStateError('Finish the work session before off time begins');
        }
        if (await findOpen()) throw new RecordStateError('Off time is already running');
        const at = toTimestamp(now);
        const session = await save({
          id: newId(),
          kind,
          localDate: toLocalDate(now),
          startedAt: at,
          note: note?.trim() || undefined,
          createdAt: at,
          updatedAt: at,
        });
        await appendEvent(db, newId, now, {
          type: 'offtime.started',
          entityId: session.id,
          data: { kind },
        });
        return session;
      });
    },

    end(id) {
      return db.transaction('rw', tables, async () => {
        const now = clock();
        const existing = await getWindow(id);
        if (existing.endedAt) return existing;
        const at = toTimestamp(now);
        const session = await save({ ...existing, endedAt: at, updatedAt: at });
        await appendEvent(db, newId, now, {
          type: 'offtime.ended',
          entityId: id,
          data: { kind: session.kind },
        });
        return session;
      });
    },

    discard(id) {
      return db.transaction('rw', tables, async () => {
        await getWindow(id);
        await db.offTimeSessions.delete(id);
        await deleteEventsFor(db, 'offTimeSession', id);
      });
    },

    declareDayOff(date, note) {
      return db.transaction('rw', tables, async () => {
        fromLocalDate(date); // validates
        const existing = await db.offTimeSessions
          .where('localDate')
          .equals(date)
          .filter((o) => o.kind === 'day_off')
          .first();
        const at = toTimestamp(clock());
        return save({
          id: existing?.id ?? newId(),
          kind: 'day_off',
          localDate: date,
          note: note?.trim() || undefined,
          createdAt: existing?.createdAt ?? at,
          updatedAt: at,
        });
      });
    },

    removeDayOff(date) {
      return db.transaction('rw', tables, async () => {
        await db.offTimeSessions
          .where('localDate')
          .equals(date)
          .filter((o) => o.kind === 'day_off')
          .delete();
      });
    },

    watchActive: watchQuery(() => findOpen()),

    watchRange(start, end) {
      return watchQuery(async () =>
        (
          await db.offTimeSessions.where('localDate').between(start, end, true, true).toArray()
        ).sort(
          (a, b) =>
            a.localDate.localeCompare(b.localDate) || a.createdAt.localeCompare(b.createdAt),
        ),
      );
    },
  };
}
