# Data model

Source of truth: `src/types/domain.ts` (TypeScript types) and `src/db/schema.ts`
(Zod schemas for persisted records, schema version, store layout). Each schema is
declared with `satisfies z.ZodMiniType<T>`, so a schema that drifts from its type is
a compile error (verified during PHASE 000 by deleting a field and running `tsc`).

## Conventions

### IDs

- Every record's primary key is `id: string`, a **UUID v4** from `crypto.randomUUID()`
  (`src/lib/ids.ts`).
- Random ids let records be created offline, on any device, and merged later without
  coordination or collisions. They carry no ordering; order by timestamps.
- `crypto.randomUUID` requires a secure context (HTTPS or `localhost`).
- Schemas validate ids with `z.uuid()`.

### Timestamps (instants)

- Type alias `Timestamp`. Stored as an **ISO 8601 string in UTC with milliseconds**,
  exactly as produced by `Date#toISOString()`: `2026-09-28T14:03:11.402Z`.
- Fixed width and UTC, so lexicographic order = chronological order, which makes them
  valid, correctly sorted IndexedDB index keys. Offsets (`+05:30`) and date-only
  strings are rejected by validation.
- Used for: `createdAt`, `updatedAt`, `completedAt`, `processedAt`, `Task.dueAt`.
  (Hackathon dates were timestamps until schema V3; they are now `LocalDate`s.)

### Date-only deadlines (`Task.dueAt`, ADR-016)

The Tasks UI sets deadlines by calendar day. `dueAt` stays a `Timestamp` (no schema
change), with this convention:

| Step       | Rule                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| User input | `<input type="date">` gives a calendar day `YYYY-MM-DD`, as the user sees it                                              |
| Storage    | `deadlineFromLocalDate(day)` → `` `${day}T12:00:00.000Z` `` (UTC noon _of that date_)                                     |
| Reading    | `localDateOfDeadline(dueAt)` → `dueAt.slice(0, 10)`, the UTC date part                                                    |
| Rendering  | the day is compared with today's **local** day (`useToday`) by calendar days: overdue / today / tomorrow / weekday / date |

The day is encoded in the UTC fields, so it is identical in every time zone and
never moves with DST or travel. **Never** derive the day with `new Date(dueAt)` in
local time: in zones at UTC+12 or further east (e.g. New Zealand in summer) that lands
on the next day.
Tests set `process.env.TZ` to zones up to 17 hours apart to check this.

Consequence: a `dueAt` currently means "due on this day", not a time of day. If
time-of-day deadlines are ever needed, add an explicit field in a schema version
bump rather than overloading this one.

### Local dates (calendar days)

- Type alias `LocalDate`. Stored as **`YYYY-MM-DD` in the user's local time zone**.
- Used where the meaning is "which day in my life", not "which instant":
  `HabitEntry.date`, `ProtectedTime.date`. A habit done at 23:30 belongs to that local
  day regardless of the UTC date.
- Helpers: `toLocalDate(date)`, `fromLocalDate(value)` (local midnight; throws on
  impossible dates like `2026-02-30`).

### Three kinds of date, kept apart

| Concept            | Type                                    | Stored as                             | Used by                                                                          |
| ------------------ | --------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| Instant            | `Timestamp`                             | ISO 8601 UTC (`toISOString()`)        | `createdAt`, `updatedAt`, `completedAt`, `processedAt`                           |
| Calendar day       | `LocalDate`                             | `YYYY-MM-DD` in the user's local zone | `Task.plannedFor`, `ProtectedTime.date`, `HabitEntry.date`, hackathon dates (V3) |
| Date-only deadline | `Timestamp` by type, a _day_ by meaning | UTC noon of the chosen date (ADR-016) | `Task.dueAt`                                                                     |

Never convert `plannedFor` or `ProtectedTime.date` into timestamps, and never read the
day of a `dueAt` in local time. Comparisons with "today" always use today's
`LocalDate` (`useToday`).

### Optional fields

Absent optional fields are **omitted** — never stored as `undefined` or `null`.
Schemas use `z.exactOptional` and reject both; repositories strip `undefined` keys
before validating.

### Enumerations

String-literal unions backed by `as const` arrays (e.g. `TASK_STATUSES`), shared by
types, schemas and (later) UI pickers. Strings are stored, not numeric codes, so data
stays readable in exports and devtools.

## Entities

### Task — store `tasks`, indexes `status, dueAt, createdAt, plannedFor` (V2)

| Field        | Type                               | Notes                                     |
| ------------ | ---------------------------------- | ----------------------------------------- |
| id           | Id                                 |                                           |
| title        | string                             | non-empty after trim                      |
| notes?       | string                             |                                           |
| status       | `todo \| doing \| done \| dropped` |                                           |
| priority     | `low \| normal \| high`            | default `normal`                          |
| dueAt?       | Timestamp                          |                                           |
| project?     | string                             | free-text label; no Project entity yet    |
| plannedFor?  | LocalDate                          | V2: day you chose to work on it (ADR-019) |
| createdAt    | Timestamp                          |                                           |
| completedAt? | Timestamp                          | set when completed; cleared on reopen     |
| updatedAt    | Timestamp                          |                                           |

Task lifecycle: `todo → done` (complete), `todo → dropped` (drop), `done|dropped →
todo` (reopen). Nothing deletes a task. `doing` exists in the model but no UI sets it
yet; it counts as open.

`plannedFor` vs `dueAt`: a deadline says when something must be done; `plannedFor`
says which day you chose to work on it. They are independent: `planFor` and
`removeFromPlan` never touch `dueAt`, and `update` with `dueAt` never touches
`plannedFor`. `plannedFor` survives complete/drop/reopen (a record of intent). Reopen
never sets one, and Today ignores closed tasks, so a kept `plannedFor` never
resurfaces a finished task.

### InboxItem — store `inbox`, index `createdAt`

| Field              | Type      | Notes                        |
| ------------------ | --------- | ---------------------------- |
| id                 | Id        |                              |
| content            | string    | non-empty after trim         |
| createdAt          | Timestamp |                              |
| processedAt?       | Timestamp | set once dealt with          |
| convertedToTaskId? | Id        | set when converted to a task |

An item is processed exactly once, in one of two ways, and is **kept** either way:

- **converted** — `processedAt` + `convertedToTaskId` (atomic with creating the task);
- **cleared** (needs no action) — `processedAt` only.

Nothing deletes inbox items. There's no screen for processed items yet, but the
history is there.

`processedAt` is not indexed (absent values aren't indexable); "unprocessed" is a
filter over `createdAt` order. Fine at personal-data scale.

### Habit — store `habits`, index `createdAt`

| Field     | Type                                                           | Notes                                             |
| --------- | -------------------------------------------------------------- | ------------------------------------------------- |
| id        | Id                                                             |                                                   |
| name      | string                                                         | non-empty                                         |
| category  | `coding \| learning \| fitness \| health \| money \| personal` | no relationship category, by design (see below)   |
| unit      | `check \| count \| minutes`                                    | `check` entries store value 1                     |
| target?   | number > 0                                                     | daily amount that counts as done                  |
| archived  | boolean                                                        | not indexed: booleans aren't valid IndexedDB keys |
| createdAt | Timestamp                                                      |                                                   |

There is deliberately **no relationship, family or friends habit category**. Time
with people is never tracked as a habit, streak, score or activity square; it is
modelled only as `ProtectedTime` (kinds `relationship`, `family`, `friends`, …) so it
is visible and defended, not measured. See DECISIONS.md ADR-013.

### HabitEntry — store `habitEntries`, indexes `habitId, date, &[habitId+date]`

| Field                | Type       | Notes |
| -------------------- | ---------- | ----- |
| id                   | Id         |       |
| habitId              | Id         |       |
| date                 | LocalDate  |       |
| value                | number ≥ 0 |       |
| note?                | string     |       |
| createdAt, updatedAt | Timestamp  |       |

The unique compound index guarantees **at most one entry per habit per day** (tested).

**Habit semantics (PHASE 003, ADR-023).** No schema change: V2 stays current.

- **Stored value rules** (the storage schema still only says `value ≥ 0`; these are
  enforced by the repository):
  - `check`: 1;
  - `count`: a positive whole number;
  - `minutes`: greater than 0 and up to 1440.
- **No entry = no recorded activity.** Clearing deletes the row; zeros are never
  stored.
- **Upsert.** Logging the same habit on the same day updates the existing row (same
  `id` and `createdAt`, new `value`, `note` and `updatedAt`).
- **Targets:** optional, and only for `count` and `minutes`. A habit's `unit` never
  changes after creation.
- **Archiving** sets `archived: true`. Entries are kept and still count in the grid's
  history. Habits are never deleted.
- **Querying.** `date` is a `LocalDate` and decides the day, never the timestamps.
  Range reads use the `date` index (`between(start, end)`), which is one query for the
  whole grid. `archived` isn't indexed; active habits are filtered in memory (a
  handful of records).
- **Grid levels** (0–4) are computed for display and never stored (ADR-024, ADR-025).

### Hackathon — store `hackathons`, indexes `status, registrationDeadline, eventStart` (repository since PHASE 004)

| Field                                         | Type                                                     | Notes                                                           |
| --------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| id                                            | Id                                                       |                                                                 |
| name                                          | string                                                   | the only required input                                         |
| registrationDeadline?, eventStart?, eventEnd? | LocalDate (V3; timestamps before)                        | `eventEnd` needs `eventStart`, not earlier                      |
| registrationStatus                            | `not_registered \| registered \| waitlisted \| rejected` | default `not_registered`; UI says "Not selected" for `rejected` |
| pptStatus                                     | `not_needed \| not_started \| in_progress \| submitted`  | default `not_started`                                           |
| buildStatus                                   | `not_started \| in_progress \| demo_ready \| submitted`  | default `not_started`                                           |
| team?, problemStatement?, nextAction?, notes? | string                                                   | trimmed; blank = omitted                                        |
| status                                        | `considering \| active \| finished \| dropped`           | default `considering`; user-controlled only                     |
| createdAt, updatedAt                          | Timestamp                                                |                                                                 |

Hackathons are never deleted; finished and dropped keep every field. `nextAction` is
plain text and is never turned into a task or completed automatically. Nothing about a
hackathon touches habits or the activity grid.

### ProtectedTime — store `protectedTime`, index `date` (repository since PHASE 002)

| Field  | Type                                                    |
| ------ | ------------------------------------------------------- |
| id     | Id                                                      |
| title  | string                                                  |
| date   | LocalDate                                               |
| kind   | `relationship \| family \| friends \| rest \| personal` |
| notes? | string                                                  |

## Database

- IndexedDB database name: `lowtide` (`DATABASE_NAME`). Never rename it — that would
  orphan existing data.
- `SCHEMA_VERSION = 3` (PHASE 004). Version history:

| Version | Phase | Stores changed                              | Record changes                           | Upgrade function |
| ------- | ----- | ------------------------------------------- | ---------------------------------------- | ---------------- |
| 1       | 000   | all six created (`STORES_V1`)               | —                                        | —                |
| 2       | 002   | `tasks`: + `plannedFor` index (`STORES_V2`) | `Task.plannedFor?: LocalDate` (optional) | none needed      |

**V1 → V2 migration, exactly.** When a V1 database is opened, Dexie runs the version-2
schema step. It adds the `plannedFor` index to the `tasks` object store, and IndexedDB
builds it from existing records (none have the field, so the index starts empty).
Nothing else changes: no record is rewritten, other stores and indexes are untouched,
and V1 tasks validate against the V2 schema unchanged, because `plannedFor` is optional.
Tested in `src/test/migration.test.ts` against a database created with a bare V1
definition.

**V2 → V3 migration, exactly.** Dexie runs the version-3 upgrade over every
`hackathons` record with `migrateHackathonToV3` (`src/db/migrations.ts`, pure). For each
of `registrationDeadline`, `eventStart` and `eventEnd`:

| Stored value                                    | After V3                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| absent                                          | absent                                                                        |
| real `YYYY-MM-DD`                               | kept                                                                          |
| ISO timestamp (`…T…Z` or `±hh:mm`)              | its **UTC** date component, e.g. `2026-10-04T01:00:00+05:30` → `2026-10-03`   |
| anything else (text, numbers, impossible dates) | field removed; appended to `notes` as `[Moved by LOWTIDE upgrade] field: raw` |

Afterwards, an `eventEnd` without an `eventStart`, or before it, is also moved to notes.
Other stores and indexes are untouched. Tested in `src/test/migration-v3.test.ts`
against a genuine V2 database, which also holds tasks with `plannedFor`, habits,
entries and protected time; all of them survive unchanged. Dexie stores versions ×10 internally, so browser devtools show
the native IndexedDB version as `10`.

## Migrations

1. Never edit a shipped `this.version(n)` block in `src/db/database.ts`.
2. Add `STORES_V{n+1}` in `schema.ts` (only stores/indexes that change need listing;
   pass `null` to delete a store) and append
   `this.version(n + 1).stores(STORES_V{n+1}).upgrade(tx => …)` for any data rewrite.
3. Bump `SCHEMA_VERSION`; the database test asserts the opened version equals it.
4. Upgrades must be non-destructive and idempotent in effect; keep user data.
5. Add a test that seeds data at version n, opens at n+1, and asserts the result.
6. Record the change in `CHANGELOG.md` and the phase report.
