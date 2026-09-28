# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/). Versions follow the
app's `package.json` version.

## [Unreleased]

### Added (PHASE 002)

- **Today** page at `/` (first nav item): date, reused brain-dump composer, inbox
  waiting link, Needs attention (due/overdue), My plan (planned today, de-duplicated),
  "Add from Tasks" picker, "Take out of today's plan", Protected time.
- `Task.plannedFor?: LocalDate` and **schema version 2** (`tasks.plannedFor` index;
  non-destructive, no upgrade function) (ADR-019).
- `TaskRepository.planFor`, `removeFromPlan`, `watchForDay` (ADR-020).
- `ProtectedTimeRepository` (create, update, remove, `watchForDate`) and its UI (ADR-021).
- Per-screen code splitting with idle prefetch (ADR-022).
- Tasks rows show "In today's plan" / "Planned for …".

### Changed (PHASE 002)

- `lib/time` no longer uses date-fns; the entry chunk dropped from 497 kB to 441 kB.
- The composer's label is now an `h2` (the page `h1` is "Today").
- `TaskRow` is built on a shared `TaskLine`, also used by Today.
- Focus after planning or saving protected time moves once the live data has
  re-rendered, not on the next animation frame.

### Removed (PHASE 002)

- The separate Home page (`src/features/home`); Today replaces it.

### Added (PHASE 001)

- App shell: sidebar on desktop, compact top bar on mobile, skip link, current-page
  marking.
- Home: brain dump composer (Enter saves, Shift+Enter new line, IME-safe, failed saves
  keep the text) and a live list of waiting thoughts.
- Inbox: process thoughts into tasks (atomic) or clear them; history kept.
- Tasks: add with optional notes/priority/deadline/project, inline edit, complete, drop,
  reopen; a Finished section.
- Reactive repositories: `Watch<T>` subscriptions (`tasks.watchOpen`,
  `tasks.watchClosed`, `inbox.watchUnprocessed`) and the `useWatch` hook (ADR-015).
- Repository methods: `tasks.update/reopen/drop`, `inbox.markProcessed`.
- Date-only deadline convention and helpers (ADR-016).
- Dev dependency `@testing-library/user-event`.

### Changed (PHASE 001)

- Light-mode `warn` token darkened to `#8a5a1c` (AA contrast); new `on-accent` token.
- The persistence-schema lint ban now covers `src/app` too.
- Blank `notes`/`project` are omitted when creating a task.

### Removed (PHASE 001)

- The temporary PHASE 000 foundation screen.

### Changed (PHASE 000 post-review corrections)

- Removed `relationships` from habit categories. Time with people is modelled only as
  `ProtectedTime` (ADR-013).
- Documented repository missing-record semantics precisely: `get` resolves `undefined`,
  mutations reject with `RecordNotFoundError` (ADR-014).
- ESLint storage boundary now also blocks UI/feature imports of the concrete database,
  Dexie repository implementations and (in features/components/hooks) persistence
  schemas, not just the `dexie` package. A new test proves the rule fires.

## [0.1.0] — 2026-09-28 — PHASE 000 foundation

The previous prototype was removed; LOWTIDE restarts on a new foundation.

### Added

- Vite 8 + React 19 + TypeScript 6 project, npm scripts (`dev`, `build`, `preview`,
  `typecheck`, `lint`, `format`, `format:check`, `test`, `check`).
- Tailwind CSS 4 with "warm paper at low tide" semantic tokens, light and dark themes
  (OS preference, `data-theme` override), system fonts, reduced-motion support.
- React Router 8 with a temporary foundation screen and a not-found route.
- Domain types for Task, InboxItem, Habit, HabitEntry, Hackathon, ProtectedTime.
- Zod (`zod/mini`) schemas for all persisted records.
- Dexie IndexedDB database `lowtide`, schema version 1, six stores.
- Repository layer: `TaskRepository`, `InboxRepository` interfaces and Dexie
  implementations; `useRepositories()` hook; ESLint rule forbidding Dexie outside `src/db`.
- Vitest + React Testing Library + fake-indexeddb; 25 tests.
- ESLint (flat config) and Prettier.
- Documentation set in `docs/`.

### Removed

- The earlier prototype (idb, oxlint, PWA, Playwright acceptance script). Still in Git
  history at `94dcde8`.
