import { toTimestamp } from '../../lib/time';
import type { Task, TaskStatus } from '../../types/domain';
import { taskSchema } from '../schema';
import { RecordNotFoundError, RecordStateError } from './errors';
import { omitUndefined, resolveDeps, watchQuery, type RepositoryDeps } from './shared';
import type { NewTask, TaskChanges, TaskRepository } from './types';

const OPEN: readonly TaskStatus[] = ['todo', 'doing'];
const CLOSED: readonly TaskStatus[] = ['done', 'dropped'];

/** Trimmed text, or `undefined` when blank, so empty optionals are omitted. */
function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildTask(input: NewTask, id: string, now: Date): Task {
  const at = toTimestamp(now);
  return taskSchema.parse(
    omitUndefined({
      id,
      title: input.title.trim(),
      notes: optionalText(input.notes),
      status: 'todo',
      priority: input.priority ?? 'normal',
      dueAt: input.dueAt,
      project: optionalText(input.project),
      createdAt: at,
      updatedAt: at,
    }),
  );
}

/** Applies edits; the result is validated by the caller before saving. */
function applyChanges(task: Task, changes: TaskChanges): Record<string, unknown> {
  const next: Record<string, unknown> = { ...task };
  if (changes.title !== undefined) next.title = changes.title.trim();
  if (changes.priority !== undefined) next.priority = changes.priority;
  if (changes.notes !== undefined) next.notes = optionalText(changes.notes);
  if (changes.project !== undefined) next.project = optionalText(changes.project);
  if (changes.dueAt !== undefined) next.dueAt = changes.dueAt ?? undefined;
  return omitUndefined(next);
}

export function createDexieTaskRepository(deps: RepositoryDeps): TaskRepository {
  const { db, clock, newId } = resolveDeps(deps);

  const listOpen = () =>
    db.tasks
      .orderBy('createdAt')
      .filter((task) => OPEN.includes(task.status))
      .toArray();

  const listClosed = async () =>
    (await db.tasks.filter((task) => CLOSED.includes(task.status)).toArray()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );

  /** Read-modify-write of one task inside a transaction, validated before saving. */
  function modify(
    id: string,
    allowedFrom: readonly TaskStatus[] | 'any',
    change: (task: Task, at: string) => object,
  ): Promise<Task> {
    return db.transaction('rw', db.tasks, async () => {
      const existing = await db.tasks.get(id);
      if (!existing) throw new RecordNotFoundError('Task', id);
      if (allowedFrom !== 'any' && !allowedFrom.includes(existing.status)) {
        throw new RecordStateError(`Task ${id} is ${existing.status}`);
      }
      const at = toTimestamp(clock());
      const task = taskSchema.parse({ ...change(existing, at), updatedAt: at });
      await db.tasks.put(task);
      return task;
    });
  }

  return {
    async create(input) {
      const task = buildTask(input, newId(), clock());
      await db.tasks.add(task);
      return task;
    },

    get(id) {
      return db.tasks.get(id);
    },

    listOpen,
    watchOpen: watchQuery(listOpen),
    watchClosed: watchQuery(listClosed),

    update(id, changes) {
      return modify(id, 'any', (task) => applyChanges(task, changes));
    },

    complete(id) {
      return modify(id, OPEN, (task, at) => ({ ...task, status: 'done', completedAt: at }));
    },

    reopen(id) {
      return modify(id, CLOSED, (task) =>
        omitUndefined({ ...task, status: 'todo', completedAt: undefined }),
      );
    },

    drop(id) {
      return modify(id, OPEN, (task) => ({ ...task, status: 'dropped' }));
    },
  };
}
