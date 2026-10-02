import * as z from 'zod/mini';
import { blocksOf, blocksToMarkdown, linksOf, parseBody } from '../../../src/lib/space-blocks';
import {
  applyView,
  formulaProblem,
  parseCsv,
  tableToCsv,
  valueOf,
  type Related,
} from '../../../src/lib/space-database';
import { newId } from '../../../src/lib/ids';
import { isDerived } from '../../../src/db/space-table';
import { SLOT_TITLES } from '../../../src/db/import/notion/types';
import {
  createRepositories,
  PROJECT_SPACE_SLOTS,
  type BackupData,
  type NewSpaceBlock,
} from '../../../src/db/repositories';
import {
  LINKABLE_TYPES,
  ROLLUP_FUNCTIONS,
  SPACE_COLUMN_TYPES,
  SPACE_FILTER_OPS,
  SPACE_VIEW_TYPES,
  type EntityLink,
  type LinkableType,
  type RollupFunction,
  type SpaceCellValue,
  type SpaceColumn,
  type SpaceNode,
  type SpaceView as DbView,
} from '../../../src/types/domain';
import {
  cellValue,
  checkMarkdown,
  d,
  dryRunArg,
  limitArg,
  MAINTAINED,
  op,
  pageArg,
  pathText,
  projectOf,
  quote,
  Refusal,
  resolveDecision,
  resolveHackathon,
  resolveItem,
  resolveMilestone,
  resolvePage,
  resolveTask,
  spaceView,
  text,
  titleEq,
  type ChangeNote,
  type Env,
  type SpaceView,
  type Tool,
} from './kit';

/*
 * SPACE administration over MCP (v2.1): folders, moves, renames, duplicates,
 * archive and restore, block-level edits, databases (properties, rows,
 * views, queries), templates, export and import. Every write enforces the
 * connection's part of SPACE, is attributed and audited, appears live, and
 * respects page revisions: a write made against an older revision is
 * refused instead of overwriting. LOWTIDE's own sections (the roots, project
 * folders and their standard sections) can be written into, never renamed,
 * moved away or archived.
 */

const kindName = (n: SpaceNode) =>
  n.kind === 'section' ? 'folder' : n.kind === 'table' ? 'database' : 'page';

const guardRevision = (n: SpaceNode) => ({
  store: 'spaceNodes',
  id: n.id,
  revision: n.revision ?? 0,
});

const expectOf = (args: Record<string, unknown>) =>
  args.baseRevision !== undefined ? { baseRevision: args.baseRevision as number } : undefined;

function notMaintained(n: SpaceNode, what: string) {
  if (MAINTAINED(n)) throw new Refusal(`LOWTIDE keeps “${n.title}” itself; it can’t be ${what}`);
}

/** A folder or page that can hold the thing being placed. */
function container(view: SpaceView, ref: string): SpaceNode {
  const node = resolvePage(view, ref);
  if (node.kind === 'table')
    throw new Refusal(`“${node.title}” is a database; it can’t hold pages`);
  return node;
}

/** Finds or makes folders along a path; never invents projects or sections. */
async function ensureFolders(env: Env, view: SpaceView, input: string[]) {
  const repos = env.repos();
  const created: string[] = [];
  const data = await env.data();
  let parts = input;
  let parent: SpaceNode | undefined = view.home;
  let level = parent ? (view.children.get(parent.id) ?? []) : (view.children.get('') ?? []);
  if (parent && parts[0] && titleEq(parts[0], 'Projects')) parts = parts.slice(1);
  if (parent && parts[0] && titleEq(parts[0], parent.title)) parts = parts.slice(1);
  for (const [i, part] of parts.entries()) {
    let next = level.find((n) => !n.archived && titleEq(n.title, part));
    if (next && view.byId.has(next.id) && !view.visible(next)) {
      throw new Refusal('That part of SPACE is outside this connection’s scope');
    }
    if (!next) {
      if (!parent) throw new Refusal(`“${part}” isn’t a SPACE section`);
      if (parent.kind === 'table') throw new Refusal(`“${parent.title}” is a database`);
      const root = view.path(parent.id)[0] ?? parent;
      if (view.byId.has(root.id) && !view.visible(root)) {
        throw new Refusal('That part of SPACE is outside this connection’s scope');
      }
      const project = /^project:([^:]+)$/.exec(parent.key ?? '')?.[1];
      const slot = PROJECT_SPACE_SLOTS.find((s) => titleEq(SLOT_TITLES[s], part));
      if (project && slot) next = await repos.space.ensureProjectSpace(project, slot);
      else if (parent.key === 'projects') {
        const p = data.projects.find((x) => titleEq(x.name, part) || x.slug === part.toLowerCase());
        if (!p) throw new Refusal(`No project “${part}”; create it with create_project first`);
        next = await repos.space.ensureProjectSpace(p.id);
      } else {
        next = await repos.space.create({ parentId: parent.id, kind: 'section', title: part });
      }
      created.push(parts.slice(0, i + 1).join(' / '));
    }
    parent = next;
    level = view.children.get(parent.id) ?? [];
  }
  if (!parent) throw new Refusal('Give a path below a section');
  return { node: parent, created };
}

/* ------------------------------ databases ------------------------------- */

function columnOf(node: SpaceNode, ref: string): SpaceColumn {
  const table = node.table;
  if (!table) throw new Refusal(`“${node.title}” isn’t a database`);
  const c =
    table.columns.find((x) => x.id === ref) ?? table.columns.find((x) => titleEq(x.name, ref));
  if (!c) throw new Refusal(`“${node.title}” has no property “${ref}”`);
  return c;
}

function rowOf(node: SpaceNode, ref: string) {
  const table = node.table!;
  const byId = table.rows.find((r) => r.id === ref);
  if (byId) return byId;
  const first = table.columns.find((c) => c.type === 'text') ?? table.columns[0];
  const named = table.rows.filter((r) => first && titleEq(String(r.cells[first.id] ?? ''), ref));
  if (named.length === 1) return named[0]!;
  if (named.length > 1) throw new Refusal(`“${ref}” matches ${named.length} rows; give the row id`);
  throw new Refusal(`“${node.title}” has no row “${ref}”`);
}

const LINK_PREFIX =
  /^(project|task|milestone|projectItem|decision|hackathon|spaceNode|aiSession):(.+)$/;

/** A relation value from refs like "task:Write docs" or {type, id}. */
async function linksFor(env: Env, column: SpaceColumn, value: unknown): Promise<EntityLink[]> {
  const list = Array.isArray(value) ? value : [value];
  const out: EntityLink[] = [];
  const data = await env.data();
  for (const item of list) {
    let type: LinkableType;
    let ref: string;
    if (typeof item === 'string') {
      const m = LINK_PREFIX.exec(item.trim());
      if (!m)
        throw new Refusal(
          `“${column.name}” takes links like "task:<id or title>" or "spaceNode:<page>"`,
        );
      type = m[1] as LinkableType;
      ref = m[2]!;
    } else if (item && typeof item === 'object' && 'type' in item && 'id' in item) {
      type = (item as { type: LinkableType }).type;
      ref = String((item as { id: string }).id);
    } else {
      throw new Refusal(`“${column.name}” takes links`);
    }
    if (column.targets?.length && !column.targets.includes(type)) {
      throw new Refusal(`“${column.name}” links only to ${column.targets.join(', ')}`);
    }
    switch (type) {
      case 'project': {
        const p = await projectOf(env, ref);
        out.push({ type, id: p.id, label: p.name });
        break;
      }
      case 'task': {
        const t = await resolveTask(env, ref);
        out.push({ type, id: t.id, label: t.title });
        break;
      }
      case 'milestone': {
        const m = await resolveMilestone(env, ref);
        out.push({ type, id: m.id, label: m.title });
        break;
      }
      case 'decision': {
        const x = await resolveDecision(env, ref);
        out.push({ type, id: x.id, label: x.title });
        break;
      }
      case 'projectItem': {
        const i = await resolveItem(env, ref);
        out.push({ type, id: i.id, label: i.title });
        break;
      }
      case 'hackathon': {
        const h = await resolveHackathon(env, ref);
        out.push({ type, id: h.id, label: h.name });
        break;
      }
      case 'spaceNode': {
        const [pageRef, rowId] = ref.split('#');
        const page = resolvePage(await spaceView(env), pageRef!);
        out.push({ type, id: page.id, ...(rowId ? { rowId } : {}), label: page.title });
        break;
      }
      default: {
        const s = data.aiSessions.find((x) => x.id === ref);
        if (!s) throw new Refusal(`No AI session ${ref}`);
        out.push({ type, id: s.id, label: s.summary.split('\n')[0]!.slice(0, 120) });
      }
    }
  }
  return out;
}

/**
 * Cells by property name or id, made to fit each property; new select
 * values become options. Returns the cells and the options to add first.
 */
async function cellsFor(env: Env, node: SpaceNode, input: Record<string, unknown>) {
  const cells: Record<string, SpaceCellValue | null> = {};
  const widen = new Map<string, string[]>();
  for (const [name, value] of Object.entries(input)) {
    const column = columnOf(node, name);
    if (isDerived(column.type)) throw new Refusal(`“${column.name}” is computed; it can’t be set`);
    if (value === null || value === undefined || value === '') {
      cells[column.id] = null;
      continue;
    }
    if (column.type === 'link') {
      cells[column.id] = await linksFor(env, column, value);
      continue;
    }
    if (column.type === 'date') {
      const v = String(value);
      if (Number.isNaN(Date.parse(v)))
        throw new Refusal(`“${column.name}” takes a date like 2026-11-04`);
      cells[column.id] = v;
      continue;
    }
    const v = cellValue(column, value);
    cells[column.id] = v;
    if (['select', 'status', 'multiSelect'].includes(column.type)) {
      const known = new Set((column.options ?? []).map((o) => o.name));
      const add = (Array.isArray(v) ? (v as string[]) : [String(v)]).filter((x) => !known.has(x));
      if (add.length) widen.set(column.id, [...(widen.get(column.id) ?? []), ...add]);
    }
  }
  return { cells, widen };
}

async function widenOptions(env: Env, node: SpaceNode, widen: Map<string, string[]>) {
  let current = node;
  for (const [columnId, names] of widen) {
    const column = current.table!.columns.find((c) => c.id === columnId)!;
    current = await env.repos().space.updateColumn(node.id, columnId, {
      options: [...(column.options ?? []), ...[...new Set(names)].map((name) => ({ name }))],
    });
  }
  return current;
}

const storedCells = (cells: Record<string, SpaceCellValue | null>) =>
  Object.fromEntries(Object.entries(cells).filter(([, v]) => v !== null)) as Record<
    string,
    SpaceCellValue
  >;

/** What relations point at, from one snapshot, for rollups. */
export function relatedFrom(data: BackupData): (link: EntityLink) => Related | undefined {
  return (link) => {
    switch (link.type) {
      case 'task': {
        const t = data.tasks.find((x) => x.id === link.id);
        const date = t?.completedAt ?? t?.dueAt;
        return t && { title: t.title, done: t.status === 'done', ...(date ? { date } : {}) };
      }
      case 'milestone': {
        const m = data.milestones.find((x) => x.id === link.id);
        const date = m?.completedAt ?? m?.dueOn;
        return (
          m && { title: m.title, done: m.completedAt !== undefined, ...(date ? { date } : {}) }
        );
      }
      case 'projectItem': {
        const i = data.projectItems.find((x) => x.id === link.id);
        return (
          i && {
            title: i.title,
            done: i.lane === 'done',
            ...(i.resolvedAt ? { date: i.resolvedAt } : {}),
          }
        );
      }
      case 'decision': {
        const x = data.decisions.find((y) => y.id === link.id);
        return x && { title: x.title, date: x.decidedAt };
      }
      case 'project': {
        const p = data.projects.find((x) => x.id === link.id);
        return p && { title: p.name, done: p.state === 'done' };
      }
      case 'hackathon': {
        const h = data.hackathons.find((x) => x.id === link.id);
        return (
          h && {
            title: h.name,
            done: h.status === 'finished',
            ...(h.eventStart ? { date: h.eventStart } : {}),
          }
        );
      }
      case 'spaceNode': {
        const n = data.spaceNodes.find((x) => x.id === link.id);
        if (!n) return undefined;
        const row = link.rowId ? n.table?.rows.find((r) => r.id === link.rowId) : undefined;
        if (!row) return { title: n.title };
        const values: NonNullable<Related['values']> = {};
        for (const c of n.table!.columns) {
          const v = row.cells[c.id];
          if (v === undefined) continue;
          values[c.id] = v;
          values[c.name] = v;
        }
        const status = n.table!.columns.find((c) => c.type === 'status');
        const statusValue = status ? String(row.cells[status.id] ?? '') : '';
        return {
          values,
          done: /^(done|complete|completed|published|shipped)$/i.test(statusValue),
        };
      }
      default:
        return undefined;
    }
  };
}

function viewFrom(
  node: SpaceNode,
  input: Record<string, unknown>,
): Omit<DbView, 'id'> & { id?: string } {
  const col = (ref: string) => columnOf(node, ref).id;
  return {
    ...(input.id ? { id: input.id as string } : {}),
    name: (input.name as string | undefined) ?? 'View',
    type: (input.type as DbView['type'] | undefined) ?? 'table',
    ...(input.filters
      ? {
          filters: (input.filters as { property: string; op: string; value?: string }[]).map(
            (f) => ({
              column: col(f.property),
              op: f.op as NonNullable<DbView['filters']>[number]['op'],
              ...(f.value !== undefined ? { value: f.value } : {}),
            }),
          ),
        }
      : {}),
    ...(input.sorts
      ? {
          sorts: (input.sorts as { property: string; dir?: 'asc' | 'desc' }[]).map((s) => ({
            column: col(s.property),
            dir: s.dir ?? 'asc',
          })),
        }
      : {}),
    ...(input.groupBy ? { groupBy: col(input.groupBy as string) } : {}),
    ...(input.dateProperty ? { dateColumn: col(input.dateProperty as string) } : {}),
    ...(input.hidden ? { hidden: (input.hidden as string[]).map(col) } : {}),
    ...(input.order ? { order: (input.order as string[]).map(col) } : {}),
  };
}

const rollupInput = z.strictObject({
  relation: text(200),
  fn: z.enum(ROLLUP_FUNCTIONS),
  property: z.optional(text(200)),
});

const propertyInput = z.strictObject({
  name: text(200),
  type: d(
    z.enum(SPACE_COLUMN_TYPES),
    'link is a Relation. createdTime, updatedTime, createdBy, updatedBy, rollup and formula are computed.',
  ),
  options: d(
    z.optional(z.array(text(200)).check(z.maxLength(200))),
    'For select, status and multiSelect.',
  ),
  targets: d(z.optional(z.array(z.enum(LINKABLE_TYPES))), 'For a relation: what it may link to.'),
  rollup: d(
    z.optional(rollupInput),
    'For a rollup: the relation property to read and what to compute (count, countDone, percentDone, sum, latest).',
  ),
  formula: d(
    z.optional(text(2000)),
    'For a formula, e.g. if(prop("Done"), "✓", concat(prop("Owner"), " — ", prop("Due"))).',
  ),
});

type PropertyInput = {
  name: string;
  type: SpaceColumn['type'];
  options?: string[] | undefined;
  targets?: LinkableType[] | undefined;
  rollup?: { relation: string; fn: RollupFunction; property?: string | undefined } | undefined;
  formula?: string | undefined;
};

/** A property definition from tool input, checked against the table's other properties. */
function columnFrom(others: SpaceColumn[], input: PropertyInput): Omit<SpaceColumn, 'id'> {
  const relation = input.rollup
    ? others.find((c) => c.id === input.rollup!.relation || titleEq(c.name, input.rollup!.relation))
    : undefined;
  if (input.rollup && relation?.type !== 'link') {
    throw new Refusal(`A rollup needs a relation property; “${input.rollup.relation}” isn’t one`);
  }
  if (input.formula) {
    const problem = formulaProblem(input.formula, others);
    if (problem) throw new Refusal(`That formula can’t be used: ${problem}`);
  }
  return {
    name: input.name,
    type: input.type,
    ...(input.options ? { options: input.options.map((name) => ({ name })) } : {}),
    ...(input.targets ? { targets: input.targets } : {}),
    ...(relation
      ? {
          rollup: {
            relation: relation.id,
            fn: input.rollup!.fn,
            ...(input.rollup!.property ? { property: input.rollup!.property } : {}),
          },
        }
      : {}),
    ...(input.formula ? { formula: input.formula } : {}),
  };
}

const viewInput = {
  name: text(200),
  type: z.enum(SPACE_VIEW_TYPES),
  filters: z.optional(
    z
      .array(
        z.strictObject({
          property: text(200),
          op: z.enum(SPACE_FILTER_OPS),
          value: z.optional(z.string().check(z.maxLength(2000))),
        }),
      )
      .check(z.maxLength(20)),
  ),
  sorts: z.optional(
    z
      .array(z.strictObject({ property: text(200), dir: z.optional(z.enum(['asc', 'desc'])) }))
      .check(z.maxLength(5)),
  ),
  groupBy: d(z.optional(text(200)), 'Board columns / list groups: a select or status property.'),
  dateProperty: d(z.optional(text(200)), 'Calendar views: the date property.'),
  hidden: z.optional(z.array(text(200))),
  order: z.optional(z.array(text(200))),
};

const revisionArg = () =>
  d(
    z.optional(z.number().check(z.int(), z.minimum(0))),
    'The revision you read (get_space_page); a write against an older one is refused instead of overwriting.',
  );

/* ------------------------------ structure ------------------------------- */

type Noted = ChangeNote & { node: SpaceNode };

async function moveOne(
  env: Env,
  view: SpaceView,
  pageRef: string,
  toRef: string,
  position?: number,
): Promise<Noted & { to: SpaceNode }> {
  const node = resolvePage(view, pageRef);
  notMaintained(node, 'moved');
  const to = container(view, toRef);
  if (view.path(to.id).some((p) => p.id === node.id))
    throw new Refusal(`“${node.title}” can’t move inside itself`);
  await env.repos().space.move(node.id, to.id, position !== undefined ? position - 1 : undefined);
  return {
    node,
    to,
    summary: `Moved ${kindName(node)} “${node.title}” to ${pathText(view, to.id)}`,
    entityType: 'spaceNode',
    entityId: node.id,
    undo: [op('space', 'move', node.id, node.parentId ?? null, node.order)],
    guard: { store: 'spaceNodes', id: node.id, fields: { parentId: to.id } },
  };
}

async function archiveOne(env: Env, view: SpaceView, ref: string): Promise<Noted> {
  const node = resolvePage(view, ref);
  notMaintained(node, 'archived');
  if (node.archived) throw new Refusal(`“${node.title}” is already archived`);
  await env.repos().space.archive(node.id);
  return {
    node,
    summary: `Archived ${kindName(node)} “${node.title}”`,
    entityType: 'spaceNode',
    entityId: node.id,
    undo: [op('space', 'restore', node.id)],
  };
}

async function renameOne(env: Env, view: SpaceView, ref: string, title: string): Promise<Noted> {
  const node = resolvePage(view, ref);
  notMaintained(node, 'renamed');
  const saved = await env.repos().space.update(node.id, { title });
  return {
    node,
    summary: `Renamed “${node.title}” to “${saved.title}”`,
    entityType: 'spaceNode',
    entityId: node.id,
    undo: [op('space', 'update', node.id, { title: node.title })],
    guard: guardRevision(saved),
  };
}

async function mergeOne(
  env: Env,
  view: SpaceView,
  fromRef: string,
  intoRef: string,
): Promise<ChangeNote> {
  const from = resolvePage(view, fromRef);
  const into = resolvePage(view, intoRef);
  if (from.id === into.id) throw new Refusal('A page can’t merge into itself');
  if (from.kind !== 'page' || into.kind !== 'page')
    throw new Refusal('Only pages merge (not folders or databases)');
  notMaintained(from, 'merged away');
  const blocks: NewSpaceBlock[] = [
    { type: 'heading2', text: from.title },
    ...blocksOf(from).map((b) => {
      const copy = { ...b } as NewSpaceBlock;
      delete copy.id;
      delete copy.by;
      return copy;
    }),
  ];
  const before = new Set(blocksOf(into).map((b) => b.id));
  const repos = env.repos();
  const saved = await repos.space.appendBlocks(into.id, blocks);
  const added = (saved.blocks ?? []).filter((b) => !before.has(b.id)).map((b) => b.id);
  // Its subpages move along, so nothing is stranded.
  const kids = (view.children.get(from.id) ?? []).filter((c) => !c.archived);
  for (const child of kids) await repos.space.move(child.id, into.id);
  await repos.space.archive(from.id);
  return {
    summary: `Merged “${from.title}” into “${into.title}” (and archived it)`,
    entityType: 'spaceNode',
    entityId: into.id,
    undo: [
      op('space', 'restore', from.id),
      op('space', 'deleteBlocks', into.id, added),
      ...kids.map((c) => op('space', 'move', c.id, from.id, c.order)),
    ],
  };
}

/** A fresh snapshot (for multi-step plans that read their own writes). */
async function readFresh(env: Env): Promise<BackupData> {
  return (await createRepositories(env.store, { watch: env.store.watch }).backup.exportBackup())
    .data;
}

const strip = (c: ChangeNote): ChangeNote => ({
  summary: c.summary,
  ...(c.entityType ? { entityType: c.entityType } : {}),
  ...(c.entityId ? { entityId: c.entityId } : {}),
  ...(c.undo ? { undo: c.undo } : {}),
  ...(c.guard ? { guard: c.guard } : {}),
});

const spaceStructureTools: Tool[] = [
  {
    name: 'create_space_folder',
    title: 'Create SPACE folder',
    capability: 'space.structure',
    action: 'create a SPACE folder',
    description:
      'Makes a folder (and any missing folders along the path). Folders hold pages, databases and other folders. If it exists, returns it. Example path: "Projects / Engine / Security Research".',
    write: true,
    input: z.strictObject({
      path: d(text(2000), 'Titles separated by " / ", ending with the new folder.'),
      description: z.optional(text(2000)),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const parts = (args.path as string)
        .split('/')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length < 2 && !view.home)
        throw new Refusal('Put the folder inside a section, e.g. "Ideas / Research"');
      const { node, created } = await env.atomic(async () => {
        const made = await ensureFolders(env, view, parts);
        if (args.description && made.created.length)
          await env.repos().space.update(made.node.id, { description: args.description as string });
        return made;
      });
      return {
        value: {
          id: node.id,
          title: node.title,
          kind: kindName(node),
          created,
          existing: !created.length,
        },
        entityType: 'spaceNode',
        entityId: node.id,
        changes: created.length
          ? [
              {
                summary: `Created folder ${parts.join(' / ')}`,
                entityType: 'spaceNode',
                entityId: node.id,
                undo: [op('space', 'archive', node.id)],
              },
            ]
          : [],
      };
    },
  },
  {
    name: 'rename_space_item',
    title: 'Rename SPACE item',
    capability: 'space.structure',
    action: 'rename a SPACE item',
    description: 'Renames a page, folder or database.',
    write: true,
    input: z.strictObject({ page: pageArg(), title: text(300) }),
    async run(env, args) {
      const change = await renameOne(
        env,
        await spaceView(env),
        args.page as string,
        args.title as string,
      );
      return {
        value: { id: change.node.id, title: args.title },
        entityType: 'spaceNode',
        entityId: change.node.id,
        changes: [strip(change)],
      };
    },
  },
  {
    name: 'move_space_item',
    title: 'Move SPACE item',
    capability: 'space.structure',
    action: 'move a SPACE item',
    dryRun: true,
    description:
      'Moves a page, folder or database into another folder or page (last, or at a position counted from 1). Moving something inside itself is refused. Example: move "Projects / Engine / Architecture / Storage" to "Projects / Engine / Engineering".',
    write: true,
    input: z.strictObject({
      page: pageArg(),
      to: d(text(2000), 'The folder or page to move it into (id or path).'),
      position: d(z.optional(z.number().check(z.int(), z.minimum(1))), '1 = first.'),
      dryRun: dryRunArg(),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const change = await moveOne(
        env,
        view,
        args.page as string,
        args.to as string,
        args.position as number | undefined,
      );
      return {
        value: {
          id: change.node.id,
          path: `${pathText(view, change.to.id)} / ${change.node.title}`,
        },
        entityType: 'spaceNode',
        entityId: change.node.id,
        changes: [strip(change)],
      };
    },
  },
  {
    name: 'reorder_space_item',
    title: 'Reorder SPACE item',
    capability: 'space.structure',
    action: 'reorder a SPACE item',
    description:
      'Changes where an item sits among its siblings: a position counted from 1, or before/after a sibling.',
    write: true,
    input: z.strictObject({
      page: pageArg(),
      position: z.optional(z.number().check(z.int(), z.minimum(1))),
      before: d(z.optional(text(2000)), 'A sibling to put it before.'),
      after: d(z.optional(text(2000)), 'A sibling to put it after.'),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const node = resolvePage(view, args.page as string);
      const siblings = (view.children.get(node.parentId ?? '') ?? []).filter(
        (n) => n.id !== node.id,
      );
      let index: number;
      if (args.position !== undefined) index = (args.position as number) - 1;
      else if (args.before !== undefined || args.after !== undefined) {
        const other = resolvePage(view, (args.before ?? args.after) as string);
        const at = siblings.findIndex((n) => n.id === other.id);
        if (at < 0) throw new Refusal(`“${other.title}” isn’t next to it`);
        index = args.before !== undefined ? at : at + 1;
      } else throw new Refusal('Give a position, before or after');
      const target = siblings[index];
      await env
        .repos()
        .space.move(node.id, node.parentId ?? null, target ? target.order : undefined);
      return {
        value: { id: node.id },
        changes: [
          {
            summary: `Reordered “${node.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [op('space', 'move', node.id, node.parentId ?? null, node.order)],
          },
        ],
      };
    },
  },
  {
    name: 'duplicate_space_item',
    title: 'Duplicate SPACE item',
    capability: 'space.structure',
    action: 'duplicate a SPACE item',
    description:
      'Copies a page, folder or database next to it (or into `to`). deep: true copies everything inside too. Content only: no history or activity is copied.',
    write: true,
    input: z.strictObject({
      page: pageArg(),
      deep: z.optional(z.boolean()),
      to: z.optional(text(2000)),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const node = resolvePage(view, args.page as string);
      const to = args.to ? container(view, args.to as string) : undefined;
      const copy = await env.repos().space.duplicateTree(node.id, {
        ...(args.deep ? { deep: true } : {}),
        ...(to ? { parentId: to.id } : {}),
      });
      return {
        value: { id: copy.id, title: copy.title },
        entityType: 'spaceNode',
        entityId: copy.id,
        changes: [
          {
            summary: `Duplicated “${node.title}”${args.deep ? ' with its contents' : ''}`,
            entityType: 'spaceNode',
            entityId: copy.id,
            undo: [op('space', 'archive', copy.id)],
          },
        ],
      };
    },
  },
  {
    name: 'archive_space_item',
    title: 'Archive SPACE item',
    capability: 'space.archive',
    action: 'archive a SPACE item',
    dryRun: true,
    description: 'Archives a page, folder or database (restorable; nothing is deleted over MCP).',
    write: true,
    input: z.strictObject({ page: pageArg(), dryRun: dryRunArg() }),
    async run(env, args) {
      const change = await archiveOne(env, await spaceView(env), args.page as string);
      return {
        value: { id: change.node.id, archived: true },
        entityType: 'spaceNode',
        entityId: change.node.id,
        after: `archived ${quote(change.node.title)}`,
        changes: [strip(change)],
      };
    },
  },
  {
    name: 'restore_space_item',
    title: 'Restore SPACE item',
    capability: 'space.archive',
    action: 'restore a SPACE item',
    description:
      'Restores an archived page, folder or database (by id; get_space_tree with includeArchived lists them).',
    write: true,
    input: z.strictObject({ page: pageArg() }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.page as string);
      if (!node.archived) throw new Refusal(`“${node.title}” isn’t archived`);
      await env.repos().space.restore(node.id);
      return {
        value: { id: node.id, archived: false },
        changes: [
          {
            summary: `Restored ${kindName(node)} “${node.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [op('space', 'archive', node.id)],
          },
        ],
      };
    },
  },
  {
    name: 'move_space_items',
    title: 'Move SPACE items (several)',
    capability: 'space.structure',
    action: 'move several SPACE items',
    dryRun: true,
    checkpointAt: 10,
    description:
      'Moves several items at once, all or nothing, with a result per item. Preview with dryRun.',
    write: true,
    input: z.strictObject({
      moves: z
        .array(
          z.strictObject({
            page: text(2000),
            to: text(2000),
            position: z.optional(z.number().check(z.int(), z.minimum(1))),
          }),
        )
        .check(z.minLength(1), z.maxLength(200)),
      dryRun: dryRunArg(),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const changes = await env.atomic(async () => {
        const out = [];
        for (const m of args.moves as { page: string; to: string; position?: number }[])
          out.push(await moveOne(env, view, m.page, m.to, m.position));
        return out;
      });
      return {
        value: changes.map((c) => ({
          id: c.node.id,
          title: c.node.title,
          to: pathText(view, c.to.id),
        })),
        changes: changes.map(strip),
      };
    },
  },
  {
    name: 'archive_space_items',
    title: 'Archive SPACE items (several)',
    capability: 'space.archive',
    action: 'archive several SPACE items',
    dryRun: true,
    checkpointAt: 10,
    description: 'Archives several items at once, all or nothing. Preview with dryRun.',
    write: true,
    input: z.strictObject({
      pages: z.array(text(2000)).check(z.minLength(1), z.maxLength(200)),
      dryRun: dryRunArg(),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const changes = await env.atomic(async () => {
        const out = [];
        for (const ref of args.pages as string[]) out.push(await archiveOne(env, view, ref));
        return out;
      });
      return {
        value: changes.map((c) => ({ id: c.node.id, title: c.node.title, archived: true })),
        changes: changes.map(strip),
      };
    },
  },
  {
    name: 'merge_space_pages',
    title: 'Merge SPACE pages',
    capability: ['space.write', 'space.archive'],
    action: 'merge SPACE pages',
    dryRun: true,
    description:
      'Merges one page into another: its content is added under a heading with its title, its subpages move over, and it is archived. Undoable. Preview with dryRun.',
    write: true,
    input: z.strictObject({ from: pageArg(), into: pageArg(), dryRun: dryRunArg() }),
    async run(env, args) {
      const view = await spaceView(env);
      const change = await env.atomic(() =>
        mergeOne(env, view, args.from as string, args.into as string),
      );
      return { value: { into: change.entityId }, changes: [change] };
    },
  },
  {
    name: 'organize_space',
    title: 'Organize SPACE',
    capability: ['space.structure', 'space.archive'],
    action: 'reorganise SPACE',
    dryRun: true,
    checkpointAt: 5,
    description:
      'Runs a reorganisation plan in order, all or nothing: createFolder, move, rename, merge and archive steps. For broad cleanups call it with dryRun first and show the owner the plan; LOWTIDE takes a checkpoint before large ones.',
    write: true,
    input: z.strictObject({
      operations: z
        .array(
          z.strictObject({
            op: z.enum(['createFolder', 'move', 'rename', 'merge', 'archive']),
            page: d(z.optional(text(2000)), 'The item (move, rename, merge, archive).'),
            to: d(z.optional(text(2000)), 'move: destination; merge: the page to merge into.'),
            path: d(z.optional(text(2000)), 'createFolder: the folder’s path.'),
            title: d(z.optional(text(300)), 'rename: the new title.'),
          }),
        )
        .check(z.minLength(1), z.maxLength(200)),
      dryRun: dryRunArg(),
    }),
    async run(env, args) {
      const ops = args.operations as {
        op: string;
        page?: string;
        to?: string;
        path?: string;
        title?: string;
      }[];
      const changes = await env.atomic(async () => {
        const out: ChangeNote[] = [];
        for (const [i, o] of ops.entries()) {
          // Each step sees what the steps before it did.
          let fresh: Promise<BackupData> | undefined;
          const view = await spaceView({ ...env, data: () => (fresh ??= readFresh(env)) });
          const need = (v: string | undefined, name: string) => {
            if (!v) throw new Refusal(`Step ${i + 1} (${o.op}) needs ${name}`);
            return v;
          };
          if (o.op === 'createFolder') {
            const parts = need(o.path, 'path')
              .split('/')
              .map((p) => p.trim())
              .filter(Boolean);
            const { node, created } = await ensureFolders(env, view, parts);
            if (created.length)
              out.push({
                summary: `Created folder ${parts.join(' / ')}`,
                entityType: 'spaceNode',
                entityId: node.id,
                undo: [op('space', 'archive', node.id)],
              });
          } else if (o.op === 'move')
            out.push(strip(await moveOne(env, view, need(o.page, 'page'), need(o.to, 'to'))));
          else if (o.op === 'rename')
            out.push(
              strip(await renameOne(env, view, need(o.page, 'page'), need(o.title, 'title'))),
            );
          else if (o.op === 'merge')
            out.push(await mergeOne(env, view, need(o.page, 'page'), need(o.to, 'to')));
          else out.push(strip(await archiveOne(env, view, need(o.page, 'page'))));
        }
        return out;
      });
      return { value: { steps: changes.map((c) => c.summary) }, changes };
    },
  },
  {
    name: 'pin_space_item',
    title: 'Pin SPACE item',
    capability: 'space.structure',
    action: 'pin a SPACE item',
    description: 'Pins or unpins a page, folder or database (only when the owner asks).',
    write: true,
    input: z.strictObject({ page: pageArg(), pinned: z.boolean() }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.page as string);
      const pinned = args.pinned as boolean;
      await env.repos().space.setPinned(node.id, pinned);
      return {
        value: { id: node.id, pinned },
        changes: [
          {
            summary: `${pinned ? 'Pinned' : 'Unpinned'} “${node.title}”`,
            undo: [op('space', 'setPinned', node.id, !pinned)],
          },
        ],
      };
    },
  },
];

/* ------------------------------- content -------------------------------- */

const spaceContentTools: Tool[] = [
  {
    name: 'insert_space_blocks',
    title: 'Insert into SPACE page',
    capability: 'space.write',
    action: 'write to a SPACE page',
    description:
      'Inserts Markdown after a block (by id from get_space_page), at the top ("top"), or at the end (default). Long documents can be written in several calls.',
    write: true,
    input: z.strictObject({
      page: pageArg(),
      after: d(z.optional(text(200)), 'A block id, or "top". Default: the end.'),
      markdown: text(200_000),
      baseRevision: revisionArg(),
    }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.page as string);
      const blocks = checkMarkdown(args.markdown as string);
      const before = new Set(blocksOf(node).map((b) => b.id));
      const repos = env.repos();
      const saved =
        args.after === undefined
          ? await repos.space.insertBlocks(
              node.id,
              blocksOf(node).at(-1)?.id ?? null,
              blocks,
              expectOf(args),
            )
          : await repos.space.insertBlocks(
              node.id,
              args.after === 'top' ? null : (args.after as string),
              blocks,
              expectOf(args),
            );
      const added = (saved.blocks ?? []).filter((b) => !before.has(b.id)).map((b) => b.id);
      return {
        value: { id: node.id, revision: saved.revision, blocks: added },
        entityType: 'spaceNode',
        entityId: node.id,
        changes: [
          {
            summary: `Added ${added.length} blocks to “${node.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [op('space', 'deleteBlocks', node.id, added)],
          },
        ],
      };
    },
  },
  {
    name: 'replace_space_blocks',
    title: 'Replace SPACE blocks',
    capability: 'space.write',
    action: 'rewrite part of a SPACE page',
    description:
      'Replaces a run of consecutive blocks (from one block id to another, inclusive) with new Markdown: change a section without rewriting the page.',
    write: true,
    input: z.strictObject({
      page: pageArg(),
      from: text(200),
      to: text(200),
      markdown: text(200_000),
      baseRevision: revisionArg(),
    }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.page as string);
      const old = blocksOf(node);
      const from = old.findIndex((b) => b.id === args.from);
      const to = old.findIndex((b) => b.id === args.to);
      if (from < 0 || to < 0) throw new Refusal('Both block ids must be on the page');
      const before = new Set(old.map((b) => b.id));
      const saved = await env
        .repos()
        .space.replaceBlocks(
          node.id,
          args.from as string,
          args.to as string,
          checkMarkdown(args.markdown as string),
          expectOf(args),
        );
      const added = (saved.blocks ?? []).filter((b) => !before.has(b.id)).map((b) => b.id);
      const removed = old.slice(from, to + 1).map((b) => {
        const copy = { ...b } as NewSpaceBlock;
        delete copy.by;
        return copy;
      });
      return {
        value: { id: node.id, revision: saved.revision, blocks: added },
        entityType: 'spaceNode',
        entityId: node.id,
        changes: [
          {
            summary: `Rewrote part of “${node.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            ...(added.length
              ? {
                  undo: [op('space', 'replaceBlocks', node.id, added[0], added.at(-1), removed)],
                  guard: guardRevision(saved),
                }
              : {}),
          },
        ],
      };
    },
  },
  {
    name: 'delete_space_blocks',
    title: 'Delete SPACE blocks',
    capability: 'space.write',
    action: 'delete SPACE blocks',
    description:
      'Removes blocks from a page by id. Imported content kept as it was can’t be removed.',
    write: true,
    input: z.strictObject({
      page: pageArg(),
      blocks: z.array(text(200)).check(z.minLength(1), z.maxLength(500)),
      baseRevision: revisionArg(),
    }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.page as string);
      const old = blocksOf(node);
      const ids = new Set(args.blocks as string[]);
      const saved = await env.repos().space.deleteBlocks(node.id, [...ids], expectOf(args));
      // Undo puts the removed blocks back, in order, after what preceded them.
      const undo = [];
      let anchor: string | null = null;
      for (const b of old) {
        if (ids.has(b.id)) {
          const copy = { ...b } as NewSpaceBlock;
          delete copy.by;
          undo.push(op('space', 'insertBlocks', node.id, anchor, [copy]));
        }
        anchor = b.id;
      }
      return {
        value: { id: node.id, revision: saved.revision },
        changes: [
          {
            summary: `Removed ${ids.size} blocks from “${node.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo,
            guard: guardRevision(saved),
          },
        ],
      };
    },
  },
  {
    name: 'move_space_block',
    title: 'Move SPACE block',
    capability: 'space.write',
    action: 'move a SPACE block',
    description: 'Moves one block after another block (or to the top).',
    write: true,
    input: z.strictObject({
      page: pageArg(),
      block: text(200),
      after: d(text(200), 'A block id, or "top".'),
    }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.page as string);
      const old = blocksOf(node);
      const index = old.findIndex((b) => b.id === args.block);
      if (index < 0) throw new Refusal('No such block on the page');
      const saved = await env
        .repos()
        .space.moveBlock(
          node.id,
          args.block as string,
          args.after === 'top' ? null : (args.after as string),
        );
      return {
        value: { id: node.id, revision: saved.revision },
        changes: [
          {
            summary: `Moved a block in “${node.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [op('space', 'moveBlock', node.id, args.block, old[index - 1]?.id ?? null)],
            guard: guardRevision(saved),
          },
        ],
      };
    },
  },
  {
    name: 'write_space_page',
    title: 'Write SPACE page',
    capability: 'space.write',
    action: 'rewrite a SPACE page',
    description:
      'Replaces a whole page’s content with Markdown. Needs the revision you read; for small changes prefer insert/replace/update of single blocks. Refused for pages with imported content kept as it was.',
    write: true,
    input: z.strictObject({
      page: pageArg(),
      markdown: z.string().check(z.maxLength(200_000)),
      baseRevision: z.number().check(z.int(), z.minimum(0)),
      title: z.optional(text(300)),
    }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.page as string);
      if (node.kind !== 'page') throw new Refusal('Only a page has content to write');
      const old = blocksOf(node);
      if (old.some((b) => b.type === 'fallback'))
        throw new Refusal(
          'This page holds imported content kept as it was; change it block by block instead',
        );
      const blocks = parseBody(args.markdown as string).map((b) => ({ ...b, id: b.id || newId() }));
      const saved = await env
        .repos()
        .space.saveContent(
          node.id,
          { blocks, ...(args.title ? { title: args.title as string } : {}) },
          args.baseRevision as number,
        );
      return {
        value: { id: node.id, revision: saved.revision },
        changes: [
          {
            summary: `Rewrote “${saved.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [
              op(
                'space',
                'saveContent',
                node.id,
                { title: node.title, blocks: old },
                {
                  $revision: node.id,
                },
              ),
            ],
            guard: guardRevision(saved),
          },
        ],
      };
    },
  },
  {
    name: 'unlink_space_entity',
    title: 'Unlink SPACE page',
    capability: 'space.write',
    action: 'unlink a SPACE page',
    description: 'Removes a link from a page to a record or page.',
    write: true,
    input: z.strictObject({ page: pageArg(), type: z.enum(LINKABLE_TYPES), id: text(200) }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.page as string);
      const link = node.links.find((l) => l.type === args.type && l.id === args.id);
      if (!link) throw new Refusal('That page has no such link');
      await env.repos().space.removeLink(node.id, link);
      return {
        value: { id: node.id },
        changes: [
          {
            summary: `Unlinked “${node.title}” from ${link.label ?? link.type}`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [op('space', 'addLink', node.id, link)],
          },
        ],
      };
    },
  },
  {
    name: 'get_backlinks',
    title: 'Get backlinks',
    capability: 'space.read',
    action: 'read backlinks',
    description: 'Pages that link to a page, or to a LOWTIDE record (type + id).',
    write: false,
    input: z.strictObject({
      page: z.optional(text(2000)),
      type: z.optional(z.enum(LINKABLE_TYPES)),
      id: z.optional(text(200)),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      let type = args.type as LinkableType | undefined;
      let target = args.id as string | undefined;
      if (args.page) {
        type = 'spaceNode';
        target = resolvePage(view, args.page as string).id;
      }
      if (!type || !target) throw new Refusal('Give a page, or a type and id');
      return {
        value: view.nodes
          .filter(
            (n) =>
              !n.archived &&
              view.visible(n) &&
              n.id !== target &&
              linksOf(n).some((l) => l.type === type && l.id === target),
          )
          .map((n) => ({ id: n.id, title: n.title, path: pathText(view, n.id) })),
      };
    },
  },
  {
    name: 'list_space_templates',
    title: 'List SPACE templates',
    capability: 'space.read',
    action: 'read SPACE templates',
    description:
      'The templates in LOWTIDE / Templates (pages and databases to start new ones from).',
    write: false,
    input: z.strictObject({}),
    async run(env) {
      const view = await spaceView(env);
      const folder = view.nodes.find((n) => n.key === 'lowtide:templates');
      return {
        value: (folder ? (view.children.get(folder.id) ?? []) : [])
          .filter((n) => !n.archived)
          .map((n) => ({ id: n.id, title: n.title, kind: kindName(n) })),
      };
    },
  },
  {
    name: 'apply_space_template',
    title: 'Apply SPACE template',
    capability: 'space.write',
    action: 'create a page from a template',
    description:
      'Makes a new page (or database, without its rows) from a template, inside a folder or page.',
    write: true,
    input: z.strictObject({
      template: d(text(2000), 'Template id or title (list_space_templates).'),
      parent: pageArg(),
      title: z.optional(text(300)),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const folder = view.nodes.find((n) => n.key === 'lowtide:templates');
      const candidates = folder
        ? (view.children.get(folder.id) ?? []).filter((n) => !n.archived)
        : [];
      const template =
        candidates.find((n) => n.id === args.template) ??
        candidates.find((n) => titleEq(n.title, args.template as string)) ??
        resolvePage(view, args.template as string);
      const parent = container(view, args.parent as string);
      const page = await env
        .repos()
        .space.applyTemplate(template.id, parent.id, args.title as string | undefined);
      return {
        value: {
          id: page.id,
          title: page.title,
          path: `${pathText(view, parent.id)} / ${page.title}`,
        },
        entityType: 'spaceNode',
        entityId: page.id,
        changes: [
          {
            summary: `Created “${page.title}” from the ${template.title} template`,
            entityType: 'spaceNode',
            entityId: page.id,
            undo: [op('space', 'archive', page.id)],
          },
        ],
      };
    },
  },
  {
    name: 'export_space',
    title: 'Export SPACE',
    capability: 'space.read',
    action: 'export SPACE',
    description:
      'A page as Markdown, a database as CSV (computed values included), or a folder with everything in it as Markdown and CSV files (path → content).',
    write: false,
    input: z.strictObject({
      page: pageArg(),
      format: d(z.optional(z.enum(['markdown', 'csv'])), 'csv for databases (default).'),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const data = await env.data();
      const ctx = { related: relatedFrom(data) };
      const node = resolvePage(view, args.page as string);
      if (node.table && args.format !== 'markdown') return { value: tableToCsv(node.table, ctx) };
      if (node.kind !== 'section')
        return { value: `# ${node.title}\n\n${blocksToMarkdown(blocksOf(node))}` };
      const files: Record<string, string> = {};
      const walk = (n: SpaceNode, prefix: string) => {
        for (const c of view.children.get(n.id) ?? []) {
          if (c.archived || !view.visible(c)) continue;
          const name = `${prefix}${c.title.replace(/[\\/:*?"<>|]/g, '-')}`;
          if (c.table) files[`${name}.csv`] = tableToCsv(c.table, ctx);
          else if (c.kind === 'page')
            files[`${name}.md`] = `# ${c.title}\n\n${blocksToMarkdown(blocksOf(c))}`;
          walk(c, `${name}/`);
        }
      };
      walk(node, '');
      return { value: { folder: pathText(view, node.id), files } };
    },
  },
  {
    name: 'import_space',
    title: 'Import into SPACE',
    capability: 'space.write',
    action: 'import into SPACE',
    description:
      'Makes a page from Markdown or plain text, or a database from CSV (first row: property names; every property starts as text).',
    write: true,
    input: z.strictObject({
      parent: pageArg(),
      title: text(300),
      markdown: z.optional(z.string().check(z.maxLength(200_000))),
      csv: z.optional(z.string().check(z.maxLength(5_000_000))),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const parent = container(view, args.parent as string);
      const repos = env.repos();
      let node: SpaceNode;
      if (args.csv !== undefined) {
        const [head, ...rows] = parseCsv(args.csv as string);
        if (!head?.length) throw new Refusal('The CSV has no header row');
        if (rows.length > 10_000)
          throw new Refusal('That’s more than 10,000 rows; import it in parts');
        const columns = head.map((name, i) => ({
          id: `c${i + 1}`,
          name: name.trim() || `Column ${i + 1}`,
          type: 'text' as const,
        }));
        node = await repos.space.create({
          parentId: parent.id,
          title: args.title as string,
          table: {
            columns,
            rows: rows.map((r) => ({
              id: newId(),
              cells: Object.fromEntries(
                columns.flatMap((c, i) => (r[i]?.trim() ? [[c.id, r[i]!]] : [])),
              ),
            })),
          },
        });
      } else {
        node = await repos.space.create({
          parentId: parent.id,
          title: args.title as string,
          blocks: args.markdown ? parseBody(args.markdown as string) : [],
        });
      }
      return {
        value: {
          id: node.id,
          title: node.title,
          kind: kindName(node),
          ...(node.table ? { rows: node.table.rows.length } : {}),
        },
        entityType: 'spaceNode',
        entityId: node.id,
        changes: [
          {
            summary: `Imported “${node.title}” into ${pathText(view, parent.id)}`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [op('space', 'archive', node.id)],
          },
        ],
      };
    },
  },
];

/* ------------------------------ databases ------------------------------- */

const tableOf = (node: SpaceNode) => {
  if (!node.table) throw new Refusal(`“${node.title}” isn’t a database`);
  return node.table;
};

const spaceDatabaseTools: Tool[] = [
  {
    name: 'create_space_table',
    title: 'Create SPACE database',
    capability: 'space.write',
    action: 'create a SPACE database',
    description:
      'Makes a database (a typed table) inside a folder or page: properties, optional first rows (by property name) and saved views (table, board, list, calendar). If one with this title is already there, returns it.',
    write: true,
    input: z.strictObject({
      parent: pageArg(),
      title: text(300),
      description: z.optional(text(2000)),
      properties: z.array(propertyInput).check(z.minLength(1), z.maxLength(100)),
      rows: z.optional(z.array(z.record(z.string(), z.unknown())).check(z.maxLength(1000))),
      views: z.optional(z.array(z.strictObject(viewInput)).check(z.maxLength(20))),
    }),
    async run(env, args) {
      const view = await spaceView(env);
      const parent = container(view, args.parent as string);
      const existing = (view.children.get(parent.id) ?? []).find(
        (n) => !n.archived && n.kind === 'table' && titleEq(n.title, args.title as string),
      );
      if (existing)
        return {
          value: {
            existing: true,
            id: existing.id,
            note: 'A database with this title is already there; nothing was created.',
          },
        };
      const columns: SpaceColumn[] = [];
      for (const [i, p] of (args.properties as PropertyInput[]).entries()) {
        columns.push({ id: `c${i + 1}`, ...columnFrom(columns, p) });
      }
      const repos = env.repos();
      const node = await env.atomic(async () => {
        let made = await repos.space.create({
          parentId: parent.id,
          title: args.title as string,
          ...(args.description ? { description: args.description as string } : {}),
          table: { columns, rows: [] },
        });
        for (const row of (args.rows as Record<string, unknown>[] | undefined) ?? []) {
          const { cells, widen } = await cellsFor(env, made, row);
          made = await widenOptions(env, made, widen);
          made = await repos.space.addRow(made.id, storedCells(cells));
        }
        for (const v of (args.views as Record<string, unknown>[] | undefined) ?? [])
          made = await repos.space.saveView(made.id, viewFrom(made, v));
        return made;
      });
      return {
        value: {
          id: node.id,
          title: node.title,
          properties: node.table!.columns.map((c) => ({ id: c.id, name: c.name, type: c.type })),
          rows: node.table!.rows.length,
          views: (node.table!.views ?? []).map((v) => v.name),
        },
        entityType: 'spaceNode',
        entityId: node.id,
        changes: [
          {
            summary: `Created database “${node.title}” in ${pathText(view, parent.id)}`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [op('space', 'archive', node.id)],
          },
        ],
      };
    },
  },
  {
    name: 'update_space_table',
    title: 'Update SPACE database',
    capability: 'space.write',
    action: 'update a SPACE database',
    description: 'Renames a database or changes its description or icon (empty clears).',
    write: true,
    input: z.strictObject({
      table: pageArg(),
      title: z.optional(text(300)),
      description: z.optional(z.string().check(z.maxLength(2000))),
      icon: z.optional(z.string().check(z.maxLength(64))),
    }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.table as string);
      tableOf(node);
      const changes: Record<string, string | null> = {};
      if (args.title !== undefined) changes.title = args.title as string;
      if (args.description !== undefined)
        changes.description = (args.description as string) || null;
      if (args.icon !== undefined) changes.icon = (args.icon as string) || null;
      if (!Object.keys(changes).length) throw new Refusal('Nothing to change');
      const saved = await env.repos().space.update(node.id, changes);
      return {
        value: { id: node.id, title: saved.title },
        changes: [
          {
            summary: `Updated database “${saved.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [
              op(
                'space',
                'update',
                node.id,
                Object.fromEntries(
                  Object.keys(changes).map((k) => [
                    k,
                    (node as unknown as Record<string, unknown>)[k] ?? null,
                  ]),
                ),
              ),
            ],
            guard: guardRevision(saved),
          },
        ],
      };
    },
  },
  {
    name: 'add_space_table_column',
    title: 'Add database property',
    capability: 'space.write',
    action: 'add a database property',
    description:
      'Adds a property to a database (last, or at a position counted from 1): text, number, checkbox (boolean), date, status, select, multiSelect, url, relation (link), created/updated time and by, rollup or formula.',
    write: true,
    input: z.strictObject({
      table: pageArg(),
      property: propertyInput,
      position: z.optional(z.number().check(z.int(), z.minimum(1))),
      baseRevision: revisionArg(),
    }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.table as string);
      const table = tableOf(node);
      const def = columnFrom(table.columns, args.property as PropertyInput);
      const saved = await env
        .repos()
        .space.addColumn(
          node.id,
          def,
          args.position !== undefined ? (args.position as number) - 1 : undefined,
          expectOf(args),
        );
      const added = saved.table!.columns.find((c) => !table.columns.some((o) => o.id === c.id))!;
      return {
        value: { id: node.id, property: { id: added.id, name: added.name, type: added.type } },
        changes: [
          {
            summary: `Added property “${added.name}” (${added.type}) to “${node.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [op('space', 'removeColumn', node.id, added.id)],
          },
        ],
      };
    },
  },
  {
    name: 'update_space_table_column',
    title: 'Update database property',
    capability: 'space.write',
    action: 'change a database property',
    description:
      'Renames a property or changes its type, options, relation targets, rollup or formula. A type change converts every value, or is refused if any value would be lost.',
    write: true,
    input: z.strictObject({
      table: pageArg(),
      property: d(text(200), 'Property name or id.'),
      name: z.optional(text(200)),
      type: z.optional(z.enum(SPACE_COLUMN_TYPES)),
      options: z.optional(z.array(text(200)).check(z.maxLength(200))),
      targets: z.optional(z.array(z.enum(LINKABLE_TYPES))),
      rollup: z.optional(rollupInput),
      formula: z.optional(text(2000)),
      baseRevision: revisionArg(),
    }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.table as string);
      const table = tableOf(node);
      const column = columnOf(node, args.property as string);
      const changes: Partial<Omit<SpaceColumn, 'id'>> = {};
      if (args.name !== undefined) changes.name = args.name as string;
      if (args.type !== undefined) changes.type = args.type as SpaceColumn['type'];
      if (args.options !== undefined)
        changes.options = (args.options as string[]).map((name) => {
          const color = column.options?.find((o) => o.name === name)?.color;
          return { name, ...(color ? { color } : {}) };
        });
      if (args.targets !== undefined) changes.targets = args.targets as LinkableType[];
      if (args.rollup !== undefined) {
        const r = args.rollup as { relation: string; fn: RollupFunction; property?: string };
        const relation = columnOf(node, r.relation);
        if (relation.type !== 'link') throw new Refusal(`“${relation.name}” isn’t a relation`);
        changes.rollup = {
          relation: relation.id,
          fn: r.fn,
          ...(r.property ? { property: r.property } : {}),
        };
      }
      if (args.formula !== undefined) {
        const problem = formulaProblem(
          args.formula as string,
          table.columns.filter((c) => c.id !== column.id),
        );
        if (problem) throw new Refusal(`That formula can’t be used: ${problem}`);
        changes.formula = args.formula as string;
      }
      if (!Object.keys(changes).length) throw new Refusal('Nothing to change');
      const saved = await env
        .repos()
        .space.updateColumn(node.id, column.id, changes, expectOf(args));
      const prior = Object.fromEntries(
        Object.keys(changes).map((k) => [k, (column as unknown as Record<string, unknown>)[k]]),
      );
      return {
        value: { id: node.id, property: saved.table!.columns.find((c) => c.id === column.id) },
        changes: [
          {
            summary: `Changed property “${column.name}” of “${node.title}”: ${Object.keys(changes).join(', ')}`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [op('space', 'updateColumn', node.id, column.id, prior)],
            guard: guardRevision(saved),
          },
        ],
      };
    },
  },
  {
    name: 'remove_space_table_column',
    title: 'Remove database property',
    capability: 'space.write',
    action: 'remove a database property',
    dryRun: true,
    description: 'Removes a property and its values (undoable). Preview with dryRun.',
    write: true,
    input: z.strictObject({ table: pageArg(), property: text(200), dryRun: dryRunArg() }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.table as string);
      const table = tableOf(node);
      const column = columnOf(node, args.property as string);
      const position = table.columns.findIndex((c) => c.id === column.id);
      const saved = await env.repos().space.removeColumn(node.id, column.id);
      const restore = table.rows
        .filter((r) => r.cells[column.id] !== undefined)
        .map((r) => op('space', 'updateRow', node.id, r.id, { [column.id]: r.cells[column.id] }));
      return {
        value: { id: node.id, removed: column.name },
        changes: [
          {
            summary: `Removed property “${column.name}” from “${node.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [op('space', 'addColumn', node.id, column, position), ...restore],
            guard: guardRevision(saved),
          },
        ],
      };
    },
  },
  {
    name: 'add_space_table_rows',
    title: 'Add database rows',
    capability: 'space.write',
    action: 'add database rows',
    description:
      'Adds rows to a database, cells by property name. Relations take "task:<id or title>", "milestone:…", "project:…", "decision:…", "hackathon:…" or "spaceNode:<page>#<row id>". New select values become options.',
    write: true,
    input: z.strictObject({
      table: pageArg(),
      rows: z.array(z.record(z.string(), z.unknown())).check(z.minLength(1), z.maxLength(1000)),
    }),
    async run(env, args) {
      let node = resolvePage(await spaceView(env), args.table as string);
      const before = new Set(tableOf(node).rows.map((r) => r.id));
      const repos = env.repos();
      node = await env.atomic(async () => {
        let n = node;
        for (const row of args.rows as Record<string, unknown>[]) {
          const { cells, widen } = await cellsFor(env, n, row);
          n = await widenOptions(env, n, widen);
          n = await repos.space.addRow(n.id, storedCells(cells));
        }
        return n;
      });
      const added = node.table!.rows.filter((r) => !before.has(r.id)).map((r) => r.id);
      return {
        value: { id: node.id, rows: added },
        changes: [
          {
            summary: `Added ${added.length} rows to “${node.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: added.map((r) => op('space', 'deleteRow', node.id, r)),
          },
        ],
      };
    },
  },
  {
    name: 'update_space_table_row',
    title: 'Update database row',
    capability: 'space.write',
    action: 'update a database row',
    description:
      'Changes cells of one row (by row id, or its title in the first text property); null or "" empties a cell.',
    write: true,
    input: z.strictObject({
      table: pageArg(),
      row: text(500),
      cells: z.record(z.string(), z.unknown()),
      baseRevision: revisionArg(),
    }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.table as string);
      tableOf(node);
      const row = rowOf(node, args.row as string);
      const { cells, widen } = await cellsFor(env, node, args.cells as Record<string, unknown>);
      const saved = await env.atomic(async () => {
        await widenOptions(env, node, widen);
        return env.repos().space.updateRow(node.id, row.id, cells, expectOf(args));
      });
      const prior = Object.fromEntries(Object.keys(cells).map((k) => [k, row.cells[k] ?? null]));
      return {
        value: { id: node.id, row: row.id, revision: saved.revision },
        changes: [
          {
            summary: `Updated a row of “${node.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [op('space', 'updateRow', node.id, row.id, prior)],
            guard: guardRevision(saved),
          },
        ],
      };
    },
  },
  {
    name: 'delete_space_table_row',
    title: 'Delete database row',
    capability: 'space.write',
    action: 'delete a database row',
    description: 'Removes one row (undoable from the AI area).',
    write: true,
    input: z.strictObject({ table: pageArg(), row: text(500) }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.table as string);
      const table = tableOf(node);
      const row = rowOf(node, args.row as string);
      const index = table.rows.findIndex((r) => r.id === row.id);
      await env.repos().space.deleteRow(node.id, row.id);
      return {
        value: { id: node.id, deleted: row.id },
        changes: [
          {
            summary: `Removed a row from “${node.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [op('space', 'addRow', node.id, row.cells, { rowId: row.id, index })],
          },
        ],
      };
    },
  },
  {
    name: 'query_space_table',
    title: 'Query SPACE database',
    capability: 'space.read',
    action: 'query a SPACE database',
    description:
      'Rows of a database with every value (computed ones too), through a saved view or your own filters, sorts and grouping. Filter ops: contains, is, isNot, isEmpty, isNotEmpty, gt, lt, before, after, checked, unchecked.',
    write: false,
    input: z.strictObject({
      table: pageArg(),
      view: d(z.optional(text(200)), 'A saved view (name or id).'),
      filters: viewInput.filters,
      sorts: viewInput.sorts,
      groupBy: viewInput.groupBy,
      limit: limitArg(100),
    }),
    async run(env, args) {
      const data = await env.data();
      const node = resolvePage(await spaceView(env), args.table as string);
      const table = tableOf(node);
      const saved = args.view
        ? table.views?.find((v) => v.id === args.view || titleEq(v.name, args.view as string))
        : undefined;
      if (args.view && !saved)
        throw new Refusal(`“${node.title}” has no view “${String(args.view)}”`);
      const adhoc = viewFrom(node, {
        ...(args.filters ? { filters: args.filters } : {}),
        ...(args.sorts ? { sorts: args.sorts } : {}),
        ...(args.groupBy ? { groupBy: args.groupBy } : {}),
      });
      const v: Partial<DbView> = {
        ...(saved ?? {}),
        ...(adhoc.filters ? { filters: adhoc.filters } : {}),
        ...(adhoc.sorts ? { sorts: adhoc.sorts } : {}),
        ...(adhoc.groupBy ? { groupBy: adhoc.groupBy } : {}),
      };
      const ctx = { related: relatedFrom(data), today: env.at.toISOString().slice(0, 10) };
      const result = applyView(table, v, ctx);
      const limit = (args.limit as number | undefined) ?? 100;
      return {
        value: {
          table: node.title,
          ...(saved ? { view: saved.name } : {}),
          total: result.rows.length,
          rows: result.rows.slice(0, limit).map((r) => ({
            id: r.id,
            ...Object.fromEntries(result.columns.map((c) => [c.name, valueOf(table, r, c, ctx)])),
          })),
          ...(result.groups
            ? {
                groups: result.groups.map((g) => ({
                  group: g.key || '(none)',
                  count: g.rows.length,
                })),
              }
            : {}),
        },
      };
    },
  },
  {
    name: 'save_space_view',
    title: 'Save database view',
    capability: 'space.write',
    action: 'save a database view',
    description:
      'Adds or replaces (by name) a saved view of a database: table, board (grouped by a select/status), list or calendar (by a date), with filters, sorts, hidden properties and property order. Views never copy rows.',
    write: true,
    input: z.strictObject({ table: pageArg(), ...viewInput }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.table as string);
      const table = tableOf(node);
      const existing = table.views?.find((v) => titleEq(v.name, args.name as string));
      const saved = await env
        .repos()
        .space.saveView(
          node.id,
          viewFrom(node, { ...args, ...(existing ? { id: existing.id } : {}) }),
        );
      const v = saved.table!.views!.find((x) => titleEq(x.name, args.name as string))!;
      return {
        value: { id: node.id, view: { id: v.id, name: v.name, type: v.type } },
        changes: [
          {
            summary: `Saved the ${v.type} view “${v.name}” of “${node.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [
              existing
                ? op('space', 'saveView', node.id, existing)
                : op('space', 'removeView', node.id, v.id),
            ],
          },
        ],
      };
    },
  },
  {
    name: 'remove_space_view',
    title: 'Remove database view',
    capability: 'space.write',
    action: 'remove a database view',
    description: 'Removes a saved view (the rows are untouched).',
    write: true,
    input: z.strictObject({ table: pageArg(), view: text(200) }),
    async run(env, args) {
      const node = resolvePage(await spaceView(env), args.table as string);
      const v = tableOf(node).views?.find(
        (x) => x.id === args.view || titleEq(x.name, args.view as string),
      );
      if (!v) throw new Refusal('No such view');
      await env.repos().space.removeView(node.id, v.id);
      return {
        value: { id: node.id },
        changes: [
          {
            summary: `Removed the view “${v.name}” of “${node.title}”`,
            entityType: 'spaceNode',
            entityId: node.id,
            undo: [op('space', 'saveView', node.id, v)],
          },
        ],
      };
    },
  },
];

export const spaceOperatorTools: Tool[] = [
  ...spaceStructureTools,
  ...spaceContentTools,
  ...spaceDatabaseTools,
];
