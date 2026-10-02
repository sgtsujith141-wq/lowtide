import { toTimestamp } from '../../lib/time';
import type {
  Decision,
  Id,
  Milestone,
  Project,
  ProjectItem,
  ProjectLane,
  ProjectState,
} from '../../types/domain';
import { checkProjectItem, checkProjectTransition, defaultLane } from '../rules';
import { decisionSchema, milestoneSchema, projectItemSchema, projectSchema } from '../schema';
import { InvalidInputError, RecordNotFoundError, RecordStateError } from './errors';
import { deleteEventsFor, eventWriter, refreshSnapshot } from './ledger';
import { omitUndefined, resolveDeps, type RepositoryDeps } from './shared';
import type { ProjectRepository } from './types';

function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** "LOWTIDE v2 — Home!" → "lowtide-v2-home". Never empty. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
    .replace(/-+$/g, '');
  return slug || 'project';
}

export function createDexieProjectRepository(deps: RepositoryDeps): ProjectRepository {
  const resolved = resolveDeps(deps);
  const { db, clock, newId, watch, source, actor } = resolved;
  const emit = eventWriter(resolved);
  const all = [
    db.projects,
    db.milestones,
    db.projectItems,
    db.decisions,
    db.events,
    db.progressSnapshots,
    db.tasks,
  ];

  async function getProject(id: Id): Promise<Project> {
    const project = await db.projects.get(id);
    if (!project) throw new RecordNotFoundError('Project', id);
    return project;
  }
  async function getMilestone(id: Id): Promise<Milestone> {
    const milestone = await db.milestones.get(id);
    if (!milestone) throw new RecordNotFoundError('Milestone', id);
    return milestone;
  }
  async function getItem(id: Id): Promise<ProjectItem> {
    const item = await db.projectItems.get(id);
    if (!item) throw new RecordNotFoundError('Project item', id);
    return item;
  }

  /** Bumps `updatedAt` (the project's "last moved") and today's snapshot. */
  async function touch(projectId: Id, now: Date) {
    const project = await getProject(projectId);
    await db.projects.put({ ...project, updatedAt: toTimestamp(now) });
    await refreshSnapshot(db, newId, now, projectId);
  }

  async function uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    let slug = base;
    for (let n = 2; await db.projects.where('slug').equals(slug).count(); n += 1) {
      slug = `${base}-${n}`;
    }
    return slug;
  }

  async function saveItem(item: Record<string, unknown>): Promise<ProjectItem> {
    const parsed = projectItemSchema.parse(omitUndefined(item));
    checkProjectItem(parsed);
    await db.projectItems.put(parsed);
    return parsed;
  }

  async function checkItemLinks(projectId: Id, taskId?: Id, milestoneId?: Id) {
    if (taskId !== undefined) {
      const task = await db.tasks.get(taskId);
      if (!task) throw new RecordNotFoundError('Task', taskId);
      if (task.projectId !== projectId) {
        throw new InvalidInputError('That task belongs to another project');
      }
    }
    if (milestoneId !== undefined) {
      const milestone = await getMilestone(milestoneId);
      if (milestone.projectId !== projectId) {
        throw new InvalidInputError('That milestone belongs to another project');
      }
    }
  }

  return {
    create(input) {
      return db.transaction('rw', all, async () => {
        const now = clock();
        const at = toTimestamp(now);
        const project = projectSchema.parse(
          omitUndefined({
            id: newId(),
            name: input.name.trim(),
            slug: await uniqueSlug(input.name),
            kind: input.kind ?? 'software',
            state: input.state ?? 'planning',
            objective: optionalText(input.objective),
            phase: optionalText(input.phase),
            nextAction: optionalText(input.nextAction),
            repoUrl: optionalText(input.repoUrl),
            createdAt: at,
            updatedAt: at,
            stateChangedAt: at,
          }),
        );
        await db.projects.add(project);
        await emit(now, {
          type: 'project.updated',
          entityId: project.id,
          projectId: project.id,
          data: { change: 'created', to: project.state },
        });
        await refreshSnapshot(db, newId, now, project.id);
        return project;
      });
    },

    createFromHackathon(hackathonId) {
      return db.transaction('rw', [...all, db.hackathons], async () => {
        const hackathon = await db.hackathons.get(hackathonId);
        if (!hackathon) throw new RecordNotFoundError('Hackathon', hackathonId);
        if (hackathon.projectId) throw new RecordStateError('Already tracked as a project');
        const now = clock();
        const at = toTimestamp(now);
        const project = projectSchema.parse(
          omitUndefined({
            id: newId(),
            name: hackathon.name,
            slug: await uniqueSlug(hackathon.name),
            kind: 'software',
            state: 'active',
            objective: optionalText(hackathon.problemStatement),
            nextAction: optionalText(hackathon.nextAction),
            createdAt: at,
            updatedAt: at,
            stateChangedAt: at,
          }),
        );
        await db.projects.add(project);
        await db.hackathons.put({ ...hackathon, projectId: project.id, updatedAt: at });
        await emit(now, {
          type: 'project.updated',
          entityId: project.id,
          projectId: project.id,
          data: { change: 'created', to: project.state, hackathonId },
        });
        await refreshSnapshot(db, newId, now, project.id);
        return project;
      });
    },

    update(id, changes) {
      return db.transaction('rw', all, async () => {
        const now = clock();
        const next: Record<string, unknown> = { ...(await getProject(id)) };
        if (changes.name !== undefined) next.name = changes.name.trim();
        if (changes.kind !== undefined) next.kind = changes.kind;
        for (const key of ['objective', 'phase', 'nextAction', 'repoUrl'] as const) {
          if (changes[key] !== undefined) next[key] = optionalText(changes[key]);
        }
        next.updatedAt = toTimestamp(now);
        const project = projectSchema.parse(omitUndefined(next));
        await db.projects.put(project);
        await emit(now, {
          type: 'project.updated',
          entityId: id,
          projectId: id,
          data: { change: 'details' },
        });
        return project;
      });
    },

    setFocus(id, focus) {
      return db.transaction('rw', all, async () => {
        const existing = await getProject(id);
        const project = projectSchema.parse(
          omitUndefined({ ...existing, focus: focus ?? undefined }),
        );
        await db.projects.put(project);
        return project;
      });
    },

    setState(id, state: ProjectState, options) {
      return db.transaction('rw', all, async () => {
        const now = clock();
        const existing = await getProject(id);
        if (existing.state === state) return existing;
        checkProjectTransition(existing.state, state);
        if (state === 'done') {
          const open = await db.milestones
            .where('projectId')
            .equals(id)
            .filter((m) => m.completedAt === undefined)
            .count();
          if (open > 0) {
            const override = options?.overrideDecisionId
              ? await db.decisions.get(options.overrideDecisionId)
              : undefined;
            if (!override || override.projectId !== id) {
              throw new RecordStateError(
                `${open} milestone${open === 1 ? ' is' : 's are'} still open; record a decision to finish anyway`,
              );
            }
          }
        }
        const at = toTimestamp(now);
        const project = projectSchema.parse({
          ...existing,
          state,
          stateChangedAt: at,
          updatedAt: at,
        });
        await db.projects.put(project);
        await emit(now, {
          type: 'project.updated',
          entityId: id,
          projectId: id,
          data: {
            change: 'state',
            from: existing.state,
            to: state,
            ...(options?.overrideDecisionId
              ? { overrideDecisionId: options.overrideDecisionId }
              : {}),
          },
        });
        await refreshSnapshot(db, newId, now, id);
        return project;
      });
    },

    get: (id) => db.projects.get(id),

    watchAll: watch(async () =>
      (await db.projects.toArray()).sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      ),
    ),

    watchBySlug(slug) {
      return watch(() => db.projects.where('slug').equals(slug).first());
    },

    /* Milestones */

    addMilestone(projectId, input) {
      return db.transaction('rw', all, async () => {
        const now = clock();
        await getProject(projectId);
        const siblings = await db.milestones.where('projectId').equals(projectId).toArray();
        const at = toTimestamp(now);
        const milestone = milestoneSchema.parse(
          omitUndefined({
            id: newId(),
            projectId,
            title: input.title.trim(),
            notes: optionalText(input.notes),
            order: siblings.reduce((max, m) => Math.max(max, m.order + 1), 0),
            weight: input.weight ?? 1,
            dueOn: input.dueOn || undefined,
            createdAt: at,
            updatedAt: at,
          }),
        );
        await db.milestones.add(milestone);
        await touch(projectId, now);
        return milestone;
      });
    },

    updateMilestone(id, changes) {
      return db.transaction('rw', all, async () => {
        const now = clock();
        const next: Record<string, unknown> = { ...(await getMilestone(id)) };
        if (changes.title !== undefined) next.title = changes.title.trim();
        if (changes.weight !== undefined) next.weight = changes.weight;
        if (changes.notes !== undefined) next.notes = optionalText(changes.notes);
        if (changes.dueOn !== undefined) next.dueOn = changes.dueOn || undefined;
        next.updatedAt = toTimestamp(now);
        const milestone = milestoneSchema.parse(omitUndefined(next));
        await db.milestones.put(milestone);
        await touch(milestone.projectId, now);
        return milestone;
      });
    },

    completeMilestone(id) {
      return db.transaction('rw', all, async () => {
        const now = clock();
        const existing = await getMilestone(id);
        if (existing.completedAt) return existing;
        const at = toTimestamp(now);
        const milestone = milestoneSchema.parse({ ...existing, completedAt: at, updatedAt: at });
        await db.milestones.put(milestone);
        await emit(now, {
          type: 'milestone.completed',
          entityId: id,
          projectId: milestone.projectId,
        });
        await touch(milestone.projectId, now);
        return milestone;
      });
    },

    reopenMilestone(id) {
      return db.transaction('rw', all, async () => {
        const now = clock();
        const existing = await getMilestone(id);
        const milestone = milestoneSchema.parse(
          omitUndefined({ ...existing, completedAt: undefined, updatedAt: toTimestamp(now) }),
        );
        await db.milestones.put(milestone);
        await touch(milestone.projectId, now);
        return milestone;
      });
    },

    moveMilestone(id, direction) {
      return db.transaction('rw', all, async () => {
        const milestone = await getMilestone(id);
        const ordered = (
          await db.milestones.where('projectId').equals(milestone.projectId).toArray()
        ).sort((a, b) => a.order - b.order);
        const index = ordered.findIndex((m) => m.id === id);
        const neighbour = ordered[index + direction];
        if (!neighbour) return;
        const at = toTimestamp(clock());
        await db.milestones.put({ ...milestone, order: neighbour.order, updatedAt: at });
        await db.milestones.put({ ...neighbour, order: milestone.order, updatedAt: at });
      });
    },

    removeMilestone(id) {
      return db.transaction('rw', all, async () => {
        const now = clock();
        const milestone = await getMilestone(id);
        const usedByTask = await db.tasks.filter((t) => t.milestoneId === id).count();
        const usedByItem = await db.projectItems.filter((i) => i.milestoneId === id).count();
        if (usedByTask + usedByItem > 0) {
          throw new RecordStateError('Tasks or items still refer to this milestone');
        }
        await db.milestones.delete(id);
        await deleteEventsFor(db, 'milestone', id);
        await touch(milestone.projectId, now);
      });
    },

    watchMilestones(projectId) {
      return watch(async () =>
        (await db.milestones.where('projectId').equals(projectId).toArray()).sort(
          (a, b) => a.order - b.order,
        ),
      );
    },

    watchAllMilestones: watch(async () =>
      (await db.milestones.toArray()).sort(
        (a, b) => a.projectId.localeCompare(b.projectId) || a.order - b.order,
      ),
    ),

    /* Command items */

    addItem(projectId, input) {
      return db.transaction('rw', all, async () => {
        const now = clock();
        await getProject(projectId);
        await checkItemLinks(projectId, input.taskId, input.milestoneId);
        const lane: ProjectLane = input.lane ?? defaultLane(input.kind);
        const inLane = await db.projectItems
          .where('[projectId+lane]')
          .equals([projectId, lane])
          .toArray();
        const at = toTimestamp(now);
        const item = await saveItem({
          id: newId(),
          projectId,
          kind: input.kind,
          lane,
          title: input.title.trim(),
          body: optionalText(input.body),
          waitingOn: lane === 'waiting' ? optionalText(input.waitingOn) : undefined,
          taskId: input.taskId,
          milestoneId: input.milestoneId,
          order: inLane.reduce((max, i) => Math.max(max, i.order + 1), 0),
          createdAt: at,
          updatedAt: at,
          laneChangedAt: at,
        });
        await laneEvent(item, now);
        await touch(projectId, now);
        return item;
      });
    },

    updateItem(id, changes) {
      return db.transaction('rw', all, async () => {
        const now = clock();
        const next: Record<string, unknown> = { ...(await getItem(id)) };
        if (changes.title !== undefined) next.title = changes.title.trim();
        if (changes.body !== undefined) next.body = optionalText(changes.body);
        if (changes.waitingOn !== undefined) next.waitingOn = optionalText(changes.waitingOn);
        next.updatedAt = toTimestamp(now);
        const item = await saveItem(next);
        await touch(item.projectId, now);
        return item;
      });
    },

    moveItem(id, lane, waitingOn) {
      return db.transaction('rw', all, async () => {
        const now = clock();
        const existing = await getItem(id);
        if (existing.lane === 'done') throw new RecordStateError('Reopen the item first');
        if (existing.lane === lane) return existing;
        const at = toTimestamp(now);
        const item = await saveItem({
          ...existing,
          lane,
          waitingOn: lane === 'waiting' ? optionalText(waitingOn ?? existing.waitingOn) : undefined,
          updatedAt: at,
          laneChangedAt: at,
        });
        await laneEvent(item, now, existing.lane);
        await touch(item.projectId, now);
        return item;
      });
    },

    resolveItem(id) {
      return db.transaction('rw', all, async () => {
        const now = clock();
        const existing = await getItem(id);
        if (existing.lane === 'done') return existing;
        const at = toTimestamp(now);
        const item = await saveItem({
          ...existing,
          lane: 'done',
          waitingOn: undefined,
          resolvedAt: at,
          updatedAt: at,
          laneChangedAt: at,
        });
        await touch(item.projectId, now);
        return item;
      });
    },

    reopenItem(id) {
      return db.transaction('rw', all, async () => {
        const now = clock();
        const existing = await getItem(id);
        if (existing.lane !== 'done') return existing;
        const at = toTimestamp(now);
        const item = await saveItem({
          ...existing,
          lane: defaultLane(existing.kind),
          resolvedAt: undefined,
          updatedAt: at,
          laneChangedAt: at,
        });
        await laneEvent(item, now, 'done');
        await touch(item.projectId, now);
        return item;
      });
    },

    removeItem(id) {
      return db.transaction('rw', all, async () => {
        const now = clock();
        const item = await getItem(id);
        await db.projectItems.delete(id);
        await deleteEventsFor(db, 'projectItem', id);
        await touch(item.projectId, now);
      });
    },

    watchItems(projectId) {
      return watch(async () =>
        (await db.projectItems.where('projectId').equals(projectId).toArray()).sort(
          (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
        ),
      );
    },

    watchAllItems: watch(() => db.projectItems.toArray()),

    /* Decisions */

    recordDecision(projectId, input) {
      return db.transaction('rw', all, async () => {
        const now = clock();
        await getProject(projectId);
        if (input.supersedesId !== undefined) {
          const earlier = await db.decisions.get(input.supersedesId);
          if (!earlier || earlier.projectId !== projectId) {
            throw new InvalidInputError('It can only supersede a decision of this project');
          }
        }
        const at = toTimestamp(now);
        const decision: Decision = decisionSchema.parse(
          omitUndefined({
            id: newId(),
            projectId,
            title: input.title.trim(),
            decision: input.decision.trim(),
            context: optionalText(input.context),
            consequences: optionalText(input.consequences),
            decidedAt: at,
            supersedesId: input.supersedesId,
            origin: source === 'ai-client' ? 'ai-client' : 'owner',
            client: source === 'ai-client' ? actor : undefined,
            createdAt: at,
          }),
        );
        await db.decisions.add(decision);
        await emit(now, {
          type: 'decision.recorded',
          entityId: decision.id,
          projectId,
          data: decision.supersedesId ? { supersedesId: decision.supersedesId } : {},
        });
        await touch(projectId, now);
        return decision;
      });
    },

    watchDecisions(projectId) {
      return watch(async () =>
        (await db.decisions.where('projectId').equals(projectId).toArray()).sort((a, b) =>
          b.decidedAt.localeCompare(a.decidedAt),
        ),
      );
    },

    watchSnapshots(projectId) {
      return watch(async () =>
        (await db.progressSnapshots.where('projectId').equals(projectId).toArray()).sort((a, b) =>
          a.localDate.localeCompare(b.localDate),
        ),
      );
    },

    watchTasks(projectId) {
      return watch(async () =>
        (await db.tasks.where('projectId').equals(projectId).toArray()).sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        ),
      );
    },
  };

  /** `project.approval_requested` / `project.item_parked` when an item enters those lanes. */
  async function laneEvent(item: ProjectItem, now: Date, fromLane?: ProjectLane) {
    if (item.lane === 'needs_approval') {
      await emit(now, {
        type: 'project.approval_requested',
        entityId: item.id,
        projectId: item.projectId,
      });
    } else if (item.lane === 'parked') {
      await emit(now, {
        type: 'project.item_parked',
        entityId: item.id,
        projectId: item.projectId,
        data: fromLane ? { fromLane } : {},
      });
    }
  }
}
