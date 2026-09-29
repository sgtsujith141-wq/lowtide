# LOWTIDE v2 — Audit of the v0.1 codebase

- **Date:** 2026-09-30
- **Repository state:** `main` = `origin/main` = `de8f501`, clean tree
- **Scope:** read-only audit. Nothing was redesigned and no data was migrated.
- **Revised:** v2 PHASE 001 (2026-09-30) corrected seven errors found in review
  (listed in §7) and records the owner's decisions on the §5 conflicts.
- **Companion document:** [LOWTIDE-V2-ARCHITECTURE.md](LOWTIDE-V2-ARCHITECTURE.md)
  (target architecture and the store-by-store migration map)

## 1. Validation suite (actual results, 2026-09-30)

| Check            | Command                | Result                                                                |
| ---------------- | ---------------------- | --------------------------------------------------------------------- |
| Typecheck        | `npm run typecheck`    | **pass**                                                              |
| Lint             | `npm run lint`         | **pass**                                                              |
| Format           | `npm run format:check` | **pass**                                                              |
| Tests            | `npm test -- --run`    | **FAIL: 1 of 338** (28 files; 27 pass). Fixed in v2 PHASE 001         |
| Production build | `npm run build`        | **pass**: entry 452.62 kB (144.45 kB gzip), one lazy chunk per screen |

**The failing test** is `inbox-page.test.tsx` › "lists unprocessed thoughts oldest first
with their capture time". It wasn't flaky; it depended on the real calendar date:

- the test captured thoughts with a fixed clock at 2026-09-28 09:00 UTC, while the page
  labels them with `formatWhen(at, now)` against the **real** current time;
- `formatWhen` gives a clock time ("14:30") on the same day, "yesterday" one day later,
  a weekday ("Mon") two to six days later, and "28 Sep" from seven days on;
- the assertion `getByText(/\d/, { selector: 'time' })` needs a digit, so it failed
  whenever the local date was **29 September to 4 October 2026**, and would have passed
  again from 5 October.

It was a test defect from PHASE 001, not a product defect, and existed before v2 PHASE
000 (`git diff de8f501 HEAD -- src` was empty, and the test failed identically on a
copy of `de8f501`). v2 PHASE 001 fixed it by pinning `now` (only `Date` is faked) and
asserting each item's exact `datetime`, local `HH:mm` label and full-date title.

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
| Security posture (no telemetry, local-only, plaintext-backup honesty)                       | Remains the default. Any v2 network feature (GitHub, AI) is opt-in with a documented model (ARCHITECTURE §14).                                                                            |

### REFACTOR

| Subsystem                                                     | Why / how                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contribution grid (`ActivityGrid`, `grid.ts`, `intensity.ts`) | Correct and accessible, but fixed at 26 Monday-first weeks, 11/15 px cells, and one sea-glass palette. v2 needs a **generic grid component**: 52/53 weeks, GitHub geometry (Sunday-first rows, Mon/Wed/Fri labels, month labels), a per-grid palette token set, a day-details callback, and any data source. Keep the ARIA grid, roving tabindex and text-per-cell. Levels and aggregation become pluggable per grid. |
| Shell / navigation                                            | v2 adds Home, Projects, Start Work and Sleep Mode. The 5-tab phone bar already fills 320 px (measured), so v2 must restructure navigation rather than append tabs. A mode state (Work / Sleep) must be shell-level, since Sleep dims the whole UI.                                                                                                                                                                    |
| Design tokens (`styles/index.css`)                            | The token architecture is right (semantic CSS variables, light and dark). v2 needs: per-category grid palettes (green Daily Pulse, amber Work, violet Sleep, teal Personal, warm red Gym, blue College, gold Projects), and Sleep-mode tokens that dim and desaturate. The palettes are additive tokens; the app stays theme-adaptive, not dark-first (ADR-042).                                                      |
| Tasks (`tasks` store, TaskRepository)                         | Keep the tasks and their lifecycle, but a task can belong to a **project** (`projectId`), not just a free-text `project` label. Start Work may attach a task. The completion flow must also emit `task.completed`.                                                                                                                                                                                                    |
| Rhythm / habits (`habits`, `habitEntries`)                    | Becomes **routines/life tracking**. Entries keep their meaning (ADR-023). Categories map to v2 grid presets without changing records (ADR-045): coding → Work/Projects, learning → College/Learning, fitness → Gym, health and personal → Personal, money unmapped. Logging also emits `habit.logged`. ADR-036's group views stay.                                                                                    |
| Today page (composition, ADR-020)                             | Its composition logic is reusable, but Today is no longer the home route. Its content becomes Home's "compact Today summary" plus a full Today view.                                                                                                                                                                                                                                                                  |
| Backup (`STORE_NAMES`, validation)                            | Extended, not replaced: new stores, new cross-store integrity rules (sessions → project, milestone → project, event → entity), and V3 → V4 snapshot migration.                                                                                                                                                                                                                                                        |

### MIGRATE

| Subsystem                                  | Destination                                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks.project` (free-text label)          | Kept verbatim. The V4 upgrade derives nothing from it (ADR-046); the owner can later link a task to a real `projects` record through the optional `projectId`.                                                |
| Hackathons (`hackathons` store)            | Stay an independent domain with stage-derived progress (ADR-039). A hackathon links to a technical **project** (`projectId`) only when the owner explicitly chooses; never automatically. No data is dropped. |
| Habit categories → secondary grids         | A mapping, not a data change (ARCHITECTURE §9).                                                                                                                                                               |
| Today's hackathon section, Needs attention | Feed Home's "Needs You" (blockers, approvals, due items).                                                                                                                                                     |

### REPLACE

| Subsystem                                                                                          | Why                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` = TodayPage as the home route                                                                  | v2's **Home** (Start Work, Sleep Mode, Ask LOWTIDE, year grid, project cards, Needs You) replaces it at `/`. Today moves to `/today` (ADR-043). The component logic is reused, not deleted.          |
| "No percentages" (v0.1 PRODUCT.md, hackathons: "deliberately absent: percentages, progress rings") | v2 explicitly wants **milestone-based** project completion. This supersedes the v0.1 principle **for projects only** (ADR-038). Percentages must come from real milestones, never time or guesswork. |
| ADR-025 "the grid is habits only" for the _master_ grid                                            | v2's Daily Pulse aggregates more than habits (work sessions, project activity). ADR-037 defines exactly what feeds it. Protected time stays excluded (non-negotiable, ADR-013/021).                  |

### NEW

| Subsystem                              | Notes                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects (command model)               | States: planning, active, waiting, needs_approval, blocked, parked, review, done, archived. Also objective, milestones, blockers, approvals, decisions. |
| Milestones and progress snapshots      | The basis of completion %, plus a progress-over-time history.                                                                                           |
| Work sessions (Start Work)             | Project, optional task, start, pause, resume, finish, durations.                                                                                        |
| Off-time / Sleep sessions (Sleep Mode) | Manually started and ended windows. Never "sleep quality".                                                                                              |
| Typed event ledger                     | Canonical names in ARCHITECTURE §4 (ADR-046), e.g. `work.started`, `offtime.ended`, `decision.recorded`. Append-only; references records.               |
| Decisions                              | Per-project, immutable, supersedable records in their own store (ADR-046).                                                                              |
| AI session / handoff records           | Written only by real clients. No fake AI activity.                                                                                                      |
| Workspace filesystem hierarchy         | Owner-triggered export first; continuous sync needs the companion (ARCHITECTURE §11, ADR-044).                                                          |
| AI context engine                      | Scoped context packs; built in the app while IndexedDB is canonical, later served by the context service (ARCHITECTURE §12).                            |
| MCP/API                                | Needs the local companion process (ARCHITECTURE §13, ADR-040).                                                                                          |
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

## 5. Conflicts with existing principles: owner decisions

Each conflict changed a documented v0.1 decision. The owner decided all eight in v2
PHASE 001; each is recorded as an ADR in `DECISIONS.md`, and older ADRs carry an
explicit status note rather than being rewritten.

| #   | Conflict                        | Decision                                                                                                                                                     | ADR     |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 1   | Daily Pulse contents            | New master grid from real daily signals, fixed bands with caps; ADR-025 stays for Rhythm views; protected time and inbox never contribute                    | ADR-037 |
| 2   | Completion percentages          | Projects only: weighted milestones, default weight 1, none shown without milestones; never time, task counts or AI                                           | ADR-038 |
| 3   | Where the source of truth lives | Staged: IndexedDB canonical now; a later dedicated phase moves to a local companion + SQLite; repository interfaces are the seam                             | ADR-040 |
| 4   | Network features                | Opt-in; companion on 127.0.0.1, authenticated, no wildcard CORS, no secrets in the bundle; GitHub read-only and repo-scoped; PROJECT/WORKSPACE/GLOBAL scopes | ADR-041 |
| 5   | Visual direction                | Theme-adaptive, warm paper kept, not dark-first; per-grid palettes; Sleep Mode dims and desaturates, keeping navigation                                      | ADR-042 |
| 6   | Home replaces Today at `/`      | `/` = Home, `/today` = Today (composition reused); mobile tabs Home, Projects, Hackathons, Rhythm, More                                                      | ADR-043 |
| 7   | Hackathons vs projects          | Hackathons stay independent, with stage-derived progress; optional `projectId` only by explicit owner choice; never auto-converted                           | ADR-039 |
| 8   | Sensitive logs in the workspace | Workspace holds technical knowledge only; sleep, routines, health, habit logs, inbox and protected time stay in private storage                              | ADR-044 |

Routine grid presets (ADR-045) and the locked V4 schema (ADR-046) were decided in the
same phase.

## 6. Risks carried into v2

- ~~The failing date-dependent test (§1)~~: fixed in v2 PHASE 001.
- **Bundle:** the entry is 452.62 kB. Charts for the Project Command Room must be plain
  SVG/CSS (no chart library) or lazy, and shouldn't grow the entry.
- **The 320 px navigation** is tuned to fit: 5 stacked tabs with 0 px overflow measured
  in PHASE 004 (spare width wasn't measured). v2 replaces tabs rather than appending
  them (ADR-043), and must re-measure.
- **Schema changes:** every one needs a real V(n−1) migration test, like
  `migration-v3.test.ts`, and a `migrateSnapshot` step so old backups still import.
- **Personal data** lives only in ignored `lowtide-backup-*.json` files (memory rule);
  v2 workspace export must not change that.
- **The old prototype database** in the owner's Firefox (`lowtide` schema 2, prototype
  stores) may be altered or dropped when the current app first opens there. Unverified.

## 7. Corrections made in v2 PHASE 001

The original PHASE 000 text had seven errors, now fixed above:

1. The failing-test window was given as "from 2026-09-30". It was **29 September to 4
   October 2026** (§1).
2. The navigation risk said "0 px spare". PHASE 004 measured **0 px overflow** (§6).
3. The security posture pointed to ARCHITECTURE §12. The security model is **§14**.
4. Event names differed between documents (`sleep.*`, `decision.created`). The
   canonical names are in ARCHITECTURE §4 (ADR-046).
5. The context engine and MCP were both said to need the companion. Context packs work
   in the app while IndexedDB is canonical; only MCP/API needs the companion.
6. The routine mapping read "coding/learning → College/Projects?". The mapping is
   ADR-045.
7. The build's gzip size was given as 144.47 kB; the re-measured value at review was
   **144.45 kB** (after v2 PHASE 001: 144.46 kB; raw size 452.62 kB throughout). The
   last digit moves with the hashed chunk file names embedded in the entry.
