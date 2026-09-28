# LOWTIDE

A calm, local-first place to run a personal life — built to be easy to use after a
mentally exhausting day.

LOWTIDE will hold today's plan, a brain-dump inbox, tasks, habits with GitHub-style
activity squares, hackathons, coding/learning and fitness consistency, money/business
experiments, and protected time for the people you love. It is not a corporate
productivity dashboard: no fake AI, no analytics, no streak guilt, no KPI walls.

Everything is stored in your browser's IndexedDB on your device. There is no server,
no account, and no network call carrying your data anywhere.

> **Status: PHASE 000 (foundation).** The app boots to a temporary screen that proves
> the toolchain, routing, styling tokens and local database work. The real interface
> starts in PHASE 001. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Quick start

Requires Node.js ≥ 22.22 (React Router 8 requirement) and npm.

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command                | What it does                                                              |
| ---------------------- | ------------------------------------------------------------------------- |
| `npm run dev`          | Vite dev server with hot reload                                           |
| `npm run build`        | Type-check (`tsc -b`) then production build into `dist/`                  |
| `npm run preview`      | Serve the production build locally                                        |
| `npm run typecheck`    | TypeScript only                                                           |
| `npm run lint`         | ESLint (includes the storage-boundary rule: UI goes through repositories) |
| `npm run format`       | Prettier, write                                                           |
| `npm run format:check` | Prettier, check only                                                      |
| `npm test`             | Vitest in watch mode (`npm test -- --run` for a single pass)              |
| `npm run check`        | typecheck + lint + format check + tests + build — run before committing   |

## Stack

React 19 · TypeScript 6 · Vite 8 · Tailwind CSS 4 · React Router 8 · Dexie 4 (IndexedDB)
· Zod 4 (`zod/mini`) · date-fns · Lucide · Vitest + React Testing Library + fake-indexeddb
· ESLint + Prettier.

## Project layout

```
src/
  app/            composition: App, routes, context, temporary foundation screen
  db/             the only code that touches IndexedDB
    database.ts   Dexie database + version history
    schema.ts     Zod record schemas, schema version, store/index layout
    repositories/ interfaces (types.ts) + Dexie implementations
  hooks/          useRepositories — how components reach data
  lib/            ids, time/date conventions
  styles/         design tokens + Tailwind entry
  types/          domain types (Task, InboxItem, Habit, …)
  test/           Vitest setup, helpers and tests
docs/             product, architecture, decisions, data model, testing, security, phases
```

Feature folders (`src/features/inbox`, `tasks`, …) and shared components are created
when the first feature needs them, not before.

## Documentation

- [Product](docs/PRODUCT.md) — what LOWTIDE is and is not
- [Architecture](docs/ARCHITECTURE.md) — layers and boundaries
- [Data model](docs/DATA-MODEL.md) — entities, date/ID conventions, migrations
- [Decisions](docs/DECISIONS.md) — ADRs
- [Setup](docs/SETUP.md) · [Testing](docs/TESTING.md) · [Security](docs/SECURITY.md)
- [Roadmap](docs/ROADMAP.md) · [Changelog](docs/CHANGELOG.md) · [Phase reports](docs/phases/)

## History

This repository previously held an earlier LOWTIDE prototype (commits up to `94dcde8`).
It was deliberately removed at the start of PHASE 000 to start fresh on the stack above;
it remains in Git history.
