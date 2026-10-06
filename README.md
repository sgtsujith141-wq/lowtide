# LOWTIDE

A calm, local-first place to run a personal life — built to be easy to use after a
mentally exhausting day.

LOWTIDE will hold today's plan, a brain-dump inbox, tasks, habits with GitHub-style
activity squares, hackathons, coding/learning and fitness consistency, money/business
experiments, and protected time for the people you love. It is not a corporate
productivity dashboard: no fake AI, no analytics, no streak guilt, no KPI walls.

Everything stays on your device. By default LOWTIDE keeps its data in your browser's
IndexedDB. When you choose, you can move it into the **LOWTIDE companion**, a small
local program that keeps it in SQLite, keeps a technical workspace up to date, and lets
the AI clients you allow (Claude Code, Claude Desktop, others) work with it over MCP,
each only within the scope you give it, with every change attributed and audited. There
is no account, no cloud, and nothing carrying your data to the internet.

> **Status: LOWTIDE v2.3 (2026-10-07): an installed Mac app (LOWTIDE.app, started by
> launchd, no Terminal), a standard MCP server on the official SDK (Streamable HTTP and
> stdio), the SQLite companion, SPACE with databases and Areas, CTFs.** See
> [docs/LOWTIDE-V2-STATUS.md](docs/LOWTIDE-V2-STATUS.md) for what's complete, partial
> and pending, and [docs/v2.2/OPERATING-PLAN.md](docs/v2.2/OPERATING-PLAN.md) for how a
> whole life plan (tracks, learning logs, hackathons, priorities) maps onto LOWTIDE.
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
> - **SPACE**: pages, folders and databases (table, board, list and calendar views) in
>   Projects, Areas, Hackathons, College, Ideas, Personal and Archive.
> - **Rhythm**, **Hackathons** (hackathons and CTFs, each with its stage rail and the
>   organisers' answer), **Calendar**, **Today** (`/today`), **Inbox**, **Tasks**, and
>   **Data & backup**.
> - **AI & workspace** (`/ai`): scoped context packs; with the companion, AI client
>   access (grants, real connection status, an audit of every call) and the live
>   workspace; without it, a workspace ZIP export.
> - **Settings** (`/settings`): Auto, Light or Dark, and moving LOWTIDE into the
>   companion ([docs/COMPANION.md](docs/COMPANION.md)) with a verified migration.
>
> Protected time for the people you love is never scored, never in a grid, and never in
> AI context.

## Using LOWTIDE (installed)

```bash
npm run install:lowtide   # once, from this repository (also how you update)
```

Then open **LOWTIDE** from Applications. It starts at login, restarts if it stops, and
serves everything at `http://127.0.0.1:4318` (the app, its API, live events and MCP at
`/mcp`); nothing depends on this repository afterwards. See
[docs/v2.3/INSTALLED-APP.md](docs/v2.3/INSTALLED-APP.md), and
[docs/integrations/](docs/integrations/MCP.md) for Claude, ChatGPT and other MCP clients.

## Development quick start

Requires Node.js ≥ 22.22 (React Router 8 requirement) and npm.

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command                   | What it does                                                                   |
| ------------------------- | ------------------------------------------------------------------------------ |
| `npm run dev`             | Vite dev server with hot reload                                                |
| `npm run build`           | Type-check (`tsc -b`) then production build into `dist/`                       |
| `npm run preview`         | Serve the production build locally                                             |
| `npm run typecheck`       | TypeScript only                                                                |
| `npm run lint`            | ESLint (includes the storage-boundary rule: UI goes through repositories)      |
| `npm run format`          | Prettier, write                                                                |
| `npm run format:check`    | Prettier, check only                                                           |
| `npm test`                | Vitest in watch mode (`npm test -- --run` for a single pass)                   |
| `npm run check`           | typecheck + lint + format check + tests + build — run before committing        |
| `npm run companion`       | Build and run the local companion (`-- pair` prints the pairing link)          |
| `npm run e2e:companion`   | The whole companion flow in a headless browser (needs `playwright-core`)       |
| `npm run build:lowtide`   | Build and check an installable runtime (`build/lowtide/<build>`)               |
| `npm run install:lowtide` | Install or update LOWTIDE.app, its runtime and launchd agent (rehearsed first) |

## Stack

React 19 · TypeScript 6 · Vite 8 · Tailwind CSS 4 · React Router 8 · Dexie 4 (IndexedDB)
· Zod 4 (`zod/mini`) · date-fns · Lucide · Vitest + React Testing Library + fake-indexeddb
· ESLint + Prettier. The companion adds no dependency: Node's built-in `node:sqlite`,
`node:http` and `node:crypto`.

## Project layout

```
src/
  app/            composition: App, Shell (navigation), routes, error screen
  db/             storage: the StoreDb contract, Dexie, repositories, backups
    database.ts   Dexie database + version history
    schema.ts     Zod record schemas, schema version, store/index layout
    store.ts      StoreDb: the storage contract both backends implement
    repositories/ interfaces (types.ts) + the domain repositories
    companion/    the app's side of the companion: wire contract, client, backend
  components/ui/  small primitives: Button, IconButton, notices, field styles
  features/       today, inbox, tasks, rhythm, hackathons, backup: screens + feature logic (each screen its own chunk)
  hooks/          useRepositories, useWatch (live data), useToday, useDocumentTitle
  lib/            ids, time/date and deadline conventions, LocalDate calendar maths, relative time labels
  styles/         design tokens + Tailwind entry
  types/          domain types (Task, InboxItem, Habit, …)
  test/           Vitest setup, helpers and tests
companion/        the companion: server/ (SQLite, migration, RPC, MCP, workspace) and
                  lowtide-mcp.ts (the stdio bridge for AI clients)
scripts/          e2e-companion.mjs (the real-browser check)
docs/             product, architecture, decisions, data model, testing, security, phases
```

Further feature folders (`today`, `habits`, `hackathons`, …) are created when the first
feature needs them, not before.

## Documentation

- [Product](docs/PRODUCT.md) — what LOWTIDE is and is not
- [Architecture](docs/ARCHITECTURE.md) — layers and boundaries
- [Data model](docs/DATA-MODEL.md) — entities, date/ID conventions, migrations
- [Decisions](docs/DECISIONS.md) — ADRs
- [Companion](docs/COMPANION.md) — starting it, moving your data, connecting AI clients,
  backup and rollback
- [Installed app](docs/v2.3/INSTALLED-APP.md) — install, update, daily use, rollback
- [MCP](docs/integrations/MCP.md) · [Claude](docs/integrations/CLAUDE-MCP.md) ·
  [ChatGPT](docs/integrations/CHATGPT-MCP.md) — connecting AI clients
- [Setup](docs/SETUP.md) · [Testing](docs/TESTING.md) · [Security](docs/SECURITY.md)
- [Roadmap](docs/ROADMAP.md) · [Changelog](docs/CHANGELOG.md) · [Phase reports](docs/phases/)

## History

This repository previously held an earlier LOWTIDE prototype (commits up to `94dcde8`).
It was deliberately removed at the start of PHASE 000 to start fresh on the stack above;
it remains in Git history.
