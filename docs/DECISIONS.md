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
