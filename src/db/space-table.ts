import {
  DERIVED_COLUMN_TYPES,
  type SpaceCellValue,
  type SpaceColumn,
  type SpaceColumnType,
} from '../types/domain';

/*
 * Pure rules for SPACE database cells (v2.1): which values a property type
 * holds, and how a value is carried over when a property changes type. A
 * conversion that would lose a value returns `undefined` so the caller can
 * refuse the change instead of silently dropping data.
 */

export const isDerived = (type: SpaceColumnType) => DERIVED_COLUMN_TYPES.includes(type);

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True when `value` is a valid cell for a property of `type`. */
export function cellFits(type: SpaceColumnType, value: SpaceCellValue): boolean {
  switch (type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'multiSelect':
      return Array.isArray(value) && value.every((v) => typeof v === 'string');
    case 'link':
      return Array.isArray(value) && value.every((v) => typeof v === 'object' && v !== null);
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    default:
      return !isDerived(type) && typeof value === 'string';
  }
}

/** A cell's plain text (for conversions, search and CSV). */
export function cellText(value: SpaceCellValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value))
    return value.map((v) => (typeof v === 'string' ? v : (v.label ?? v.id))).join(', ');
  return String(value);
}

/**
 * `value` as a cell of `to`, or `undefined` when it can't be carried over
 * without losing what it says.
 */
export function convertCell(
  value: SpaceCellValue,
  to: SpaceColumnType,
): SpaceCellValue | undefined {
  if (cellFits(to, value)) return value;
  if (isDerived(to)) return undefined;
  const text = cellText(value).trim();
  switch (to) {
    case 'text':
    case 'url':
    case 'select':
    case 'status':
      return Array.isArray(value) && value.some((v) => typeof v !== 'string') ? undefined : text;
    case 'number': {
      if (typeof value === 'boolean') return undefined;
      const n = Number(text.replace(/,/g, ''));
      return text && Number.isFinite(n) ? n : undefined;
    }
    case 'boolean': {
      const t = text.toLowerCase();
      if (['yes', 'true', '1', 'x', '✓', 'done'].includes(t)) return true;
      if (['no', 'false', '0', ''].includes(t)) return false;
      return undefined;
    }
    case 'multiSelect':
      return typeof value === 'string' || typeof value === 'number'
        ? text
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        : undefined;
    case 'date':
      if (LOCAL_DATE.test(text) || !Number.isNaN(Date.parse(text))) return text;
      return undefined;
    default:
      return undefined;
  }
}

/** Options a select/status/multi-select property needs so every cell is one of them. */
export function optionsFor(column: SpaceColumn, values: readonly SpaceCellValue[]) {
  if (!['select', 'status', 'multiSelect'].includes(column.type)) return column.options;
  const names = new Set((column.options ?? []).map((o) => o.name));
  const out = [...(column.options ?? [])];
  for (const v of values) {
    for (const name of Array.isArray(v) ? v : [v]) {
      if (typeof name === 'string' && name && !names.has(name)) {
        names.add(name);
        out.push({ name });
      }
    }
  }
  return out;
}
