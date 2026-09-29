import { addDays } from '../../lib/calendar';
import { toLocalDate, toTimestamp } from '../../lib/time';
import { PRIVATE_EVENT_TYPES, type LedgerEvent } from '../../types/domain';
import { checkAiSession } from '../rules';
import { aiSessionSchema } from '../schema';
import { RecordNotFoundError } from './errors';
import { appendEvent } from './ledger';
import { omitUndefined, resolveDeps, watchQuery, type RepositoryDeps } from './shared';
import type { ActivityRepository, AiSessionRepository, EventQuery, EventRepository } from './types';

const newestFirst = (a: LedgerEvent, b: LedgerEvent) =>
  b.at.localeCompare(a.at) || b.id.localeCompare(a.id);

function visible(query: EventQuery | undefined) {
  return (e: LedgerEvent) =>
    (query?.projectId === undefined || e.projectId === query.projectId) &&
    (query?.includePrivate === true || !PRIVATE_EVENT_TYPES.includes(e.type));
}

export function createDexieEventRepository(deps: RepositoryDeps): EventRepository {
  const { db } = resolveDeps(deps);

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
      case 'offTimeSession':
        return undefined;
    }
  }

  async function recent(query: EventQuery | undefined) {
    const source = query?.projectId
      ? db.events.where('projectId').equals(query.projectId)
      : db.events.toCollection();
    const events = (await source.toArray()).filter(visible(query)).sort(newestFirst);
    return query?.limit ? events.slice(0, query.limit) : events;
  }

  return {
    watchTimeline(query) {
      return watchQuery(async () => {
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
      return watchQuery(() => recent(query));
    },
    watchRange(start, end, query) {
      return watchQuery(async () => {
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
  const { db, clock, newId } = resolveDeps(deps);
  return {
    record(input) {
      return db.transaction('rw', [db.aiSessions, db.projects, db.events], async () => {
        const now = clock();
        if (input.projectId !== undefined && !(await db.projects.get(input.projectId))) {
          throw new RecordNotFoundError('Project', input.projectId);
        }
        const session = aiSessionSchema.parse(
          omitUndefined({ ...input, id: newId(), createdAt: toTimestamp(now) }),
        );
        checkAiSession(session);
        await db.aiSessions.add(session);
        await appendEvent(db, newId, now, {
          type: 'ai.session.completed',
          entityId: session.id,
          projectId: session.projectId,
          data: { scope: session.scope },
          source: 'ai-client',
        });
        return session;
      });
    },
    watchForProject(projectId) {
      return watchQuery(async () =>
        (await db.aiSessions.where('projectId').equals(projectId).toArray()).sort((a, b) =>
          b.startedAt.localeCompare(a.startedAt),
        ),
      );
    },
  };
}

/** Local day of an instant, as the owner saw it. */
const dayOf = (at: string) => toLocalDate(new Date(at));

export function createDexieActivityRepository(deps: RepositoryDeps): ActivityRepository {
  const { db } = resolveDeps(deps);
  return {
    watchSources(start, end) {
      const inRange = (at: string | undefined) => {
        if (at === undefined) return false;
        const day = dayOf(at);
        return day >= start && day <= end;
      };
      return watchQuery(async () => {
        // Sessions are indexed by their start day; a window that started the
        // evening before `start` can still end inside the range, so read a day early.
        const before = addDays(start, -1);
        const [habits, habitEntries, workSessions, offTime, tasks, milestones, decisions, items] =
          await Promise.all([
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
              .filter(
                (i) => (i.kind === 'blocker' || i.kind === 'approval') && inRange(i.resolvedAt),
              )
              .toArray(),
          ]);
        return {
          habits,
          habitEntries,
          workSessions,
          offTimeSessions: offTime.filter((o) =>
            o.kind === 'day_off'
              ? o.localDate >= start && o.localDate <= end
              : inRange(o.endedAt ?? o.startedAt),
          ),
          completedTasks: tasks,
          milestones,
          decisions: decisions.filter((d) => inRange(d.decidedAt)),
          resolvedItems: items,
        };
      });
    },
  };
}
