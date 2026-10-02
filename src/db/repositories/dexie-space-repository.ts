import { blocksOf } from '../../lib/space-blocks';
import { toTimestamp } from '../../lib/time';
import {
  SPACE_EDIT_LIMIT,
  SPACE_ROOTS,
  type EntityLink,
  type EventSource,
  type Id,
  type SpaceBlock,
  type SpaceEdit,
  type SpaceEditKind,
  type SpaceNode,
} from '../../types/domain';
import { SLOT_TITLES } from '../import/notion/types';
import { checkSpaceNode } from '../rules';
import { spaceNodeSchema } from '../schema';
import type { StoreDb } from '../store';
import {
  InvalidInputError,
  RecordNotFoundError,
  RecordStateError,
  SpaceConflictError,
} from './errors';
import { omitUndefined, resolveDeps, type RepositoryDeps } from './shared';
import { PROJECT_SPACE_SLOTS, type NewSpaceBlock, type SpaceRepository } from './types';

const byOrder = (a: SpaceNode, b: SpaceNode) =>
  a.order - b.order || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

/** Children of `parentId` (undefined: top level). */
export async function spaceChildren(db: StoreDb, parentId: Id | undefined): Promise<SpaceNode[]> {
  const nodes =
    parentId === undefined
      ? await db.spaceNodes.filter((n) => n.parentId === undefined).toArray()
      : await db.spaceNodes.where('parentId').equals(parentId).toArray();
  return nodes.sort(byOrder);
}

/** The next free position under a parent. */
export async function nextSpaceOrder(db: StoreDb, parentId: Id | undefined): Promise<number> {
  const siblings = await spaceChildren(db, parentId);
  return siblings.reduce((max, n) => Math.max(max, n.order + 1), 0);
}

/** Validates a node (shape and SPACE rules) before it is written. */
export function parseSpaceNode(record: Record<string, unknown>): SpaceNode {
  const node = spaceNodeSchema.parse(omitUndefined(record));
  checkSpaceNode(node);
  return node;
}

/** Edits by one author within this window are one history entry. */
export const SPACE_EDIT_BATCH_MS = 15 * 60_000;

/**
 * A page's history with one more change: the same author continuing the same
 * kind of edit within the batch window extends the last entry instead of
 * adding one, so typing never floods the history.
 */
export function withEdit(
  edits: readonly SpaceEdit[] | undefined,
  kind: SpaceEditKind,
  at: string,
  by: EventSource,
  client: string | undefined,
): SpaceEdit[] {
  const list = edits ?? [];
  const last = list.at(-1);
  if (
    last &&
    last.kind === kind &&
    last.by === by &&
    last.client === client &&
    (kind === 'edited' || kind === 'table') &&
    Date.parse(at) - Date.parse(last.at) < SPACE_EDIT_BATCH_MS
  ) {
    return [...list.slice(0, -1), { ...last, at, count: last.count + 1 }];
  }
  const entry: SpaceEdit = { kind, by, startedAt: at, at, count: 1 };
  if (client) entry.client = client;
  return [...list, entry].slice(-SPACE_EDIT_LIMIT);
}

const sameLink = (a: EntityLink, b: EntityLink) =>
  a.type === b.type && a.id === b.id && (a.rowId ?? '') === (b.rowId ?? '');

/**
 * SPACE (ADR-062). No ledger events and no snapshots: knowledge is not
 * activity, so creating, importing or editing a page never lights a square.
 */
export function createDexieSpaceRepository(deps: RepositoryDeps): SpaceRepository {
  const { db, clock, newId, watch, source, actor } = resolveDeps(deps);
  const tables = [db.spaceNodes];
  const client = source === 'ai-client' ? (actor ?? 'AI client') : undefined;

  /** Gives blocks ids and, for an AI client, its name and the time. */
  function stamp(blocks: readonly NewSpaceBlock[], at: string): SpaceBlock[] {
    return blocks.map((b) => {
      const block = { ...b, id: b.id ?? newId() } as SpaceBlock;
      if (client) block.by = { client, at };
      return block;
    });
  }

  /** A content change: revision up, history extended, updated now. */
  function changed(node: SpaceNode, kind: SpaceEditKind, at: string): Record<string, unknown> {
    return {
      ...node,
      revision: (node.revision ?? 0) + 1,
      edits: withEdit(node.edits, kind, at, source, client),
      updatedAt: at,
    };
  }

  function checkBlocks(blocks: readonly SpaceBlock[]) {
    const ids = new Set<string>();
    for (const b of blocks) {
      if (ids.has(b.id)) throw new InvalidInputError(`Block ${b.id} appears twice`);
      ids.add(b.id);
    }
  }

  async function getNode(id: Id): Promise<SpaceNode> {
    const node = await db.spaceNodes.get(id);
    if (!node) throw new RecordNotFoundError('Space node', id);
    return node;
  }

  async function checkParent(id: Id | undefined, parentId: Id | undefined) {
    if (parentId === undefined) return;
    await getNode(parentId);
    for (let at: Id | undefined = parentId; at !== undefined;) {
      if (at === id) throw new InvalidInputError('A page can’t move inside itself');
      at = (await db.spaceNodes.get(at))?.parentId;
    }
  }

  async function put(record: Record<string, unknown>): Promise<SpaceNode> {
    const node = parseSpaceNode(record);
    await db.spaceNodes.put(node);
    return node;
  }

  return {
    get: (id) => db.spaceNodes.get(id),

    getByKey: (key) => db.spaceNodes.where('key').equals(key).first(),

    create(input) {
      return db.transaction('rw', tables, async () => {
        await checkParent(undefined, input.parentId);
        const at = toTimestamp(clock());
        const kind = input.kind ?? (input.table ? 'table' : 'page');
        const node = parseSpaceNode({
          id: newId(),
          parentId: input.parentId,
          kind,
          title: input.title.trim(),
          icon: input.icon,
          body: input.body,
          bodyFormat: input.body !== undefined ? (input.bodyFormat ?? 'markdown') : undefined,
          order: await nextSpaceOrder(db, input.parentId),
          archived: false,
          links: input.links ?? [],
          externalLinks: [],
          attachments: [],
          table: input.table,
          ...(input.blocks ? { blocks: stamp(input.blocks, at) } : {}),
          revision: 0,
          edits: withEdit(undefined, 'created', at, source, client),
          createdAt: at,
          updatedAt: at,
        });
        if (node.blocks) checkBlocks(node.blocks);
        await db.spaceNodes.add(node);
        return node;
      });
    },

    update(id, changes) {
      return db.transaction('rw', tables, async () => {
        const existing = await getNode(id);
        const at = toTimestamp(clock());
        const renamed =
          changes.title !== undefined &&
          changes.title.trim() !== existing.title &&
          Object.keys(changes).length === 1;
        const next = changed(existing, renamed ? 'renamed' : 'edited', at);
        if (changes.title !== undefined) next.title = changes.title.trim();
        if (changes.links !== undefined) next.links = changes.links;
        if (changes.table !== undefined) next.table = changes.table;
        for (const key of ['icon', 'body'] as const) {
          const value = changes[key];
          if (value === undefined) continue;
          next[key] = value === null ? undefined : value;
        }
        if (next.body === undefined) delete next.bodyFormat;
        else next.bodyFormat ??= 'markdown';
        return put(next);
      });
    },

    move(id, parentId, order) {
      return db.transaction('rw', tables, async () => {
        const node = await getNode(id);
        const parent = parentId ?? undefined;
        await checkParent(id, parent);
        const at = toTimestamp(clock());
        return put({
          ...node,
          parentId: parent,
          order: order ?? (await nextSpaceOrder(db, parent)),
          edits: withEdit(node.edits, 'moved', at, source, client),
          updatedAt: at,
        });
      });
    },

    archive(id) {
      return db.transaction('rw', tables, async () => {
        const node = await getNode(id);
        const at = toTimestamp(clock());
        return put({
          ...node,
          archived: true,
          edits: withEdit(node.edits, 'archived', at, source, client),
          updatedAt: at,
        });
      });
    },

    restore(id) {
      return db.transaction('rw', tables, async () => {
        const node = await getNode(id);
        const at = toTimestamp(clock());
        return put({
          ...node,
          archived: false,
          edits: withEdit(node.edits, 'restored', at, source, client),
          updatedAt: at,
        });
      });
    },

    ensureRoots() {
      return db.transaction('rw', tables, async () => {
        const at = toTimestamp(clock());
        const roots: SpaceNode[] = [];
        for (const [order, root] of SPACE_ROOTS.entries()) {
          const existing = await db.spaceNodes.where('key').equals(root.key).first();
          if (existing) {
            roots.push(existing);
            continue;
          }
          const node = parseSpaceNode({
            id: newId(),
            kind: 'section',
            title: root.title,
            key: root.key,
            order,
            archived: false,
            links: [],
            externalLinks: [],
            attachments: [],
            createdAt: at,
            updatedAt: at,
          });
          await db.spaceNodes.add(node);
          roots.push(node);
        }
        return roots;
      });
    },

    saveContent(id, content, baseRevision) {
      return db.transaction('rw', tables, async () => {
        const node = await getNode(id);
        const revision = node.revision ?? 0;
        if (revision !== baseRevision) {
          throw new SpaceConflictError(
            `“${node.title}” changed since you opened it (revision ${revision}, yours ${baseRevision})`,
            revision,
          );
        }
        checkBlocks(content.blocks);
        const at = toTimestamp(clock());
        const next = changed(node, 'edited', at);
        next.blocks = content.blocks;
        if (content.title !== undefined) next.title = content.title.trim();
        return put(next);
      });
    },

    appendBlocks(id, blocks) {
      return db.transaction('rw', tables, async () => {
        const node = await getNode(id);
        if (blocks.length === 0) throw new InvalidInputError('Nothing to add');
        const at = toTimestamp(clock());
        const next = changed(node, 'edited', at);
        // An imported page becomes blocks first; its original body stays as it was.
        next.blocks = [...blocksOf(node), ...stamp(blocks, at)];
        checkBlocks(next.blocks as SpaceBlock[]);
        return put(next);
      });
    },

    updateBlock(id, blockId, changes) {
      return db.transaction('rw', tables, async () => {
        const node = await getNode(id);
        const blocks = blocksOf(node);
        const index = blocks.findIndex((b) => b.id === blockId);
        if (index < 0) throw new RecordNotFoundError('Block', blockId);
        if (blocks[index]!.type === 'fallback') {
          throw new RecordStateError('Imported content kept as it was can’t be edited');
        }
        const at = toTimestamp(clock());
        const block = omitUndefined({ ...blocks[index]!, ...changes, id: blockId }) as SpaceBlock;
        if (client) block.by = { client, at };
        else delete block.by;
        const next = changed(node, 'edited', at);
        next.blocks = blocks.map((b, i) => (i === index ? block : b));
        return put(next);
      });
    },

    setCell(id, rowId, columnId, value) {
      return db.transaction('rw', tables, async () => {
        const node = await getNode(id);
        if (!node.table) throw new RecordStateError('That page isn’t a table');
        if (!node.table.columns.some((c) => c.id === columnId)) {
          throw new RecordNotFoundError('Column', columnId);
        }
        const row = node.table.rows.find((r) => r.id === rowId);
        if (!row) throw new RecordNotFoundError('Row', rowId);
        const cells = { ...row.cells };
        if (value === null || value === '') delete cells[columnId];
        else cells[columnId] = value;
        const at = toTimestamp(clock());
        const next = changed(node, 'table', at);
        next.table = {
          ...node.table,
          rows: node.table.rows.map((r) => (r.id === rowId ? { ...r, cells } : r)),
        };
        return put(next);
      });
    },

    addRow(id, cells) {
      return db.transaction('rw', tables, async () => {
        const node = await getNode(id);
        if (!node.table) throw new RecordStateError('That page isn’t a table');
        const at = toTimestamp(clock());
        const next = changed(node, 'table', at);
        next.table = { ...node.table, rows: [...node.table.rows, { id: newId(), cells }] };
        return put(next);
      });
    },

    addLink(id, link) {
      return db.transaction('rw', tables, async () => {
        const node = await getNode(id);
        if (node.links.some((l) => sameLink(l, link))) return node;
        const at = toTimestamp(clock());
        const next = changed(node, 'linked', at);
        next.links = [...node.links, link];
        return put(next);
      });
    },

    removeLink(id, link) {
      return db.transaction('rw', tables, async () => {
        const node = await getNode(id);
        if (!node.links.some((l) => sameLink(l, link))) return node;
        const at = toTimestamp(clock());
        const next = changed(node, 'linked', at);
        next.links = node.links.filter((l) => !sameLink(l, link));
        return put(next);
      });
    },

    duplicate(id) {
      return db.transaction('rw', tables, async () => {
        const node = await getNode(id);
        if (node.kind === 'section' && node.key) {
          throw new RecordStateError('A section LOWTIDE maintains can’t be duplicated');
        }
        const at = toTimestamp(clock());
        const siblings = await spaceChildren(db, node.parentId);
        // Make room right after the original.
        for (const s of siblings.filter((s) => s.order > node.order)) {
          await db.spaceNodes.put({ ...s, order: s.order + 1 });
        }
        const copy = parseSpaceNode({
          id: newId(),
          parentId: node.parentId,
          kind: node.kind,
          title: `${node.title} (copy)`.slice(0, 2000),
          icon: node.icon,
          blocks: blocksOf(node).map((b) => ({ ...b, id: newId() })),
          order: node.order + 1,
          archived: false,
          links: node.links,
          externalLinks: node.externalLinks,
          attachments: node.attachments,
          table: node.table,
          revision: 0,
          edits: withEdit(undefined, 'created', at, source, client),
          createdAt: at,
          updatedAt: at,
        });
        await db.spaceNodes.add(copy);
        return copy;
      });
    },

    ensureProjectSpace(projectId, slot) {
      return db.transaction('rw', [db.spaceNodes, db.projects], async () => {
        const project = await db.projects.get(projectId);
        if (!project) throw new RecordNotFoundError('Project', projectId);
        const at = toTimestamp(clock());
        const make = async (key: string, title: string, parentId: Id | undefined) => {
          const existing = await db.spaceNodes.where('key').equals(key).first();
          if (existing) return existing;
          const node = parseSpaceNode({
            id: newId(),
            parentId,
            kind: 'section',
            title,
            key,
            order: await nextSpaceOrder(db, parentId),
            archived: false,
            links: key === `project:${projectId}` ? [{ type: 'project', id: projectId }] : [],
            externalLinks: [],
            attachments: [],
            revision: 0,
            edits: withEdit(undefined, 'created', at, source, client),
            createdAt: at,
            updatedAt: at,
          });
          await db.spaceNodes.add(node);
          return node;
        };
        const root =
          (await db.spaceNodes.where('key').equals('projects').first()) ??
          (await make('projects', 'Projects', undefined));
        const folder = await make(`project:${projectId}`, project.name, root.id);
        if (!slot) return folder;
        if (!PROJECT_SPACE_SLOTS.includes(slot)) throw new InvalidInputError(`No slot ${slot}`);
        return make(`project:${projectId}:${slot}`, SLOT_TITLES[slot], folder.id);
      });
    },

    watchChildren(parentId) {
      return watch(() => spaceChildren(db, parentId ?? undefined));
    },

    watchAll: watch(async () =>
      (await db.spaceNodes.toArray()).sort(
        (a, b) => (a.parentId ?? '').localeCompare(b.parentId ?? '') || byOrder(a, b),
      ),
    ),

    watchLinked(type, id) {
      return watch(async () =>
        (
          await db.spaceNodes
            .filter((n) => n.links.some((l) => l.type === type && l.id === id))
            .toArray()
        ).sort(byOrder),
      );
    },

    watchSources(type, id) {
      const rank = { canonical: 0, legacy: 1, reference: 2 } as const;
      return watch(async () =>
        (await db.sourceRecords.where('[entityType+entityId]').equals([type, id]).toArray()).sort(
          (a, b) => rank[a.role] - rank[b.role] || a.sourceId.localeCompare(b.sourceId),
        ),
      );
    },

    watchProjectSources(projectId) {
      return watch(async () => {
        const [milestones, tasks, items, decisions] = await Promise.all([
          db.milestones.where('projectId').equals(projectId).toArray(),
          db.tasks.where('projectId').equals(projectId).toArray(),
          db.projectItems.where('projectId').equals(projectId).toArray(),
          db.decisions.where('projectId').equals(projectId).toArray(),
        ]);
        const ids = new Set<string>([
          projectId,
          ...[...milestones, ...tasks, ...items, ...decisions].map((r) => r.id),
        ]);
        return (await db.sourceRecords.filter((r) => ids.has(r.entityId)).toArray()).sort(
          (a, b) => b.appliedAt.localeCompare(a.appliedAt) || a.sourceId.localeCompare(b.sourceId),
        );
      });
    },
  };
}
