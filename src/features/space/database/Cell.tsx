import { X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Drawer } from '../../../components/layout';
import { Button } from '../../../components/ui/Button';
import { fieldClass, labelClass } from '../../../components/ui/styles';
import { valueOf, type DatabaseContext } from '../../../lib/space-database';
import type {
  EntityLink,
  LinkableType,
  SpaceCellValue,
  SpaceColumn,
  SpaceRow,
  SpaceTable,
} from '../../../types/domain';
import { useSpaceData } from '../context';
import { LINK_WORD } from '../entities';
import { display, isChoice, isComputed, LINK_TARGETS } from './model';

/*
 * One value of a database row (v2.1), for every property type: shown, and
 * edited where it can be. Inline in a table it edits on click; in a row's
 * details (`form`) every field is open. Computed values are read-only.
 */

export interface CellProps {
  table: SpaceTable;
  row: SpaceRow;
  column: SpaceColumn;
  ctx: DatabaseContext;
  editable: boolean;
  /** Accessible name: "Stage, row Beta". */
  label: string;
  mode?: 'inline' | 'form';
  onSave: (value: SpaceCellValue | null) => void;
  /** Adds a choice to a select, status or multi-select property. */
  onAddOption: (name: string) => Promise<unknown>;
}

const NEW = '\u0000new';

export function Cell(props: CellProps) {
  const { table, row, column, ctx, editable, label, mode = 'inline', onSave } = props;
  const value = row.cells[column.id];
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sheet, setSheet] = useState(false);
  const inline = mode === 'inline';

  if (isComputed(column)) {
    const computed = valueOf(table, row, column, ctx);
    return (
      <span
        className="cell-text text-fg-muted"
        aria-label={`${label}: ${display(computed) || 'empty'}`}
      >
        {display(computed)}
      </span>
    );
  }

  if (column.type === 'link' || column.type === 'multiSelect') {
    const chips =
      column.type === 'link' ? (
        <LinkChips links={(Array.isArray(value) ? value : []) as EntityLink[]} />
      ) : (
        <span className="cell-text">{display(value)}</span>
      );
    const editor =
      column.type === 'link' ? (
        <RelationEditor column={column} value={value} label={label} onSave={onSave} />
      ) : (
        <MultiEditor {...props} />
      );
    if (!editable) return chips;
    if (!inline) return editor;
    return (
      <>
        <button
          type="button"
          aria-label={`Edit ${label}`}
          onClick={() => setSheet(true)}
          className="block min-h-6 w-full rounded px-0.5 text-left hover:bg-hover"
        >
          {display(value) ? chips : <span className="text-fg-subtle"> </span>}
        </button>
        <Drawer open={sheet} onClose={() => setSheet(false)} title={label}>
          {sheet && editor}
        </Drawer>
      </>
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

  if (isChoice(column)) {
    if (adding)
      return (
        <input
          autoFocus
          aria-label={`New option for ${column.name}`}
          placeholder="New option"
          onBlur={() => setAdding(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAdding(false);
            if (e.key !== 'Enter') return;
            const name = e.currentTarget.value.trim();
            setAdding(false);
            if (!name) return;
            void props.onAddOption(name).then(() => onSave(name));
          }}
          className="w-full min-w-24 rounded border border-line bg-raised px-1.5 py-0.5 text-sm"
        />
      );
    const options = column.options ?? [];
    return (
      <select
        aria-label={label}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => {
          if (e.target.value === NEW) setAdding(true);
          else onSave(e.target.value || null);
        }}
        className={
          inline
            ? 'max-w-48 rounded border border-transparent bg-transparent py-0.5 text-sm hover:border-line'
            : fieldClass
        }
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.name} value={o.name}>
            {o.name}
          </option>
        ))}
        {typeof value === 'string' && value && !options.some((o) => o.name === value) && (
          <option value={value}>{value}</option>
        )}
        <option value={NEW}>New option…</option>
      </select>
    );
  }

  const inputType =
    column.type === 'number'
      ? 'number'
      : column.type === 'date'
        ? 'date'
        : column.type === 'url'
          ? 'url'
          : 'text';
  const initial =
    column.type === 'date' && typeof value === 'string' ? value.slice(0, 10) : display(value);
  const commit = (raw: string) => {
    const trimmed = raw.trim();
    const next: SpaceCellValue | null =
      trimmed === '' ? null : column.type === 'number' ? Number(trimmed) : trimmed;
    if (column.type === 'number' && next !== null && !Number.isFinite(next)) return;
    if (next !== (value ?? null)) onSave(next);
  };

  if (inline && !editing) {
    return (
      <span className="flex items-start gap-1">
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
        {column.type === 'url' && typeof value === 'string' && (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${value}`}
            className="shrink-0 px-0.5 text-xs text-accent-ink hover:underline"
          >
            ↗
          </a>
        )}
      </span>
    );
  }
  return (
    <input
      autoFocus={inline}
      aria-label={label}
      type={inputType}
      defaultValue={initial}
      key={`${row.id}:${String(value ?? '')}`}
      onBlur={(e) => {
        setEditing(false);
        commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setEditing(false);
      }}
      className={
        inline
          ? 'w-full min-w-24 rounded border border-line bg-raised px-1.5 py-0.5 text-sm'
          : fieldClass
      }
    />
  );
}

/** Links shown as chips that open what they point at. */
export function LinkChips({ links }: { links: EntityLink[] }) {
  const { lookup } = useSpaceData();
  return (
    <span className="flex flex-wrap gap-1">
      {links.map((l, i) => {
        const href = lookup.href(l);
        const name = lookup.label(l);
        return href ? (
          <Link
            key={`${l.type}:${l.id}:${i}`}
            to={href}
            onClick={(e) => e.stopPropagation()}
            className="rounded-sm bg-hover px-1.5 py-px text-xs text-accent-ink hover:underline"
          >
            {name}
          </Link>
        ) : (
          <span key={`${l.type}:${l.id}:${i}`} className="rounded-sm bg-hover px-1.5 py-px text-xs">
            {name}
          </span>
        );
      })}
    </span>
  );
}

/** Picks and removes the records a relation links to. */
function RelationEditor({
  column,
  value,
  label,
  onSave,
}: {
  column: SpaceColumn;
  value: SpaceCellValue | undefined;
  label: string;
  onSave: (value: SpaceCellValue | null) => void;
}) {
  const { lookup } = useSpaceData();
  const links = useMemo(() => (Array.isArray(value) ? value : []) as EntityLink[], [value]);
  const targets = column.targets?.length ? column.targets : LINK_TARGETS;
  const [type, setType] = useState<LinkableType>(targets[0]!);
  const [query, setQuery] = useState('');
  const ids = { type: useId(), query: useId() };
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lookup
      .options(type)
      .filter((o) => !links.some((l) => l.type === o.type && l.id === o.id))
      .filter((o) => !q || o.label.toLowerCase().includes(q))
      .slice(0, 20);
  }, [lookup, type, query, links]);
  const save = (next: EntityLink[]) => onSave(next.length ? next : null);
  return (
    <div className="space-y-3" role="group" aria-label={`${label} links`}>
      {links.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Linked">
          {links.map((l) => (
            <li
              key={`${l.type}:${l.id}`}
              className="inline-flex items-center gap-1 rounded-sm bg-hover px-1.5 py-0.5 text-xs"
            >
              <span>
                <span className="text-fg-muted">{LINK_WORD[l.type]} · </span>
                {lookup.label(l)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${lookup.label(l)}`}
                onClick={() => save(links.filter((x) => !(x.type === l.type && x.id === l.id)))}
                className="grid size-4 place-items-center rounded text-fg-muted hover:text-fg"
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-muted">Nothing linked yet.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {targets.length > 1 && (
          <div>
            <label htmlFor={ids.type} className={labelClass}>
              Kind
            </label>
            <select
              id={ids.type}
              value={type}
              onChange={(e) => setType(e.target.value as LinkableType)}
              className={fieldClass}
            >
              {targets.map((t) => (
                <option key={t} value={t}>
                  {LINK_WORD[t]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="min-w-40 flex-1">
          <label htmlFor={ids.query} className={labelClass}>
            Find
          </label>
          <input
            id={ids.query}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${LINK_WORD[type].toLowerCase()}s`}
            className={fieldClass}
          />
        </div>
      </div>
      <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line">
        {options.length === 0 && (
          <li className="px-2 py-2 text-xs text-fg-muted">Nothing to link.</li>
        )}
        {options.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              aria-label={`Link ${o.label}${o.detail ? ` (${o.detail})` : ''}`}
              onClick={() => save([...links, { type: o.type, id: o.id, label: o.label }])}
              className="flex w-full items-baseline justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-hover"
            >
              <span>Link {o.label}</span>
              {o.detail && <span className="text-xs text-fg-muted">{o.detail}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ticks the choices of a multi-select, and adds new ones. */
function MultiEditor({ column, row, label, onSave, onAddOption }: CellProps) {
  const value = row.cells[column.id];
  const chosen = new Set(Array.isArray(value) ? (value as string[]) : []);
  const [draft, setDraft] = useState('');
  const toggle = (name: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(name);
    else next.delete(name);
    onSave(next.size ? [...next] : null);
  };
  const names = [
    ...(column.options ?? []).map((o) => o.name),
    ...[...chosen].filter((c) => !(column.options ?? []).some((o) => o.name === c)),
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">{label}</legend>
      {names.length === 0 && <p className="text-xs text-fg-muted">No options yet.</p>}
      {names.map((name) => (
        <label key={name} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={chosen.has(name)}
            onChange={(e) => toggle(name, e.target.checked)}
            className="size-4"
          />
          {name}
        </label>
      ))}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const name = draft.trim();
          if (!name) return;
          setDraft('');
          void onAddOption(name).then(() => toggle(name, true));
        }}
      >
        <input
          aria-label={`New option for ${column.name}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="New option"
          className={fieldClass}
        />
        <Button type="submit" size="sm">
          Add
        </Button>
      </form>
    </fieldset>
  );
}
