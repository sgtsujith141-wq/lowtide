import type { StoreDb } from '../store';
import { addDays } from '../../lib/calendar';
import { toLocalDate, toTimestamp } from '../../lib/time';
import { PRIVATE_EVENT_TYPES, type LedgerEvent } from '../../types/domain';
import { checkAiSession } from '../rules';
import { aiSessionSchema } from '../schema';
import { InvalidInputError, RecordNotFoundError } from './errors';
import { eventWriter } from './ledger';
import { omitUndefined, resolveDeps, type RepositoryDeps } from './shared';
import type { ActivityRepository, AiSessionRepository, EventQuery, EventRepository } from './types';

const newestFirst = (a: LedgerEvent, b: LedgerEvent) =>
  b.at.localeCompare(a.at) || b.id.localeCompare(a.id);

function visible(query: EventQuery | undefined) {
  return (e: LedgerEvent) =>
    (query?.projectId === undefined || e.projectId === query.projectId) &&
    (query?.includePrivate === true || !PRIVATE_EVENT_TYPES.includes(e.type));
}

export function createDexieEventRepository(deps: RepositoryDeps): EventRepository {
  const resolved = resolveDeps(deps);
  const { db, watch } = resolved;

  async function titleOf(event: LedgerEvent): Promise<string | undefined> {
    switch (event.entityType) {
      case 'task':
        return (await db.tasks.get(event.entityId))?.title;
      case 'milestone':
        return (await db.milestones.get(event.entityId))?.title;
      case 'projectItem':
        return (await db.projectItems.get(event.entityId))?.title;
      case 'decision':
        return (await db.decisions.get(event.entityId))?.title;
      case 'project':
        return (await db.projects.get(event.entityId))?.name;
      case 'workSession':
        return (await db.workSessions.get(event.entityId))?.intent;
      case 'aiSession':
        return (await db.aiSessions.get(event.entityId))?.summary;
      case 'habitEntry': {
        const entry = await db.habitEntries.get(event.entityId);
        return entry ? (await db.habits.get(entry.habitId))?.name : undefined;
      }
      case 'note':
        return (await db.notes.get(event.entityId))?.title;
      case 'offTimeSession':
        return undefined;
    }
  }

  async function recent(query: EventQuery | undefined) {
    const source = query?.day
      ? db.events.where('localDate').equals(query.day)
      : query?.projectId
        ? db.events.where('projectId').equals(query.projectId)
        : db.events.toCollection();
    const events = (await source.toArray())
      .filter(visible(query))
      .filter((e) => query?.projectId === undefined || e.projectId === query.projectId)
      .sort(newestFirst);
    return query?.limit ? events.slice(0, query.limit) : events;
  }

  return {
    watchTimeline(query) {
      return watch(async () => {
        const events = await recent(query);
        const names = new Map((await db.projects.toArray()).map((p) => [p.id, p.name]));
        return Promise.all(
          events.map(async (event) => {
            const title = await titleOf(event);
            const projectName = event.projectId ? names.get(event.projectId) : undefined;
            return {
              event,
              ...(title !== undefined ? { title } : {}),
              ...(projectName !== undefined ? { projectName } : {}),
            };
          }),
        );
      });
    },
    watchRecent(query) {
      return watch(() => recent(query));
    },
    watchRange(start, end, query) {
      return watch(async () => {
        const events = (
          await db.events.where('localDate').between(start, end, true, true).toArray()
        )
          .filter(visible(query))
          .sort(newestFirst);
        return query?.limit ? events.slice(0, query.limit) : events;
      });
    },
  };
}

export function createDexieAiSessionRepository(deps: RepositoryDeps): AiSessionRepository {
  const resolved = resolveDeps(deps);
  const { db, clock, newId, watch } = resolved;
  const emit = eventWriter(resolved);
  return {
    record(input) {
      return db.transaction('rw', [db.aiSessions, db.projects, db.tasks, db.events], async () => {
        const now = clock();
        if (input.projectId !== undefined && !(await db.projects.get(input.projectId))) {
          throw new RecordNotFoundError('Project', input.projectId);
        }
        if (input.taskId !== undefined) {
          const task = await db.tasks.get(input.taskId);
          if (!task) throw new RecordNotFoundError('Task', input.taskId);
          if (task.projectId !== input.projectId) {
            throw new InvalidInputError('That task belongs to another project');
          }
        }
        const session = aiSessionSchema.parse(
          omitUndefined({ ...input, id: newId(), createdAt: toTimestamp(now) }),
        );
        checkAiSession(session);
        await db.aiSessions.add(session);
        await emit(now, {
          type: 'ai.session.completed',
          entityId: session.id,
          projectId: session.projectId,
          data: { scope: session.scope },
          source: 'ai-client',
          actor: session.client,
        });
        return session;
      });
    },
    watchForProject(projectId) {
      return watch(async () =>
        (await db.aiSessions.where('projectId').equals(projectId).toArray()).sort((a, b) =>
          b.startedAt.localeCompare(a.startedAt),
        ),
      );
    },
  };
}

/**
 * Records that came in by import (ADR-062). They are history someone wrote
 * down elsewhere, not work done in LOWTIDE, so they never count as activity:
 * an imported finished task or old decision lights no square.
 */
async function importedIds(db: StoreDb): Promise<Set<string>> {
  const records = await db.sourceRecords.toArray();
  return new Set(records.map((r) => r.entityId));
}

/** Local day of an instant, as the owner saw it. */
const dayOf = (at: string) => toLocalDate(new Date(at));

export function createDexieActivityRepository(deps: RepositoryDeps): ActivityRepository {
  const resolved = resolveDeps(deps);
  const { db, watch } = resolved;
  return {
    watchSources(start, end) {
      const inRange = (at: string | undefined) => {
        if (at === undefined) return false;
        const day = dayOf(at);
        return day >= start && day <= end;
      };
      return watch(async () => {
        // Sessions are indexed by their start day; a window that started the
        // evening before `start` can still end inside the range, so read a day early.
        const before = addDays(start, -1);
        const [
          habits,
          habitEntries,
          workSessions,
          offTime,
          tasks,
          milestones,
          decisions,
          items,
          college,
        ] = await Promise.all([
          db.habits.toArray(),
          db.habitEntries.where('date').between(start, end, true, true).toArray(),
          db.workSessions.where('localDate').between(start, end, true, true).toArray(),
          db.offTimeSessions.where('localDate').between(before, end, true, true).toArray(),
          db.tasks.filter((t) => t.status === 'done' && inRange(t.completedAt)).toArray(),
          db.milestones.filter((m) => inRange(m.completedAt)).toArray(),
          db.decisions
            .where('decidedAt')
            .between(toTimestamp(new Date(`${before}T00:00:00`)), '￿')
            .toArray(),
          db.projectItems
            .filter((i) => (i.kind === 'blocker' || i.kind === 'approval') && inRange(i.resolvedAt))
            .toArray(),
          db.collegeItems.where('date').between(start, end, true, true).toArray(),
        ]);
        // Provenance is read only when something here could have been imported.
        const candidates = tasks.length + milestones.length + decisions.length + items.length;
        const imported = candidates ? await importedIds(db) : new Set<string>();
        const own = <T extends { id: string }>(records: T[]) =>
          imported.size ? records.filter((r) => !imported.has(r.id)) : records;
        return {
          habits,
          habitEntries,
          workSessions,
          offTimeSessions: offTime.filter((o) =>
            o.kind === 'day_off'
              ? o.localDate >= start && o.localDate <= end
              : inRange(o.endedAt ?? o.startedAt),
          ),
          completedTasks: own(tasks),
          milestones: own(milestones),
          decisions: own(decisions).filter((d) => inRange(d.decidedAt)),
          resolvedItems: own(items),
          collegeDone: college.filter((c) => c.status === 'attended' || c.status === 'done'),
        };
      });
    },
  };
}
