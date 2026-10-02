import { ArrowDown, ArrowUp, ChevronsUpDown, Plus } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { useRepositories } from '../../hooks/useRepositories';
import type {
  EntityLink,
  SpaceCellValue,
  SpaceColumn,
  SpaceNode,
  SpaceRow,
} from '../../types/domain';
import { useSpaceData } from './context';

/*
 * SPACE tables (v2 PHASE 014): typed columns from the import, sortable,
 * filterable and editable in place where that is safe (text, numbers, yes/no,
 * dates, choices). Multi-choice and link cells are shown, not edited here.
 * Long tables show their first rows until asked for the rest.
 */

const PAGE = 100;
const COMPACT = 8;
const EDITABLE = new Set<SpaceColumn['type']>([
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'status',
  'url',
]);

type Sort = { column: string; dir: 1 | -1 } | null;

const display = (v: SpaceCellValue | undefined): string =>
  v === undefined
    ? ''
    : typeof v === 'boolean'
      ? v
        ? 'Yes'
        : 'No'
      : Array.isArray(v)
        ? v.map((x) => (typeof x === 'string' ? x : (x.label ?? x.type))).join(', ')
        : String(v);

function compare(a: SpaceCellValue | undefined, b: SpaceCellValue | undefined): number {
  if (a === undefined) return b === undefined ? 0 : 1;
  if (b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return display(a).localeCompare(display(b), undefined, { numeric: true });
}

export function TableView({ tableId, compact = false }: { tableId: string; compact?: boolean }) {
  const { index } = useSpaceData();
  const node = index.byId.get(tableId);
  if (!node?.table) return <p className="text-sm text-fg-muted">This table no longer exists.</p>;
  return <Table node={node} compact={compact} />;
}

function Table({ node, compact }: { node: SpaceNode; compact: boolean }) {
  const { space } = useRepositories();
  const table = node.table!;
  const [sort, setSort] = useState<Sort>(null);
  const [filter, setFilter] = useState('');
  const [choice, setChoice] = useState<{ column: string; value: string } | null>(null);
  const [limit, setLimit] = useState(compact ? COMPACT : PAGE);
  const [error, setError] = useState<string | null>(null);
  const ids = { filter: useId(), choice: useId() };
  const choiceColumns = table.columns.filter(
    (c) => (c.type === 'select' || c.type === 'status') && c.options?.length,
  );

  const [wrap, setWrap] = useState<'compact' | 'full'>('compact');
  // Column widths from their content: prose gets room, short values stay narrow.
  const widths = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of table.columns) {
      let longest = c.name.length;
      for (const r of table.rows) longest = Math.max(longest, display(r.cells[c.id]).length);
      out[c.id] =
        longest > 120 ? '22rem' : longest > 50 ? '16rem' : longest > 20 ? '10rem' : '6rem';
    }
    return out;
  }, [table]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let out = table.rows.filter(
      (r) =>
        (!q || table.columns.some((c) => display(r.cells[c.id]).toLowerCase().includes(q))) &&
        (!choice || display(r.cells[choice.column]) === choice.value),
    );
    if (sort)
      out = [...out].sort((a, b) => compare(a.cells[sort.column], b.cells[sort.column]) * sort.dir);
    return out;
  }, [table, filter, choice, sort]);

  const run = (p: Promise<unknown>) =>
    p.then(
      () => setError(null),
      (e: unknown) =>
        setError(
          e instanceof Error && /wrong kind/.test(e.message)
            ? 'That value doesn’t fit this column.'
            : 'Couldn’t save that cell. Nothing changed.',
        ),
    );

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
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={ids.filter} className="sr-only">
              Filter rows
            </label>
            <input
              id={ids.filter}
              type="search"
              value={filter}
              placeholder="Filter rows"
              onChange={(e) => setFilter(e.target.value)}
              className="h-8 w-56 rounded-md border border-line bg-raised px-2.5 text-sm"
            />
          </div>
          {choiceColumns.length > 0 && (
            <div>
              <label htmlFor={ids.choice} className="sr-only">
                Show only
              </label>
              <select
                id={ids.choice}
                value={choice ? `${choice.column}\u0000${choice.value}` : ''}
                onChange={(e) => {
                  const [column, value] = e.target.value.split('\u0000');
                  setChoice(column && value !== undefined ? { column, value } : null);
                }}
                className="h-8 rounded-md border border-line bg-raised px-2 text-sm"
              >
                <option value="">All rows</option>
                {choiceColumns.map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    {c.options!.map((o) => (
                      <option key={o.name} value={`${c.id}\u0000${o.name}`}>
                        {o.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
          <span className="text-xs text-fg-muted" role="status">
            {rows.length === table.rows.length
              ? `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`
              : `${rows.length} of ${table.rows.length} rows`}
          </span>
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
          <Button size="sm" onClick={() => void run(space.addRow(node.id, {}))}>
            <Plus aria-hidden className="size-3.5" /> Add row
          </Button>
        </div>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div
        tabIndex={0}
        role="region"
        aria-label={`${node.title}, scrolls sideways`}
        className="overflow-x-auto rounded-md border border-line"
      >
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{node.title}</caption>
          <thead className="bg-surface">
            <tr>
              {table.columns.map((c) => {
                const active = sort?.column === c.id;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'}
                    style={{ minWidth: widths[c.id] }}
                    className={`px-3 py-2 font-medium whitespace-nowrap ${c === table.columns[0] && !compact ? 'sticky left-0 z-10 bg-surface' : ''}`}
                  >
                    {compact ? (
                      c.name
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setSort(
                            !active
                              ? { column: c.id, dir: 1 }
                              : sort!.dir === 1
                                ? { column: c.id, dir: -1 }
                                : null,
                          )
                        }
                        className="inline-flex items-center gap-1 hover:text-fg"
                      >
                        {c.name || 'Untitled'}
                        {active ? (
                          sort!.dir === 1 ? (
                            <ArrowUp aria-hidden className="size-3" />
                          ) : (
                            <ArrowDown aria-hidden className="size-3" />
                          )
                        ) : (
                          <ChevronsUpDown aria-hidden className="size-3 text-fg-subtle" />
                        )}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr key={r.id} className="border-t border-line hover:bg-hover/40">
                {table.columns.map((c, i) => (
                  <td
                    key={c.id}
                    style={{ minWidth: widths[c.id], maxWidth: '28rem' }}
                    className={`px-3 py-1.5 align-top ${wrap === 'compact' || compact ? '[&_.cell-text]:line-clamp-3' : ''} ${i === 0 && !compact ? 'sticky left-0 z-[1] bg-canvas' : ''}`}
                  >
                    <Cell
                      row={r}
                      column={c}
                      editable={!compact && EDITABLE.has(c.type)}
                      onSave={(value) => void run(space.setCell(node.id, r.id, c.id, value))}
                    />
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={table.columns.length} className="px-3 py-3 text-fg-muted">
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
    </div>
  );
}

function Cell({
  row,
  column,
  editable,
  onSave,
}: {
  row: SpaceRow;
  column: SpaceColumn;
  editable: boolean;
  onSave: (value: SpaceCellValue | null) => void;
}) {
  const { lookup } = useSpaceData();
  const value = row.cells[column.id];
  const [editing, setEditing] = useState(false);
  const label = `${column.name || 'Cell'}, row ${display(Object.values(row.cells)[0]).slice(0, 40)}`;

  if (column.type === 'link') {
    const links = (Array.isArray(value) ? value : []) as EntityLink[];
    return (
      <span className="flex flex-wrap gap-x-2">
        {links.map((l, i) => {
          const href = lookup.href(l);
          return href ? (
            <Link key={i} to={href} className="text-accent-ink hover:underline">
              {lookup.label(l)}
            </Link>
          ) : (
            <span key={i}>{lookup.label(l)}</span>
          );
        })}
      </span>
    );
  }
  if (column.type === 'boolean')
    return (
      <input
        type="checkbox"
        aria-label={label}
        checked={value === true}
        disabled={!editable}
        onChange={(e) => onSave(e.target.checked)}
        className="size-4"
      />
    );
  if (!editable) {
    if (column.type === 'url' && typeof value === 'string')
      return (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="text-accent-ink hover:underline"
        >
          {value}
        </a>
      );
    return (
      <span
        className="cell-text whitespace-pre-line"
        title={display(value).length > 120 ? display(value) : undefined}
      >
        {display(value)}
      </span>
    );
  }
  if ((column.type === 'select' || column.type === 'status') && column.options?.length) {
    return (
      <select
        aria-label={label}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onSave(e.target.value || null)}
        className="max-w-48 rounded border border-transparent bg-transparent py-0.5 text-sm hover:border-line"
      >
        <option value="">—</option>
        {column.options.map((o) => (
          <option key={o.name} value={o.name}>
            {o.name}
          </option>
        ))}
        {typeof value === 'string' && value && !column.options.some((o) => o.name === value) && (
          <option value={value}>{value}</option>
        )}
      </select>
    );
  }
  if (!editing)
    return (
      <button
        type="button"
        aria-label={`Edit ${label}`}
        onClick={() => setEditing(true)}
        className="block min-h-6 w-full rounded px-0.5 text-left whitespace-pre-line hover:bg-hover"
      >
        <span className="cell-text">
          {display(value) || <span className="text-fg-subtle"> </span>}
        </span>
      </button>
    );
  const type = column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text';
  return (
    <input
      autoFocus
      aria-label={label}
      type={type}
      defaultValue={
        column.type === 'date' && typeof value === 'string' ? value.slice(0, 10) : display(value)
      }
      onBlur={(e) => {
        setEditing(false);
        const raw = e.target.value.trim();
        const next: SpaceCellValue | null =
          raw === '' ? null : column.type === 'number' ? Number(raw) : raw;
        if (next !== (value ?? null)) onSave(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setEditing(false);
      }}
      className="w-full min-w-24 rounded border border-line bg-raised px-1.5 py-0.5 text-sm"
    />
  );
}
