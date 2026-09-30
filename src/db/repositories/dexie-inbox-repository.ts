import { toTimestamp } from '../../lib/time';
import { inboxItemSchema } from '../schema';
import { buildTask } from './dexie-task-repository';
import { RecordNotFoundError, RecordStateError } from './errors';
import { resolveDeps, type RepositoryDeps } from './shared';
import type { InboxRepository } from './types';

function splitContent(content: string): { title: string; notes?: string } {
  const [first = '', ...rest] = content.trim().split('\n');
  const notes = rest.join('\n').trim();
  return notes ? { title: first.trim(), notes } : { title: first.trim() };
}

export function createDexieInboxRepository(deps: RepositoryDeps): InboxRepository {
  const resolved = resolveDeps(deps);
  const { db, clock, newId, watch } = resolved;

  const unprocessed = () => db.inbox.orderBy('createdAt').filter((item) => !item.processedAt);
  const listUnprocessed = () => unprocessed().toArray();

  async function getUnprocessed(id: string) {
    const item = await db.inbox.get(id);
    if (!item) throw new RecordNotFoundError('InboxItem', id);
    if (item.processedAt) throw new RecordStateError(`InboxItem ${id} is already processed`);
    return item;
  }

  return {
    async capture(content) {
      const item = inboxItemSchema.parse({
        id: newId(),
        content: content.trim(),
        createdAt: toTimestamp(clock()),
      });
      await db.inbox.add(item);
      return item;
    },

    listUnprocessed,
    watchUnprocessed: watch(listUnprocessed),

    countUnprocessed() {
      return unprocessed().count();
    },

    convertToTask(id) {
      return db.transaction('rw', db.inbox, db.tasks, async () => {
        const item = await getUnprocessed(id);
        const now = clock();
        const task = buildTask(splitContent(item.content), newId(), now);
        await db.tasks.add(task);
        await db.inbox.put(
          inboxItemSchema.parse({
            ...item,
            processedAt: toTimestamp(now),
            convertedToTaskId: task.id,
          }),
        );
        return task;
      });
    },

    markProcessed(id) {
      return db.transaction('rw', db.inbox, async () => {
        const item = inboxItemSchema.parse({
          ...(await getUnprocessed(id)),
          processedAt: toTimestamp(clock()),
        });
        await db.inbox.put(item);
        return item;
      });
    },
  };
}
