# Architecture decisions

Lightweight ADRs. Status is Accepted unless noted. Newest decisions are appended.

## ADR-001 — React + Vite SPA, not a server-oriented framework

**Context.** LOWTIDE is a single-user app whose data lives on the device. There is no
server-side data to render.
**Decision.** React 19 + TypeScript built by Vite into static files. No Next.js/SSR.
**Consequences.** Hosting is any static file server; no server to secure or pay for.
No SSR/SEO, which a personal tool does not need.

## ADR-002 — IndexedDB via Dexie for persistence

**Context.** Needs durable, structured, queryable local storage with transactions and
indexes; `localStorage` is synchronous, string-only and small.
**Decision.** IndexedDB through Dexie 4 (typed tables, versioned schema, transactions).
**Consequences.** Data lives in the browser profile and can be cleared by the user or
browser (see SECURITY.md). Dexie is ~95 KB of source in the bundle.

## ADR-003 — Repository abstraction between UI and database

**Context.** A future sync or cloud backend must not require rewriting components.
**Decision.** Components access data only through repository interfaces
(`src/db/repositories/types.ts`) obtained from `useRepositories()`. Dexie
implementations live in `src/db`. ESLint forbids UI/feature code from importing
`dexie`, the concrete database, Dexie repository implementations, and (in features,
components and hooks) persistence schemas. Only `src/db`, the composition root
`src/main.tsx` and tests are exempt. A test proves the rule fires. See ARCHITECTURE.md
for the exact scope and limits.
**Consequences.** Slight indirection; storage can be swapped at the composition root.
Reactive live queries (Dexie `liveQuery`) will need to be exposed through the
repository layer when needed rather than used directly in components.

## ADR-004 — No cloud, backend or authentication in v0.1

**Decision.** No server, database service, accounts or auth.
**Consequences.** No cross-device sync yet; backup is the user's responsibility until
export exists (planned). Nothing to breach server-side.

## ADR-005 — No analytics or telemetry

**Decision.** No analytics, telemetry, error reporting services or third-party scripts.
The app makes no network requests at runtime beyond loading its own static files
(verified in PHASE 000 with a headless browser).
**Consequences.** Bugs are learned about by using the app, not from dashboards.

## ADR-006 — Local-first

**Decision.** The device's database is the source of truth. All features must work
offline. Any future sync is an optional layer on top, not a requirement.
**Consequences.** IDs and timestamps chosen to be merge-friendly (ADR-007, ADR-008).

## ADR-007 — Timestamp and date representation

**Decision.** Instants are ISO 8601 UTC strings from `toISOString()`; calendar days are
local `YYYY-MM-DD` strings. See DATA-MODEL.md.
**Why strings, not `Date` or epoch numbers.** Readable in devtools and exports, sort
correctly as IndexedDB keys, survive JSON round-trips unchanged, and the distinction
between an instant and a calendar day is explicit in the type.
**Consequences.** Code must convert at the edges (`toTimestamp`, `toLocalDate`).

## ADR-008 — ID generation: UUID v4

**Decision.** `crypto.randomUUID()` for every record id.
**Why.** Offline creation on multiple devices without coordination; no auto-increment
collisions if data is later merged or imported. No new dependency.
**Consequences.** Ids are not ordered; ordering uses timestamps. Requires a secure
context (HTTPS/localhost).

## ADR-009 — Zod (`zod/mini`) validates persisted records

**Decision.** Every record is parsed with its Zod schema before being written; the same
schemas will gate imports. Use the tree-shakeable `zod/mini` entry.
**Why mini.** The classic API added ~66 KB minified (~18 KB gzip) to a one-screen app and
triggered Vite's 500 KB chunk warning; `zod/mini` removed both with identical checks.
**Consequences.** Functional API (`z.exactOptional(x)`, `.check(z.minLength(1))`) instead
of chained methods.

## ADR-010 — Domain error names must not collide with DOMException names

**Context.** A repository threw `NotFoundError` inside a Dexie transaction; callers
received a `DexieError` instead. Dexie maps errors whose `name` matches IndexedDB
DOMException names (`NotFoundError`, `InvalidStateError`, `ConstraintError`, …) to its
own classes.
**Decision.** Domain errors are named `RecordNotFoundError` and `RecordStateError`.
**Consequences.** `instanceof` checks work across transaction boundaries (tested).

## ADR-011 — TypeScript pinned to 6.0.x

**Context.** TypeScript 7.0 is the npm `latest`, but `typescript-eslint` 8.70 supports
`typescript <6.1.0`.
**Decision.** Pin `typescript@~6.0.3`. Revisit when typescript-eslint supports 7.x.

## ADR-012 — ESLint + Prettier, system fonts, browser-history routing

- ESLint (flat config) with typescript-eslint, react-hooks, react-refresh; Prettier owns
  formatting (`eslint-config-prettier` disables conflicting rules).
- System font stacks, so no font CDN requests (privacy + offline).
- `createBrowserRouter` for clean URLs; static hosts must fall back to `index.html`.

## ADR-013 — Relationships are protected time, never habits

**Context.** PHASE 000 shipped a `relationships` habit category. Review flagged that
it contradicts a core product principle: relationships and quality time must not be
turned into productivity tasks, streaks, scores or contribution-grid performance.
**Decision.** Remove `relationships` from `HABIT_CATEGORIES` and add no replacement
relationship-type category. Time with partner, family and friends (and rest) is
modelled only by `ProtectedTime` (`relationship | family | friends | rest | personal`).
**Consequences.** Habit validation rejects `category: "relationships"` (tested). No data
migration was needed: PHASE 000 has no habit repository or UI, so no code path could
have written a habit with that category.
Future features (activity squares, stats) must not score protected time.

## ADR-014 — Missing-record semantics for repositories

**Decision.** `get`-style lookups resolve to `undefined` for a missing id; operations
that require an existing record reject with `RecordNotFoundError`; operations invalid
for the record's current state reject with `RecordStateError`.
**Why.** "Is it there?" is a normal question for lookups and shouldn't need
`try/catch`; for a mutation, a missing target is a genuine error the caller must see.

## ADR-015 — Reactive data through storage-agnostic repository watches

**Context.** PHASE 001 screens must update whenever data changes (capture on Home
shows up below; converting in Inbox makes a task appear in Tasks), without components
importing Dexie or reloading by hand after each mutation.
**Decision.** Repository interfaces gain `watch…` members of type
`Watch<T> = (onChange, onError?) => Unsubscribe`. The Dexie implementation wraps
`liveQuery` in `src/db`; components use `useWatch(watch)`. Only watches the screens need
exist: `tasks.watchOpen`, `tasks.watchClosed`, `inbox.watchUnprocessed`.
**Alternatives rejected.** `dexie-react-hooks`' `useLiveQuery` in components (breaks the
storage boundary, adds a dependency); returning Dexie/Observable types from repositories
(leaks the engine); manual refetch after each mutation (misses other tabs, easy to forget);
a state-management library (unnecessary).
**Consequences.** A future sync implementation must provide the same push-style
`Watch` semantics. Screens are non-optimistic: lists change only when storage changes.
Liveness across repositories (convert in Inbox → Tasks updates) comes free from
`liveQuery`'s cross-table change tracking; this is tested.

## ADR-016 — Date-only deadlines encoded as UTC noon of the chosen date

**Context.** The UI needs date-level deadlines; `Task.dueAt` is a UTC `Timestamp`.
Converting a local date to a local instant and back shifts the day for zones far enough
apart.
**Decision.** Store a chosen day `D` as `D T12:00:00.000Z` and read the day back from the
UTC date part (`dueAt.slice(0, 10)`), only through `deadlineFromLocalDate` /
`localDateOfDeadline` in `src/lib/time.ts`. Overdue/today status compares that day with
today's local calendar day, never instants. No schema change.
**Alternatives.** _Local noon as an instant_ was implemented first and **failed the new
tests**: a deadline entered in Asia/Kolkata showed a day early in America/Los_Angeles
(12.5 h apart), and Auckland↔New York was off by a day too. _A new `dueDate: LocalDate`
field_ would match the `LocalDate` convention best but needs a schema v2 migration and
changes the specified `dueAt` model; not justified while every deadline is date-only.
**Consequences.** `dueAt` currently means "due on this calendar day". Time-of-day
deadlines, if ever needed, get an explicit field in a new schema version.

## ADR-017 — Capture clears immediately and saves in order; failures put the text back

**Context.** Brain dump must let you type, press Enter, and keep typing. The first
implementation cleared the box only after the write finished and read the draft
from React state. The PHASE 001 browser run showed that fast typing could merge the
next thought into the one being saved.
**Decision.** On Enter the composer reads the textarea's live value, clears
immediately, and appends the write to a per-composer promise queue, so writes happen
in order. If a write fails, its text is put back in the box ahead of anything typed
since, with a visible error. Success is announced only after the write.
**Consequences.** Enter is never lost and thoughts never merge. The text sits in memory
(not on screen) for the few milliseconds of a local write. Regression tests slow the
write down to reproduce the race.

## ADR-018 — Processing keeps history

**Decision.** Nothing in PHASE 001 deletes records. Clearing an inbox item sets
`processedAt`; converting also links `convertedToTaskId`. Dropping a task sets status
`dropped`; completed and dropped tasks stay listed under "Finished" and can be reopened.
**Why.** Honest history, recoverable mistakes (there is no undo yet), and future export,
all with no schema change. Permanent deletion, if added, will be an explicit action.
