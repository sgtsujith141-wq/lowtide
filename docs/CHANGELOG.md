# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/). Versions follow the
app's `package.json` version.

## [Unreleased]

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
