import { describe, expect, it } from 'vitest';
import {
  applyView,
  FormulaError,
  formulaProblem,
  parseCsv,
  parseFormula,
  relatedFromRecords,
  tableToCsv,
  valueOf,
} from '../lib/space-database';
import type { SpaceColumn, SpaceTable } from '../types/domain';

const columns: SpaceColumn[] = [
  { id: 'name', name: 'Name', type: 'text' },
  { id: 'min', name: 'Minutes', type: 'number' },
  { id: 'due', name: 'Due', type: 'date' },
  { id: 'stage', name: 'Stage', type: 'status', options: [{ name: 'Todo' }, { name: 'Done' }] },
  { id: 'done', name: 'Done', type: 'boolean' },
  { id: 'tasks', name: 'Tasks', type: 'link' },
  {
    id: 'count',
    name: 'Done tasks',
    type: 'rollup',
    rollup: { relation: 'tasks', fn: 'countDone' },
  },
  { id: 'pct', name: 'Progress', type: 'rollup', rollup: { relation: 'tasks', fn: 'percentDone' } },
  { id: 'f', name: 'Size', type: 'formula', formula: 'if(prop("Minutes") > 30, "long", "short")' },
];

const table: SpaceTable = {
  columns,
  rows: [
    {
      id: 'a',
      cells: {
        name: 'Alpha',
        min: 45,
        due: '2026-11-04',
        stage: 'Todo',
        tasks: [
          { type: 'task', id: 't1', label: 'One' },
          { type: 'task', id: 't2', label: 'Two' },
        ],
      },
      createdAt: '2026-10-01T10:00:00.000Z',
      createdBy: 'owner',
    },
    { id: 'b', cells: { name: 'Beta', min: 12, stage: 'Done', done: true } },
    { id: 'c', cells: { name: 'Gamma', stage: 'Blocked' } },
  ],
};

const ctx = {
  today: '2026-10-02',
  related: relatedFromRecords({
    tasks: [
      { id: 't1', title: 'One', status: 'done', completedAt: '2026-10-01T00:00:00.000Z' },
      { id: 't2', title: 'Two', status: 'todo' },
    ],
    milestones: [],
    projectItems: [],
    decisions: [],
    projects: [],
    hackathons: [],
    spaceNodes: [],
  }),
};

const row = (id: string) => table.rows.find((r) => r.id === id)!;
const col = (id: string) => columns.find((c) => c.id === id)!;

describe('formulas', () => {
  const run = (formula: string, id = 'a') =>
    valueOf(
      { ...table, columns: [...columns, { id: 'x', name: 'X', type: 'formula', formula }] },
      row(id),
      { id: 'x', name: 'X', type: 'formula', formula },
      ctx,
    );

  it('respects precedence, comparisons and booleans', () => {
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('(1 + 2) * 3')).toBe(9);
    expect(run('10 - 4 - 3')).toBe(3);
    expect(run('2 * 3 > 5 and not false')).toBe(true);
    expect(run('1 == 2 or 3 >= 3')).toBe(true);
    expect(run('-prop("Minutes") + 50')).toBe(5);
    expect(run('10 / 0')).toBeNull();
  });

  it('reads properties and runs functions', () => {
    expect(run('{Minutes} * 2')).toBe(90);
    expect(run('concat(prop("Name"), " — ", prop("Stage"))')).toBe('Alpha — Todo');
    expect(run('"x" + 1')).toBe('x1');
    expect(run('if(empty(prop("Due")), "none", "set")', 'b')).toBe('none');
    expect(run('dateBetween(prop("Due"), today(), "days")')).toBe(33);
    expect(run('dateBetween(prop("Due"), "2026-10-04", "weeks")')).toBe(4);
    expect(run('round(10 / 3, 2)')).toBe(3.33);
    expect(run('length(prop("Name"))')).toBe(5);
    expect(valueOf(table, row('a'), col('f'), ctx)).toBe('long');
    expect(valueOf(table, row('b'), col('f'), ctx)).toBe('short');
  });

  it('reports problems instead of evaluating them', () => {
    expect(() => parseFormula('1 +')).toThrow(FormulaError);
    expect(() => parseFormula('eval("x")')).toThrow(/Unknown name/);
    expect(() => parseFormula('1 2')).toThrow(/follows the end/);
    expect(() => parseFormula('"open')).toThrow(/Unclosed/);
    expect(formulaProblem('prop("Nope") + 1', columns)).toBe('No property “Nope”');
    expect(formulaProblem('prop("Minutes") + 1', columns)).toBeUndefined();
    // A broken formula shows nothing rather than failing the table.
    expect(run('prop("Nope")')).toBeNull();
  });
});

describe('computed properties', () => {
  it('rolls up related records and reads row authorship', () => {
    expect(valueOf(table, row('a'), col('count'), ctx)).toBe(1);
    expect(valueOf(table, row('a'), col('pct'), ctx)).toBe(50);
    expect(valueOf(table, row('b'), col('pct'), ctx)).toBeNull();
    expect(valueOf(table, row('a'), { id: 'ct', name: 'Created', type: 'createdTime' })).toBe(
      '2026-10-01T10:00:00.000Z',
    );
    expect(valueOf(table, row('a'), { id: 'cb', name: 'By', type: 'createdBy' })).toBe('owner');
  });

  it('sums and finds the latest across related database rows', () => {
    const other: SpaceTable = {
      columns: [
        { id: 'h', name: 'Hours', type: 'number' },
        { id: 'w', name: 'When', type: 'date' },
      ],
      rows: [
        { id: 'r1', cells: { h: 2, w: '2026-09-01' } },
        { id: 'r2', cells: { h: 3, w: '2026-10-01' } },
      ],
    };
    const related = relatedFromRecords({
      tasks: [],
      milestones: [],
      projectItems: [],
      decisions: [],
      projects: [],
      hackathons: [],
      spaceNodes: [{ id: 'n', title: 'Log', table: other }],
    });
    const t: SpaceTable = {
      columns: [
        { id: 'l', name: 'Log', type: 'link' },
        {
          id: 's',
          name: 'Total',
          type: 'rollup',
          rollup: { relation: 'l', fn: 'sum', property: 'Hours' },
        },
        {
          id: 'm',
          name: 'Last',
          type: 'rollup',
          rollup: { relation: 'l', fn: 'latest', property: 'When' },
        },
      ],
      rows: [
        {
          id: 'x',
          cells: {
            l: [
              { type: 'spaceNode', id: 'n', rowId: 'r1' },
              { type: 'spaceNode', id: 'n', rowId: 'r2' },
            ],
          },
        },
      ],
    };
    expect(valueOf(t, t.rows[0]!, t.columns[1]!, { related })).toBe(5);
    expect(valueOf(t, t.rows[0]!, t.columns[2]!, { related })).toBe('2026-10-01');
  });
});

describe('views', () => {
  it('filters by every kind of operator', () => {
    const ids = (filters: Parameters<typeof applyView>[1]) =>
      applyView(table, filters, ctx).rows.map((r) => r.id);
    expect(ids({ filters: [{ column: 'name', op: 'contains', value: 'ta' }] })).toEqual(['b']);
    expect(ids({ filters: [{ column: 'stage', op: 'is', value: 'done' }] })).toEqual(['b']);
    expect(ids({ filters: [{ column: 'stage', op: 'isNot', value: 'Done' }] })).toEqual(['a', 'c']);
    expect(ids({ filters: [{ column: 'min', op: 'gt', value: '20' }] })).toEqual(['a']);
    expect(ids({ filters: [{ column: 'min', op: 'lt', value: '20' }] })).toEqual(['b']);
    expect(ids({ filters: [{ column: 'min', op: 'isEmpty' }] })).toEqual(['c']);
    expect(ids({ filters: [{ column: 'due', op: 'after', value: '2026-11-01' }] })).toEqual(['a']);
    expect(ids({ filters: [{ column: 'due', op: 'before', value: '2026-11-01' }] })).toEqual([]);
    expect(ids({ filters: [{ column: 'done', op: 'checked' }] })).toEqual(['b']);
    expect(ids({ filters: [{ column: 'tasks', op: 'is', value: 'two' }] })).toEqual(['a']);
    expect(ids({ filters: [{ column: 'count', op: 'gt', value: '0' }] })).toEqual(['a']);
  });

  it('sorts with empties last, and groups by a choice in option order', () => {
    const sorted = applyView(table, { sorts: [{ column: 'min', dir: 'desc' }] }, ctx);
    expect(sorted.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    const asc = applyView(table, { sorts: [{ column: 'min', dir: 'asc' }] }, ctx);
    expect(asc.rows.map((r) => r.id)).toEqual(['b', 'a', 'c']);
    const grouped = applyView(table, { groupBy: 'stage' }, ctx);
    expect(grouped.groups!.map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
      ['Todo', ['a']],
      ['Done', ['b']],
      ['Blocked', ['c']],
    ]);
  });

  it('hides and orders properties per view', () => {
    const v = applyView(table, { hidden: ['due', 'done'], order: ['stage', 'name'] }, ctx);
    expect(v.columns.map((c) => c.id).slice(0, 3)).toEqual(['stage', 'name', 'min']);
    expect(v.columns.some((c) => c.id === 'due')).toBe(false);
  });
});

describe('CSV', () => {
  it('round-trips quotes, commas and newlines', () => {
    const t: SpaceTable = {
      columns: [
        { id: 'a', name: 'Name', type: 'text' },
        { id: 'b', name: 'Note, long', type: 'text' },
      ],
      rows: [{ id: 'r', cells: { a: 'He said "hi"', b: 'line one\nline two, more' } }],
    };
    const csv = tableToCsv(t);
    expect(parseCsv(csv)).toEqual([
      ['Name', 'Note, long'],
      ['He said "hi"', 'line one\nline two, more'],
    ]);
    expect(parseCsv('a,b\r\n1,2\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('exports computed values', () => {
    expect(tableToCsv(table, ctx).split('\n')[1]).toContain('long');
  });
});
