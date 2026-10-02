import {
  EVENT_ENTITY,
  DERIVED_COLUMN_TYPES,
  type SpaceColumnType,
  type CollegeItem,
  type AiSession,
  type Hackathon,
  type HabitUnit,
  type LedgerEvent,
  type OffTimeSession,
  type ProjectItem,
  type ProjectItemKind,
  type ProjectLane,
  type ProjectState,
  type SpaceNode,
  type WorkSession,
} from '../types/domain';
import { InvalidInputError } from './repositories/errors';

/*
 * Domain invariants beyond record shape. Shared by the repositories (every
 * write) and backup import (every restored record), so a backup can never
 * bring in data the app itself would refuse to write.
 */

/** Longest loggable day, in minutes. Anything above is a typo, not a day. */
export const MAX_MINUTES = 24 * 60;

/** Habit targets: optional, only for count/minutes, positive (ADR-023). */
export function checkHabitTarget(unit: HabitUnit, target: number | undefined) {
  if (target === undefined) return;
  if (unit === 'check') throw new InvalidInputError('A done-or-not habit has no target');
  if (!Number.isFinite(target) || target <= 0) {
    throw new InvalidInputError('A target must be a positive number');
  }
  if (unit === 'count' && !Number.isInteger(target)) {
    throw new InvalidInputError('A count target must be a whole number');
  }
  if (unit === 'minutes' && target > MAX_MINUTES) {
    throw new InvalidInputError(`A minutes target can't exceed ${MAX_MINUTES}`);
  }
}

/** Unit rules for a recorded entry (ADR-023). Zero is not an entry: clear instead. */
export function checkEntryValue(unit: HabitUnit, value: number) {
  const ok =
    unit === 'check'
      ? value === 1
      : unit === 'count'
        ? Number.isInteger(value) && value > 0
        : Number.isFinite(value) && value > 0 && value <= MAX_MINUTES;
  if (!ok) throw new InvalidInputError(`Not a valid ${unit} value: ${value}`);
}

/** Hackathon date range (ADR-027): an end needs a start and can't precede it. */
export function checkHackathonDates(h: Pick<Hackathon, 'eventStart' | 'eventEnd'>) {
  if (h.eventEnd === undefined) return;
  if (h.eventStart === undefined) throw new InvalidInputError('An end date needs a start date');
  if (h.eventEnd < h.eventStart)
    throw new InvalidInputError('The event can’t end before it starts');
}

/* ---------------------------- Schema V4 rules ---------------------------- */

const LANE_BY_KIND: Record<ProjectItemKind, ProjectLane> = {
  focus: 'working_now',
  step: 'next',
  dependency: 'waiting',
  approval: 'needs_approval',
  blocker: 'blocked',
  idea: 'parked',
  note: 'next',
};

/** Where a new (or reopened) item of this kind starts. */
export function defaultLane(kind: ProjectItemKind): ProjectLane {
  return LANE_BY_KIND[kind];
}

/**
 * Project item lanes (ADR-046): `resolvedAt` exactly when in `done`; an open
 * approval sits in `needs_approval` and an open blocker in `blocked`;
 * `waitingOn` only in `waiting`.
 */
export function checkProjectItem(item: ProjectItem) {
  if ((item.lane === 'done') !== (item.resolvedAt !== undefined)) {
    throw new InvalidInputError('An item is resolved exactly when it is in Done');
  }
  if (item.lane !== 'done') {
    if (item.kind === 'approval' && item.lane !== 'needs_approval') {
      throw new InvalidInputError('An open approval stays in Needs approval');
    }
    if (item.kind === 'blocker' && item.lane !== 'blocked') {
      throw new InvalidInputError('An open blocker stays in Blocked');
    }
  }
  if (item.waitingOn !== undefined && item.lane !== 'waiting') {
    throw new InvalidInputError('Only a waiting item says what it waits on');
  }
}

/** `archived` can only be left for `parked` (unarchive). */
export function checkProjectTransition(from: ProjectState, to: ProjectState) {
  if (from === 'archived' && to !== 'parked' && to !== 'archived') {
    throw new InvalidInputError('An archived project can only be unarchived to Parked');
  }
}

/** Work sessions (ADR-046 §7). */
export function checkWorkSession(session: WorkSession) {
  if (session.kind === 'project' && !session.projectId) {
    throw new InvalidInputError('Project work needs a project');
  }
  if (session.kind === 'task' && !session.taskId) {
    throw new InvalidInputError('Task work needs a task');
  }
  if (session.endedAt !== undefined && session.endedAt < session.startedAt) {
    throw new InvalidInputError('A session can’t end before it starts');
  }
  let previous = session.startedAt;
  session.pauses.forEach((pause, i) => {
    const last = i === session.pauses.length - 1;
    if (pause.at < previous) throw new InvalidInputError('Pauses must be in order');
    if (pause.resumedAt === undefined) {
      if (!last) throw new InvalidInputError('Only the last pause can be open');
      if (session.endedAt !== undefined) {
        throw new InvalidInputError('A finished session has no open pause');
      }
      previous = pause.at;
      return;
    }
    if (pause.resumedAt < pause.at)
      throw new InvalidInputError('A pause can’t end before it starts');
    previous = pause.resumedAt;
  });
  if (session.endedAt !== undefined && session.endedAt < previous) {
    throw new InvalidInputError('Pauses must fall within the session');
  }
}

/** Off-time (ADR-046 §8): sleep/rest are started windows; a day off is a whole date. */
export function checkOffTime(session: OffTimeSession) {
  if (session.kind === 'day_off') {
    if (session.startedAt !== undefined || session.endedAt !== undefined) {
      throw new InvalidInputError('A day off has no start or end time');
    }
    return;
  }
  if (session.startedAt === undefined) throw new InvalidInputError('Off time needs a start');
  if (session.endedAt !== undefined && session.endedAt < session.startedAt) {
    throw new InvalidInputError('Off time can’t end before it starts');
  }
}

export function checkLedgerEvent(event: LedgerEvent) {
  if (EVENT_ENTITY[event.type] !== event.entityType) {
    throw new InvalidInputError(`${event.type} can’t be about a ${event.entityType}`);
  }
}

export function checkAiSession(session: AiSession) {
  if (session.scope === 'project' && !session.projectId) {
    throw new InvalidInputError('A project-scoped AI session needs a project');
  }
  if (session.endedAt < session.startedAt) {
    throw new InvalidInputError('An AI session can’t end before it starts');
  }
}

/** College items (ADR-051): attended/missed are for classes and labs; done for the rest. */
export function checkCollegeItem(item: Pick<CollegeItem, 'kind' | 'status'>) {
  const attendable = item.kind === 'class' || item.kind === 'lab';
  if (attendable && item.status === 'done') {
    throw new InvalidInputError('A class or lab is attended or missed, not done');
  }
  if (!attendable && (item.status === 'attended' || item.status === 'missed')) {
    throw new InvalidInputError(`An ${item.kind} is done, not attended or missed`);
  }
}

/**
 * A SPACE node's own shape (ADR-062): a table carries its table and nothing
 * else does; column and row ids are unique; cells name real columns and fit
 * the column's type.
 */
export function checkSpaceNode(node: Pick<SpaceNode, 'kind' | 'table' | 'id' | 'parentId'>) {
  if (node.parentId === node.id) throw new InvalidInputError('A page can’t be its own parent');
  if (node.kind === 'table' && !node.table) throw new InvalidInputError('A table needs columns');
  if (node.kind !== 'table' && node.table) {
    throw new InvalidInputError('Only a table page holds table data');
  }
  if (!node.table) return;
  const types = new Map<string, string>();
  for (const column of node.table.columns) {
    if (types.has(column.id)) throw new InvalidInputError(`Column ${column.id} appears twice`);
    types.set(column.id, column.type);
  }
  for (const column of node.table.columns) {
    if (column.type === 'rollup') {
      const relation = node.table.columns.find((c) => c.id === column.rollup?.relation);
      if (!relation || relation.type !== 'link') {
        throw new InvalidInputError(`Rollup “${column.name}” needs a relation property`);
      }
    }
  }
  const views = new Set<string>();
  for (const view of node.table.views ?? []) {
    if (views.has(view.id)) throw new InvalidInputError(`View ${view.id} appears twice`);
    views.add(view.id);
  }
  const rows = new Set<string>();
  for (const row of node.table.rows) {
    if (rows.has(row.id)) throw new InvalidInputError(`Row ${row.id} appears twice`);
    rows.add(row.id);
    for (const [columnId, value] of Object.entries(row.cells)) {
      const type = types.get(columnId);
      if (!type) throw new InvalidInputError(`Row ${row.id} has a cell for no column`);
      if (DERIVED_COLUMN_TYPES.includes(type as SpaceColumnType)) {
        throw new InvalidInputError(`Row ${row.id}: ${type} is computed, never typed in`);
      }
      const ok =
        type === 'number'
          ? typeof value === 'number' && Number.isFinite(value)
          : type === 'boolean'
            ? typeof value === 'boolean'
            : type === 'multiSelect'
              ? Array.isArray(value) && value.every((v) => typeof v === 'string')
              : type === 'link'
                ? Array.isArray(value) && value.every((v) => typeof v === 'object')
                : typeof value === 'string';
      if (!ok)
        throw new InvalidInputError(`Row ${row.id}: a ${type} cell holds the wrong kind of value`);
    }
  }
}

/**
 * The SPACE hierarchy as a whole: every parent exists and no node is its own
 * ancestor. Returns problems instead of throwing, for backup inspection.
 */
export function spaceTreeProblems(nodes: readonly Pick<SpaceNode, 'id' | 'parentId'>[]): string[] {
  const parent = new Map(nodes.map((n) => [n.id, n.parentId]));
  const problems: string[] = [];
  for (const node of nodes) {
    if (node.parentId !== undefined && !parent.has(node.parentId)) {
      problems.push(`space node ${node.id}: parent ${node.parentId} is missing`);
      continue;
    }
    const seen = new Set<string>([node.id]);
    let at = node.parentId;
    while (at !== undefined) {
      if (seen.has(at)) {
        problems.push(`space node ${node.id}: its parents form a loop`);
        break;
      }
      seen.add(at);
      at = parent.get(at);
    }
  }
  return problems;
}
