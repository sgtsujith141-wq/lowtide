import { format } from 'date-fns';
import type { ComputedValue } from '../../../lib/space-database';
import {
  DERIVED_COLUMN_TYPES,
  type EntityLink,
  type LinkableType,
  type SpaceCellValue,
  type SpaceColumn,
  type SpaceColumnType,
  type SpaceFilterOp,
  type SpaceRow,
  type SpaceTable,
  type SpaceView,
  type SpaceViewType,
} from '../../../types/domain';

/*
 * SPACE databases in the app (v2.1): words for property types, views and
 * filter operators, and how values read. Shared by every layout.
 */

/** Property types in the order the picker offers them, with plain names. */
export const TYPE_LABEL: Record<SpaceColumnType, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Checkbox',
  date: 'Date',
  status: 'Status',
  select: 'Select',
  multiSelect: 'Multi-select',
  url: 'URL',
  link: 'Relation',
  createdTime: 'Created time',
  updatedTime: 'Updated time',
  createdBy: 'Created by',
  updatedBy: 'Updated by',
  rollup: 'Rollup',
  formula: 'Formula',
};

export const TYPE_ORDER = Object.keys(TYPE_LABEL) as SpaceColumnType[];

export const VIEW_LABEL: Record<SpaceViewType, string> = {
  table: 'Table',
  board: 'Board',
  list: 'List',
  calendar: 'Calendar',
};

export const OP_LABEL: Record<SpaceFilterOp, string> = {
  contains: 'contains',
  is: 'is',
  isNot: 'is not',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  gt: 'is more than',
  lt: 'is less than',
  before: 'is before',
  after: 'is after',
  checked: 'is checked',
  unchecked: 'is not checked',
};

/** Operators that make sense for a property type. */
export function opsFor(type: SpaceColumnType): SpaceFilterOp[] {
  switch (type) {
    case 'boolean':
      return ['checked', 'unchecked'];
    case 'number':
    case 'rollup':
      return ['is', 'gt', 'lt', 'isEmpty', 'isNotEmpty'];
    case 'date':
    case 'createdTime':
    case 'updatedTime':
      return ['before', 'after', 'is', 'isEmpty', 'isNotEmpty'];
    default:
      return ['contains', 'is', 'isNot', 'isEmpty', 'isNotEmpty'];
  }
}

/** Operators that take no value. */
export const NO_VALUE: readonly SpaceFilterOp[] = ['isEmpty', 'isNotEmpty', 'checked', 'unchecked'];

export const LINK_TARGETS: LinkableType[] = [
  'project',
  'task',
  'milestone',
  'decision',
  'hackathon',
  'projectItem',
  'spaceNode',
];

export const isComputed = (c: SpaceColumn) => DERIVED_COLUMN_TYPES.includes(c.type);
export const isChoice = (c: SpaceColumn) => c.type === 'select' || c.type === 'status';
export const isDateLike = (c: SpaceColumn) =>
  c.type === 'date' || c.type === 'createdTime' || c.type === 'updatedTime';

/** The implicit view of a database that has no saved views yet. */
export const DEFAULT_VIEW: SpaceView = { id: '__default', name: 'Table', type: 'table' };

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** How a value reads in a cell, a card or a list. */
export function display(value: ComputedValue | SpaceCellValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value))
    return (value as (string | EntityLink)[])
      .map((x) => (typeof x === 'string' ? x : (x.label ?? x.type)))
      .join(', ');
  if (typeof value === 'string' && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value)))
    return format(new Date(value), 'd MMM yyyy, HH:mm');
  return String(value);
}

/** A row's name: its first property's value (or "Untitled"). */
export function rowTitle(table: SpaceTable, row: SpaceRow): string {
  const first = table.columns[0];
  const value = first ? display(row.cells[first.id]) : '';
  return value || 'Untitled';
}

/** A name not yet used by another view. */
export function freshViewName(views: readonly SpaceView[], base: string): string {
  const names = new Set(views.map((v) => v.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}
