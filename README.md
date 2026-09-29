# LOWTIDE

A calm, local-first place to run a personal life — built to be easy to use after a
mentally exhausting day.

LOWTIDE will hold today's plan, a brain-dump inbox, tasks, habits with GitHub-style
activity squares, hackathons, coding/learning and fitness consistency, money/business
experiments, and protected time for the people you love. It is not a corporate
productivity dashboard: no fake AI, no analytics, no streak guilt, no KPI walls.

Everything is stored in your browser's IndexedDB on your device. There is no server,
no account, and no network call carrying your data anywhere. The optional companion is
a local process that reads an exported folder; it opens no network port.

> **Status: LOWTIDE v2 (overnight build, 2026-09-30).** See
> [docs/LOWTIDE-V2-STATUS.md](docs/LOWTIDE-V2-STATUS.md) for what's complete, partial
> and pending.
>
> - **Home** (`/`): Start Work, Sleep Mode, Ask LOWTIDE (a local search, not an AI);
>   a year of **Daily Pulse** as a GitHub-style calendar; project cards; Needs you;
>   a compact Today; recent activity; Work, Projects, College, Personal and Sleep grids.
> - **Projects** and each project's **Command Room**:
>   - a milestone completion ring and the milestone pipeline;
>   - the Working now, Next, Waiting, Needs approval, Blocked, Parked and Done lanes;
>   - progress and time charts, an activity calendar, a timeline;
>   - tabs for Tasks, Milestones, Docs (decisions), AI and GitHub.
> - **Work Mode and Sleep Mode:** a global timer bar. Sleep Mode dims the app but
>   keeps it usable, and records a marked window, never a sleep measurement.
> - **Life** (`/life`): personal routines, sleep and off time, the gym, and college.
> - **Rhythm**, **Hackathons** (with a stage rail), **Calendar**, **Today** (`/today`),
>   **Inbox**, **Tasks**, and **Data & backup**.
> - **AI & workspace** (`/ai`): scoped context packs and a technical workspace export.
>   A local MCP companion (`companion/`, [docs/COMPANION.md](docs/COMPANION.md)) serves
>   the workspace to AI clients over stdio.
>
> Protected time for the people you love is never scored, never in a grid, and never in
> AI context.

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
  app/            composition: App, Shell (navigation), routes, error screen
  db/             the only code that touches IndexedDB
    database.ts   Dexie database + version history
    schema.ts     Zod record schemas, schema version, store/index layout
    repositories/ interfaces (types.ts) + Dexie implementations
  components/ui/  small primitives: Button, IconButton, notices, field styles
  features/       today, inbox, tasks, rhythm, hackathons, backup: screens + feature logic (each screen its own chunk)
  hooks/          useRepositories, useWatch (live data), useToday, useDocumentTitle
  lib/            ids, time/date and deadline conventions, LocalDate calendar maths, relative time labels
  styles/         design tokens + Tailwind entry
  types/          domain types (Task, InboxItem, Habit, …)
  test/           Vitest setup, helpers and tests
docs/             product, architecture, decisions, data model, testing, security, phases
```

Further feature folders (`today`, `habits`, `hackathons`, …) are created when the first
feature needs them, not before.

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
