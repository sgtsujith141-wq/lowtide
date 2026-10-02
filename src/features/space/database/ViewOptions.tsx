import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Button, IconButton } from '../../../components/ui/Button';
import { ErrorNotice } from '../../../components/ui/Notice';
import { fieldClass, labelClass } from '../../../components/ui/styles';
import {
  SPACE_VIEW_TYPES,
  type SpaceFilter,
  type SpaceSort,
  type SpaceTable,
  type SpaceView,
  type SpaceViewType,
} from '../../../types/domain';
import { isChoice, isDateLike, NO_VALUE, OP_LABEL, opsFor, VIEW_LABEL } from './model';

/*
 * A view's settings (v2.1): its layout, filters, sorts, grouping, the date a
 * calendar uses, and which properties show in what order. Saved with the
 * database; rows are never copied.
 */

export function ViewOptions({
  table,
  view,
  onSave,
  onDelete,
  onCancel,
}: {
  table: SpaceTable;
  view: SpaceView;
  onSave: (view: SpaceView) => Promise<unknown>;
  /** Absent for the implicit default view. */
  onDelete?: () => Promise<unknown>;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(view.name);
  const [type, setType] = useState<SpaceViewType>(view.type);
  const [filters, setFilters] = useState<SpaceFilter[]>(view.filters ?? []);
  const [sorts, setSorts] = useState<SpaceSort[]>(view.sorts ?? []);
  const [groupBy, setGroupBy] = useState(view.groupBy ?? '');
  const [dateColumn, setDateColumn] = useState(view.dateColumn ?? '');
  const [hidden, setHidden] = useState<string[]>(view.hidden ?? []);
  const [order, setOrder] = useState<string[]>(() => {
    const ids = table.columns.map((c) => c.id);
    const first = (view.order ?? []).filter((x) => ids.includes(x));
    return [...first, ...ids.filter((x) => !first.includes(x))];
  });
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const byId = new Map(table.columns.map((c) => [c.id, c]));
  const groupable = table.columns.filter(isChoice);
  const dated = table.columns.filter(isDateLike);
  const first = table.columns[0]?.id ?? '';

  const move = (at: number, by: -1 | 1) => {
    const next = [...order];
    const [x] = next.splice(at, 1);
    next.splice(at + by, 0, x!);
    setOrder(next);
  };

  async function save() {
    if (!name.trim()) return setError('Name the view.');
    if (type === 'board' && !groupBy)
      return setError('A board needs a Status or Select property to group by.');
    setError(null);
    try {
      await onSave({
        id: view.id,
        name: name.trim(),
        type,
        ...(filters.length ? { filters } : {}),
        ...(sorts.length ? { sorts } : {}),
        ...(groupBy && (type === 'board' || type === 'list') ? { groupBy } : {}),
        ...(dateColumn && type === 'calendar' ? { dateColumn } : {}),
        ...(hidden.length ? { hidden } : {}),
        order,
      });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Couldn’t save the view.');
    }
  }

  return (
    <form
      aria-label="View options"
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-name`} className={labelClass}>
            View name
          </label>
          <input
            id={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={`${id}-type`} className={labelClass}>
            Layout
          </label>
          <select
            id={`${id}-type`}
            value={type}
            onChange={(e) => setType(e.target.value as SpaceViewType)}
            className={fieldClass}
          >
            {SPACE_VIEW_TYPES.map((t) => (
              <option key={t} value={t}>
                {VIEW_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        {(type === 'board' || type === 'list') && (
          <div>
            <label htmlFor={`${id}-group`} className={labelClass}>
              Group by
            </label>
            <select
              id={`${id}-group`}
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
              className={fieldClass}
            >
              <option value="">{type === 'list' ? 'No grouping' : 'Choose…'}</option>
              {groupable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {type === 'calendar' && (
          <div>
            <label htmlFor={`${id}-date`} className={labelClass}>
              Date property
            </label>
            <select
              id={`${id}-date`}
              value={dateColumn}
              onChange={(e) => setDateColumn(e.target.value)}
              className={fieldClass}
            >
              <option value="">{dated[0] ? `Default (${dated[0].name})` : 'None yet'}</option>
              {dated.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className={labelClass}>Filters</legend>
        {filters.length === 0 && <p className="text-xs text-fg-muted">Every row shows.</p>}
        {filters.map((f, i) => {
          const column = byId.get(f.column);
          const ops = column ? opsFor(column.type) : [];
          return (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <select
                aria-label={`Filter ${i + 1} property`}
                value={f.column}
                onChange={(e) => {
                  const c = byId.get(e.target.value)!;
                  setFilters(
                    filters.map((x, j) => (j === i ? { column: c.id, op: opsFor(c.type)[0]! } : x)),
                  );
                }}
                className={`${fieldClass} w-auto`}
              >
                {table.columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Filter ${i + 1} condition`}
                value={f.op}
                onChange={(e) =>
                  setFilters(
                    filters.map((x, j) =>
                      j === i ? { ...x, op: e.target.value as SpaceFilter['op'] } : x,
                    ),
                  )
                }
                className={`${fieldClass} w-auto`}
              >
                {ops.map((op) => (
                  <option key={op} value={op}>
                    {OP_LABEL[op]}
                  </option>
                ))}
              </select>
              {!NO_VALUE.includes(f.op) && (
                <input
                  aria-label={`Filter ${i + 1} value`}
                  type={
                    column?.type === 'date' ? 'date' : column?.type === 'number' ? 'number' : 'text'
                  }
                  value={f.value ?? ''}
                  onChange={(e) =>
                    setFilters(
                      filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                    )
                  }
                  className={`${fieldClass} w-36`}
                />
              )}
              <IconButton
                label={`Remove filter ${i + 1}`}
                icon={<X aria-hidden className="size-3.5" />}
                onClick={() => setFilters(filters.filter((_, j) => j !== i))}
              />
            </div>
          );
        })}
        <Button
          size="sm"
          variant="ghost"
          disabled={!first}
          onClick={() => {
            const c = byId.get(first)!;
            setFilters([...filters, { column: c.id, op: opsFor(c.type)[0]! }]);
          }}
        >
          <Plus aria-hidden className="size-3.5" /> Add filter
        </Button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className={labelClass}>Sort</legend>
        {sorts.length === 0 && (
          <p className="text-xs text-fg-muted">In the order rows were added.</p>
        )}
        {sorts.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <select
              aria-label={`Sort ${i + 1} property`}
              value={s.column}
              onChange={(e) =>
                setSorts(sorts.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))
              }
              className={`${fieldClass} w-auto`}
            >
              {table.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              aria-label={`Sort ${i + 1} direction`}
              value={s.dir}
              onChange={(e) =>
                setSorts(
                  sorts.map((x, j) =>
                    j === i ? { ...x, dir: e.target.value as 'asc' | 'desc' } : x,
                  ),
                )
              }
              className={`${fieldClass} w-auto`}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
            <IconButton
              label={`Remove sort ${i + 1}`}
              icon={<X aria-hidden className="size-3.5" />}
              onClick={() => setSorts(sorts.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        {sorts.length < 3 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={!first}
            onClick={() => setSorts([...sorts, { column: first, dir: 'asc' }])}
          >
            <Plus aria-hidden className="size-3.5" /> Add sort
          </Button>
        )}
      </fieldset>

      <fieldset>
        <legend className={labelClass}>Properties</legend>
        <ul className="divide-y divide-line rounded-md border border-line">
          {order.map((colId, i) => {
            const c = byId.get(colId)!;
            return (
              <li key={colId} className="flex items-center gap-2 px-2 py-1">
                <label className="flex flex-1 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!hidden.includes(colId)}
                    disabled={colId === first}
                    onChange={(e) =>
                      setHidden(
                        e.target.checked ? hidden.filter((h) => h !== colId) : [...hidden, colId],
                      )
                    }
                    className="size-4"
                  />
                  <span>
                    <span className="sr-only">Show </span>
                    {c.name}
                  </span>
                </label>
                <IconButton
                  label={`Move ${c.name} up`}
                  icon={<ArrowUp aria-hidden className="size-3.5" />}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                />
                <IconButton
                  label={`Move ${c.name} down`}
                  icon={<ArrowDown aria-hidden className="size-3.5" />}
                  disabled={i === order.length - 1}
                  onClick={() => move(i, 1)}
                />
              </li>
            );
          })}
        </ul>
      </fieldset>

      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">
          Save view
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {onDelete &&
          (confirming ? (
            <span className="ml-auto flex items-center gap-2">
              <span className="text-xs text-fg-muted">Delete this view? Rows stay.</span>
              <Button variant="danger" size="sm" onClick={() => void onDelete()}>
                Delete view
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </span>
          ) : (
            <Button variant="ghost" className="ml-auto" onClick={() => setConfirming(true)}>
              Delete view…
            </Button>
          ))}
      </div>
    </form>
  );
}
