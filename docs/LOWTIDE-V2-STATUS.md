# LOWTIDE v2 — Status after v2.1 (operator parity, SPACE, creation, live upgrade)

- **Date:** 2026-10-03
- **v2.1 docs:** [OPERATOR-PARITY](v2.1/OPERATOR-PARITY.md),
  [SPACE-USABILITY](v2.1/SPACE-USABILITY.md),
  [MCP-CAPABILITY-MATRIX](v2.1/MCP-CAPABILITY-MATRIX.md),
  [ZERO-DOWNTIME-UPGRADE](v2.1/ZERO-DOWNTIME-UPGRADE.md)
- **Baseline:** v2 PHASE 001 at `8ba660f`; the overnight build ended at `f4ffe5a`;
  PHASE 008B starts at `a638466`
- **Rule followed:** only what was implemented and verified is listed as done

## COMPLETE

| Phase                     | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Key decisions             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 002 V4 data foundation    | Schema V4: projects, milestones, board items, decisions, work and off-time sessions, event ledger, progress snapshots, AI sessions. Additive, with repositories, rules and backups.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ADR-046                   |
| 003 Home v2               | Home at `/`, Today at `/today`, the v2 navigation, the Daily Pulse year calendar, project cards, Needs you, a compact Today, recent activity, secondary grids.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ADR-043, ADR-047, ADR-048 |
| 004 Project Command Room  | Completion ring, milestone pipeline, seven lanes, charts, a project calendar, a timeline, tabs: Overview, Tasks, Milestones, Docs, AI, GitHub, History.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ADR-050                   |
| 005 Work + Sleep Mode     | Start Work, a global timer bar that survives a reload, Sleep Mode (dims, keeps navigation, Wake up; refused while work runs).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ADR-049                   |
| 006 Life + Rhythm         | Schema V5 college items; the Life page; Rhythm on the shared grid with 7-day to 12-month ranges.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ADR-051, ADR-052          |
| 007 Hackathons + Calendar | A seven-stage rail, an explicit "Track the build as a project", a combined calendar, coursework in Needs you.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ADR-053                   |
| 008 Shared AI context     | Scoped context packs (never protected time) and the workspace export (browser mode).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ADR-054                   |
| 008B SQLite companion     | Schema V6 (notes, recorded research status, AI attribution). One storage contract for Dexie and SQLite, with parity tests. The companion: SQLite canonical after an owner-triggered, verified move; companion-backed repositories with live events; MCP with scoped grants, 22 tools, attribution and audit; the live workspace and optional Git; Appearance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ADR-056 to ADR-061        |
| 010 Data consolidation    | Schema V7: SPACE (sections, pages, typed tables) and source provenance. The Notion importer and `import-notion` (idempotent, LOWTIDE wins, no invented history). The owner's Notion workspace imported: real projects, tasks, milestones, blockers, decisions and hackathons, the rest in SPACE.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ADR-062                   |
| v2.1 Operator parity      | Schema V10 (subtasks, milestone and hackathon archive, pins, descriptions; database views, relations, rollups, formulas; companion migrations 6–7). 127 MCP tools under granular capabilities with Read only, Project, Workspace and Full LOWTIDE operator presets; a capability matrix with every gap implemented or restricted with a reason; dry runs, checkpoints, attributed change log with guarded undo; the Claude Operating Guide in SPACE. One New menu and ⌘K for eight kinds of record; Command Room adds milestones and tasks; SPACE folders, + New, context menus, Trash, pins, templates, import/export, an obvious empty page, `[[` links, bookmarks; table, board, list and calendar views. Settings: autostart, health, logs, restart, checkpoints. Live upgrade measured at 417 ms of companion unavailability. | see v2.1 docs             |
| 016 Refinement and QA     | Rhythm stepper race fixed at its root; Home offers a way to begin; Hackathons, Rhythm, Life, Calendar, AI and Settings refined; readable long SPACE tables, labelled code and Mermaid source with copy, a SPACE home from real pages; palette create commands; shorter copy. Re-verified on real data: 238-combination axe and overflow sweep plus interactive states (0), backup round trip on a disposable copy (identical), MCP smoke (scopes, Personal and protected time refused, audit).                                                                                                                                                                                                                                                                                                                                     | see PHASE 016             |
| 015 Work and Sleep Modes  | Sleep as a full-screen dormant layer with a finish-first decision for running work and a passing wake summary; Work Mode as a focus surface with a keyboard chooser that offers the current project first, a compact bar, a light finish summary, state-aware palette actions and ⌘/Ctrl ⇧ Enter. Session data unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ADR-069                   |
| 014 SPACE                 | SPACE as a three-pane workspace on the real imported hierarchy: a keyboard tree, a block editor with autosave, conflicts and history, first-class tables, links and backlinks, a context inspector, local search, a global ⌘K, and ten scoped SPACE tools over MCP (schema V9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ADR-067, ADR-068          |
| 013 Projects flagship     | Projects as a tiered, full-width portfolio; the Command Room rebuilt around identity, milestone progress, a clickable roadmap, Start Work, a five-fact summary, a work plane, honest progress and time charts, a six-month gold grid and meaningful activity; explicit milestone sets reconciled from Notion with provenance and no fake history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ADR-065, ADR-066          |
| 012 Home v3               | Home rebuilt on real data: a full-width Daily Pulse hero with a day drawer, Project Command rows ordered by the new project focus (schema V8), grouped Needs you, a Today strip, recent events, one rhythm at a time, a ⌘K local search.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ADR-064                   |
| 011 Visual foundation     | Cold graphite tokens with colour reserved for data, Geist, an icon rail with a launcher, page widths and layout primitives, flattened surfaces, compact controls, fitted contribution grids, motion tokens and a dormant Sleep state; 0 axe violations at 320–1920 px.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ADR-063                   |
| 009 QA and polish         | Vendor chunks, an axe-core sweep, overflow, large-data timing and keyboard checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | see PHASE 009             |

## PARTIAL

**AI client connections.** Everything on LOWTIDE's side is built and tested: the MCP
endpoint, the stdio bridge, scoped grants, audit, and the whole flow in a headless
browser (`npm run e2e:companion`) and against a disposable copy of the real data
(PHASE 016). Claude Code has connected for real over a grant (it read context from the
upgraded companion during the v2.1 cutover). Still untried:

- **Claude (Desktop):** the bridge it would launch is protocol-tested; not yet run from
  the app itself.
- **Other MCP clients:** stdio and HTTP both work with any client that can hold a grant
  token; none besides the test harness has been tried.

LOWTIDE's AI area shows each client's real status, so this becomes visible the moment a
client connects.

## KNOWN LIMITATIONS

These are not built, and nothing in LOWTIDE claims they work:

- **GitHub integration:** no repository access; the Command Room's GitHub tab says so.
- **ChatGPT direct connection:** none. Its connectors reach servers over the internet;
  the companion listens only on this computer.
- **Notion sync:** the import is one-way and read-only; Notion is never written, and
  later Notion edits aren't pulled.
- **File uploads:** SPACE holds references to files, not uploaded files.
- **Workspace Git remote/sync:** the workspace can be a local Git repository; no remote,
  no push, no sync.
- **Mermaid diagrams** are shown as labelled source, not drawn; "Recently opened" is per
  device.
- **SPACE databases (v2.1):** the relation picker links pages, not individual rows;
  boards group only by select or status; sorting from a table header isn't saved to the
  view; editing a 10,000-row database takes about 1.8 s per change (one record per table).
- **Creation (v2.1):** quick-create for a hackathon asks only for a name and date (the
  rest is edited in its sheet); projects are archived, never permanently deleted.
- **AI access (v2.1):** a token is shown once and copied by hand into the client;
  LOWTIDE doesn't write client configuration files.

## NOT BUILT

- GitHub read access (a repository-scoped token held by the companion; ADR-041).
- Encrypted backups, sync between devices, PWA/offline caching.
- Audit-log pruning.

## TEST COUNTS

- **Vitest:** 72 files and 743 tests (`npm test -- --run`), all passing; companion and
  MCP suites are 10 of those files (61 tests), including the thirty real owner workflows
  over MCP.
- **Progression:** 338 at the v0.1 baseline → 356 after v2 PHASE 001 → 514 after the
  overnight build → 521 with schema V6 → 663 after PHASE 015 → 677 after PHASE 016 → 743 after v2.1.
- **PHASE 008B suites:** SQLite store and parity, migration and rollback, MCP and the HTTP
  boundary, the workspace, the stdio bridge, the wire contract, the app against a real
  companion, and Settings (see TESTING.md).
- **Real-browser check:** `npm run e2e:companion`, 16 steps, all passing, no console
  errors (headless Chromium, throwaway profile and data folder).
- **PHASE 016 browser checks on real data:** axe-core and overflow over 17 routes × 7
  widths × 2 themes (238 combinations) plus modes, SPACE and Command Room overlays: 0
  violations, 0 horizontal overflow. Backup → preview → restore on a disposable copy:
  integrity ok, all tables identical. MCP smoke on a disposable copy: all checks pass.
- **v2.1 checks on a disposable copy of real data:** the same 238-combination sweep
  including new routes (0 violations, 0 overflow) and 56 open menus, forms and dialogs
  (0); backup round trip with 22 tables identical; synthetic 1,000 pages / 10,000 rows /
  500 tasks (every route and view settles in under 1.2 s; adding a row to the 10,000-row
  table takes 1.8 s); upgrade rehearsals and the live cutover (see ZERO-DOWNTIME-UPGRADE).

## CURRENT ARCHITECTURE

- **App:** a static React 19 SPA (Vite 8, TypeScript strict, Tailwind 4, React Router
  8). Repositories are the only way UI code reaches data (ESLint-enforced).
- **Storage, two modes (ADR-058):** browser mode keeps IndexedDB (Dexie) canonical;
  companion mode keeps `~/.lowtide/lowtide.sqlite` canonical, and the app's repositories
  call the companion. The same domain repositories run on both through `StoreDb`
  (ADR-057). There's no fallback between them.
- **Schema V10:** 19 stores (V8 added `Project.focus`, V9 SPACE blocks, revisions and history, V10 subtasks, archives, pins, descriptions and database views); every upgrade additive. Backups: envelope format 1, 19
  stores; V1–V6 still import.
- **The companion:** one process on 127.0.0.1 (Host and Origin checks, owner token for
  the app, grant tokens for AI clients, rate and size limits, owner-only files). Live
  updates by server-sent events after every commit.
- **AI:** no AI inside the app. AI clients reach LOWTIDE only through the companion's
  MCP endpoint, within their grant; every call is audited; protected time is reachable
  from no scope.
- **Workspace:** regenerated after every change; people's files never touched; optional
  private Git with no remote.
- **Bundles:** entry ~83 kB plus vendors (react 219 kB, data 120 kB, router 92 kB); each
  screen is lazy-loaded.

## KNOWN RISKS

- **The companion has to be running** in companion mode. If it isn't, LOWTIDE says so
  and saves nothing until it's back (no silent fallback, by design). Settings can now
  start it at login; that is off until the owner turns it on.
- **Plaintext at rest,** as before: the SQLite database, backups and the workspace aren't
  encrypted by LOWTIDE; they're owner-only files. Use disk encryption.
- **The owner token sits in the app's `localStorage`.** Anything running script on
  LOWTIDE's origin could read it; LOWTIDE loads no third-party scripts.
- **What an AI client reads, it sends to its model provider.** Scopes limit what that is.
- **`node:sqlite`** is Node's built-in SQLite module, a newer part of Node than the rest
  of what LOWTIDE uses. The companion was tested on Node 24.19; it needs Node 22.22 or
  later (LOWTIDE's minimum), and a Node upgrade is worth a run of the companion tests.
- **The audit log grows** with every AI call. There's no pruning yet.
- **jsdom test weight,** as before: two waits for page-wide queries on heavy screens now
  allow up to 8 s under load.

## NEXT HUMAN DECISIONS

1. **Download a fresh backup** from Data & backup and keep it somewhere you trust.
2. **Choose Claude's access:** keep the existing grants, or give Claude Code the Full
   LOWTIDE operator preset (AI → Give access) so it can run projects and SPACE end to end.
3. **Workspace location:** keep `~/.lowtide/workspace`, or point `workspaceDir` at a
   folder of your choice, and decide whether to make it a Git repository.
4. **Start at login:** turn on Settings → Running in the background if you want the
   companion started automatically.
5. **Daily Pulse calibration** (ADR-037), still open from the overnight build.
