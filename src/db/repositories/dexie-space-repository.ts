import { toTimestamp } from '../../lib/time';
import { SPACE_ROOTS, type Id, type SpaceNode } from '../../types/domain';
import { checkSpaceNode } from '../rules';
import { spaceNodeSchema } from '../schema';
import type { StoreDb } from '../store';
import { InvalidInputError, RecordNotFoundError } from './errors';
import { omitUndefined, resolveDeps, type RepositoryDeps } from './shared';
import type { SpaceRepository } from './types';

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

/**
 * SPACE (ADR-062). No ledger events and no snapshots: knowledge is not
 * activity, so creating, importing or editing a page never lights a square.
 */
export function createDexieSpaceRepository(deps: RepositoryDeps): SpaceRepository {
  const { db, clock, newId, watch } = resolveDeps(deps);
  const tables = [db.spaceNodes];

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
          createdAt: at,
          updatedAt: at,
        });
        await db.spaceNodes.add(node);
        return node;
      });
    },

    update(id, changes) {
      return db.transaction('rw', tables, async () => {
        const next: Record<string, unknown> = { ...(await getNode(id)) };
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
        next.updatedAt = toTimestamp(clock());
        return put(next);
      });
    },

    move(id, parentId, order) {
      return db.transaction('rw', tables, async () => {
        const node = await getNode(id);
        const parent = parentId ?? undefined;
        await checkParent(id, parent);
        return put({
          ...node,
          parentId: parent,
          order: order ?? (await nextSpaceOrder(db, parent)),
          updatedAt: toTimestamp(clock()),
        });
      });
    },

    archive(id) {
      return db.transaction('rw', tables, async () =>
        put({ ...(await getNode(id)), archived: true, updatedAt: toTimestamp(clock()) }),
      );
    },

    restore(id) {
      return db.transaction('rw', tables, async () =>
        put({ ...(await getNode(id)), archived: false, updatedAt: toTimestamp(clock()) }),
      );
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
  };
}
