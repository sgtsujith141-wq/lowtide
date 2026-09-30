import type { NotionId, NotionPropertySchema } from './types';

/*
 * Notion row values, as a view query returns them: text as strings, numbers
 * as numbers, checkboxes as `__YES__`/`__NO__`, relations and multi-selects
 * as JSON-encoded arrays, dates split into `date:<name>:start|end|is_datetime`
 * keys, rollups as opaque `rollupResult://` references. Pure helpers.
 */

const ID = /([0-9a-f]{32})(?:[?#].*)?$/;
const DASHED = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/;

/** The 32-hex id in a Notion URL or id (dashed or not), or undefined. */
export function notionIdOf(value: string): NotionId | undefined {
  const dashed = DASHED.exec(value);
  if (dashed) return dashed.slice(1).join('');
  return ID.exec(value.replace(/-/g, ''))?.[1];
}

export type Row = Record<string, unknown>;

export function text(row: Row, property: string | undefined): string | undefined {
  if (!property) return undefined;
  const value = row[property];
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return undefined;
  if (value.startsWith('rollupResult://')) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function checkbox(row: Row, property: string | undefined): boolean | undefined {
  if (!property) return undefined;
  const value = row[property];
  if (value === '__YES__' || value === true) return true;
  if (value === '__NO__' || value === false) return false;
  return undefined;
}

export function number(row: Row, property: string | undefined): number | undefined {
  if (!property) return undefined;
  const value = row[property];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A JSON-encoded string array (relations, multi-selects), or an array. */
export function list(row: Row, property: string | undefined): string[] {
  if (!property) return [];
  const value = row[property];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value !== 'string' || !value.trim().startsWith('[')) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Related row ids of a relation property. */
export function relation(row: Row, property: string | undefined): NotionId[] {
  return list(row, property)
    .map(notionIdOf)
    .filter((id): id is NotionId => id !== undefined);
}

export interface NotionDate {
  start: string;
  end?: string;
  /** False for a calendar day, true for an instant. */
  isDateTime: boolean;
}

export function date(row: Row, property: string | undefined): NotionDate | undefined {
  if (!property) return undefined;
  const start = row[`date:${property}:start`];
  if (typeof start !== 'string' || start === '') return undefined;
  const end = row[`date:${property}:end`];
  return {
    start,
    ...(typeof end === 'string' && end !== '' ? { end } : {}),
    isDateTime: row[`date:${property}:is_datetime`] === 1,
  };
}

/** The calendar day of a Notion date (its first 10 characters when valid). */
export function localDay(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

/** An ISO instant, normalised to `toISOString()` form; undefined if not one. */
export function instant(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** The row's own id (from its `url`). */
export function rowId(row: Row): NotionId | undefined {
  return typeof row.url === 'string' ? notionIdOf(row.url) : undefined;
}

/** The title property's name in a schema. */
export function titleProperty(schema: Record<string, NotionPropertySchema>): string | undefined {
  return Object.values(schema).find((p) => p.type === 'title')?.name;
}

/** When a row was created, from its `created_time` property if the schema has one. */
export function createdTime(
  row: Row,
  schema: Record<string, NotionPropertySchema>,
): string | undefined {
  for (const property of Object.values(schema)) {
    if (property.type === 'created_time') return instant(row[property.name]);
  }
  return instant(row.createdTime);
}

/** When a row was last edited, from its `last_edited_time` property if any. */
export function editedTime(
  row: Row,
  schema: Record<string, NotionPropertySchema>,
): string | undefined {
  for (const property of Object.values(schema)) {
    if (property.type === 'last_edited_time') return instant(row[property.name]);
  }
  return undefined;
}

/** Undoes the backslash escapes Notion adds to plain text values (`\~`, `\$`, `\[`…). */
export function unescapeNotion(value: string): string {
  return value.replace(/\\([~$[\]<>*_`#|\\-])/g, '$1');
}
