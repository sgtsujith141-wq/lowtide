# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/). Versions follow the
app's `package.json` version.

## [Unreleased]

### Changed (v2 PHASE 016 — final refinement and QA)

- Fixed: quick taps on a rhythm's − / + could store the wrong amount.
- Home offers "Start ‹project›" when nothing has happened today; the rhythm preview is
  quieter; recent AI sessions read as short summaries.
- Hackathons is a progress view with a side sheet; Rhythm and Life lead with history and
  today's state; Calendar shows what's coming and moves by keyboard; AI and Settings are
  compact.
- SPACE tables size columns to their content, keep the first column fixed and clamp long
  cells until "Show full text"; code blocks show their language and copy exactly
  (Mermaid as labelled source); the SPACE home lists recent, project and idea pages.
- The command palette can create a task, SPACE page, project or hackathon.
- Shorter empty states and plainer wording; restore says where it writes.
- Fixed: the SPACE tree had no Tab stop while an archived page was open.

### Changed (v2 PHASE 015 — Work Mode and Sleep Mode)

- Sleep Mode covers the screen with a near-black dormant layer: the timer, Off time, when
  it started, Wake up. Running work is never stopped silently (finish it and sleep, or go
  back). Waking shows a small passing summary.
- Work Mode is a focused surface: the project and task, a large timer, Pause or Resume
  and Finish, today's total and what's next; it folds into a one-line bar. Finishing
  shows a light summary with an optional note.
- Start Work is a keyboard chooser that offers the current project (or task) first,
  then recent work, projects, general work and study.
- The command palette lists the mode actions possible now; ⌘/Ctrl ⇧ Enter starts or
  returns to Work Mode.

### Added (v2 PHASE 014 — SPACE)

- SPACE workspace: the real hierarchy as a keyboard tree (create, rename, move, drag,
  archive, restore), a block editor (Markdown shortcuts, a short slash menu, links to
  pages and records, tables, file references, undo, autosave), first-class tables (sort,
  filter, edit in place, add rows), links and backlinks, and a context inspector with
  the page's project, provenance and history. Phone widths get the page alone with the
  tree and details as sheets.
- Find in SPACE (Cmd/Ctrl P); the command palette (Cmd/Ctrl K) works everywhere and also
  finds SPACE pages, tables and decisions.
- SPACE over MCP: ten scoped tools so AI clients can save at a path, append, edit
  blocks, add table rows, link and archive, attributed and audited; a new Personal SPACE
  permission. `park_item` can record a new parked idea.
- Schema V9: SPACE pages gain blocks, revisions and batched history; imported bodies are
  never rewritten. Edits from elsewhere never overwrite unsaved text.

### Changed (v2 PHASE 013 — Projects flagship)

- Projects: the card grid is gone. Projects are grouped by tier (primary, secondary,
  supporting, later, not current) as full-width rows: progress line with stage ticks,
  roadmap, now, next, needs you, last moved.
- Command Room: name, purpose, state and priority as compact controls, a large
  milestone-derived figure, a roadmap whose milestones open their details, Start Work
  (general or a chosen task), a five-fact summary, a work plane (now, next, needs you;
  waiting, blocked, parked; done folded), progress over time and time invested from real
  records, a six-month gold grid and a timeline of meaningful events.
- Long imported text is shown as a short display title; the original stays one step away.
- Docs shows the project's SPACE documents by slot with a read-only preview. History shows
  the import and reconciliation trail. The empty GitHub tab is gone.

### Added

- Import plans can list explicit milestone sets; two projects' stated milestones were
  reconciled from Notion with provenance, idempotently, with no events or activity.

### Changed (v2 PHASE 012 — Home v3)

- Home rebuilt: a greeting and compact actions; a full-width Daily Pulse hero with a
  day drawer; Project Command rows; Needs you grouped by project; a Today strip with
  what's next; the latest events; one rhythm grid at a time. Empty sections are hidden.
- Schema V8: optional project focus (primary, secondary, supporting, not current), set
  in the Command Room, never counted as movement. Home orders projects by it.
- ⌘K opens the local search as a palette on Home.
- Grids: an `xl` hero size, a minimum square size, no clipped month labels.

### Changed (v2 PHASE 011 — visual foundation)

- A cold, dark graphite visual system replaces warm paper: semantic tokens, colour
  reserved for data, Geist with tabular figures, no serif headings.
- A compact icon rail (Home, Projects, SPACE, Hackathons, Rhythm) with a launcher for
  everything else; phones keep five tabs. A SPACE placeholder page.
- Screens use reading, standard or wide widths; surfaces are hairlines and whitespace
  instead of bordered cards; compact controls; contribution grids fit their width.
- Sleep Mode is a dormant state instead of a purple banner. Motion tokens; reduced
  motion respected.

### Added (v2 PHASE 010 — canonical data consolidation and the Notion import)

- **Schema V7** (ADR-062): `spaceNodes` (SPACE: sections, pages and typed tables, with
  links to LOWTIDE records, attachments as references, provenance and an archived flag)
  and `sourceRecords` (where every imported record came from). Additive; V1–V6 backups
  still import. A SPACE repository (no UI yet).
- **The Notion importer** (`src/db/import/notion`) and `lowtide-companion import-notion
--snapshot <dir> --plan <file> [--dry-run]`: idempotent, LOWTIDE-wins merges,
  duplicates kept as provenance, every database kept as a SPACE table, backups first,
  a report, and no invented history. See `docs/NOTION-IMPORT.md`.
- Imported records never count as activity (Daily Pulse and grids).
- The workspace now carries each project's SPACE pages and tables under
  `projects/<slug>/space/`, listed in CONTEXT.md; nothing outside a project's own SPACE
  subtree is written.

### Added (v2 PHASE 008B — SQLite companion and permanent shared AI context)

- **The LOWTIDE companion** (`npm run companion`): a local process on 127.0.0.1 that
  owns LOWTIDE's data in SQLite once you move it there, runs the same domain
  repositories as the browser (ADR-057), and keeps a technical workspace up to date by
  itself. See `docs/COMPANION.md`.
- **Moving into it** (Settings): pairing, a required backup checked like a restore, and a
  verified move (every record read back and compared, links checked, rolled back on any
  difference) with a per-store report. Switching is a separate step; IndexedDB is never
  deleted; switching back is documented.
- **AI access over MCP:** per-client grants (one project, every project, or global with
  private categories granted one by one; never protected time), read or write,
  delegated approvals, tokens shown once. 12 read and 10 write tools; writes go through
  the domain rules, attributed to the client; every call audited. A stdio bridge for
  Claude Code and Claude Desktop. The AI area shows real connection status, the audit,
  and access you can revoke.
- **Live workspace:** per-project PROJECT.md, CONTEXT.md, decisions, notes and AI
  sessions under `projects/<slug>/`, plus `hackathons/`, `shared/` and `archive/`;
  people's files are never touched; optional private Git (no remote, no commits).
- **Schema V6:** project notes, a recorded hackathon research status, and attribution
  (which AI client did what).
- **Appearance:** Auto, Light or Dark in Settings; Sleep Mode dims either.
- The Project Room's Docs tab lists notes (yours and AI clients') and shows who recorded
  each decision; the timeline names the AI client.
- `npm run e2e:companion`: the whole flow in a headless browser with a real MCP session.

### Changed (v2 PHASE 008B)

- The repositories depend on a small storage contract (`StoreDb`) instead of Dexie.
- The stage-1 stdio MCP server over an exported folder is replaced by the companion;
  `companion/lowtide-mcp.ts` is now its stdio bridge.
- The workspace layout: no `daily/` log; notes and decisions have their own folders.

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
