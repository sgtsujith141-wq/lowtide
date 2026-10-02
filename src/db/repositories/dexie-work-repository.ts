import { toLocalDate, toTimestamp } from '../../lib/time';
import type { Id, WorkSession } from '../../types/domain';
import { checkWorkSession } from '../rules';
import { workSessionSchema } from '../schema';
import { InvalidInputError, RecordNotFoundError, RecordStateError } from './errors';
import { deleteEventsFor, eventWriter } from './ledger';
import { omitUndefined, resolveDeps, type RepositoryDeps } from './shared';
import type { WorkRepository } from './types';

const byStart = (a: WorkSession, b: WorkSession) => a.startedAt.localeCompare(b.startedAt);

export function createDexieWorkRepository(deps: RepositoryDeps): WorkRepository {
  const resolved = resolveDeps(deps);
  const { db, clock, newId, watch } = resolved;
  const emit = eventWriter(resolved);
  const tables = [db.workSessions, db.offTimeSessions, db.tasks, db.projects, db.events];

  async function getSession(id: Id): Promise<WorkSession> {
    const session = await db.workSessions.get(id);
    if (!session) throw new RecordNotFoundError('Work session', id);
    return session;
  }

  function findOpen() {
    return db.workSessions.filter((s) => s.endedAt === undefined).first();
  }

  async function save(record: Record<string, unknown>): Promise<WorkSession> {
    const session = workSessionSchema.parse(omitUndefined(record));
    checkWorkSession(session);
    await db.workSessions.put(session);
    return session;
  }

  /** Read-modify-write of an open session. */
  function change(
    id: Id,
    apply: (session: WorkSession, at: string) => Record<string, unknown>,
    event: 'work.paused' | 'work.resumed' | 'work.finished',
  ) {
    return db.transaction('rw', tables, async () => {
      const now = clock();
      const existing = await getSession(id);
      if (existing.endedAt) throw new RecordStateError('That session has finished');
      const at = toTimestamp(now);
      const session = await save({ ...apply(existing, at), updatedAt: at });
      await emit(now, {
        type: event,
        entityId: id,
        projectId: session.projectId,
      });
      return session;
    });
  }

  const lastPauseOpen = (s: WorkSession) => {
    const last = s.pauses.at(-1);
    return last !== undefined && last.resumedAt === undefined;
  };

  return {
    start(input) {
      return db.transaction('rw', tables, async () => {
        const now = clock();
        if (await findOpen()) throw new RecordStateError('A work session is already running');
        const offTime = await db.offTimeSessions
          .filter((o) => o.kind !== 'day_off' && o.endedAt === undefined)
          .first();
        if (offTime) throw new RecordStateError('Off time is running; wake up first');

        let projectId = input.projectId;
        if (input.taskId !== undefined) {
          const task = await db.tasks.get(input.taskId);
          if (!task) throw new RecordNotFoundError('Task', input.taskId);
          if (task.status === 'done' || task.status === 'dropped') {
            throw new RecordStateError('That task is closed');
          }
          if (task.projectId !== undefined) {
            if (projectId !== undefined && projectId !== task.projectId) {
              throw new InvalidInputError('That task belongs to another project');
            }
            projectId = task.projectId;
          }
        }
        if (projectId !== undefined && !(await db.projects.get(projectId))) {
          throw new RecordNotFoundError('Project', projectId);
        }
        const at = toTimestamp(now);
        const session = await save({
          id: newId(),
          kind: input.kind,
          projectId,
          taskId: input.taskId,
          intent: input.intent?.trim() || undefined,
          startedAt: at,
          pauses: [],
          localDate: toLocalDate(now),
          createdAt: at,
          updatedAt: at,
        });
        await emit(now, {
          type: 'work.started',
          entityId: session.id,
          projectId,
          data: { kind: session.kind },
        });
        return session;
      });
    },

    pause(id) {
      return change(
        id,
        (s, at) => {
          if (lastPauseOpen(s)) throw new RecordStateError('Already paused');
          return { ...s, pauses: [...s.pauses, { at }] };
        },
        'work.paused',
      );
    },

    resume(id) {
      return change(
        id,
        (s, at) => {
          if (!lastPauseOpen(s)) throw new RecordStateError('Not paused');
          return {
            ...s,
            pauses: [...s.pauses.slice(0, -1), { ...s.pauses.at(-1)!, resumedAt: at }],
          };
        },
        'work.resumed',
      );
    },

    finish(id, outcome) {
      return change(
        id,
        (s, at) => {
          // Finishing while paused closes the pause at the same moment.
          const pauses = lastPauseOpen(s)
            ? [...s.pauses.slice(0, -1), { ...s.pauses.at(-1)!, resumedAt: at }]
            : s.pauses;
          return { ...s, pauses, endedAt: at, outcome: outcome?.trim() || undefined };
        },
        'work.finished',
      );
    },

    describe(id, outcome) {
      return db.transaction('rw', tables, async () => {
        const session = await getSession(id);
        if (!session.endedAt) throw new RecordStateError('Finish the session first');
        return save({
          ...session,
          outcome: outcome.trim().slice(0, 2000) || undefined,
          updatedAt: toTimestamp(clock()),
        });
      });
    },

    discard(id) {
      return db.transaction('rw', tables, async () => {
        await getSession(id);
        await db.workSessions.delete(id);
        await deleteEventsFor(db, 'workSession', id);
      });
    },

    watchActive: watch(() => findOpen()),

    watchRange(start, end) {
      return watch(async () =>
        (await db.workSessions.where('localDate').between(start, end, true, true).toArray()).sort(
          byStart,
        ),
      );
    },

    watchForProject(projectId) {
      return watch(async () =>
        (await db.workSessions.where('projectId').equals(projectId).toArray()).sort(byStart),
      );
    },
  };
}
