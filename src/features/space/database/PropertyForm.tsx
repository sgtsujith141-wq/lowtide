import { useId, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { ErrorNotice } from '../../../components/ui/Notice';
import { fieldClass, labelClass } from '../../../components/ui/styles';
import { formulaProblem } from '../../../lib/space-database';
import {
  ROLLUP_FUNCTIONS,
  type LinkableType,
  type RollupFunction,
  type SpaceColumn,
  type SpaceColumnType,
  type SpaceTable,
} from '../../../types/domain';
import type { NewSpaceColumn } from '../../../db/repositories/types';
import { LINK_WORD } from '../entities';
import { LINK_TARGETS, TYPE_LABEL, TYPE_ORDER } from './model';

/*
 * Adding or changing a database property (v2.1): its name, type and what the
 * type needs — choices, what a relation may link to, what a rollup reads, a
 * formula (checked as it's typed). Changing the type converts every value,
 * or LOWTIDE refuses and says why.
 */

const ROLLUP_LABEL: Record<RollupFunction, string> = {
  count: 'Count linked',
  countDone: 'Count done',
  percentDone: 'Percent done',
  sum: 'Sum of a number',
  latest: 'Latest date',
};

export function PropertyForm({
  table,
  column,
  onSubmit,
  onCancel,
}: {
  table: SpaceTable;
  /** Absent: a new property. */
  column?: SpaceColumn;
  onSubmit: (column: NewSpaceColumn) => Promise<unknown>;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(column?.name ?? '');
  const [type, setType] = useState<SpaceColumnType>(column?.type ?? 'text');
  const [options, setOptions] = useState((column?.options ?? []).map((o) => o.name).join('\n'));
  const [targets, setTargets] = useState<LinkableType[]>(column?.targets ?? []);
  const relations = table.columns.filter((c) => c.type === 'link' && c.id !== column?.id);
  const [relation, setRelation] = useState(column?.rollup?.relation ?? relations[0]?.id ?? '');
  const [fn, setFn] = useState<RollupFunction>(column?.rollup?.fn ?? 'count');
  const [property, setProperty] = useState(column?.rollup?.property ?? '');
  const [formula, setFormula] = useState(column?.formula ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const others = table.columns.filter((c) => c.id !== column?.id);
  const formulaIssue =
    type === 'formula' && formula.trim() ? formulaProblem(formula, others) : undefined;
  const choice = type === 'select' || type === 'status' || type === 'multiSelect';

  async function submit() {
    if (!name.trim()) return setError('Name the property.');
    if (type === 'rollup' && !relation)
      return setError('A rollup needs a relation property first.');
    if (type === 'formula' && (!formula.trim() || formulaIssue))
      return setError(formulaIssue ?? 'Write the formula.');
    const names = options
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean);
    const draft: NewSpaceColumn = {
      name: name.trim(),
      type,
      ...(choice
        ? {
            options: [...new Set(names)].map((n) => {
              const color = column?.options?.find((o) => o.name === n)?.color;
              return { name: n, ...(color ? { color } : {}) };
            }),
          }
        : {}),
      ...(type === 'link' && targets.length ? { targets } : {}),
      ...(type === 'rollup'
        ? { rollup: { relation, fn, ...(property.trim() ? { property: property.trim() } : {}) } }
        : {}),
      ...(type === 'formula' ? { formula: formula.trim() } : {}),
    };
    setSaving(true);
    setError(null);
    try {
      await onSubmit(draft);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Couldn’t save that property.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      aria-label={column ? `Edit property ${column.name}` : 'New property'}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <label htmlFor={`${id}-name`} className={labelClass}>
          Name
        </label>
        <input
          id={`${id}-name`}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor={`${id}-type`} className={labelClass}>
          Type
        </label>
        <select
          id={`${id}-type`}
          value={type}
          onChange={(e) => setType(e.target.value as SpaceColumnType)}
          className={fieldClass}
        >
          {TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        {column && type !== column.type && (
          <p className="mt-1 text-xs text-fg-muted">
            Every value is converted; if one can’t be, nothing changes.
          </p>
        )}
      </div>
      {choice && (
        <div>
          <label htmlFor={`${id}-options`} className={labelClass}>
            Options (one per line)
          </label>
          <textarea
            id={`${id}-options`}
            rows={4}
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            className={fieldClass}
          />
        </div>
      )}
      {type === 'link' && (
        <fieldset>
          <legend className={labelClass}>Can link to (none ticked: anything)</legend>
          <div className="grid grid-cols-2 gap-1">
            {LINK_TARGETS.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={targets.includes(t)}
                  onChange={(e) =>
                    setTargets(e.target.checked ? [...targets, t] : targets.filter((x) => x !== t))
                  }
                  className="size-4"
                />
                {LINK_WORD[t]}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {type === 'rollup' &&
        (relations.length === 0 ? (
          <p className="text-sm text-fg-muted">Add a Relation property first; a rollup reads it.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-rel`} className={labelClass}>
                Relation
              </label>
              <select
                id={`${id}-rel`}
                value={relation}
                onChange={(e) => setRelation(e.target.value)}
                className={fieldClass}
              >
                {relations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-fn`} className={labelClass}>
                Calculate
              </label>
              <select
                id={`${id}-fn`}
                value={fn}
                onChange={(e) => setFn(e.target.value as RollupFunction)}
                className={fieldClass}
              >
                {ROLLUP_FUNCTIONS.map((f) => (
                  <option key={f} value={f}>
                    {ROLLUP_LABEL[f]}
                  </option>
                ))}
              </select>
            </div>
            {(fn === 'sum' || fn === 'latest') && (
              <div className="sm:col-span-2">
                <label htmlFor={`${id}-prop`} className={labelClass}>
                  Property of the linked rows {fn === 'latest' && '(optional)'}
                </label>
                <input
                  id={`${id}-prop`}
                  value={property}
                  onChange={(e) => setProperty(e.target.value)}
                  className={fieldClass}
                />
              </div>
            )}
          </div>
        ))}
      {type === 'formula' && (
        <div>
          <label htmlFor={`${id}-formula`} className={labelClass}>
            Formula
          </label>
          <input
            id={`${id}-formula`}
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            placeholder={'if(prop("Done"), "✓", prop("Owner"))'}
            aria-invalid={formulaIssue ? true : undefined}
            aria-describedby={`${id}-formula-help`}
            className={`${fieldClass} font-mono`}
          />
          <p
            id={`${id}-formula-help`}
            className={`mt-1 text-xs ${formulaIssue ? 'text-danger' : 'text-fg-muted'}`}
          >
            {formulaIssue ??
              'prop("Name"), + − × ÷, comparisons, and/or/not, if, concat, round, length, empty, today, dateBetween.'}
          </p>
        </div>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={saving}>
          {column ? 'Save property' : 'Add property'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
