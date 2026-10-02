import { blocksOf, blocksToMarkdown, parseBody } from '../../lib/space-blocks';
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
  type SpaceColumn,
  type SpaceRow,
  type SpaceTable,
  type SpaceView,
} from '../../types/domain';
import { STARTING_TEMPLATES } from '../space-templates';
import { convertCell, isDerived, optionsFor } from '../space-table';
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
import {
  PROJECT_SPACE_SLOTS,
  type Expect,
  type NewSpaceBlock,
  type SpaceRepository,
} from './types';

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

  /** Refuses a write made against an older revision, when the caller says which it saw. */
  function checkRevision(node: SpaceNode, expect: Expect | undefined) {
    if (expect?.baseRevision === undefined) return;
    const revision = node.revision ?? 0;
    if (revision !== expect.baseRevision) {
      throw new SpaceConflictError(
        `“${node.title}” changed since you read it (revision ${revision}, yours ${expect.baseRevision})`,
        revision,
      );
    }
  }

  function tableOf(node: SpaceNode): SpaceTable {
    if (!node.table) throw new RecordStateError('That page isn’t a database');
    return node.table;
  }

  /** Who wrote a row, as a row records it. */
  const who = client ?? 'owner';

  /** A change to a table page: one transaction, one revision. */
  function changeTable(
    id: Id,
    expect: Expect | undefined,
    change: (table: SpaceTable, at: string, node: SpaceNode) => SpaceTable,
  ): Promise<SpaceNode> {
    return db.transaction('rw', tables, async () => {
      const node = await getNode(id);
      checkRevision(node, expect);
      const at = toTimestamp(clock());
      const next = changed(node, 'table', at);
      next.table = change(tableOf(node), at, node);
      return put(next);
    });
  }

  /** A change to a page's blocks: one transaction, one revision. */
  function changeBlocks(
    id: Id,
    expect: Expect | undefined,
    change: (blocks: SpaceBlock[], at: string) => SpaceBlock[],
  ): Promise<SpaceNode> {
    return db.transaction('rw', tables, async () => {
      const node = await getNode(id);
      checkRevision(node, expect);
      if (node.kind !== 'page') throw new RecordStateError('Only a page holds blocks');
      const at = toTimestamp(clock());
      const next = changed(node, 'edited', at);
      // An imported page becomes blocks first; its original body stays as it was.
      next.blocks = change(blocksOf(node), at);
      checkBlocks(next.blocks as SpaceBlock[]);
      return put(next);
    });
  }

  function indexOfBlock(blocks: readonly SpaceBlock[], blockId: string): number {
    const index = blocks.findIndex((b) => b.id === blockId);
    if (index < 0) throw new RecordNotFoundError('Block', blockId);
    return index;
  }

  /** Every node under `id` (not `id` itself), parents before children. */
  async function descendants(id: Id): Promise<SpaceNode[]> {
    const out: SpaceNode[] = [];
    for (let level = await spaceChildren(db, id); level.length;) {
      out.push(...level);
      const next: SpaceNode[] = [];
      for (const n of level) next.push(...(await spaceChildren(db, n.id)));
      level = next;
    }
    return out;
  }

  /** A fresh copy of a node's content, without history, keys or pins. */
  function copyOf(
    node: SpaceNode,
    parentId: Id | undefined,
    order: number,
    at: string,
    title?: string,
  ) {
    const table = node.table
      ? {
          ...node.table,
          views: node.table.views?.map((v) => ({ ...v })),
        }
      : undefined;
    return parseSpaceNode({
      id: newId(),
      parentId,
      kind: node.kind,
      title: (title ?? node.title).slice(0, 2000),
      icon: node.icon,
      description: node.description,
      blocks:
        node.kind === 'page'
          ? blocksOf(node).map((b) => {
              const copy = { ...b, id: newId() };
              delete copy.by;
              return copy;
            })
          : undefined,
      order,
      archived: false,
      links: node.links,
      externalLinks: node.externalLinks,
      attachments: node.attachments,
      table,
      revision: 0,
      edits: withEdit(undefined, 'created', at, source, client),
      createdAt: at,
      updatedAt: at,
    });
  }

  /** Finds or makes a maintained section under `parentId`. */
  async function maintained(key: string, title: string, parentId: Id | undefined, at: string) {
    const existing = await db.spaceNodes.where('key').equals(key).first();
    if (existing) return { node: existing, made: false };
    const node = parseSpaceNode({
      id: newId(),
      parentId,
      kind: 'section',
      title,
      key,
      order: await nextSpaceOrder(db, parentId),
      archived: false,
      links: [],
      externalLinks: [],
      attachments: [],
      revision: 0,
      edits: withEdit(undefined, 'created', at, source, client),
      createdAt: at,
      updatedAt: at,
    });
    await db.spaceNodes.add(node);
    return { node, made: true };
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
          description: input.description?.trim() || undefined,
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
        for (const key of ['icon', 'body', 'description'] as const) {
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
        if (parent !== undefined && (await getNode(parent)).kind === 'table') {
          throw new InvalidInputError('A database can’t hold pages');
        }
        if (node.key !== undefined && parent !== node.parentId) {
          throw new RecordStateError(
            'LOWTIDE keeps this section in its place; it can only be reordered',
          );
        }
        if (node.key === undefined && parent === undefined) {
          throw new InvalidInputError(
            'Only LOWTIDE’s own sections live at the top; choose a folder',
          );
        }
        const at = toTimestamp(clock());
        let position = order ?? (await nextSpaceOrder(db, parent));
        if (order !== undefined) {
          // Insert at `order`: siblings are renumbered around it, in their order.
          const siblings = (await spaceChildren(db, parent)).filter((s) => s.id !== id);
          const insertAt = siblings.findIndex((s) => s.order >= order);
          const slot = insertAt < 0 ? siblings.length : insertAt;
          for (const [i, s] of siblings.entries()) {
            const next = i < slot ? i : i + 1;
            if (s.order !== next) await db.spaceNodes.put({ ...s, order: next });
          }
          position = slot;
        }
        return put({
          ...node,
          parentId: parent,
          order: position,
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
          rows: node.table.rows.map((r) =>
            r.id === rowId ? { ...r, cells, updatedAt: at, updatedBy: who } : r,
          ),
        };
        return put(next);
      });
    },

    addRow(id, cells, options) {
      return changeTable(id, undefined, (table, at) => {
        const rowId = options?.rowId ?? newId();
        if (table.rows.some((r) => r.id === rowId)) {
          throw new InvalidInputError(`Row ${rowId} already exists`);
        }
        const row: SpaceRow = {
          id: rowId,
          cells,
          createdAt: at,
          updatedAt: at,
          createdBy: who,
          updatedBy: who,
        };
        const rows = [...table.rows];
        const index = options?.index;
        rows.splice(
          index === undefined ? rows.length : Math.max(0, Math.min(index, rows.length)),
          0,
          row,
        );
        return { ...table, rows };
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

    updateRow(id, rowId, cells, expect) {
      return changeTable(id, expect, (table, at) => {
        const row = table.rows.find((r) => r.id === rowId);
        if (!row) throw new RecordNotFoundError('Row', rowId);
        const next = { ...row.cells };
        for (const [columnId, value] of Object.entries(cells)) {
          if (!table.columns.some((c) => c.id === columnId)) {
            throw new RecordNotFoundError('Column', columnId);
          }
          if (value === null || value === '') delete next[columnId];
          else next[columnId] = value;
        }
        return {
          ...table,
          rows: table.rows.map((r) =>
            r.id === rowId ? { ...r, cells: next, updatedAt: at, updatedBy: who } : r,
          ),
        };
      });
    },

    deleteRow(id, rowId, expect) {
      return changeTable(id, expect, (table) => {
        if (!table.rows.some((r) => r.id === rowId)) throw new RecordNotFoundError('Row', rowId);
        return { ...table, rows: table.rows.filter((r) => r.id !== rowId) };
      });
    },

    addColumn(id, input, position, expect) {
      return changeTable(id, expect, (table) => {
        const columnId = input.id ?? newId();
        if (table.columns.some((c) => c.id === columnId)) {
          throw new InvalidInputError(`Property ${columnId} already exists`);
        }
        const name = input.name.trim();
        if (!name) throw new InvalidInputError('Name the property');
        if (table.columns.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) {
          throw new InvalidInputError(`There’s already a property called “${name}”`);
        }
        const column = omitUndefined({ ...input, id: columnId, name });
        const columns = [...table.columns];
        columns.splice(
          position === undefined ? columns.length : Math.max(0, Math.min(position, columns.length)),
          0,
          column,
        );
        return { ...table, columns };
      });
    },

    updateColumn(id, columnId, changes, expect) {
      return changeTable(id, expect, (table) => {
        const column = table.columns.find((c) => c.id === columnId);
        if (!column) throw new RecordNotFoundError('Column', columnId);
        const name = changes.name !== undefined ? changes.name.trim() : column.name;
        if (!name) throw new InvalidInputError('Name the property');
        if (
          changes.name !== undefined &&
          table.columns.some(
            (c) => c.id !== columnId && c.name.trim().toLowerCase() === name.toLowerCase(),
          )
        ) {
          throw new InvalidInputError(`There’s already a property called “${name}”`);
        }
        let next = omitUndefined({ ...column, ...changes, id: columnId, name });
        let rows = table.rows;
        if (changes.type !== undefined && changes.type !== column.type) {
          const to = changes.type;
          const lost: string[] = [];
          rows = table.rows.map((r) => {
            const value = r.cells[columnId];
            if (value === undefined) return r;
            const converted = isDerived(to) ? undefined : convertCell(value, to);
            if (converted === undefined) {
              lost.push(r.id);
              return r;
            }
            return { ...r, cells: { ...r.cells, [columnId]: converted } };
          });
          if (lost.length) {
            throw new RecordStateError(
              `${lost.length} ${lost.length === 1 ? 'value' : 'values'} in “${column.name}” can’t become ${to}; change or clear ${lost.length === 1 ? 'it' : 'them'} first`,
            );
          }
          const options = optionsFor(
            next,
            rows.map((r) => r.cells[columnId]).filter((v) => v !== undefined),
          );
          next = omitUndefined({ ...next, options }) as SpaceColumn;
          if (to !== 'link') delete next.targets;
          if (to !== 'rollup') delete next.rollup;
          if (to !== 'formula') delete next.formula;
        }
        return {
          ...table,
          columns: table.columns.map((c) => (c.id === columnId ? next : c)),
          rows,
        };
      });
    },

    removeColumn(id, columnId, expect) {
      return changeTable(id, expect, (table) => {
        if (!table.columns.some((c) => c.id === columnId)) {
          throw new RecordNotFoundError('Column', columnId);
        }
        const used = table.columns.find((c) => c.rollup?.relation === columnId);
        if (used) {
          throw new RecordStateError(
            `The rollup “${used.name}” reads this relation; remove it first`,
          );
        }
        if (table.columns.length === 1) throw new RecordStateError('A database needs a property');
        return {
          columns: table.columns.filter((c) => c.id !== columnId),
          rows: table.rows.map((r) => {
            if (!(columnId in r.cells)) return r;
            const cells = { ...r.cells };
            delete cells[columnId];
            return { ...r, cells };
          }),
          ...(table.views
            ? {
                views: table.views.map(
                  (v) =>
                    omitUndefined({
                      ...v,
                      filters: v.filters?.filter((f) => f.column !== columnId),
                      sorts: v.sorts?.filter((x) => x.column !== columnId),
                      groupBy: v.groupBy === columnId ? undefined : v.groupBy,
                      dateColumn: v.dateColumn === columnId ? undefined : v.dateColumn,
                      hidden: v.hidden?.filter((h) => h !== columnId),
                      order: v.order?.filter((o) => o !== columnId),
                    }) as SpaceView,
                ),
              }
            : {}),
        };
      });
    },

    saveView(id, input) {
      return changeTable(id, undefined, (table) => {
        const known = new Set(table.columns.map((c) => c.id));
        const refs = [
          ...(input.filters ?? []).map((f) => f.column),
          ...(input.sorts ?? []).map((x) => x.column),
          ...(input.groupBy ? [input.groupBy] : []),
          ...(input.dateColumn ? [input.dateColumn] : []),
        ];
        const unknown = refs.find((r) => !known.has(r));
        if (unknown) throw new RecordNotFoundError('Column', unknown);
        const view = omitUndefined({ ...input, id: input.id ?? newId(), name: input.name.trim() });
        const views = table.views ?? [];
        return {
          ...table,
          views: views.some((v) => v.id === view.id)
            ? views.map((v) => (v.id === view.id ? view : v))
            : [...views, view],
        };
      });
    },

    removeView(id, viewId) {
      return changeTable(id, undefined, (table) => {
        if (!(table.views ?? []).some((v) => v.id === viewId)) {
          throw new RecordNotFoundError('View', viewId);
        }
        return { ...table, views: table.views!.filter((v) => v.id !== viewId) };
      });
    },

    insertBlocks(id, afterBlockId, blocks, expect) {
      if (blocks.length === 0) return Promise.reject(new InvalidInputError('Nothing to add'));
      return changeBlocks(id, expect, (current, at) => {
        const index = afterBlockId === null ? 0 : indexOfBlock(current, afterBlockId) + 1;
        return [...current.slice(0, index), ...stamp(blocks, at), ...current.slice(index)];
      });
    },

    deleteBlocks(id, blockIds, expect) {
      return changeBlocks(id, expect, (current) => {
        const ids = new Set(blockIds);
        for (const blockId of ids) {
          const block = current[indexOfBlock(current, blockId)]!;
          if (block.type === 'fallback') {
            throw new RecordStateError('Imported content kept as it was can’t be removed here');
          }
        }
        return current.filter((b) => !ids.has(b.id));
      });
    },

    moveBlock(id, blockId, afterBlockId, expect) {
      return changeBlocks(id, expect, (current) => {
        const block = current[indexOfBlock(current, blockId)]!;
        if (afterBlockId === blockId) return current;
        const rest = current.filter((b) => b.id !== blockId);
        const index = afterBlockId === null ? 0 : indexOfBlock(rest, afterBlockId) + 1;
        return [...rest.slice(0, index), block, ...rest.slice(index)];
      });
    },

    replaceBlocks(id, fromBlockId, toBlockId, blocks, expect) {
      return changeBlocks(id, expect, (current, at) => {
        const from = indexOfBlock(current, fromBlockId);
        const to = indexOfBlock(current, toBlockId);
        if (to < from) throw new InvalidInputError('The range ends before it starts');
        if (current.slice(from, to + 1).some((b) => b.type === 'fallback')) {
          throw new RecordStateError('Imported content kept as it was can’t be replaced');
        }
        return [...current.slice(0, from), ...stamp(blocks, at), ...current.slice(to + 1)];
      });
    },

    setPinned(id, pinned) {
      return db.transaction('rw', tables, async () => {
        const node = await getNode(id);
        if (Boolean(node.pinnedAt) === pinned) return node;
        // A viewing choice: no revision, no history, updatedAt stays.
        return put({ ...node, pinnedAt: pinned ? toTimestamp(clock()) : undefined });
      });
    },

    duplicateTree(id, options) {
      return db.transaction('rw', tables, async () => {
        const node = await getNode(id);
        if (node.key !== undefined) {
          throw new RecordStateError('A section LOWTIDE maintains can’t be duplicated');
        }
        const parentId = options?.parentId ?? node.parentId;
        await checkParent(undefined, parentId);
        const at = toTimestamp(clock());
        let order: number;
        if (parentId === node.parentId) {
          const siblings = await spaceChildren(db, node.parentId);
          for (const s of siblings.filter((s) => s.order > node.order)) {
            await db.spaceNodes.put({ ...s, order: s.order + 1 });
          }
          order = node.order + 1;
        } else {
          order = await nextSpaceOrder(db, parentId);
        }
        const top = copyOf(node, parentId, order, at, `${node.title} (copy)`);
        await db.spaceNodes.add(top);
        if (options?.deep) {
          const copies = new Map<Id, Id>([[node.id, top.id]]);
          for (const d of await descendants(node.id)) {
            if (d.archived) continue;
            const parent = copies.get(d.parentId!);
            if (!parent) continue;
            const copy = copyOf(d, parent, d.order, at);
            await db.spaceNodes.add(copy);
            copies.set(d.id, copy.id);
          }
        }
        return top;
      });
    },

    applyTemplate(templateId, parentId, title) {
      return db.transaction('rw', tables, async () => {
        const template = await getNode(templateId);
        if (template.kind === 'section') throw new InvalidInputError('A folder isn’t a template');
        const parent = await getNode(parentId);
        if (parent.kind === 'table') throw new InvalidInputError('A database can’t hold pages');
        const at = toTimestamp(clock());
        const copy = copyOf(
          template.kind === 'table'
            ? { ...template, table: { ...template.table!, rows: [] } }
            : template,
          parentId,
          await nextSpaceOrder(db, parentId),
          at,
          title?.trim() || template.title,
        );
        await db.spaceNodes.add(copy);
        return copy;
      });
    },

    ensureSystemPages(guide) {
      return db.transaction('rw', tables, async () => {
        const at = toTimestamp(clock());
        const root = await maintained('lowtide', 'LOWTIDE', undefined, at);
        if (root.made) {
          const order = SPACE_ROOTS.findIndex((r) => r.key === 'lowtide');
          await db.spaceNodes.put({ ...root.node, order });
        }
        const templates = await maintained('lowtide:templates', 'Templates', root.node.id, at);
        if (templates.made) {
          for (const [order, t] of STARTING_TEMPLATES.entries()) {
            await db.spaceNodes.add(
              parseSpaceNode({
                id: newId(),
                parentId: templates.node.id,
                kind: 'page',
                title: t.title,
                blocks: stamp(parseBody(t.markdown), at),
                order,
                archived: false,
                links: [],
                externalLinks: [],
                attachments: [],
                revision: 0,
                edits: withEdit(undefined, 'created', at, source, client),
                createdAt: at,
                updatedAt: at,
              }),
            );
          }
        }
        const ai = await maintained('lowtide:ai', 'AI', root.node.id, at);
        const blocks = parseBody(guide.markdown);
        const existing = await db.spaceNodes.where('key').equals('lowtide:guide').first();
        if (!existing) {
          await db.spaceNodes.add(
            parseSpaceNode({
              id: newId(),
              parentId: ai.node.id,
              kind: 'page',
              title: guide.title,
              key: 'lowtide:guide',
              blocks: stamp(blocks, at),
              order: 0,
              archived: false,
              links: [],
              externalLinks: [],
              attachments: [],
              revision: 0,
              edits: withEdit(undefined, 'created', at, source, client),
              createdAt: at,
              updatedAt: at,
            }),
          );
        } else if (
          blocksToMarkdown(blocksOf(existing)) !== blocksToMarkdown(blocks) ||
          existing.title !== guide.title
        ) {
          const next = changed(existing, 'edited', at);
          next.title = guide.title;
          next.blocks = stamp(blocks, at);
          await put(next);
        }
      });
    },

    deletePermanently(id) {
      return db.transaction('rw', tables, async () => {
        const node = await getNode(id);
        if (node.key !== undefined) {
          throw new RecordStateError('A section LOWTIDE maintains can’t be deleted');
        }
        if (!node.archived)
          throw new RecordStateError('Archive it first; only archived pages can be deleted');
        const all = [node, ...(await descendants(id))];
        if (all.some((n) => n.key !== undefined)) {
          throw new RecordStateError('It holds a section LOWTIDE maintains');
        }
        for (const n of all.reverse()) await db.spaceNodes.delete(n.id);
        return all.length;
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
