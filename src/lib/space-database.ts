import { cellText } from '../db/space-table';
import type {
  EntityLink,
  SpaceCellValue,
  SpaceColumn,
  SpaceFilter,
  SpaceRow,
  SpaceTable,
  SpaceView,
} from '../types/domain';

/*
 * SPACE databases, computed (v2.1). Pure functions over a table: the values
 * of computed properties (created/updated time and by, rollups, formulas),
 * and a view's rows after filters, sorts and grouping. Views never copy rows.
 *
 * Formulas are a small, safe expression language — no `eval`, no access to
 * anything but the row:
 *   prop("Name")            a property of this row (or {Name})
 *   + - * /  == != > < >= <=  and or not  ( )
 *   "text" 12.5 true false
 *   if(cond, a, b)  concat(a, b, …)  round(n, digits)  length(s)
 *   dateBetween(a, b, "days"|"weeks"|"months")  today()  empty(v)
 */

/** What a relation's target is, as far as a rollup needs to know. */
export interface Related {
  title?: string;
  /** Tasks, milestones and items: whether it's done. */
  done?: boolean;
  /** A related database row's cells, by property name. */
  values?: Record<string, SpaceCellValue>;
  /** A date the record carries (due day, completion, decision…). */
  date?: string;
}

export interface DatabaseContext {
  related?: (link: EntityLink) => Related | undefined;
  /** "Today" for formulas, as YYYY-MM-DD. */
  today?: string;
}

export type ComputedValue = string | number | boolean | null;

/* ------------------------------- formulas ------------------------------- */

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'prop'; v: string };

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+/.exec(src.slice(i));
      if (!m) throw new FormulaError(`Unexpected “${c}”`);
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new FormulaError('Unclosed text');
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
    } else if (c === '{') {
      const end = src.indexOf('}', i + 1);
      if (end < 0) throw new FormulaError('Unclosed {property}');
      out.push({ t: 'prop', v: src.slice(i + 1, end).trim() });
      i = end + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else {
      const two = src.slice(i, i + 2);
      if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
        out.push({ t: 'op', v: two });
        i += 2;
      } else if ('+-*/()<>,!'.includes(c)) {
        out.push({ t: 'op', v: c });
        i++;
      } else {
        throw new FormulaError(`Unexpected “${c}”`);
      }
    }
  }
  return out;
}

type Node =
  | { k: 'lit'; v: ComputedValue }
  | { k: 'prop'; name: string }
  | { k: 'call'; fn: string; args: Node[] }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node };

const PREC: Record<string, number> = {
  or: 1,
  '||': 1,
  and: 2,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '>': 4,
  '<': 4,
  '>=': 4,
  '<=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
};

const FUNCTIONS = new Set([
  'prop',
  'if',
  'concat',
  'round',
  'length',
  'dateBetween',
  'today',
  'empty',
  'not',
]);

export function parseFormula(src: string): Node {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (v: string) => {
    const t = next();
    if (!t || t.t !== 'op' || t.v !== v) throw new FormulaError(`Expected “${v}”`);
  };
  const opOf = (t: Token | undefined) =>
    t && (t.t === 'op' || (t.t === 'id' && (t.v === 'and' || t.v === 'or'))) ? t.v : undefined;

  function primary(): Node {
    const t = next();
    if (!t) throw new FormulaError('The formula ends too soon');
    if (t.t === 'num') return { k: 'lit', v: t.v };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'prop') return { k: 'prop', name: t.v };
    if (t.t === 'op' && t.v === '(') {
      const e = expr(0);
      expect(')');
      return e;
    }
    if (t.t === 'op' && (t.v === '-' || t.v === '!')) return { k: 'un', op: t.v, a: primary() };
    if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'false') return { k: 'lit', v: t.v === 'true' };
      if (t.v === 'not') return { k: 'un', op: '!', a: primary() };
      if (!FUNCTIONS.has(t.v)) throw new FormulaError(`Unknown name “${t.v}”`);
      expect('(');
      const args: Node[] = [];
      if (!(peek()?.t === 'op' && peek()!.v === ')')) {
        for (;;) {
          args.push(expr(0));
          if (peek()?.t === 'op' && peek()!.v === ',') {
            next();
            continue;
          }
          break;
        }
      }
      expect(')');
      if (t.v === 'prop') {
        const a = args[0];
        if (args.length !== 1 || a?.k !== 'lit' || typeof a.v !== 'string')
          throw new FormulaError('prop() takes a property name in quotes');
        return { k: 'prop', name: a.v };
      }
      return { k: 'call', fn: t.v, args };
    }
    throw new FormulaError(`Unexpected “${t.v}”`);
  }

  function expr(min: number): Node {
    let left = primary();
    for (;;) {
      const op = opOf(peek());
      const prec = op ? PREC[op] : undefined;
      if (!op || prec === undefined || prec <= min) break;
      next();
      left = { k: 'bin', op, a: left, b: expr(prec) };
    }
    return left;
  }

  const tree = expr(0);
  if (pos < tokens.length) throw new FormulaError('Something follows the end of the formula');
  return tree;
}

const DAY = 86_400_000;

function toNumber(v: ComputedValue): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new FormulaError(`“${v}” isn’t a number`);
  return n;
}

const truthy = (v: ComputedValue) => v !== null && v !== false && v !== 0 && v !== '';

function evaluate(node: Node, get: (name: string) => ComputedValue, today: string): ComputedValue {
  const ev = (n: Node) => evaluate(n, get, today);
  switch (node.k) {
    case 'lit':
      return node.v;
    case 'prop':
      return get(node.name);
    case 'un': {
      const a = ev(node.a);
      return node.op === '-' ? -toNumber(a) : !truthy(a);
    }
    case 'bin': {
      if (node.op === 'and' || node.op === '&&') return truthy(ev(node.a)) && truthy(ev(node.b));
      if (node.op === 'or' || node.op === '||') return truthy(ev(node.a)) || truthy(ev(node.b));
      const a = ev(node.a);
      const b = ev(node.b);
      switch (node.op) {
        case '+':
          return typeof a === 'string' || typeof b === 'string'
            ? `${a ?? ''}${b ?? ''}`
            : toNumber(a) + toNumber(b);
        case '-':
          return toNumber(a) - toNumber(b);
        case '*':
          return toNumber(a) * toNumber(b);
        case '/': {
          const d = toNumber(b);
          return d === 0 ? null : toNumber(a) / d;
        }
        case '==':
          return a === b;
        case '!=':
          return a !== b;
        default: {
          const x = typeof a === 'number' || typeof b === 'number' ? toNumber(a) : String(a ?? '');
          const y = typeof a === 'number' || typeof b === 'number' ? toNumber(b) : String(b ?? '');
          return node.op === '>'
            ? x > y
            : node.op === '<'
              ? x < y
              : node.op === '>='
                ? x >= y
                : x <= y;
        }
      }
    }
    case 'call': {
      const args = node.args;
      switch (node.fn) {
        case 'if':
          if (args.length !== 3) throw new FormulaError('if() takes a condition and two values');
          return truthy(ev(args[0]!)) ? ev(args[1]!) : ev(args[2]!);
        case 'concat':
          return args.map((a) => ev(a) ?? '').join('');
        case 'round': {
          const digits = args[1] ? toNumber(ev(args[1])) : 0;
          const f = 10 ** digits;
          return Math.round(toNumber(ev(args[0]!)) * f) / f;
        }
        case 'length':
          return String(ev(args[0]!) ?? '').length;
        case 'empty': {
          const v = ev(args[0]!);
          return v === null || v === '';
        }
        case 'not':
          return !truthy(ev(args[0]!));
        case 'today':
          return today;
        case 'dateBetween': {
          const a = Date.parse(String(ev(args[0]!) ?? ''));
          const b = Date.parse(String(ev(args[1]!) ?? ''));
          if (Number.isNaN(a) || Number.isNaN(b)) return null;
          const unit = String(ev(args[2] ?? { k: 'lit', v: 'days' }));
          const days = (a - b) / DAY;
          return Math.trunc(unit === 'weeks' ? days / 7 : unit === 'months' ? days / 30.44 : days);
        }
        default:
          throw new FormulaError(`Unknown function ${node.fn}`);
      }
    }
  }
}

/** Checks a formula against a table's properties; returns the problem, if any. */
export function formulaProblem(
  formula: string,
  columns: readonly SpaceColumn[],
): string | undefined {
  try {
    const names = new Set(columns.map((c) => c.name.trim().toLowerCase()));
    const walk = (n: Node): void => {
      if (n.k === 'prop' && !names.has(n.name.trim().toLowerCase()))
        throw new FormulaError(`No property “${n.name}”`);
      if (n.k === 'call') n.args.forEach(walk);
      if (n.k === 'un') walk(n.a);
      if (n.k === 'bin') {
        walk(n.a);
        walk(n.b);
      }
    };
    walk(parseFormula(formula));
    return undefined;
  } catch (error) {
    return error instanceof FormulaError ? error.message : 'That formula can’t be read';
  }
}

/* ------------------------------ computed cells ------------------------------ */

/** A row's value for a property: stored or computed. */
export function valueOf(
  table: SpaceTable,
  row: SpaceRow,
  column: SpaceColumn,
  ctx: DatabaseContext = {},
  depth = 0,
): ComputedValue | SpaceCellValue {
  switch (column.type) {
    case 'createdTime':
      return row.createdAt ?? null;
    case 'updatedTime':
      return row.updatedAt ?? row.createdAt ?? null;
    case 'createdBy':
      return row.createdBy ?? null;
    case 'updatedBy':
      return row.updatedBy ?? row.createdBy ?? null;
    case 'rollup':
      return rollup(table, row, column, ctx);
    case 'formula': {
      if (!column.formula || depth > 4) return null;
      try {
        const byName = new Map(table.columns.map((c) => [c.name.trim().toLowerCase(), c]));
        return evaluate(
          parseFormula(column.formula),
          (name) => {
            const c = byName.get(name.trim().toLowerCase());
            if (!c) throw new FormulaError(`No property “${name}”`);
            if (c.id === column.id) throw new FormulaError('A formula can’t read itself');
            const v = valueOf(table, row, c, ctx, depth + 1);
            return Array.isArray(v) ? cellText(v) : (v as ComputedValue);
          },
          ctx.today ?? new Date().toISOString().slice(0, 10),
        );
      } catch {
        return null;
      }
    }
    default:
      return row.cells[column.id] ?? null;
  }
}

function rollup(table: SpaceTable, row: SpaceRow, column: SpaceColumn, ctx: DatabaseContext) {
  const config = column.rollup;
  if (!config) return null;
  const links = (row.cells[config.relation] as EntityLink[] | undefined) ?? [];
  const related = links.map((l) => ctx.related?.(l));
  switch (config.fn) {
    case 'count':
      return links.length;
    case 'countDone':
      return related.filter((r) => r?.done).length;
    case 'percentDone':
      return links.length
        ? Math.round((related.filter((r) => r?.done).length / links.length) * 100)
        : null;
    case 'sum': {
      if (!config.property) return null;
      let sum = 0;
      for (const r of related) {
        const v = r?.values?.[config.property];
        if (typeof v === 'number') sum += v;
      }
      return sum;
    }
    case 'latest': {
      const dates = related
        .map((r) => {
          const v = config.property ? r?.values?.[config.property] : r?.date;
          return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : undefined;
        })
        .filter((v): v is string => v !== undefined)
        .sort();
      return dates.at(-1) ?? null;
    }
    default:
      void table;
      return null;
  }
}

/* --------------------------------- views --------------------------------- */

function textOf(v: ComputedValue | SpaceCellValue): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return cellText(v);
  return String(v);
}

function matches(table: SpaceTable, row: SpaceRow, f: SpaceFilter, ctx: DatabaseContext): boolean {
  const column = table.columns.find((c) => c.id === f.column);
  if (!column) return true;
  const v = valueOf(table, row, column, ctx);
  const t = textOf(v).toLowerCase();
  const want = (f.value ?? '').toLowerCase();
  switch (f.op) {
    case 'contains':
      return t.includes(want);
    case 'is':
      return Array.isArray(v)
        ? v.some((x) => textOf(x as never).toLowerCase() === want)
        : t === want;
    case 'isNot':
      return Array.isArray(v)
        ? !v.some((x) => textOf(x as never).toLowerCase() === want)
        : t !== want;
    case 'isEmpty':
      return t === '';
    case 'isNotEmpty':
      return t !== '';
    case 'gt':
      return typeof v === 'number' && v > Number(f.value);
    case 'lt':
      return typeof v === 'number' && v < Number(f.value);
    case 'before':
      return t !== '' && t.slice(0, 10) < want;
    case 'after':
      return t !== '' && t.slice(0, 10) > want;
    case 'checked':
      return v === true;
    case 'unchecked':
      return v !== true;
    default:
      return true;
  }
}

function compare(a: ComputedValue | SpaceCellValue, b: ComputedValue | SpaceCellValue): number {
  const empty = (x: unknown) => x === null || x === undefined || x === '';
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1; // empties last
  if (empty(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return textOf(a).localeCompare(textOf(b), undefined, { numeric: true, sensitivity: 'base' });
}

export interface ViewResult {
  rows: SpaceRow[];
  /** Board columns or grouped lists, in the property's option order. */
  groups?: { key: string; rows: SpaceRow[] }[];
  /** Properties shown, in order. */
  columns: SpaceColumn[];
}

/** A view of a table: its rows filtered and sorted, grouped if asked, and its columns. */
export function applyView(
  table: SpaceTable,
  view: Partial<SpaceView> | undefined,
  ctx: DatabaseContext = {},
): ViewResult {
  let rows = table.rows.filter((r) =>
    (view?.filters ?? []).every((f) => matches(table, r, f, ctx)),
  );
  const sorts = view?.sorts ?? [];
  if (sorts.length) {
    const byId = new Map(table.columns.map((c) => [c.id, c]));
    rows = [...rows].sort((a, b) => {
      for (const s of sorts) {
        const c = byId.get(s.column);
        if (!c) continue;
        const d = compare(valueOf(table, a, c, ctx), valueOf(table, b, c, ctx));
        if (d) return s.dir === 'desc' ? -d : d;
      }
      return 0;
    });
  }
  const order = view?.order?.length
    ? [
        ...view.order
          .map((id) => table.columns.find((c) => c.id === id))
          .filter((c): c is SpaceColumn => !!c),
        ...table.columns.filter((c) => !view.order!.includes(c.id)),
      ]
    : table.columns;
  const hidden = new Set(view?.hidden ?? []);
  const columns = order.filter((c) => !hidden.has(c.id));
  const group = view?.groupBy ? table.columns.find((c) => c.id === view.groupBy) : undefined;
  if (!group) return { rows, columns };
  const keys = [...(group.options ?? []).map((o) => o.name)];
  const buckets = new Map<string, SpaceRow[]>(keys.map((k) => [k, []]));
  const none: SpaceRow[] = [];
  for (const r of rows) {
    const v = valueOf(table, r, group, ctx);
    const values = Array.isArray(v) ? v.map((x) => textOf(x as never)) : [textOf(v)];
    const placed = values.filter((k) => k !== '');
    if (!placed.length) none.push(r);
    for (const k of placed) {
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(r);
    }
  }
  const groups = [...buckets.entries()].map(([key, list]) => ({ key, rows: list }));
  if (none.length) groups.push({ key: '', rows: none });
  return { rows, groups, columns };
}

/** A table as CSV (computed values included), RFC 4180 quoting. */
export function tableToCsv(table: SpaceTable, ctx: DatabaseContext = {}): string {
  const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [table.columns.map((c) => q(c.name)).join(',')];
  for (const r of table.rows) {
    lines.push(table.columns.map((c) => q(textOf(valueOf(table, r, c, ctx)))).join(','));
  }
  return lines.join('\n');
}

/** Parses CSV text into a header and rows (quotes, escaped quotes and newlines in quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
