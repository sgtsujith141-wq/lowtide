import { toTimestamp } from '../../lib/time';
import type { Task, TaskStatus } from '../../types/domain';
import { taskSchema } from '../schema';
import { InvalidInputError, RecordNotFoundError, RecordStateError } from './errors';
import { eventWriter } from './ledger';
import { omitUndefined, resolveDeps, type RepositoryDeps } from './shared';
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
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      parentId: input.parentId,
      plannedFor: input.plannedFor,
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
  if (changes.projectId !== undefined) {
    next.projectId = changes.projectId ?? undefined;
    // A milestone belongs to one project: moving or unlinking clears it.
    if (changes.projectId !== task.projectId) next.milestoneId = undefined;
  }
  if (changes.milestoneId !== undefined) next.milestoneId = changes.milestoneId ?? undefined;
  if (changes.parentId !== undefined) next.parentId = changes.parentId ?? undefined;
  return omitUndefined(next);
}

export function createDexieTaskRepository(deps: RepositoryDeps): TaskRepository {
  const resolved = resolveDeps(deps);
  const { db, clock, newId, watch } = resolved;
  const emit = eventWriter(resolved);
  const tables = [db.tasks, db.projects, db.milestones, db.events];

  /**
   * A task's project must exist, and its milestone must be in that project.
   * A subtask's parent exists, is in the same project and is no subtask
   * itself; a task with subtasks can't become one.
   */
  async function checkLinks(task: Task) {
    if (task.projectId !== undefined && !(await db.projects.get(task.projectId))) {
      throw new RecordNotFoundError('Project', task.projectId);
    }
    if (task.parentId !== undefined) {
      if (task.parentId === task.id) throw new InvalidInputError('A task can’t be its own subtask');
      const parent = await db.tasks.get(task.parentId);
      if (!parent) throw new RecordNotFoundError('Task', task.parentId);
      if (parent.parentId !== undefined) {
        throw new InvalidInputError('Subtasks can’t have subtasks of their own');
      }
      if ((parent.projectId ?? null) !== (task.projectId ?? null)) {
        throw new InvalidInputError('A subtask belongs to the same project as its parent');
      }
      const children = await db.tasks.where('parentId').equals(task.id).count();
      if (children > 0) throw new InvalidInputError('A task with subtasks can’t become a subtask');
    }
    if (task.milestoneId !== undefined) {
      const milestone = await db.milestones.get(task.milestoneId);
      if (!milestone) throw new RecordNotFoundError('Milestone', task.milestoneId);
      if (milestone.projectId !== task.projectId) {
        throw new InvalidInputError('That milestone belongs to another project');
      }
    }
  }

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
    after?: (task: Task, now: Date) => Promise<unknown>,
  ): Promise<Task> {
    return db.transaction('rw', tables, async () => {
      const existing = await db.tasks.get(id);
      if (!existing) throw new RecordNotFoundError('Task', id);
      if (allowedFrom !== 'any' && !allowedFrom.includes(existing.status)) {
        throw new RecordStateError(`Task ${id} is ${existing.status}`);
      }
      const now = clock();
      const at = toTimestamp(now);
      const task = taskSchema.parse({ ...change(existing, at), updatedAt: at });
      await checkLinks(task);
      await db.tasks.put(task);
      await after?.(task, now);
      return task;
    });
  }

  return {
    create(input) {
      return db.transaction('rw', tables, async () => {
        let draft = input;
        // A subtask takes its parent's project when none is given.
        if (input.parentId !== undefined && input.projectId === undefined) {
          const parent = await db.tasks.get(input.parentId);
          if (parent?.projectId) draft = { ...input, projectId: parent.projectId };
        }
        const task = buildTask(draft, newId(), clock());
        await checkLinks(task);
        await db.tasks.add(task);
        return task;
      });
    },

    get(id) {
      return db.tasks.get(id);
    },

    listOpen,
    watchOpen: watch(listOpen),
    watchClosed: watch(listClosed),

    update(id, changes) {
      return modify(id, 'any', (task) => applyChanges(task, changes));
    },

    complete(id) {
      return modify(
        id,
        OPEN,
        (task, at) => ({ ...task, status: 'done', completedAt: at }),
        (task, now) =>
          emit(now, {
            type: 'task.completed',
            entityId: task.id,
            projectId: task.projectId,
          }),
      );
    },

    reopen(id) {
      return modify(id, CLOSED, (task) =>
        omitUndefined({ ...task, status: 'todo', completedAt: undefined }),
      );
    },

    drop(id) {
      return modify(id, OPEN, (task) => ({ ...task, status: 'dropped' }));
    },

    setDoing(id, doing) {
      return modify(id, OPEN, (task) => ({ ...task, status: doing ? 'doing' : 'todo' }));
    },

    watchAll: watch(() => db.tasks.orderBy('createdAt').toArray()),

    planFor(id, date) {
      return modify(id, OPEN, (task) => ({ ...task, plannedFor: date }));
    },

    removeFromPlan(id) {
      return modify(id, 'any', (task) => omitUndefined({ ...task, plannedFor: undefined }));
    },

    watchForDay(day) {
      return watch(async () => {
        const [planned, due] = await Promise.all([
          db.tasks.where('plannedFor').equals(day).toArray(),
          // Deadlines are stored as UTC noon of their date (ADR-016), so
          // "on or before day" is "UTC date part <= day".
          db.tasks.where('dueAt').belowOrEqual(`${day}T23:59:59.999Z`).toArray(),
        ]);
        const byId = new Map([...planned, ...due].map((task) => [task.id, task]));
        return [...byId.values()].filter((task) => OPEN.includes(task.status));
      });
    },
  };
}
