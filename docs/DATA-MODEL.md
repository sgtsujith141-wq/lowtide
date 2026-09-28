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
- Used for: `createdAt`, `updatedAt`, `completedAt`, `processedAt`, `Task.dueAt`,
  `Hackathon.registrationDeadline / eventStart / eventEnd`.

### Local dates (calendar days)

- Type alias `LocalDate`. Stored as **`YYYY-MM-DD` in the user's local time zone**.
- Used where the meaning is "which day in my life", not "which instant":
  `HabitEntry.date`, `ProtectedTime.date`. A habit done at 23:30 belongs to that local
  day regardless of the UTC date.
- Helpers: `toLocalDate(date)`, `fromLocalDate(value)` (local midnight; throws on
  impossible dates like `2026-02-30`).

### Optional fields

Absent optional fields are **omitted** — never stored as `undefined` or `null`.
Schemas use `z.exactOptional` and reject both; repositories strip `undefined` keys
before validating.

### Enumerations

String-literal unions backed by `as const` arrays (e.g. `TASK_STATUSES`), shared by
types, schemas and (later) UI pickers. Strings are stored, not numeric codes, so data
stays readable in exports and devtools.

## Entities

### Task — store `tasks`, indexes `status, dueAt, createdAt`

| Field        | Type                               | Notes                                  |
| ------------ | ---------------------------------- | -------------------------------------- |
| id           | Id                                 |                                        |
| title        | string                             | non-empty after trim                   |
| notes?       | string                             |                                        |
| status       | `todo \| doing \| done \| dropped` |                                        |
| priority     | `low \| normal \| high`            | default `normal`                       |
| dueAt?       | Timestamp                          |                                        |
| project?     | string                             | free-text label; no Project entity yet |
| createdAt    | Timestamp                          |                                        |
| completedAt? | Timestamp                          | set when marked done                   |
| updatedAt    | Timestamp                          |                                        |

### InboxItem — store `inbox`, index `createdAt`

| Field              | Type      | Notes                        |
| ------------------ | --------- | ---------------------------- |
| id                 | Id        |                              |
| content            | string    | non-empty after trim         |
| createdAt          | Timestamp |                              |
| processedAt?       | Timestamp | set once dealt with          |
| convertedToTaskId? | Id        | set when converted to a task |

`processedAt` is not indexed (absent values aren't indexable); "unprocessed" is a
filter over `createdAt` order. Fine at personal-data scale.

### Habit — store `habits`, index `createdAt`

| Field     | Type                                                                            | Notes                                             |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------- |
| id        | Id                                                                              |                                                   |
| name      | string                                                                          | non-empty                                         |
| category  | `coding \| learning \| fitness \| health \| money \| relationships \| personal` |                                                   |
| unit      | `check \| count \| minutes`                                                     | `check` entries store value 1                     |
| target?   | number > 0                                                                      | daily amount that counts as done                  |
| archived  | boolean                                                                         | not indexed: booleans aren't valid IndexedDB keys |
| createdAt | Timestamp                                                                       |                                                   |

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

### Hackathon — store `hackathons`, indexes `status, registrationDeadline, eventStart`

| Field                                         | Type                                                     |
| --------------------------------------------- | -------------------------------------------------------- |
| id                                            | Id                                                       |
| name                                          | string                                                   |
| registrationDeadline?, eventStart?, eventEnd? | Timestamp                                                |
| registrationStatus                            | `not_registered \| registered \| waitlisted \| rejected` |
| pptStatus                                     | `not_needed \| not_started \| in_progress \| submitted`  |
| buildStatus                                   | `not_started \| in_progress \| demo_ready \| submitted`  |
| team?, problemStatement?, nextAction?, notes? | string                                                   |
| status                                        | `considering \| active \| finished \| dropped`           |
| createdAt, updatedAt                          | Timestamp                                                |

### ProtectedTime — store `protectedTime`, index `date`

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
- `SCHEMA_VERSION = 1`. Dexie stores versions ×10 internally, so browser devtools show
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
