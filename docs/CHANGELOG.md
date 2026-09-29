# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/). Versions follow the
app's `package.json` version.

## [Unreleased]

### Changed (v2 PHASE 009 — QA and polish)

- Vendor code is in separate chunks; the app entry is 69 kB.
- Accessibility: Sleep Mode keeps AA contrast, the heading order is fixed, list markup
  is valid, and the milestone pipeline is keyboard-scrollable. axe-core reports 0
  violations on every route.
- `docs/LOWTIDE-V2-STATUS.md` records the final state.

### Added (v2 PHASE 008 — shared AI context, companion stage 1)

- **AI & workspace** (`/ai`): scoped context packs (Project, Workspace, Global with
  explicit grants; never protected time), copy/download, and a technical workspace ZIP
  export.
- The Command Room's AI tab shows the project's CONTEXT.md.
- `companion/lowtide-mcp.ts`: a local MCP server over stdio for the exported workspace,
  project-scoped by default. Read tools plus add-only, audit-logged notes and AI session
  records. See `docs/COMPANION.md`.

### Added (v2 PHASE 007 — Hackathons + Calendar)

- A stage rail on each hackathon (seven stages from its own statuses) and "Track the
  build as a project" (explicit, one transaction; Unlink keeps the project).
- **Calendar** (`/calendar`): month grid plus day agenda for college, hackathons,
  milestones, deadlines, plans, work, days off and protected time.
- Needs you lists college coursework that's due or overdue.

### Added (v2 PHASE 006 — Life + Rhythm)

- **Life** (`/life`): Personal routines, Sleep & off time (start windows, recent marked
  windows, days off), Gym (type, duration, note), College (classes attended or missed,
  coursework done, study time, Start study). Each area has its own grid.
- **Schema V5:** college items (additive).
- **Rhythm** now uses the shared GitHub-style grid with 7-day to 12-month ranges.

### Added (v2 PHASE 005 — Work Mode + Sleep Mode)

- Focus follows mode changes (Pause after starting, Wake up after Sleep Mode, the page
  after finishing); Escape closes Start Work; a Finish work session button when Sleep
  Mode is refused; Start work here in the Command Room; nonessential Home sections fade
  in Sleep Mode.

### Fixed (v2 PHASE 005)

- Hackathons: moving a sheet between Past and the open list could lose keyboard focus.
- Home renders its secondary grids when scrolled to.

### Added (v2 PHASE 003–004 — Home and the Project Command Room)

- **Home** at `/`: Start Work, Sleep Mode, Ask LOWTIDE (a local search, clearly
  labelled); a year of Daily Pulse as a GitHub-style calendar with day details; project
  cards; Needs you; a compact Today; recent activity; Work, Projects, College, Personal
  and Sleep grids. Today moved to `/today` (ADR-043).
- **Navigation:** phones get Home, Projects, Hackathons, Rhythm and More; desktop lists
  every destination.
- **Projects** page and **Project Command Room**: completion ring, milestone pipeline,
  seven command lanes, progress-over-time and time-invested charts, project activity
  calendar, timeline, and the Tasks, Milestones, Docs, AI, GitHub and History tabs.
- **Work Mode and Sleep Mode:** a global mode bar with a live timer, pause/resume,
  finish and today's total; Sleep Mode dims the app without replacing it.
- A reusable `ContributionGrid` in seven light/dark palettes (ADR-047).

### Added (v2 PHASE 002 — V4 data foundation)

- Schema V4 (additive): projects, milestones, project items in lanes, decisions, work
  sessions, off-time sessions, a typed event ledger, progress snapshots and AI sessions;
  optional `projectId`/`milestoneId` on tasks and `projectId` on hackathons. The upgrade
  rewrites no existing record.
- Repositories for all of it, with events and snapshots written in the same
  transaction as their records.
- Backups carry all 15 stores; V1–V3 backups still import.

### Added (v2 PHASE 001 — decisions locked, baseline green)

- ADR-037 to ADR-046: Daily Pulse, project completion, hackathon stages, staged move to a
  local companion, network/AI security, visual system, Home and navigation, workspace
  privacy, routine grid presets, and the locked schema V4 design. ADR-001/004/005/006,
  ADR-020 and ADR-025 gain explicit status notes; none were rewritten.
- Pure, tested rules not yet used by any screen: `dailyPulse` (algorithm v1),
  `projectCompletion`, `hackathonStages`, `CATEGORY_PRESET` and `routineSignals`.
- `docs/LOWTIDE-V2-ARCHITECTURE.md` now holds the exact V4 schema and a PHASE 002
  preflight.

### Fixed (v2 PHASE 001)

- The inbox capture-time test depended on the real date and failed from 29 September to
  4 October 2026. It now pins `now` and asserts exact times in any time zone.
- Seven errors in the v2 PHASE 000 audit and architecture documents (see the audit §7).

### Added (PHASE 006 — core v0.1 roadmap complete)

- **Protected time for the week ahead** on Today: seven day rows (today plus six);
  add on any day, edit, move between days (a new Day select), remove. Still plans only
  (ADR-035).
- `ProtectedTimeRepository.watchRange(start, end)`: one inclusive indexed range query;
  `watchForDate` is now a one-day range.
- **Rhythm groups** in "Show": Coding & learning, Fitness & health. The grid filter
  doesn't affect today's logging (ADR-036).

### Fixed (PHASE 006 sweep)

- Protected-time day headings read "Thursday**Thu** 1 Oct" to screen readers; a real
  space now separates the words.
- After moving a protected-time entry to another day, focus landed on the old row just
  before it unmounted; focus now waits for the entry on its new day.
- Inbox action buttons all had the same names ("Make task", "Clear"). They're now
  named by the thought's first line, and stay enabled while saving (ADR-030).
- Inbox and the plan picker could lose keyboard focus when the live update arrived
  before the save returned. Focus now moves once the item is gone, whichever comes
  first.

- Tests asserted focus and `document.title` the instant an element rendered, while the
  app sets them in effects just after, causing intermittent failures under load. A new
  `expectFocus` helper waits, and the title assertion waits too (`9b514c6`).

### Unchanged (PHASE 006)

- `SCHEMA_VERSION` 3 and `BACKUP_FORMAT_VERSION` 1; no migration, no new stores or
  fields.

### Added (PHASE 005)

- **Data & backup** (`/data`, lazy; linked from the sidebar footer and a phone footer):
  - JSON export `lowtide-backup-YYYY-MM-DD-HHmm.json`;
  - validated restore with a preview and an explicit confirmation;
  - persistent-storage status and request.
- `BackupRepository`:
  - `exportBackup` (one read-only transaction over all six stores);
  - `inspect` (parse → envelope → migrate → schemas and domain rules → cross-store
    integrity);
  - `restore` (replace, one read-write transaction);
  - `watchCounts`.
- Backup envelope `format: "lowtide-backup"`, `formatVersion` 1
  (`BACKUP_FORMAT_VERSION`), `schemaVersion`, `exportedAt`, `data` (ADR-031).
- `migrateSnapshot`: upgrades schema-1/2 backup data with the database's own
  migrations.
- `src/db/rules.ts`: domain invariants shared by repositories and import.

### Changed (PHASE 005)

- Habit and hackathon repositories now take their rules from `src/db/rules.ts`
  (behaviour unchanged).
- `SCHEMA_VERSION` is re-exported from the repositories index for display.

### Added (PHASE 004)

- **Hackathons** (`/hackathons`, fifth nav item, lazy chunk):
  - compact project sheets with date wording, an editable "Next:" line, and
    Registration / PPT / Build / Status selects;
  - quick add (name and dates) and a full editor;
  - a collapsed Past section.
- `HackathonRepository` (`create`, `update`, `watchAll`); `eventEnd` rules via
  `InvalidInputError`.
- **Schema version 3**: hackathon dates become `LocalDate`, with a tested upgrade that
  keeps real dates, converts timestamps to their UTC date, and moves anything
  unreadable into notes (ADR-027).
- Pure hackathon ordering and wording (ADR-028), and Today's "Hackathons" section
  (at most 3 near-term rows, ADR-029).

### Fixed (PHASE 004)

- A flaky PHASE 001 test: the capture retry test asserted the error was gone before the
  write finished. It now waits for the error to clear (`adb607e`).
- Another flaky capture test failed the save after a fixed 40 ms, which could land
  mid-typing under load. The save now fails on cue after typing (`28492a5`).
- Rhythm logging controls were disabled while saving, which drops keyboard focus in
  Chromium. They now stay enabled, and focus moves to the amount field after clearing
  (ADR-030).
- "Add a next action" had the accessible name "Add a next actionfor …"; it now uses an
  explicit label.

### Changed (PHASE 004)

- Mobile nav: below `md` items stack icon over a small label, and the wordmark text
  hides below 440 px; five items fit at 320 px.
- `SCHEMA_VERSION` 2 → 3. The PHASE 002 migration test now asserts "opens at the current
  version".

### Added (PHASE 003)

- **Rhythm** (`/rhythm`, fourth nav item, lazy chunk):
  - six-month contribution-style activity grid, overall or per habit (archived habits
    included);
  - today's quick logging (one tap for done-or-not; a number for count or minutes);
  - create, edit, archive and restore rhythms.
- `HabitRepository`: `create`, `update`, `archive`, `restore`, `watchAll`, `setEntry`
  (upsert), `clearEntry`, `watchEntries(start, end)` (ADR-023).
- `InvalidInputError` for values or targets that don't fit a habit's unit.
- Display-only activity levels (ADR-024), the overall banded-sum aggregation
  (ADR-025), and an accessible grid with roving tabindex (ADR-026).
- `src/lib/calendar.ts`: `LocalDate` arithmetic that can't skip or repeat days.
- `--lt-activity-0…4` tokens (light and dark).

### Fixed (PHASE 003)

- Screen readers heard run-together words where two spans were separated only by CSS
  margin: Finished task rows ("LaundryDone"), plan-picker deadlines, and rhythm rows.
  Found in Chromium's accessibility tree.

### Changed (PHASE 003)

- Nav icons hide below 420 px so the four labels fit at 320 px.
- Vitest `testTimeout` raised to 15 s (cold-start slowness on this machine; see
  PHASE-003).
- No schema change: `SCHEMA_VERSION` stays 2.

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
