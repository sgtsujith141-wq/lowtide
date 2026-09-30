# Architecture

LOWTIDE is a static single-page app. It keeps its data in one of two places, chosen by
the owner (ADR-058):

- **browser mode** (the default): IndexedDB in the browser, through Dexie;
- **companion mode**: the LOWTIDE companion, a local process on 127.0.0.1 that owns a
  SQLite database, keeps the technical workspace up to date, and serves AI clients over
  MCP. See [The companion](#the-companion-phase-008b) and [COMPANION.md](COMPANION.md).

The same domain repositories run in both (ADR-057), so every rule, event and snapshot
behaves identically wherever the data lives.

**LOWTIDE v2** is planned in [LOWTIDE-V2-ARCHITECTURE.md](LOWTIDE-V2-ARCHITECTURE.md)
(ADR-037 onwards); [LOWTIDE-V2-STATUS.md](LOWTIDE-V2-STATUS.md) says what's built.

**v2 feature map:**

| Path                 | Holds                                                             |
| -------------------- | ----------------------------------------------------------------- |
| `components/shared/` | `ContributionGrid`, grid geometry and palettes, small SVG visuals |
| `features/pulse/`    | `dailyPulse` (ADR-037) and day summaries from records (`days.ts`) |
| `features/home/`     | Home sections, More, Ask LOWTIDE (local search)                   |
| `features/projects/` | project summaries, charts, Projects page, Command Room (`room/`)  |
| `features/modes/`    | the mode bar, Start Work panel, Sleep Mode                        |
| `features/work/`     | work-session arithmetic                                           |
| `features/activity/` | the ledger timeline                                               |
| `features/context/`  | context packs, the workspace generator, the AI area               |
| `features/settings/` | Appearance and where LOWTIDE keeps its data (pairing, the move)   |

## Layers

```
 components / routes (src/app, src/features/*)
        │  useRepositories()  +  useWatch(repo.watch…)   ← live data
        ▼
 repository interfaces        src/db/repositories/types.ts
        │
        ├── browser mode: the domain repositories   src/db/repositories/dexie-*.ts
        │        │  validate with Zod (src/db/schema.ts), write through StoreDb
        │        ▼
        │   StoreDb (src/db/store.ts) = asStore(LowtideDatabase)  →  IndexedDB "lowtide"
        │
        └── companion mode: companion repositories  src/db/companion/client.ts
                 │  HTTP to 127.0.0.1 (owner token); live queries re-ask on SSE changes
                 ▼
            the companion (companion/server): the SAME domain repositories
                 │  write through StoreDb
                 ▼
            StoreDb = SqliteStore  →  ~/.lowtide/lowtide.sqlite
```

Domain types (`src/types/domain.ts`) are plain TypeScript and are shared by every layer.

### The repository boundary

- UI and feature code never touch the concrete database. ESLint
  (`no-restricted-imports` in `eslint.config.js`) enforces, for everything under `src/`:
  - importing the `dexie` package, `db/database`, `db/repositories/dexie-*` or
    `db/repositories/shared` is a lint error;
  - in `src/features/**`, `src/components/**` and `src/hooks/**`, importing
    `db/schema` (Zod persistence schemas, store layout) is also a lint error.
  - Exempt: `src/db/**` itself, the composition root `src/main.tsx`, and `src/test/**`
    (persistence-level tests need the real database).
  - Allowed everywhere: `db/repositories` (the index: interfaces, error classes) and
    `hooks/useRepositories`.
  - `src/app/**` may still import `db/schema`: the temporary foundation screen reads
    `SCHEMA_VERSION`. It may not import the database.
  - `src/test/storage-boundary.test.ts` lints probe sources at those paths and asserts
    the rule fires (and doesn't fire for allowed imports), so a config regression
    fails `npm test`.
  - Limits: this is static import checking. It does not see dynamic `import()` or a
    `LowtideDatabase` instance handed to UI code at runtime. The composition root is
    the only place that creates one, and it gives UI code only repositories.
- Components get data through `useRepositories()`, which reads a React context.
- The concrete implementation is chosen once, in the composition root `src/main.tsx`:
  `createDexieRepositories(openDatabase())` in browser mode, or
  `createCompanionRepositories(client)` once the owner has switched to the companion
  (`src/db/companion/backend.ts` remembers which). Tests pass their own.
- Repository methods are async, take/return plain domain objects, validate before
  writing, and enforce invariants (e.g. converting an inbox item to a task is a single
  IndexedDB transaction across both stores).

This is what allows a later sync/cloud layer: a new implementation of the same
interfaces can be swapped in at the composition root without touching components.

Repositories: `TaskRepository`, `InboxRepository`, `ProtectedTimeRepository`
(PHASE 002), `HabitRepository` (PHASE 003), `HackathonRepository` (PHASE 004), and
`BackupRepository` (PHASE 005), which spans every store. Domain invariants that both
repositories and backup import enforce live in `src/db/rules.ts`.

### Reactive data (ADR-015)

Repositories expose **watch** methods with a storage-agnostic type:

```ts
type Watch<T> = (onChange: (value: T) => void, onError?: (error: unknown) => void) => Unsubscribe;
```

- `tasks.watchOpen`, `tasks.watchClosed`, `tasks.watchForDay(day)`,
  `inbox.watchUnprocessed`, `protectedTime.watchForDate(date)`,
  `protectedTime.watchRange(start, end)`, `habits.watchAll`,
  `habits.watchEntries(start, end)`, `hackathons.watchAll`, `backup.watchCounts`.
- Parameterised watches (`watchForDay`, `watchForDate`) return a new `Watch` per call;
  components memoise them on their argument (`useMemo(() => tasks.watchForDay(today),
[tasks, today])`), so the subscription changes exactly when the day does.
- Implemented in `src/db/repositories/shared.ts` (`watchQuery`) with Dexie `liveQuery`.
  Dexie re-runs the query after any write that touches data it read, including
  writes from another tab. No Dexie or Observable type crosses the interface.
- Components subscribe with `useWatch(watch)` (`src/hooks/useWatch.ts`), which returns
  `{ status: 'loading' | 'ready' | 'error' }` and unsubscribes on unmount.
- Mutations never trigger manual reloads. Screens stay non-optimistic: a list changes
  only when the database has changed, so a failed write can't leave the UI showing a
  state that isn't stored.
- Watch methods are plain properties, stable for the repository's lifetime, so they
  are safe as effect dependencies.

### Today (ADR-020)

`TodayPage` subscribes to `tasks.watchForDay(today)`: open tasks planned for today, or
due on or before today. The pure `composeToday(tasks, today)` in
`src/features/today/compose.ts` splits them into sections:

- **Needs attention**: open, with a deadline day ≤ today (overdue or due today).
- **My plan**: open, `plannedFor === today`, and _not_ already under Needs attention.

Each task appears at most once; deadlines take precedence. `planCandidates` lists the
open tasks the picker can offer (anything not already on Today). `useToday()` gives
today's local date and re-renders just after local midnight, which re-keys both the
task and protected-time watches.

### Rhythm (ADR-023 to ADR-026)

`RhythmPage` (`/rhythm`) uses two subscriptions: `habits.watchAll` (every habit,
archived included) and `habits.watchEntries(start, today)` for the grid's 26 weeks. The
entries arrive in one indexed range query on `habitEntries.date` and are grouped in
memory, never one query per square. The same data feeds today's logging rows.
Everything else is pure and unit-tested:

- `src/lib/calendar.ts`: `LocalDate` arithmetic on UTC date fields (addDays,
  daysBetween, weekdayIndex, startOfWeek, eachDay), immune to time zones and DST;
- `src/features/rhythm/intensity.ts`: per-habit levels, the overall banded sum, value
  formatting;
- `src/features/rhythm/grid.ts`: `gridRange`, `buildGrid(today, habits, entries, view)`
  and month labels.

`ActivityGrid` renders the result as an ARIA grid with a roving tabindex (ADR-026).
Views are `overall`, `group` (`RHYTHM_GROUPS`: Coding & learning, Fitness & health) or
`habit` (ADR-036). The selector affects only the grid, never today's logging.
Activity colours come from `--lt-activity-0…4` tokens via `LEVEL_CLASS`, the only place
levels meet colour.

### Protected time this week (ADR-035)

`ProtectedTimeSection` subscribes to `protectedTime.watchRange(today, today + 6)`. The
pure `weekAhead(today)` and `groupByDay` (in `src/features/today/week.ts`) lay out
seven day rows. Add, edit (including moving between days, through the shared
`ProtectedTimeForm` and its Day select) and remove all go through the repository.

### Hackathons (ADR-027 to ADR-029)

`HackathonsPage` (`/hackathons`) and Today's `TodayHackathons` both subscribe to
`hackathons.watchAll`. Everything that decides what to show is pure, in
`src/features/hackathons/schedule.ts`:

- `orderHackathons`: upcoming by next meaningful date, then undated, then past;
- `primaryMoment` and the moment functions: date wording;
- `formatRange`;
- `hackathonsForToday`: the at-most-3 relevant rows.

All date arithmetic uses `src/lib/calendar.ts` on `LocalDate`s. Status changes and the
next action save through `hackathons.update`, with no side effects on tasks or habits.
The Hackathons tests replace the habit repository with a trap that throws if it's ever
called.

### Backup and restore (ADR-031 to ADR-034)

- `src/db/backup.ts` holds the envelope constants and the pure `inspectBackup(text)`:
  parse → envelope → `migrateSnapshot` (in `migrations.ts`, reusing the database's
  upgrade functions) → current schemas and rules → cross-store integrity.
- `BackupRepository` (`dexie-backup-repository.ts`):
  - `exportBackup()` reads all six stores in one read-only transaction;
  - `watchCounts` gives live per-store counts;
  - `inspect` delegates to `inspectBackup`;
  - `restore(ValidatedBackup)` clears and refills all six stores in one read-write
    transaction.
- The UI (`src/features/backup/DataPage.tsx`, lazy route `/data`) only ever sees
  `BackupDocument`, `BackupInspection` and `ValidatedBackup`. It downloads with Blob,
  an object URL and a temporary anchor.
- `src/lib/storage-persistence.ts` wraps `navigator.storage.persisted`/`persist`.
- **Entry points:** the desktop rail's launcher, and a `<footer>` (`contentinfo`) on
  phones, below `md`. The five-item tab bar is unchanged.

### Injected clock and ids

Repositories accept optional `clock` and `newId` dependencies (defaults:
`systemClock`, `crypto.randomUUID`). Tests inject a deterministic clock; production
never needs to.

### Errors

Missing records follow one rule (documented on the interfaces in
`src/db/repositories/types.ts`):

- **Lookups** (`get`) resolve to `undefined` when nothing has that id. Absence is a
  normal answer.
- **Operations that need an existing record** (`update`, `complete`, `reopen`, `drop`,
  `planFor`, `removeFromPlan`, `convertToTask`, `markProcessed`, protected-time
  `update`/`remove`, habit `update`/`archive`/`restore`/`setEntry`/`clearEntry`,
  hackathon `update`) reject with `RecordNotFoundError`.
- **Input that is well-formed but wrong for its context** (a habit value that doesn't
  fit its unit, a target on a done-or-not habit) rejects with `InvalidInputError`.
  Logging an archived habit rejects with `RecordStateError`.
- **Operations not allowed in the record's current state** reject with
  `RecordStateError`. Task transitions: `complete`, `drop` and `planFor` need an open
  task (`todo` or `doing`); `reopen` needs `done` or `dropped`. Inbox: `convertToTask` and
  `markProcessed` need an unprocessed item.
- UI code catches these and shows a plain-language message (`ErrorNotice`); raw error
  text and stack traces are never rendered.
- Invalid input rejects with a Zod error before anything is written.
  Domain error names deliberately avoid DOMException names — see
  [DECISIONS.md ADR-010](DECISIONS.md).

## The companion (PHASE 008B)

One process (`npm run companion`, built by `companion/vite.config.ts` into
`companion/dist/`) owns the SQLite database. Everything else reaches LOWTIDE's data
through it:

```
 LOWTIDE app (browser) ──owner token──►  /api/rpc      repository calls, by the wire contract
                         ◄── SSE ──────  /api/events   "change" after every commit, "ai", "workspace"
                         ──owner token─►  /api/migrate, /api/ai/*, /api/workspace/*
 AI client (HTTP)      ──grant token──►  /mcp          MCP, Streamable HTTP, JSON responses
 AI client (stdio) ─► companion/lowtide-mcp.ts (bridge) ─► /mcp
                                           │
                            companion/server/app.ts (127.0.0.1, Host + Origin checks,
                            tokens, rate and size limits)
                                           │
        domain repositories (owner, or attributed AI client) ─► SqliteStore ─► SQLite
                                           │ onChange
                                           ▼
                             WorkspaceSync ─► ~/.lowtide/workspace
```

| File (`companion/`)           | Does                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| `server/sqlite/tables.ts`     | one strict table per store, generated from the domain enums          |
| `server/sqlite/migrations.ts` | companion schema migrations and metadata (`companion_meta`)          |
| `server/sqlite/store.ts`      | `SqliteStore implements StoreDb`: queue, transactions, change events |
| `server/migrate.ts`           | the verified move (stage B) and its report                           |
| `server/rpc.ts`               | the owner's repository RPC, dispatched by the wire contract          |
| `server/grants.ts`            | AI grants, tokens, audit log, sightings, client status               |
| `server/tools.ts`             | the 22 MCP tools: scopes, validation, attribution, audit             |
| `server/mcp.ts`               | MCP sessions, version negotiation, `tools/list`, `tools/call`        |
| `server/workspace-sync.ts`    | the live workspace, path security, Git init                          |
| `server/app.ts`, `main.ts`    | the HTTP boundary and the command line                               |
| `lowtide-mcp.ts`              | the stdio bridge (Node built-ins only; Node runs it from source)     |

The wire contract (`src/db/companion/contract.ts`) lists every repository member as a
call, a live query or pure (run in the app); a type-level check and a test pin it to the
real repositories. Shapes the owner API returns are in `src/db/companion/wire.ts`.

Live data in companion mode: each `Watch` in the app is a query to the companion that
runs again (once per burst) when the event stream reports a committed change, and only
passes a result on when it differs. There's no polling and no IndexedDB fallback.

## App shell and routing

- `src/app/App.tsx` receives `repositories` and a `router` as props (so tests can use
  a memory router and a throwaway database) and provides the repository context.
- `src/app/routes.tsx` is the route table (ADR-043): `Shell` is the layout route, with
  children:
  - `/` (Home), `/projects` and `/projects/:slug` (Command Room);
  - `/today`, `/inbox`, `/tasks`, `/rhythm`, `/hackathons`, `/data` (Data & backup, not
    in the tab bar), `/more`;
  - a catch-all "Nothing here".

  v0.1 screens are wrapped to keep their reading width inside the wider v2 frame.

- **Navigation (ADR-043):** one list of links. On phones the five tabs are Home,
  Projects, Hackathons, Rhythm and More; the desktop-only links carry `max-md:hidden`
  and More carries `md:hidden`. Below `md` each item stacks its icon over a 10 px label,
  and the wordmark hides its text below 440 px. Every screen was measured with 0 px
  horizontal overflow at 320 px in Chromium.
- **Mode bar (ADR-049):** under the header, sticky, showing a running work session or
  Sleep Mode. In Sleep Mode the shell carries `data-mode="sleep"`.
- **Route-level code splitting (ADR-022).** Each screen is a React Router `lazy` route,
  so its code (and display-only libraries like date-fns `format`) is a separate chunk.
  The entry keeps React, the router, the shell and the data layer. `prefetchScreens()`
  runs once the first screen is up (`requestIdleCallback`, or a 200 ms timeout where
  that isn't available), so later navigation doesn't wait on the network. The root
  route's `HydrateFallback` renders nothing for the few milliseconds the first chunk
  takes locally. While a later chunk loads, React Router keeps the current screen on
  display, so focus doesn't jump. A route
  `errorElement` (`RouteError`) replaces a crashed screen with a calm message and a
  Reload button.
- `Shell` (`src/app/Shell.tsx`, v2 PHASE 011): one `<header>` holding the mark and the
  main `<nav>`. At `md` and up it is a 56 px icon rail with the five primary
  destinations (Home, Projects, SPACE, Hackathons, Rhythm; each name is the link's
  accessible name and a hover/focus tooltip) and a launcher (a disclosure, "More
  destinations") for Today, Inbox, Tasks, Life, Calendar, AI, Settings and Data &
  backup. Below `md` it is a top bar with five tabs (Home, Projects, Hackathons,
  Rhythm, More); SPACE and the rest are on More. A skip link focuses `<main>` without
  changing the URL. The current page is marked with `aria-current` and a sliding bar,
  not by colour alone.
- Every route is framed by `Page` at a `reading`, `standard` or `wide` width
  (`src/app/routes.tsx`); layout primitives live in `src/components/layout`.
- Each page sets `document.title` via `useDocumentTitle`.
- Browser history routing (`createBrowserRouter`). Static hosting must serve
  `index.html` for unknown paths; `vite preview` does this already.

## Styling

- Tailwind CSS 4 via `@tailwindcss/vite`, entry `src/styles/index.css`.
- The visual system is described in full in [phases/V2-PHASE-011.md](phases/V2-PHASE-011.md)
  (ADR-063). In short: semantic tokens are CSS custom properties on `:root`
  (`--lt-canvas`, `--lt-surface`, `--lt-raised`, `--lt-fg`, `--lt-line`, `--lt-accent`,
  `--lt-primary`, the data ramps `--lt-<palette>-1…4`, …) exposed to Tailwind via
  `@theme inline` (`bg-canvas`, `text-fg-muted`, `border-line`, `bg-pulse-3`).
- Components use the semantic utilities only — no raw hex values in components.
- Themes: dark is the reference design; Auto follows `prefers-color-scheme`, and
  `<html data-theme="light|dark">` forces one (Settings → Appearance, ADR-061).
- Type: Geist Variable, bundled with the app (no font network requests), tabular
  figures throughout; `.figure` for numbers read at a glance.
- Motion tokens (`--lt-dur-micro` 140 ms, `--lt-dur-state` 200 ms, `--lt-dur-panel`
  260 ms, `--lt-dur-dormant` 700 ms, `--ease-tide`); `prefers-reduced-motion` removes
  all of it.
- Contrast: every text token meets 4.5:1 on every surface of its theme, including in
  Sleep Mode (checked with axe-core at 320–1920 px, both themes).
- Contribution grids: an inactive cell (`grid-0`) and four levels per palette; squares
  carry text labels, so colour is never the only signal.
- **Saving never disables a focused control** (ADR-030). Buttons, selects and fields
  that trigger a write stay enabled and ignore repeats while busy, because disabling a
  focused element drops keyboard focus.
- Shared control styles live in `src/components/ui/styles.ts` (`fieldClass`,
  `compactFieldClass`, `labelClass`, `segmentedClass`/`segmentClass`, `tabClass`,
  `badgeClass`).

## Directory conventions

| Path                     | Holds                                                           |
| ------------------------ | --------------------------------------------------------------- |
| `src/app/`               | Composition: App, routes, context objects, app-level screens    |
| `src/features/<area>/`   | Feature UI + feature logic, one folder per area                 |
| `src/components/ui/`     | Small presentational primitives (Button, notices, styles)       |
| `src/components/shared/` | Cross-feature composed components (contribution grid, visuals)  |
| `src/db/`                | Storage: the StoreDb contract, Dexie, repositories, backups     |
| `src/db/companion/`      | The app's side of the companion: wire contract, client, backend |
| `src/hooks/`             | Cross-feature hooks                                             |
| `src/lib/`               | Pure helpers (ids, time)                                        |
| `src/types/`             | Domain types                                                    |
| `src/styles/`            | Global CSS and tokens                                           |
| `src/test/`              | Test setup, helpers and tests                                   |
| `companion/`             | The companion daemon, its stdio bridge, and their tests         |
| `scripts/`               | Tooling outside the app (the real-browser e2e check)            |

Empty folders are not created ahead of time.
