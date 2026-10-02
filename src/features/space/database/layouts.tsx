import { addMonths, endOfMonth, format, getISODay, startOfMonth } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useId, useState, type DragEvent } from 'react';
import { Drawer } from '../../../components/layout';
import { Button, IconButton } from '../../../components/ui/Button';
import { valueOf, type DatabaseContext, type ViewResult } from '../../../lib/space-database';
import type {
  SpaceCellValue,
  SpaceColumn,
  SpaceRow,
  SpaceTable,
  SpaceView,
} from '../../../types/domain';
import { Cell } from './Cell';
import { display, isDateLike, rowTitle } from './model';

/** Cards (or list lines) drawn per group before “Show more”: big databases stay quick. */
const CARDS = 50;
/** Rows shown in a calendar day before “+N more”. */
const PER_DAY = 4;

/** How many of each group's rows are shown, growing by CARDS on request. */
function useShown() {
  const [shown, setShown] = useState<Record<string, number>>({});
  return {
    limit: (key: string) => shown[key] ?? CARDS,
    more: (key: string) => setShown((s) => ({ ...s, [key]: (s[key] ?? CARDS) + CARDS })),
  };
}

function ShowMore({ total, limit, onMore }: { total: number; limit: number; onMore: () => void }) {
  if (total <= limit) return null;
  return (
    <Button size="sm" variant="ghost" className="mt-1 self-start" onClick={onMore}>
      Show {Math.min(CARDS, total - limit)} more ({total - limit} hidden)
    </Button>
  );
}

/*
 * The other ways to see a database (v2.1): a board grouped by a choice, a
 * compact list, and a month calendar by a date. Each reads the same rows a
 * table does; moving a card only changes that row's value.
 */

export interface LayoutProps {
  table: SpaceTable;
  view: SpaceView;
  result: ViewResult;
  ctx: DatabaseContext;
  editable: boolean;
  openRow: (rowId: string) => void;
  addRow: (cells: Record<string, SpaceCellValue>) => void;
  setCell: (rowId: string, columnId: string, value: SpaceCellValue | null) => void;
}

/** A few values of a row worth showing on a card or list line. */
function Chips({
  table,
  row,
  columns,
  ctx,
  skip,
}: {
  table: SpaceTable;
  row: SpaceRow;
  columns: SpaceColumn[];
  ctx: DatabaseContext;
  skip?: string | undefined;
}) {
  const shown = columns
    .filter((c) => c.id !== table.columns[0]?.id && c.id !== skip)
    .map((c) => [c, display(valueOf(table, row, c, ctx) as SpaceCellValue)] as const)
    .filter(([, v]) => v)
    .slice(0, 4);
  if (!shown.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {shown.map(([c, v]) => (
        <span key={c.id} className="rounded-sm bg-hover px-1.5 py-px text-[11px] text-fg-muted">
          <span className="sr-only">{c.name}: </span>
          {v.length > 40 ? `${v.slice(0, 39)}…` : v}
        </span>
      ))}
    </span>
  );
}

export function BoardLayout({
  table,
  view,
  result,
  ctx,
  editable,
  openRow,
  addRow,
  setCell,
}: LayoutProps) {
  const group = table.columns.find((c) => c.id === view.groupBy);
  const [over, setOver] = useState<string | null>(null);
  const shown = useShown();
  if (!group || !result.groups)
    return (
      <p className="text-sm text-fg-muted">
        Choose a Status or Select property to group this board by (View options).
      </p>
    );
  const keys = result.groups.map((g) => g.key);
  const drop = (key: string) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const rowId = e.dataTransfer.getData('text/x-lowtide-row');
    if (rowId) setCell(rowId, group.id, key || null);
  };
  return (
    <div
      className="relative flex gap-3 overflow-x-auto pb-2"
      role="group"
      aria-label={`${view.name} board`}
    >
      {result.groups.map((g) => {
        const name = g.key || `No ${group.name}`;
        return (
          <section
            key={g.key || '\u0000none'}
            aria-label={name}
            onDragOver={(e) => {
              if (!editable) return;
              e.preventDefault();
              setOver(g.key);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={drop(g.key)}
            className={`flex w-64 shrink-0 flex-col rounded-md border bg-surface p-2 ${over === g.key ? 'border-accent' : 'border-line'}`}
          >
            <h3 className="mb-2 flex items-baseline justify-between px-1 text-xs font-semibold">
              {name}
              <span className="font-normal text-fg-muted">{g.rows.length}</span>
            </h3>
            <ul className="flex flex-col gap-1.5">
              {g.rows.slice(0, shown.limit(g.key)).map((r) => (
                <li
                  key={r.id}
                  draggable={editable}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/x-lowtide-row', r.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  className="rounded-md border border-line bg-raised p-2 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => openRow(r.id)}
                    className="block w-full text-left font-medium hover:underline"
                  >
                    {rowTitle(table, r)}
                  </button>
                  <Chips table={table} row={r} columns={result.columns} ctx={ctx} skip={group.id} />
                  {editable && (
                    <span className="mt-1.5 flex items-center gap-1 text-[11px] text-fg-muted">
                      <span aria-hidden>Move to</span>
                      <select
                        aria-label={`Move ${rowTitle(table, r)} to`}
                        value={g.key}
                        onChange={(e) => setCell(r.id, group.id, e.target.value || null)}
                        className="h-6 min-w-0 flex-1 rounded border border-line bg-surface px-1 text-[11px] text-fg"
                      >
                        {keys.map((k) => (
                          <option key={k || '\u0000none'} value={k}>
                            {k || `No ${group.name}`}
                          </option>
                        ))}
                      </select>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <ShowMore
              total={g.rows.length}
              limit={shown.limit(g.key)}
              onMore={() => shown.more(g.key)}
            />
            {editable && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 self-start"
                onClick={() => addRow(g.key ? { [group.id]: g.key } : {})}
              >
                <Plus aria-hidden className="size-3.5" /> Add to {name}
              </Button>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function ListLayout({ table, result, ctx, openRow, view }: LayoutProps) {
  const group = table.columns.find((c) => c.id === view.groupBy);
  const shown = useShown();
  const line = (r: SpaceRow) => (
    <li key={r.id} className="border-b border-line py-2 last:border-0">
      <button
        type="button"
        onClick={() => openRow(r.id)}
        className="text-left text-sm font-medium hover:underline"
      >
        {rowTitle(table, r)}
      </button>
      <Chips table={table} row={r} columns={result.columns} ctx={ctx} />
    </li>
  );
  if (result.rows.length === 0) return <p className="text-sm text-fg-muted">No rows match.</p>;
  if (!group || !result.groups)
    return (
      <div className="flex flex-col">
        <ul aria-label={view.name} className="rounded-md border border-line px-3">
          {result.rows.slice(0, shown.limit('')).map(line)}
        </ul>
        <ShowMore
          total={result.rows.length}
          limit={shown.limit('')}
          onMore={() => shown.more('')}
        />
      </div>
    );
  return (
    <div className="space-y-4">
      {result.groups
        .filter((g) => g.rows.length)
        .map((g) => (
          <section key={g.key || '\u0000none'} aria-label={g.key || `No ${group.name}`}>
            <h3 className="mb-1 text-xs font-semibold text-fg-muted">
              {g.key || `No ${group.name}`} · {g.rows.length}
            </h3>
            <ul className="rounded-md border border-line px-3">
              {g.rows.slice(0, shown.limit(g.key)).map(line)}
            </ul>
            <ShowMore
              total={g.rows.length}
              limit={shown.limit(g.key)}
              onMore={() => shown.more(g.key)}
            />
          </section>
        ))}
    </div>
  );
}

export function CalendarLayout({ table, view, result, ctx, openRow }: LayoutProps) {
  const column =
    table.columns.find((c) => c.id === view.dateColumn) ?? table.columns.find(isDateLike);
  const dayOf = (r: SpaceRow) => {
    if (!column) return undefined;
    const v = valueOf(table, r, column, ctx);
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined;
  };
  const dated = result.rows.map((r) => [r, dayOf(r)] as const);
  const first = dated.find(([, d]) => d)?.[1];
  const [month, setMonth] = useState(() =>
    startOfMonth(
      first
        ? new Date(`${first}T12:00:00`)
        : ctx.today
          ? new Date(`${ctx.today}T12:00:00`)
          : new Date(),
    ),
  );
  const headingId = useId();
  const daysOpen = useShown();
  if (!column)
    return (
      <p className="text-sm text-fg-muted">
        Add a Date property to see this database on a calendar.
      </p>
    );
  const start = startOfMonth(month);
  const lead = getISODay(start) - 1;
  const days = endOfMonth(month).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) =>
      format(new Date(start.getFullYear(), start.getMonth(), i + 1), 'yyyy-MM-dd'),
    ),
  ];
  const byDay = new Map<string, SpaceRow[]>();
  for (const [r, d] of dated) if (d) byDay.set(d, [...(byDay.get(d) ?? []), r]);
  const undated = dated.filter(([, d]) => !d).map(([r]) => r);
  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <IconButton
          label="Previous month"
          icon={<ChevronLeft aria-hidden className="size-4" />}
          onClick={() => setMonth(addMonths(month, -1))}
        />
        <h3 id={headingId} className="min-w-32 text-center text-sm font-semibold">
          {format(month, 'MMMM yyyy')}
        </h3>
        <IconButton
          label="Next month"
          icon={<ChevronRight aria-hidden className="size-4" />}
          onClick={() => setMonth(addMonths(month, 1))}
        />
        <span className="ml-2 text-xs text-fg-muted">by {column.name}</span>
      </div>
      <div
        role="grid"
        aria-labelledby={headingId}
        className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-line bg-line text-xs"
      >
        <div role="row" className="contents">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div
              key={d}
              role="columnheader"
              className="bg-surface px-1 py-1 text-center font-medium text-fg-muted"
            >
              {d}
            </div>
          ))}
        </div>
        <div role="row" className="contents">
          {cells.map((day, i) => (
            <div
              key={day ?? `pad-${i}`}
              role="gridcell"
              aria-label={day ? format(new Date(`${day}T12:00:00`), 'd MMMM') : undefined}
              className="min-h-16 bg-canvas p-1"
            >
              {day && (
                <>
                  <span className="text-fg-muted">{Number(day.slice(8))}</span>
                  <ul>
                    {(byDay.get(day) ?? [])
                      .slice(0, daysOpen.limit(day) === CARDS ? PER_DAY : undefined)
                      .map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => openRow(r.id)}
                            className="block w-full truncate rounded bg-hover px-1 text-left hover:underline"
                          >
                            {rowTitle(table, r)}
                          </button>
                        </li>
                      ))}
                  </ul>
                  {daysOpen.limit(day) === CARDS && (byDay.get(day)?.length ?? 0) > PER_DAY && (
                    <button
                      type="button"
                      onClick={() => daysOpen.more(day)}
                      className="px-1 text-fg-muted hover:text-fg hover:underline"
                    >
                      +{(byDay.get(day)?.length ?? 0) - PER_DAY} more
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      {undated.length > 0 && (
        <section aria-label="No date" className="mt-3">
          <h3 className="mb-1 text-xs font-semibold text-fg-muted">No date · {undated.length}</h3>
          <ul className="flex flex-wrap gap-1.5">
            {undated.slice(0, daysOpen.limit('')).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => openRow(r.id)}
                  className="rounded bg-hover px-1.5 py-0.5 text-xs hover:underline"
                >
                  {rowTitle(table, r)}
                </button>
              </li>
            ))}
          </ul>
          <ShowMore
            total={undated.length}
            limit={daysOpen.limit('')}
            onMore={() => daysOpen.more('')}
          />
        </section>
      )}
    </div>
  );
}

/** Every property of one row, editable, with deleting the row behind a confirmation. */
export function RowDrawer({
  table,
  row,
  ctx,
  editable,
  onClose,
  setCell,
  addOption,
  deleteRow,
}: {
  table: SpaceTable;
  row: SpaceRow | undefined;
  ctx: DatabaseContext;
  editable: boolean;
  onClose: () => void;
  setCell: (rowId: string, columnId: string, value: SpaceCellValue | null) => void;
  addOption: (columnId: string, name: string) => Promise<unknown>;
  deleteRow: (rowId: string) => Promise<unknown>;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Drawer
      open={row !== undefined}
      onClose={() => {
        setConfirming(false);
        onClose();
      }}
      title={row ? rowTitle(table, row) : 'Row'}
    >
      {row && (
        <div className="space-y-4">
          <dl className="space-y-3">
            {table.columns.map((c) => (
              <div key={c.id}>
                <dt className="mb-1 text-xs font-medium text-fg-muted">{c.name}</dt>
                <dd className="text-sm">
                  <Cell
                    table={table}
                    row={row}
                    column={c}
                    ctx={ctx}
                    editable={editable}
                    mode="form"
                    label={c.name}
                    onSave={(v) => setCell(row.id, c.id, v)}
                    onAddOption={(name) => addOption(c.id, name)}
                  />
                </dd>
              </div>
            ))}
          </dl>
          {editable &&
            (confirming ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <span className="text-sm">Delete this row? It can’t be undone here.</span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() =>
                    void deleteRow(row.id).then(() => {
                      setConfirming(false);
                      onClose();
                    })
                  }
                >
                  Delete row
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setConfirming(true)}>
                Delete row…
              </Button>
            ))}
        </div>
      )}
    </Drawer>
  );
}
