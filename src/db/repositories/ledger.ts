import { toLocalDate, toTimestamp } from '../../lib/time';
import {
  EVENT_ENTITY,
  PROJECT_LANES,
  type EntityType,
  type EventSource,
  type EventType,
  type Id,
  type LedgerEvent,
  type ProjectLane,
} from '../../types/domain';
import type { StoreDb } from '../store';
import { checkLedgerEvent } from '../rules';
import { ledgerEventSchema, progressSnapshotSchema } from '../schema';
import type { ResolvedDeps } from './shared';

/*
 * Ledger and snapshot writes. Called only by repositories, inside the same
 * transaction as the record change they describe (ADR-046), so a record can't
 * change without its event and vice versa. Callers must include
 * `db.events` / `db.progressSnapshots` (and what a snapshot reads) in the
 * transaction's tables.
 */

export interface EventInput {
  type: EventType;
  entityId: Id;
  projectId?: Id | undefined;
  data?: Record<string, string>;
  source?: EventSource;
  actor?: string | undefined;
}

export async function appendEvent(
  db: StoreDb,
  newId: () => Id,
  at: Date,
  input: EventInput,
): Promise<LedgerEvent> {
  const event = ledgerEventSchema.parse({
    id: newId(),
    type: input.type,
    at: toTimestamp(at),
    localDate: toLocalDate(at),
    entityType: EVENT_ENTITY[input.type],
    entityId: input.entityId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    data: input.data ?? {},
    source: input.source ?? 'app',
    ...(input.actor ? { actor: input.actor } : {}),
  });
  checkLedgerEvent(event);
  await db.events.add(event);
  return event;
}

/**
 * An event writer bound to who is acting (ADR-056): events from an AI client
 * carry `source: 'ai-client'` and the client's name.
 */
export function eventWriter(deps: ResolvedDeps) {
  return (at: Date, input: EventInput) =>
    appendEvent(deps.db, deps.newId, at, {
      ...input,
      source: input.source ?? deps.source,
      actor: input.actor ?? deps.actor,
    });
}

/** Cascade when the owner deletes the entity itself (the only event removal). */
export function deleteEventsFor(db: StoreDb, entityType: EntityType, entityId: Id) {
  return db.events.where('[entityType+entityId]').equals([entityType, entityId]).delete();
}

/**
 * Upserts the project's snapshot for the local day of `at` from its current
 * milestones, items and state. Past days are never touched, so history keeps
 * the values it had (ADR-038).
 */
export async function refreshSnapshot(
  db: StoreDb,
  newId: () => Id,
  at: Date,
  projectId: Id,
): Promise<void> {
  const project = await db.projects.get(projectId);
  if (!project) return;
  const [milestones, items] = await Promise.all([
    db.milestones.where('projectId').equals(projectId).toArray(),
    db.projectItems.where('projectId').equals(projectId).toArray(),
  ]);
  const laneCounts = Object.fromEntries(PROJECT_LANES.map((lane) => [lane, 0])) as Record<
    ProjectLane,
    number
  >;
  for (const item of items) laneCounts[item.lane] += 1;
  const done = milestones.filter((m) => m.completedAt !== undefined);
  const localDate = toLocalDate(at);
  const existing = await db.progressSnapshots
    .where('[projectId+localDate]')
    .equals([projectId, localDate])
    .first();
  const snapshot = progressSnapshotSchema.parse({
    id: existing?.id ?? newId(),
    projectId,
    localDate,
    completedWeight: done.reduce((sum, m) => sum + m.weight, 0),
    totalWeight: milestones.reduce((sum, m) => sum + m.weight, 0),
    milestoneCount: milestones.length,
    completedCount: done.length,
    state: project.state,
    laneCounts,
    updatedAt: toTimestamp(at),
  });
  await db.progressSnapshots.put(snapshot);
}
