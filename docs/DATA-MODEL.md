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
| researchStatus?                               | `not_started \| in_progress \| done`                     | V6; absent reads as not started                                 |
| projectId?                                    | Id                                                       | V4; a Project tracking the build, set only on request           |
| archivedAt?, pinnedAt?                        | Timestamp                                                | V10; archived (restorable) and pinned                           |
| kind?                                         | `hackathon \| ctf`                                       | V11 (ADR-072); absent reads as a hackathon                      |
| selection?                                    | `applied \| shortlisted \| selected \| rejected`         | V11 (ADR-072); the organisers' answer; absent = nothing yet     |
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
- `SCHEMA_VERSION = 11` (v2.2). Version history (V5 onwards is described in the
  sections below):

| Version | Phase  | Stores changed                                                          | Record changes                                                 | Upgrade function       |
| ------- | ------ | ----------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------- |
| 1       | 000    | all six created (`STORES_V1`)                                           | —                                                              | —                      |
| 2       | 002    | `tasks`: + `plannedFor` index (`STORES_V2`)                             | `Task.plannedFor?: LocalDate` (optional)                       | none needed            |
| 3       | 004    | none (`STORES_V3`)                                                      | hackathon dates become `LocalDate`                             | `migrateHackathonToV3` |
| 4       | v2 002 | nine new stores; `tasks`/`hackathons` + `projectId` index (`STORES_V4`) | optional `Task.projectId`/`milestoneId`, `Hackathon.projectId` | none (additive)        |
| 5–9     | v2     | `collegeItems`, `notes`, `spaceNodes`, `sourceRecords`                  | see Schema V5–V9 below                                         | none (additive)        |
| 10      | v2.1   | `tasks` + `parentId` index (`STORES_V10`)                               | subtasks, archives, pins, descriptions, SPACE databases        | none (additive)        |
| 11      | v2.2   | none (`STORES_V11`)                                                     | optional `Hackathon.kind`, `Hackathon.selection`               | none (additive)        |

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

PHASE 006 changed no persisted shape. Week-ahead protected time uses ordinary
`ProtectedTime` records, and Rhythm groups read the existing `Habit.category`.
`SCHEMA_VERSION` stays 3 and `BACKUP_FORMAT_VERSION` stays 1 (verified by a backup
round-trip test).

## Backups (PHASE 005)

A backup file is the JSON envelope of ADR-031:

- `format: "lowtide-backup"`;
- `formatVersion` (currently 1, `BACKUP_FORMAT_VERSION`);
- `schemaVersion` (the database schema of the data);
- `exportedAt` (a timestamp);
- `data` with all six stores: `tasks`, `inbox`, `habits`, `habitEntries`,
  `hackathons`, `protectedTime`.

Records are stored exactly as in IndexedDB. Each store is sorted: records with
`createdAt` by `createdAt` then id, habit entries by date, habit and id, and protected
time by date then id.

**Import** (`src/db/backup.ts`) runs in this order:

1. parse;
2. check the envelope;
3. migrate from the backup's `schemaVersion` with `migrateSnapshot`;
4. validate against the current schemas and domain rules;
5. check cross-store integrity;
6. **replace** in one transaction.

Unknown extra fields in a record are dropped by the Zod parse. No schema change was
needed for backups; the database stays at V3.

## Schema V4 (v2 PHASE 002)

**V3 → V4 migration, exactly.** Dexie runs the version-4 schema step with no upgrade
function. It creates nine empty stores and adds a `projectId` index to `tasks` and
`hackathons`. No existing record is read or rewritten: no projects are derived from
`Task.project` labels, no hackathon is converted, and no events, snapshots or sessions
are synthesized. Tested in `src/test/migration-v4.test.ts` against a genuine V3
database, where every V3 record is deep-equal afterwards and every new store is empty.

The V4 entities are specified in
[LOWTIDE-V2-ARCHITECTURE.md](LOWTIDE-V2-ARCHITECTURE.md) §3–§9 (ADR-046). Their types
live in `src/types/domain.ts`, their Zod schemas in `src/db/schema.ts`, and their rules
in `src/db/rules.ts`:

| Store               | Entity             | Indexes                                                 |
| ------------------- | ------------------ | ------------------------------------------------------- |
| `projects`          | `Project`          | `&slug, state, updatedAt`                               |
| `milestones`        | `Milestone`        | `projectId, [projectId+order]`                          |
| `projectItems`      | `ProjectItem`      | `projectId, [projectId+lane], taskId`                   |
| `decisions`         | `Decision`         | `projectId, decidedAt`                                  |
| `workSessions`      | `WorkSession`      | `kind, projectId, taskId, localDate, startedAt`         |
| `offTimeSessions`   | `OffTimeSession`   | `kind, localDate, startedAt`                            |
| `events`            | `LedgerEvent`      | `at, localDate, type, projectId, [entityType+entityId]` |
| `progressSnapshots` | `ProgressSnapshot` | `projectId, &[projectId+localDate]`                     |
| `aiSessions`        | `AiSession`        | `projectId, startedAt`                                  |

**Amendment to the locked design (recorded in ADR-046):** `Project.phase?` is an optional
text field for the Command Room's "current phase". It's additive and has no index.

## Schema V5 (v2 PHASE 006, ADR-051)

`collegeItems` (`id, date, kind`) holds classes, labs, assignments, exams and events,
each with a `status`. Classes and labs are attended or missed; the others are done.
The V4 → V5 upgrade only creates the store. Tested in `v5-college.test.ts` against a
genuine V4 database.

**Backups:** `STORE_NAMES` lists all 16 stores (15 in V4). A schema-4 backup must contain all 15
and no others. A V1–V3 backup must contain the six legacy stores and no others; it
imports with the nine new stores empty (`migrateSnapshot`). `BACKUP_FORMAT_VERSION`
stays 1.

## Schema V6 (v2 PHASE 008B, ADR-056)

Additive; the V5 → V6 upgrade only creates the `notes` store and changes no record.

| Store   | Entity | Indexes                          |
| ------- | ------ | -------------------------------- |
| `notes` | `Note` | `projectId, createdAt` (V6 only) |

- **`Note`**: `id, projectId, kind (note | research | handoff | summary), title, body
(Markdown), author (owner | ai-client), client?, createdAt, updatedAt`. `client` is
  present exactly when an AI client wrote it. Creating a note appends `note.created`.
- **`Hackathon.researchStatus?`**: `not_started | in_progress | done`, recorded by the
  owner. Absent on existing hackathons (read as not started). The stage rail reads it
  and no longer infers research from other stages.
- **Attribution.** `LedgerEvent.actor?` names the AI client when `source` is
  `ai-client`; `Decision.origin` gains `ai-client` with `Decision.client?`;
  `AiSession` gains `taskId?`, `result?`, `nextAction?`, `commits?` and `handoff?`.

**Backups:** `STORE_NAMES` lists all 17 stores. Schema-6 backups carry them all; V1–V5
backups still import, with `notes` empty (`migrateSnapshot`). Integrity: a note needs
an existing project, and an AI-authored note needs its client.

## Schema V7 (v2 PHASE 010, ADR-062)

Additive; the V6 → V7 upgrade only creates two stores and changes no record.

| Store           | Entity         | Indexes                                                |
| --------------- | -------------- | ------------------------------------------------------ |
| `spaceNodes`    | `SpaceNode`    | `parentId, &key, updatedAt`                            |
| `sourceRecords` | `SourceRecord` | `&[system+sourceId+entityType], [entityType+entityId]` |

- **`SpaceNode`** (SPACE): `id, parentId?, kind (section | page | table), title, icon?,
key? (unique: projects, archive, project:<id>, project:<id>:planning…), body?,
bodyFormat? (markdown | notion), order, archived, links: EntityLink[],
externalLinks: {url, label?}[], attachments: SpaceAttachment[], table?, source?,
createdAt, updatedAt`.
  - `table` is present exactly when `kind` is `table`: `columns` (`id, name, type,
options?, description?`, type one of text, number, boolean, date, select, status,
    multiSelect, url, link) and `rows` (`id, cells, pageId?, links?`). A cell matches its
    column's type (`link` cells hold `EntityLink`s); an empty cell is absent.
  - `EntityLink`: `type` (project, task, milestone, projectItem, decision, hackathon,
    aiSession, spaceNode), `id`, `rowId?` (one row of a linked table), `label?` (the
    name at its source).
  - `SpaceAttachment`: `id, kind (file | image | pdf | video | audio), name, status
(stored | external), url?, note?`. `external` means only the reference is kept.
  - `SourceRef`: `system (notion), sourceId, url?, originalTitle, path?, importedAt,
sourceCreatedAt?, sourceUpdatedAt?`.
  - Six top-level sections are maintained: Projects, Hackathons, College, Ideas,
    Personal, Archive (v2.1 adds LOWTIDE and v2.2 adds Areas, ADR-071: eight in all).
    Nodes are archived, never deleted. No ledger events.
- **`SourceRecord`** (provenance): `id, system, sourceId, entityType, entityId, role
(canonical | legacy | reference), url?, originalTitle, path?, contentHash,
importedAt, appliedAt, sourceCreatedAt?, sourceUpdatedAt?`. One per (system, source
  id, record type). A record with any source record came in by import and never counts
  as activity.

**Backups:** `STORE_NAMES` lists all 19 stores. Schema-7 backups carry them all; V1–V6
backups still import, with both stores empty. Integrity: SPACE parents exist and form
no loop, maintained keys are unique, table cells match their columns, and one source
record per (system, source id, record type). Links may point at records removed since.

## Schema V8 (v2 PHASE 012, ADR-064)

No store changes. `Project.focus?`: `primary | secondary | supporting | background`, the
owner's portfolio priority. Set with `projects.setFocus`, which changes nothing else
(no `updatedAt`, no ledger event). Backups at schema 8 carry it; older backups import
with focus unset. SQLite: companion migration 4 adds `projects.focus` where missing.

## Work session outcome (v2 PHASE 015, ADR-069)

No schema change. `work.describe(id, outcome)` sets or clears a finished session's
`outcome` (the optional "What changed?" note); it never changes times and writes no
ledger event.

## Schema V9 (v2 PHASE 014, ADR-067)

No store changes. `SpaceNode` gains:

- `blocks?: SpaceBlock[]`: the page's editable content, written on first edit. Types:
  paragraph, heading1–3, bullet, numbered, check, quote, callout, code, divider, file,
  link, table, grid, fallback. Text is a small inline Markdown subset. `by` marks a block
  an AI client wrote.
- `revision?: number`: bumped by every content change; editors save against it.
- `edits?: SpaceEdit[]`: batched history (kind, by, client, startedAt, at, count), at
  most 200.

An imported `body` is never rewritten; `blocksOf(node)` parses it on read. Companion
migration 5 adds `blocks`, `revision` and `edits` columns where missing.
`projects.watchAllDecisions` lists every decision (SPACE links, search and the palette).

## Reconciled milestones (v2 PHASE 013, ADR-065)

No schema change. Milestones from an import plan's `milestoneSets` are ordinary
milestones with a canonical `sourceRecords` entry naming their task row.
`space.watchProjectSources(projectId)` reads the provenance for a project and everything
in it (milestones, tasks, items, decisions), newest first: the import and reconciliation
trail shown in History. It is never activity.

## Schema V11 (v2.2, ADR-072)

No store or index changes. `Hackathon` gains two optional fields:

- `kind?`: `hackathon | ctf`. Absent reads as a hackathon. A CTF's stage rail is
  registration, preparation (the recorded `researchStatus`) and the competition (done when
  `status` is `finished`).
- `selection?`: `applied | shortlisted | selected | rejected`, the organisers' answer to
  an application, recorded by the owner. Absent: nothing submitted or heard yet. `null` or
  a blank form choice removes it.

The V10 → V11 upgrade rewrites nothing; existing hackathons keep both unset. Companion
migration 8 adds the nullable `kind` and `selection` columns, each with its own CHECK.
Backups at schema 11 carry them; schema 10 backups import unchanged. Tested in
`v11-schema.test.ts` (a genuine V10 database) and the companion's `store.test.ts`.

**Areas (ADR-071)** is not a schema change: it is one more maintained SPACE section node
(key `areas`), made like the others.

## The companion's SQLite schema (PHASE 008B, ADR-057, ADR-058)

In companion mode the same records live in `~/.lowtide/lowtide.sqlite`, one table per
store, generated from the domain definitions (`companion/server/sqlite/tables.ts`), so
an enum added to the domain changes the database with it:

- `STRICT` tables; the primary key is the record's own `id` (never re-generated).
- Columns are the record's fields in `snake_case`: text (timestamps and `LocalDate`s
  stay exactly as in IndexedDB, as strings), integer, real, boolean (0/1, checked), or
  JSON (checked with `json_valid`) for nested values such as work-session pauses,
  lane counts, event data, AI session files and commits.
- Enumerations are `CHECK (column IN (…))` constraints built from the domain's `as
const` arrays. Required fields are `NOT NULL`; an absent optional field is `NULL` and
  comes back omitted, as in IndexedDB.
- Every reference is a foreign key, `DEFERRABLE INITIALLY DEFERRED` (checked at commit,
  so a transaction can write records in any order), for example milestones → projects,
  tasks → projects and milestones, decisions → the decision they supersede.
- The IndexedDB indexes are SQL indexes, and the unique ones stay unique: one entry per
  habit per day, one snapshot per project per day, one project per slug.

Tables that only the companion has (`companion/server/sqlite/migrations.ts`):

| Table                  | Holds                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| `companion_migrations` | which companion schema migrations have run                               |
| `companion_meta`       | `lowtide_schema_version` (11), and when and from which backup it moved   |
| `ai_grants`            | each AI client's grant; the token only as a SHA-256 fingerprint          |
| `ai_audit`             | every MCP tool call: who, scope, operation, entity, before/after, result |
| `ai_sightings`         | when each grant's client was last heard from (connection status)         |

**Parity.** `companion/server/sqlite/store.test.ts` runs one scenario touching all 19
stores (including a Notion import) on Dexie and on SQLite and requires identical exports and identical answers to
13 live queries.

## Migrations

1. Never edit a shipped `this.version(n)` block in `src/db/database.ts`.
2. Add `STORES_V{n+1}` in `schema.ts` (only stores/indexes that change need listing;
   pass `null` to delete a store) and append
   `this.version(n + 1).stores(STORES_V{n+1}).upgrade(tx => …)` for any data rewrite.
3. Bump `SCHEMA_VERSION`; the database test asserts the opened version equals it.
4. Upgrades must be non-destructive and idempotent in effect; keep user data.
5. Add a test that seeds data at version n, opens at n+1, and asserts the result.
6. Record the change in `CHANGELOG.md` and the phase report.
