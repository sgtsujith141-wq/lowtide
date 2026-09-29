# Architecture

LOWTIDE is a static single-page app. There is no server: the browser is the runtime
and IndexedDB is the database.

**LOWTIDE v2** is planned in [LOWTIDE-V2-ARCHITECTURE.md](LOWTIDE-V2-ARCHITECTURE.md)
(decisions ADR-037 to ADR-046). Until its phases ship, this document describes the
running app. v2 PHASE 001 added only pure, tested rules that nothing renders yet:
`features/pulse/daily-pulse.ts` (ADR-037), `features/projects/completion.ts`
(ADR-038), `features/hackathons/progress.ts` (ADR-039) and
`features/rhythm/presets.ts` (ADR-045). IndexedDB stays canonical until a dedicated
later phase (ADR-040).

## Layers

```
 components / routes (src/app, src/features/*)
        │  useRepositories()  +  useWatch(repo.watch…)   ← live data
        ▼
 repository interfaces        src/db/repositories/types.ts
        │  implemented by
        ▼
 Dexie repositories           src/db/repositories/dexie-*.ts
        │  validate with            ▲
        ▼                           │
 Zod schemas + store layout   src/db/schema.ts
        │
        ▼
 LowtideDatabase (Dexie)      src/db/database.ts  →  IndexedDB "lowtide"
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
  `createDexieRepositories(openDatabase())`. Tests pass their own database.
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
- **Entry points:** a link in the desktop sidebar footer, and a `<footer>`
  (`contentinfo`) on phones, below `md`. The five-item tab bar is unchanged.

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

## App shell and routing

- `src/app/App.tsx` receives `repositories` and a `router` as props (so tests can use
  a memory router and a throwaway database) and provides the repository context.
- `src/app/routes.tsx` is the route table: `Shell` is the layout route, with children
  `/` (Today), `/inbox`, `/tasks`, `/rhythm`, `/hackathons`, `/data` (Data & backup,
  not in the tab bar), and a catch-all "Nothing here".
- **Narrow screens:** below `md` each nav item stacks its icon over a 10 px label
  (tab-bar style), and the wordmark hides its text below 440 px. That way five items
  fit with no overflow from 320 to 768 px (measured in Chromium).
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
- `Shell` (`src/app/Shell.tsx`): one `<header>` holding the wordmark and the main
  `<nav>`. It is a narrow sidebar at `md` and up, and a single compact top bar below
  that. Same markup at every size, so nothing jumps. A skip link focuses `<main>`
  without changing the URL. The current page is marked with `aria-current` (from
  `NavLink`) and shown by weight plus an accent bar, not by colour alone.
- Each page sets `document.title` via `useDocumentTitle`.
- Browser history routing (`createBrowserRouter`). Static hosting must serve
  `index.html` for unknown paths; `vite preview` does this already.

## Styling

- Tailwind CSS 4 via `@tailwindcss/vite`, entry `src/styles/index.css`.
- Semantic tokens are CSS custom properties on `:root` (`--lt-paper`, `--lt-ink`,
  `--lt-line`, `--lt-accent`, …) and exposed to Tailwind via `@theme inline`, giving
  utilities like `bg-paper`, `text-ink-muted`, `border-line`, `text-accent`.
- Components use the semantic utilities only — no raw hex values in components.
- Dark theme: follows `prefers-color-scheme` by default; `<html data-theme="light|dark">`
  overrides it. A switcher UI is a later phase; the CSS already supports it.
- System font stacks only, so the app makes no font network requests.
- Motion: a 140 ms default colour transition on buttons and fields only (the nav
  has none), and `prefers-reduced-motion` respected globally. No animations.
- Contrast: every text token meets 4.5:1 on every paper surface in both themes,
  except `ink-faint`, which is for decoration only (PHASE 001 darkened light-mode
  `warn` to `#8a5a1c` for this). Primary buttons use `accent-ink` with `on-accent`.
- Activity squares: `--lt-activity-0…4` form a muted sea-glass ramp, not GitHub green.
  Each step is at least 1.19:1 against the previous one in light and 1.30:1 in dark,
  rising steadily. Squares carry text labels, so colour is never the only signal.
- **Saving never disables a focused control** (ADR-030). Buttons, selects and fields
  that trigger a write stay enabled and ignore repeats while busy, because disabling a
  focused element drops keyboard focus.
- Shared control styles live in `src/components/ui/styles.ts` (`fieldClass`,
  `labelClass`).

## Directory conventions

| Path                     | Holds                                                         |
| ------------------------ | ------------------------------------------------------------- |
| `src/app/`               | Composition: App, routes, context objects, app-level screens  |
| `src/features/<area>/`   | Feature UI + feature logic (today, inbox, tasks so far)       |
| `src/components/ui/`     | Small presentational primitives (Button, notices, styles)     |
| `src/components/shared/` | Cross-feature composed components (created when first needed) |
| `src/db/`                | Everything that knows about IndexedDB                         |
| `src/hooks/`             | Cross-feature hooks                                           |
| `src/lib/`               | Pure helpers (ids, time)                                      |
| `src/types/`             | Domain types                                                  |
| `src/styles/`            | Global CSS and tokens                                         |
| `src/test/`              | Test setup, helpers and tests                                 |

Empty folders are not created ahead of time.
