# LOWTIDE v2 — Audit of the v0.1 codebase

- **Date:** 2026-09-30
- **Repository state:** `main` = `origin/main` = `de8f501`, clean tree
- **Scope:** read-only audit. Nothing was redesigned and no data was migrated.
- **Companion document:** [LOWTIDE-V2-ARCHITECTURE.md](LOWTIDE-V2-ARCHITECTURE.md)
  (target architecture and the store-by-store migration map)

## 1. Validation suite (actual results, 2026-09-30)

| Check            | Command                | Result                                                                |
| ---------------- | ---------------------- | --------------------------------------------------------------------- |
| Typecheck        | `npm run typecheck`    | **pass**                                                              |
| Lint             | `npm run lint`         | **pass**                                                              |
| Format           | `npm run format:check` | **pass**                                                              |
| Tests            | `npm test -- --run`    | **FAIL: 1 of 338** (28 files; 27 pass)                                |
| Production build | `npm run build`        | **pass**: entry 452.62 kB (144.47 kB gzip), one lazy chunk per screen |

**The failing test** is `inbox-page.test.tsx` › "lists unprocessed thoughts oldest first
with their capture time". It isn't flaky; it's a **date time-bomb**:

- the test captures thoughts with a fixed clock at 2026-09-28 09:00 UTC, while
  `formatWhen` renders relative labels against the real current date;
- on 2026-09-28 the label was a clock time ("14:30"), which contains digits;
- from 2026-09-30 it's the weekday ("Mon"), and the assertion
  `getByText(/\d/, { selector: 'time' })` finds nothing.

It's a test defect from PHASE 001, not a product defect. It has **not** been fixed in
this phase, which is documentation-only. The fix is to assert on the `<time>` element's
`datetime` attribute (or inject the clock into `formatWhen`), and should be the first
commit of the next phase.

## 2. What exists (inventory)

- **Stack:** Vite 8, React 19, TypeScript 6 (strict, `exactOptionalPropertyTypes`),
  Tailwind 4, React Router 8, Dexie 4 (IndexedDB), Zod 4 (`zod/mini`), date-fns,
  Lucide.
- **Size:** 7 runtime dependencies. About 11.1k lines in `src/`: about 6.3k app, about
  4.8k tests.
- **Routes** (all screens lazy, `src/app/routes.tsx`):

  | Route         | Screen         | Purpose                                                                           |
  | ------------- | -------------- | --------------------------------------------------------------------------------- |
  | `/`           | TodayPage      | capture, Needs attention, My plan, near-term hackathons, protected time this week |
  | `/inbox`      | InboxPage      | brain-dump processing (Make task / Clear)                                         |
  | `/tasks`      | TasksPage      | open tasks, inline edit, Finished section                                         |
  | `/rhythm`     | RhythmPage     | 26-week activity grid, today's habit logging, rhythm management                   |
  | `/hackathons` | HackathonsPage | hackathon project sheets, Past                                                    |
  | `/data`       | DataPage       | backup export, validated replace-restore, storage persistence                     |
  | `*`           | NotFound       | —                                                                                 |

- **Shell:** a sidebar at `md` and up, a 5-item stacked-icon tab bar on phones, and a
  footer link to Data & backup. It has a skip link and an idle-time prefetch of screen
  chunks.
- **Data:** the Dexie database `lowtide`, schema **V3**. It has six stores (§4) and six
  repositories (task, inbox, protected time, habit, hackathon, backup), all behind
  interfaces. UI code can't import Dexie or the database (enforced by ESLint and tested).
- **Reactivity:** repository `Watch<T>` subscriptions over Dexie `liveQuery`, consumed
  with `useWatch`.
- **Rules:** domain invariants live in `src/db/rules.ts`, shared by the repositories
  and the backup import.
- **Backup:** a versioned JSON envelope (`formatVersion` 1, independent of
  `schemaVersion`). Export is one consistent read transaction. Import runs parse →
  envelope → migrate (`migrateSnapshot`) → schema and rule validation → cross-store
  integrity → atomic replace.
- **Tests:** Vitest + React Testing Library + fake-indexeddb, 28 files and 338 tests.
  `testTimeout` is 15 s. There are migration tests from real V1 and V2 databases, and an
  ESLint storage-boundary test.
- **Docs:** product, architecture, data model, 36 ADRs, security, testing, setup,
  changelog, roadmap, and phase reports 000–006.

## 3. Classification by subsystem

**KEEP:** it stays as it is and v2 builds on it. **REFACTOR:** the same responsibility
reshaped for v2. **MIGRATE:** the data or concept moves to a v2 home, preserved.
**REPLACE:** superseded by a different design (data preserved). **NEW:** doesn't exist
yet.

### KEEP

| Subsystem                                                                                   | Why                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain (Vite, TS strict, Tailwind 4, React Router lazy routes, ESLint, Prettier, Vitest) | Healthy: typecheck, lint and build pass; route splitting is working; nothing is v2-incompatible.                                                                                          |
| Repository boundary + `Watch<T>` reactivity (ADR-003, ADR-015)                              | Exactly the "shared context service" seam v2 needs. Components never touch Dexie, so storage can later move to a companion process without rewriting UI. The ESLint rule keeps it honest. |
| Domain rules module (`src/db/rules.ts`)                                                     | Shared invariants for writes and imports; v2 adds rules here.                                                                                                                             |
| Date conventions (`Timestamp` UTC, `LocalDate`, `lib/calendar.ts`)                          | Tested across DST and time zones; v2 grids, sessions and timelines need exactly this.                                                                                                     |
| Inbox / Brain Dump capture (CaptureComposer, ADR-017)                                       | Race-free, IME-safe capture with failure restore; v2's Home keeps a capture entry point.                                                                                                  |
| Inbox processing                                                                            | Make task / Clear semantics and history-preserving processing (ADR-018) still fit.                                                                                                        |
| Protected time model and repository (ADR-021, ADR-035)                                      | A core product principle: people and rest are never scored. v2 keeps it separate from every grid (see ARCHITECTURE §Daily Pulse).                                                         |
| Backup/restore pipeline (ADR-031–034)                                                       | Safety net for all v2 migrations. The envelope stays at format 1; every new store must be added to `STORE_NAMES`, validation and `migrateSnapshot`.                                       |
| Accessibility work                                                                          | ARIA grid with roving tabindex, focus-after-action patterns, `expectFocus`, the "never disable a focused control" rule (ADR-030). The v2 UI must inherit these.                           |
| Test infrastructure                                                                         | Real IndexedDB semantics via fake-indexeddb, migration tests from genuine old databases, and the storage-boundary lint test.                                                              |
| Security posture (no telemetry, local-only, plaintext-backup honesty)                       | Remains the default. Any v2 network feature (GitHub, AI) is opt-in with a documented model (ARCHITECTURE §12).                                                                            |

### REFACTOR

| Subsystem                                                     | Why / how                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contribution grid (`ActivityGrid`, `grid.ts`, `intensity.ts`) | Correct and accessible, but fixed at 26 Monday-first weeks, 11/15 px cells, and one sea-glass palette. v2 needs a **generic grid component**: 52/53 weeks, GitHub geometry (Sunday-first rows, Mon/Wed/Fri labels, month labels), a per-grid palette token set, a day-details callback, and any data source. Keep the ARIA grid, roving tabindex and text-per-cell. Levels and aggregation become pluggable per grid. |
| Shell / navigation                                            | v2 adds Home, Projects, Start Work and Sleep Mode. The 5-tab phone bar already fills 320 px (measured), so v2 must restructure navigation rather than append tabs. A mode state (Work / Sleep) must be shell-level, since Sleep dims the whole UI.                                                                                                                                                                    |
| Design tokens (`styles/index.css`)                            | The token architecture is right (semantic CSS variables, light and dark). v2 needs: per-category grid palettes (green Daily Pulse, amber Work, violet Sleep, teal Personal, warm red Gym, blue College, gold Projects), "dimmed" Sleep-mode tokens, and probably a dark-first Home (a GitHub-style dark grid). The palettes are additive tokens; whether dark becomes the default is a decision (§5).                 |
| Tasks (`tasks` store, TaskRepository)                         | Keep the tasks and their lifecycle, but a task can belong to a **project** (`projectId`), not just a free-text `project` label. Start Work may attach a task. The completion flow must also emit `task.completed`.                                                                                                                                                                                                    |
| Rhythm / habits (`habits`, `habitEntries`)                    | Becomes **routines/life tracking**. Entries keep their meaning (ADR-023). Categories map to v2 secondary grids (coding/learning → College/Projects?, fitness → Gym, personal → Personal). Logging also emits `habit.logged`. Group views (ADR-036) become grid presets.                                                                                                                                               |
| Today page (composition, ADR-020)                             | Its composition logic is reusable, but Today is no longer the home route. Its content becomes Home's "compact Today summary" plus a full Today view.                                                                                                                                                                                                                                                                  |
| Backup (`STORE_NAMES`, validation)                            | Extended, not replaced: new stores, new cross-store integrity rules (sessions → project, milestone → project, event → entity), and V3 → V4 snapshot migration.                                                                                                                                                                                                                                                        |

### MIGRATE

| Subsystem                                  | Destination                                                                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks.project` (free-text label)          | Real `projects` records: one per distinct label, created by the V4 upgrade. Each task gets a `projectId`, and **the label field is kept** so nothing is lost and a rollback reads the old data.                                 |
| Hackathons (`hackathons` store)            | Stay as records. Each hackathon optionally links to a v2 **project** of kind `hackathon`, whose command room shows milestones, sessions and grid. The hackathon statuses (registration, PPT, build) remain. No data is dropped. |
| Habit categories → secondary grids         | A mapping, not a data change (ARCHITECTURE §9).                                                                                                                                                                                 |
| Today's hackathon section, Needs attention | Feed Home's "Needs You" (blockers, approvals, due items).                                                                                                                                                                       |

### REPLACE

| Subsystem                                                                                          | Why                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/` = TodayPage as the home route                                                                  | v2's **Home** (Start Work, Sleep Mode, Ask LOWTIDE, year grid, project cards, Needs You) replaces it at `/`. Today moves to its own route. The component logic is reused, not deleted.                       |
| "No percentages" (v0.1 PRODUCT.md, hackathons: "deliberately absent: percentages, progress rings") | v2 explicitly wants **milestone-based** project completion. This supersedes the v0.1 principle **for projects only**, and needs an ADR. Percentages must come from real milestones, never time or guesswork. |
| ADR-025 "the grid is habits only" for the _master_ grid                                            | v2's Daily Pulse aggregates more than habits (work sessions, project activity). Needs a new ADR defining exactly what feeds it. Protected time stays excluded (non-negotiable, ADR-013/021).                 |

### NEW

| Subsystem                              | Notes                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects (command model)               | States: planning, active, waiting, needs_approval, blocked, parked, review, done, archived. Also objective, milestones, blockers, approvals, decisions. |
| Milestones and progress snapshots      | The basis of completion %, plus a progress-over-time history.                                                                                           |
| Work sessions (Start Work)             | Project, optional task, start, pause, resume, finish, durations.                                                                                        |
| Off-time / Sleep sessions (Sleep Mode) | Manually started and ended windows. Never "sleep quality".                                                                                              |
| Typed event ledger                     | `work.*`, `sleep.*`, `habit.logged`, `task.completed`, `project.*`, `decision.created`, `ai.session.completed`… append-only.                            |
| Decisions                              | Per-project ADR-like records.                                                                                                                           |
| AI session / handoff records           | Written only by real clients. No fake AI activity.                                                                                                      |
| Workspace filesystem hierarchy         | Needs a writer outside the browser (ARCHITECTURE §11).                                                                                                  |
| AI context engine + MCP/API            | Needs a local companion process (ARCHITECTURE §12–13).                                                                                                  |
| GitHub information                     | Network plus a token. Opt-in, a new security model.                                                                                                     |
| Home and Project Command Room UIs      | Visual-first screens.                                                                                                                                   |

## 4. Existing stores (all six) and their v2 destination

| Store (V3)      | Records                                                                    | v2 destination                                                     | Data change                                    |
| --------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| `tasks`         | Task (title, notes, status, priority, dueAt, project label, plannedFor, …) | `tasks`, + optional `projectId`, + optional `milestoneId`          | additive; `project` label kept                 |
| `inbox`         | InboxItem                                                                  | `inbox` (unchanged)                                                | none                                           |
| `habits`        | Habit (name, category, unit, target, archived)                             | `habits`, surfaced as "routines"; category → grid mapping          | none (optional additive `grid` override later) |
| `habitEntries`  | one per habit per LocalDate                                                | `habitEntries` (unchanged; the source of truth for routine values) | none                                           |
| `hackathons`    | Hackathon (LocalDate dates, statuses, next action, …)                      | `hackathons`, + optional `projectId` link                          | additive                                       |
| `protectedTime` | ProtectedTime (LocalDate, kind)                                            | `protectedTime` (unchanged)                                        | none. **Never** enters Daily Pulse or any grid |

The full column-level map, the new V4 stores and the upgrade steps are in
ARCHITECTURE §2 and §15.

## 5. Conflicts with existing principles: decisions for the owner

These aren't implementation details. Each changes a documented v0.1 decision, so each
needs an explicit owner decision (and then an ADR) before the phase that depends on it.

1. **Daily Pulse contents** (supersedes ADR-025 for the master grid). What counts as a
   pulse: work minutes, routine entries, completed tasks, project events? Protected
   time is **excluded regardless** (ADR-013/021), and sleep has its own grid.
2. **Completion percentages** (reverses PRODUCT.md's "deliberately absent: percentages" for projects). The
   proposal is that % = completed milestone weight ÷ total milestone weight, and that
   only the owner adds or completes milestones.
3. **Where the source of truth lives.** Today it's browser IndexedDB, which Claude Code,
   an MCP server or a filesystem sync **cannot read**. Options (ARCHITECTURE §12):
   - keep IndexedDB and add a localhost companion that receives exports; or
   - move the canonical store to a local SQLite owned by a companion process, with the
     browser as a client.

   This changes ADR-001/004 (static SPA, no server).

4. **Network features** (GitHub info, AI clients) change ADR-005's "no network at
   runtime". The proposal: all opt-in, localhost-first, tokens never in the browser
   bundle or Git, and a documented security model before any code.
5. **Visual direction.** A GitHub-style green, dark-cell grid conflicts with the
   warm-paper light theme. Options:
   - dark-first Home only;
   - a dark default app-wide;
   - grid palettes that adapt per theme.
6. **Home replaces Today at `/`.** Where Today lives (`/today`?), and how the 320 px
   navigation carries Home, Projects, Today, Inbox, Tasks, Routines, Hackathons, Data
   and the modes.
7. **Hackathons vs projects.** Link each hackathon to a project, or make hackathons a
   project kind outright.
8. **Sensitive logs in the workspace.** Sleep windows, routines and protected time stay
   DB-only by default. Only technical project knowledge is exported to the filesystem
   hierarchy (you asked for this; recorded here so it's enforced).

## 6. Risks carried into v2

- **The failing time-bomb test** (§1), until it's fixed.
- **Bundle:** the entry is 452.62 kB. Charts for the Project Command Room must be plain
  SVG/CSS (no chart library) or lazy, and shouldn't grow the entry.
- **The 320 px navigation** is already at capacity (5 stacked tabs, 0 px spare measured
  in PHASE 004).
- **Schema changes:** every one needs a real V(n−1) migration test, like
  `migration-v3.test.ts`, and a `migrateSnapshot` step so old backups still import.
- **Personal data** lives only in ignored `lowtide-backup-*.json` files (memory rule);
  v2 workspace export must not change that.
- **The old prototype database** in the owner's Firefox (`lowtide` schema 2, prototype
  stores) may be altered or dropped when the current app first opens there. Unverified.
