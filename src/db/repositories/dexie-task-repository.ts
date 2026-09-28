import { toTimestamp } from '../../lib/time';
import type { Task } from '../../types/domain';
import { taskSchema } from '../schema';
import { RecordNotFoundError } from './errors';
import { omitUndefined, resolveDeps, type RepositoryDeps } from './shared';
import type { NewTask, TaskRepository } from './types';

export function buildTask(input: NewTask, id: string, now: Date): Task {
  const at = toTimestamp(now);
  return taskSchema.parse(
    omitUndefined({
      id,
      title: input.title.trim(),
      notes: input.notes,
      status: 'todo',
      priority: input.priority ?? 'normal',
      dueAt: input.dueAt,
      project: input.project,
      createdAt: at,
      updatedAt: at,
    }),
  );
}

export function createDexieTaskRepository(deps: RepositoryDeps): TaskRepository {
  const { db, clock, newId } = resolveDeps(deps);

  return {
    async create(input) {
      const task = buildTask(input, newId(), clock());
      await db.tasks.add(task);
      return task;
    },

    get(id) {
      return db.tasks.get(id);
    },

    listOpen() {
      return db.tasks
        .orderBy('createdAt')
        .filter((task) => task.status === 'todo' || task.status === 'doing')
        .toArray();
    },

    complete(id) {
      return db.transaction('rw', db.tasks, async () => {
        const existing = await db.tasks.get(id);
        if (!existing) throw new RecordNotFoundError('Task', id);
        const at = toTimestamp(clock());
        const task = taskSchema.parse({
          ...existing,
          status: 'done',
          completedAt: at,
          updatedAt: at,
        });
        await db.tasks.put(task);
        return task;
      });
    },
  };
}
