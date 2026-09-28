import { z } from 'zod/mini';
import {
  BUILD_STATUSES,
  HABIT_CATEGORIES,
  HABIT_UNITS,
  HACKATHON_STATUSES,
  PPT_STATUSES,
  PROTECTED_TIME_KINDS,
  REGISTRATION_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Habit,
  type HabitEntry,
  type Hackathon,
  type InboxItem,
  type ProtectedTime,
  type Task,
} from '../types/domain';

/**
 * Persisted-record schemas and the IndexedDB store layout.
 *
 * Every record is validated with these schemas before it is written, and they
 * are the gate for any future import. `satisfies z.ZodMiniType<T>` keeps each
 * schema in lockstep with its domain type: drift is a compile error.
 */

const id = z.uuid();
const timestamp = z.iso.datetime();
const localDate = z.iso.date();
const text = z.string().check(z.trim(), z.minLength(1));

export const taskSchema = z.object({
  id,
  title: text,
  notes: z.exactOptional(z.string()),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  dueAt: z.exactOptional(timestamp),
  project: z.exactOptional(text),
  createdAt: timestamp,
  completedAt: z.exactOptional(timestamp),
  updatedAt: timestamp,
}) satisfies z.ZodMiniType<Task>;

export const inboxItemSchema = z.object({
  id,
  content: text,
  createdAt: timestamp,
  processedAt: z.exactOptional(timestamp),
  convertedToTaskId: z.exactOptional(id),
}) satisfies z.ZodMiniType<InboxItem>;

export const habitSchema = z.object({
  id,
  name: text,
  category: z.enum(HABIT_CATEGORIES),
  unit: z.enum(HABIT_UNITS),
  target: z.exactOptional(z.number().check(z.positive())),
  archived: z.boolean(),
  createdAt: timestamp,
}) satisfies z.ZodMiniType<Habit>;

export const habitEntrySchema = z.object({
  id,
  habitId: id,
  date: localDate,
  value: z.number().check(z.nonnegative()),
  note: z.exactOptional(z.string()),
  createdAt: timestamp,
  updatedAt: timestamp,
}) satisfies z.ZodMiniType<HabitEntry>;

export const hackathonSchema = z.object({
  id,
  name: text,
  registrationDeadline: z.exactOptional(timestamp),
  eventStart: z.exactOptional(timestamp),
  eventEnd: z.exactOptional(timestamp),
  registrationStatus: z.enum(REGISTRATION_STATUSES),
  pptStatus: z.enum(PPT_STATUSES),
  buildStatus: z.enum(BUILD_STATUSES),
  team: z.exactOptional(z.string()),
  problemStatement: z.exactOptional(z.string()),
  nextAction: z.exactOptional(z.string()),
  status: z.enum(HACKATHON_STATUSES),
  notes: z.exactOptional(z.string()),
  createdAt: timestamp,
  updatedAt: timestamp,
}) satisfies z.ZodMiniType<Hackathon>;

export const protectedTimeSchema = z.object({
  id,
  title: text,
  date: localDate,
  kind: z.enum(PROTECTED_TIME_KINDS),
  notes: z.exactOptional(z.string()),
}) satisfies z.ZodMiniType<ProtectedTime>;

/**
 * IndexedDB name. Changing it abandons existing user data; don't.
 */
export const DATABASE_NAME = 'lowtide';

/**
 * Current schema version. Bump it (never edit a shipped version) when the
 * store layout or record shape changes; see docs/DATA-MODEL.md#migrations.
 */
export const SCHEMA_VERSION = 1;

/**
 * Dexie store definitions for version 1. First entry is the primary key;
 * the rest are indexes. `&` = unique, `[a+b]` = compound. Only fields we
 * query by are indexed. Booleans are not valid IndexedDB keys, so
 * `habits.archived` is deliberately not indexed.
 */
export const STORES_V1 = {
  tasks: 'id, status, dueAt, createdAt',
  inbox: 'id, createdAt',
  habits: 'id, createdAt',
  habitEntries: 'id, habitId, date, &[habitId+date]',
  hackathons: 'id, status, registrationDeadline, eventStart',
  protectedTime: 'id, date',
} as const;
