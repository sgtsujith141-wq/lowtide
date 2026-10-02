import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronsUpDown,
  Columns3,
  List,
  MoreHorizontal,
  PanelRightOpen,
  Plus,
  SlidersHorizontal,
  Table2,
} from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Drawer } from '../../components/layout';
import { Button, IconButton } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { tabClass } from '../../components/ui/styles';
import { useRepositories } from '../../hooks/useRepositories';
import { applyView, valueOf, type DatabaseContext } from '../../lib/space-database';
import type {
  SpaceCellValue,
  SpaceColumn,
  SpaceNode,
  SpaceSort,
  SpaceTable,
  SpaceView,
  SpaceViewType,
} from '../../types/domain';
import { useSpaceData } from './context';
import { Cell } from './database/Cell';
import { BoardLayout, CalendarLayout, ListLayout, RowDrawer } from './database/layouts';
import {
  DEFAULT_VIEW,
  display,
  freshViewName,
  isChoice,
  isDateLike,
  rowTitle,
  TYPE_LABEL,
  VIEW_LABEL,
} from './database/model';
import { MenuItem, Popover } from './database/Popover';
import { PropertyForm } from './database/PropertyForm';
import { useDatabaseContext } from './database/useDatabaseContext';
import { ViewOptions } from './database/ViewOptions';

/*
 * SPACE databases (v2 PHASE 014, v2.1): typed properties (computed ones
 * included), saved views — table, board, list, calendar — with their own
 * filters, sorts, grouping and shown properties, rows edited in place or in
 * their details. Views never copy rows. Embedded in a page (`compact`), a
 * database shows its first view's first rows, read-only.
 */

const PAGE = 100;
const COMPACT = 8;

const VIEW_ICON: Record<SpaceViewType, typeof Table2> = {
  table: Table2,
  board: Columns3,
  list: List,
  calendar: CalendarDays,
};

/** A domain error's own words; anything else is a calm generic line. */
function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && /wrong kind/.test(error.message))
    return 'That value doesn’t fit this property.';
  if (
    error instanceof Error &&
    /^(RecordStateError|InvalidInputError|SpaceConflictError|RecordNotFoundError)$/.test(error.name)
  )
    return error.message;
  return fallback;
}

export function TableView({ tableId, compact = false }: { tableId: string; compact?: boolean }) {
  const { index } = useSpaceData();
  const node = index.byId.get(tableId);
  if (!node?.table) return <p className="text-sm text-fg-muted">This table no longer exists.</p>;
  return <Database node={node} compact={compact} />;
}

function Database({ node, compact }: { node: SpaceNode; compact: boolean }) {
  const { space } = useRepositories();
  const table = node.table!;
  const ctx = useDatabaseContext();
  const views = table.views ?? [];
  const [activeId, setActiveId] = useState<string | null>(null);
  const view =
    (compact ? views[0] : (views.find((v) => v.id === activeId) ?? views[0])) ?? DEFAULT_VIEW;
  const [filter, setFilter] = useState('');
  const [sortOverride, setSortOverride] = useState<SpaceSort | null>(null);
  const [limit, setLimit] = useState(compact ? COMPACT : PAGE);
  const [wrap, setWrap] = useState<'compact' | 'full'>('compact');
  const [error, setError] = useState<string | null>(null);
  const [property, setProperty] = useState<{ columnId?: string } | null>(null);
  const [options, setOptions] = useState(false);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addAnchor = useRef<HTMLButtonElement>(null);
  const ids = { filter: useId() };

  const run = (p: Promise<unknown>, fallback = 'Couldn’t save that. Nothing changed.') =>
    p.then(
      () => setError(null),
      (e: unknown) => setError(messageOf(e, fallback)),
    );

  const base = useMemo(
    () =>
      applyView(
        table,
        view.type === 'table' && sortOverride ? { ...view, sorts: [sortOverride] } : view,
        ctx,
      ),
    [table, view, sortOverride, ctx],
  );
  const result = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return base;
    const keep = (r: (typeof base.rows)[number]) =>
      table.columns.some((c) =>
        display(valueOf(table, r, c, ctx))
          .toLowerCase()
          .includes(q),
      );
    return {
      ...base,
      rows: base.rows.filter(keep),
      ...(base.groups
        ? { groups: base.groups.map((g) => ({ ...g, rows: g.rows.filter(keep) })) }
        : {}),
    };
  }, [base, filter, table, ctx]);

  /** Saves a view; the implicit default becomes a saved "Table" view the first time. */
  async function persist(next: SpaceView) {
    const before = new Set(views.map((v) => v.id));
    const draft: Omit<SpaceView, 'id'> & { id?: string } = { ...next };
    if (next.id === DEFAULT_VIEW.id) delete draft.id;
    const saved = await space.saveView(node.id, draft);
    const made = saved.table?.views?.find((v) => !before.has(v.id));
    if (made) setActiveId(made.id);
  }

  async function addView(type: SpaceViewType) {
    setAdding(false);
    const groupBy = table.columns.find(isChoice)?.id;
    const dateColumn = table.columns.find(isDateLike)?.id;
    await run(
      persist({
        id: DEFAULT_VIEW.id,
        name: freshViewName(views, VIEW_LABEL[type]),
        type,
        ...(type === 'board' && groupBy ? { groupBy } : {}),
        ...(type === 'calendar' && dateColumn ? { dateColumn } : {}),
      }),
    );
  }

  const setCell = (rowId: string, columnId: string, value: SpaceCellValue | null) =>
    void run(
      space.setCell(node.id, rowId, columnId, value),
      'Couldn’t save that cell. Nothing changed.',
    );
  const addOption = (columnId: string, name: string) => {
    const column = table.columns.find((c) => c.id === columnId)!;
    if ((column.options ?? []).some((o) => o.name === name)) return Promise.resolve();
    return space.updateColumn(node.id, columnId, {
      options: [...(column.options ?? []), { name }],
    });
  };
  const addRow = (cells: Record<string, SpaceCellValue> = {}) =>
    void run(space.addRow(node.id, cells));
  const openRow = table.rows.find((r) => r.id === openRowId);
  const editable = !compact;
  const filtered = result.rows.length !== table.rows.length;
  const layout = {
    table,
    view,
    result,
    ctx,
    editable,
    openRow: setOpenRowId,
    addRow,
    setCell,
  };

  return (
    <div className="min-w-0">
      {compact ? (
        <p className="mb-2 flex items-baseline justify-between gap-3 text-sm">
          <Link to={`/space/${node.id}`} className="font-medium hover:underline">
            {node.title}
          </Link>
          <span className="text-xs text-fg-muted">
            {table.rows.length} {table.rows.length === 1 ? 'row' : 'rows'}
          </span>
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-end gap-1 border-b border-line">
            <div role="tablist" aria-label="Views" className="flex min-w-0 flex-wrap">
              {(views.length ? views : [DEFAULT_VIEW]).map((v) => {
                const Icon = VIEW_ICON[v.type];
                return (
                  <button
                    key={v.id}
                    type="button"
                    role="tab"
                    aria-selected={v.id === view.id}
                    onClick={() => {
                      setActiveId(v.id);
                      setSortOverride(null);
                    }}
                    className={tabClass(v.id === view.id)}
                  >
                    <Icon aria-hidden className="mr-1.5 size-3.5" />
                    {v.name}
                  </button>
                );
              })}
            </div>
            <Button
              ref={addAnchor}
              size="sm"
              variant="ghost"
              className="mb-1"
              aria-haspopup="menu"
              aria-expanded={adding}
              onClick={() => setAdding((a) => !a)}
            >
              <Plus aria-hidden className="size-3.5" /> View
            </Button>
            <Popover
              anchor={addAnchor}
              open={adding}
              onClose={() => setAdding(false)}
              label="New view"
            >
              {(['table', 'board', 'list', 'calendar'] as const).map((t) => {
                const Icon = VIEW_ICON[t];
                return (
                  <MenuItem key={t} onClick={() => void addView(t)}>
                    <Icon aria-hidden className="size-3.5" /> {VIEW_LABEL[t]} view
                  </MenuItem>
                );
              })}
            </Popover>
            <Button
              size="sm"
              variant="ghost"
              className="mb-1 ml-auto"
              onClick={() => setOptions(true)}
            >
              <SlidersHorizontal aria-hidden className="size-3.5" /> View options
            </Button>
          </div>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div className="max-w-full">
              <label htmlFor={ids.filter} className="sr-only">
                Filter rows
              </label>
              <input
                id={ids.filter}
                type="search"
                value={filter}
                placeholder="Filter rows"
                onChange={(e) => setFilter(e.target.value)}
                className="h-8 w-56 max-w-full rounded-md border border-line bg-raised px-2.5 text-sm"
              />
            </div>
            <span className="text-xs text-fg-muted" role="status">
              {filtered
                ? `${result.rows.length} of ${table.rows.length} rows`
                : `${result.rows.length} ${result.rows.length === 1 ? 'row' : 'rows'}`}
            </span>
            {view.type === 'table' && (
              <label className="ml-auto flex items-center gap-1.5 text-xs text-fg-muted">
                Rows
                <select
                  aria-label="Rows"
                  value={wrap}
                  onChange={(e) => setWrap(e.target.value as 'compact' | 'full')}
                  className="h-8 rounded-md border border-line bg-raised px-1.5 text-xs text-fg"
                >
                  <option value="compact">Compact</option>
                  <option value="full">Show full text</option>
                </select>
              </label>
            )}
            <Button
              size="sm"
              className={view.type === 'table' ? '' : 'ml-auto'}
              onClick={() => setProperty({})}
            >
              <Plus aria-hidden className="size-3.5" /> Property
            </Button>
            <Button size="sm" onClick={() => addRow()}>
              <Plus aria-hidden className="size-3.5" /> Add row
            </Button>
          </div>
        </>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}

      {view.type === 'board' ? (
        <BoardLayout {...layout} />
      ) : view.type === 'list' ? (
        <ListLayout {...layout} />
      ) : view.type === 'calendar' ? (
        <CalendarLayout {...layout} />
      ) : (
        <TableLayout
          node={node}
          table={table}
          view={view}
          columns={result.columns}
          rows={result.rows}
          ctx={ctx}
          compact={compact}
          wrap={wrap}
          limit={limit}
          setLimit={setLimit}
          sort={sortOverride}
          setSort={setSortOverride}
          setCell={setCell}
          addOption={addOption}
          openRow={setOpenRowId}
          editProperty={(columnId) => setProperty({ columnId })}
          persistView={(v) => void run(persist(v))}
          removeColumn={(columnId) => run(space.removeColumn(node.id, columnId))}
        />
      )}

      {editable && (
        <>
          <Drawer
            open={property !== null}
            onClose={() => setProperty(null)}
            title={property?.columnId ? 'Edit property' : 'New property'}
          >
            {property && (
              <PropertyForm
                key={property.columnId ?? 'new'}
                table={table}
                {...(property.columnId
                  ? { column: table.columns.find((c) => c.id === property.columnId)! }
                  : {})}
                onCancel={() => setProperty(null)}
                onSubmit={async (draft) => {
                  if (property.columnId)
                    await space.updateColumn(node.id, property.columnId, draft);
                  else await space.addColumn(node.id, draft);
                  setProperty(null);
                }}
              />
            )}
          </Drawer>
          <Drawer open={options} onClose={() => setOptions(false)} title={`${view.name} view`}>
            {options && (
              <ViewOptions
                key={view.id}
                table={table}
                view={view}
                onCancel={() => setOptions(false)}
                onSave={async (next) => {
                  await persist(next);
                  setOptions(false);
                }}
                {...(view.id !== DEFAULT_VIEW.id
                  ? {
                      onDelete: async () => {
                        await space.removeView(node.id, view.id);
                        setActiveId(null);
                        setOptions(false);
                      },
                    }
                  : {})}
              />
            )}
          </Drawer>
          <RowDrawer
            table={table}
            row={openRow}
            ctx={ctx}
            editable={editable}
            onClose={() => setOpenRowId(null)}
            setCell={setCell}
            addOption={addOption}
            deleteRow={(rowId) => run(space.deleteRow(node.id, rowId))}
          />
        </>
      )}
    </div>
  );
}

function TableLayout({
  node,
  table,
  view,
  columns,
  rows,
  ctx,
  compact,
  wrap,
  limit,
  setLimit,
  sort,
  setSort,
  setCell,
  addOption,
  openRow,
  editProperty,
  persistView,
  removeColumn,
}: {
  node: SpaceNode;
  table: SpaceTable;
  view: SpaceView;
  columns: SpaceColumn[];
  rows: SpaceTable['rows'];
  ctx: DatabaseContext;
  compact: boolean;
  wrap: 'compact' | 'full';
  limit: number;
  setLimit: (fn: (l: number) => number) => void;
  sort: SpaceSort | null;
  setSort: (sort: SpaceSort | null) => void;
  setCell: (rowId: string, columnId: string, value: SpaceCellValue | null) => void;
  addOption: (columnId: string, name: string) => Promise<unknown>;
  openRow: (rowId: string) => void;
  editProperty: (columnId: string) => void;
  persistView: (view: SpaceView) => void;
  removeColumn: (columnId: string) => Promise<unknown>;
}) {
  // Column widths from their content: prose gets room, short values stay narrow.
  const widths = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of columns) {
      let longest = c.name.length;
      for (const r of table.rows)
        longest = Math.max(longest, display(valueOf(table, r, c, ctx)).length);
      out[c.id] =
        longest > 120 ? '22rem' : longest > 50 ? '16rem' : longest > 20 ? '10rem' : '6rem';
    }
    return out;
  }, [table, columns, ctx]);
  const moveColumn = (id: string, by: -1 | 1) => {
    const shown = columns.map((c) => c.id);
    const all = [...shown, ...table.columns.map((c) => c.id).filter((c) => !shown.includes(c))];
    const at = all.indexOf(id);
    const next = all.filter((c) => c !== id);
    next.splice(Math.max(0, Math.min(at + by, next.length)), 0, id);
    persistView({ ...view, order: next });
  };

  return (
    <>
      <div
        tabIndex={0}
        role="region"
        aria-label={`${node.title}, scrolls sideways`}
        className="relative overflow-x-auto rounded-md border border-line"
      >
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{node.title}</caption>
          <thead className="bg-surface">
            <tr>
              {columns.map((c, i) => {
                const active = sort?.column === c.id;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    style={{ minWidth: widths[c.id] }}
                    className={`px-3 py-2 font-medium whitespace-nowrap ${i === 0 && !compact ? 'sticky left-0 z-10 bg-surface' : ''}`}
                  >
                    {compact ? (
                      c.name
                    ) : (
                      <span className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          title={TYPE_LABEL[c.type]}
                          onClick={() =>
                            setSort(
                              !active
                                ? { column: c.id, dir: 'asc' }
                                : sort!.dir === 'asc'
                                  ? { column: c.id, dir: 'desc' }
                                  : null,
                            )
                          }
                          className="inline-flex items-center gap-1 hover:text-fg"
                        >
                          {c.name || 'Untitled'}
                          {active ? (
                            sort!.dir === 'asc' ? (
                              <ArrowUp aria-hidden className="size-3" />
                            ) : (
                              <ArrowDown aria-hidden className="size-3" />
                            )
                          ) : (
                            <ChevronsUpDown aria-hidden className="size-3 text-fg-subtle" />
                          )}
                        </button>
                        <PropertyMenu
                          column={c}
                          first={i === 0}
                          last={i === columns.length - 1}
                          onEdit={() => editProperty(c.id)}
                          onHide={() =>
                            persistView({ ...view, hidden: [...(view.hidden ?? []), c.id] })
                          }
                          onMove={(by) => moveColumn(c.id, by)}
                          onDelete={() => removeColumn(c.id)}
                        />
                      </span>
                    )}
                  </th>
                );
              })}
              {!compact && (
                <th scope="col" className="w-10 px-1">
                  <span className="sr-only">Details</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => {
              const title = rowTitle(table, r);
              return (
                <tr key={r.id} className="border-t border-line hover:bg-hover/40">
                  {columns.map((c, i) => (
                    <td
                      key={c.id}
                      style={{ minWidth: widths[c.id], maxWidth: '28rem' }}
                      className={`px-3 py-1.5 align-top ${wrap === 'compact' || compact ? '[&_.cell-text]:line-clamp-3' : ''} ${i === 0 && !compact ? 'sticky left-0 z-[1] bg-canvas' : ''}`}
                    >
                      <Cell
                        table={table}
                        row={r}
                        column={c}
                        ctx={ctx}
                        editable={!compact}
                        label={`${c.name || 'Cell'}, row ${title.slice(0, 40)}`}
                        onSave={(value) => setCell(r.id, c.id, value)}
                        onAddOption={(name) => addOption(c.id, name)}
                      />
                    </td>
                  ))}
                  {!compact && (
                    <td className="px-1 py-1 align-top">
                      <IconButton
                        label={`Open ${title}`}
                        icon={<PanelRightOpen aria-hidden className="size-3.5" />}
                        onClick={() => openRow(r.id)}
                        className="size-7"
                      />
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-3 text-fg-muted">
                  {table.rows.length === 0 ? 'No rows yet.' : 'No rows match.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > limit &&
        (compact ? (
          <Link
            to={`/space/${node.id}`}
            className="mt-1.5 inline-block text-xs text-fg-muted hover:text-fg"
          >
            Open the table ({rows.length - limit} more rows)
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE)}
            className="mt-2 text-xs text-fg-muted hover:text-fg"
          >
            Show {Math.min(PAGE, rows.length - limit)} more rows
          </button>
        ))}
    </>
  );
}

/** A property's menu: edit, hide in this view, move, delete (after a confirmation). */
function PropertyMenu({
  column,
  first,
  last,
  onEdit,
  onHide,
  onMove,
  onDelete,
}: {
  column: SpaceColumn;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onHide: () => void;
  onMove: (by: -1 | 1) => void;
  onDelete: () => Promise<unknown>;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const close = () => {
    setOpen(false);
    setConfirming(false);
  };
  const act = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={`Options for ${column.name || 'property'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid size-6 place-items-center rounded text-fg-subtle hover:bg-hover hover:text-fg"
      >
        <MoreHorizontal aria-hidden className="size-3.5" />
      </button>
      <Popover anchor={anchor} open={open} onClose={close} label={`${column.name} options`}>
        {confirming ? (
          <>
            <p className="px-2 py-1.5 text-xs text-fg-muted">
              Delete “{column.name}” and every value in it?
            </p>
            <MenuItem danger onClick={() => void onDelete().then(close)}>
              Delete property
            </MenuItem>
            <MenuItem onClick={() => setConfirming(false)}>Keep it</MenuItem>
          </>
        ) : (
          <>
            <MenuItem onClick={act(onEdit)}>Edit property…</MenuItem>
            <MenuItem onClick={act(onHide)} disabled={first}>
              Hide in this view
            </MenuItem>
            <MenuItem onClick={act(() => onMove(-1))} disabled={first}>
              Move left
            </MenuItem>
            <MenuItem onClick={act(() => onMove(1))} disabled={last}>
              Move right
            </MenuItem>
            <MenuItem danger onClick={() => setConfirming(true)}>
              Delete property…
            </MenuItem>
          </>
        )}
      </Popover>
    </>
  );
}
