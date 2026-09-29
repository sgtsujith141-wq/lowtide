# LOWTIDE v2 — Status after the overnight build

- **Date:** 2026-09-30
- **Baseline:** v2 PHASE 001 at `8ba660f`
- **This document:** written at the end of the overnight run
- **Rule followed:** only what was implemented and verified is listed as done

## COMPLETED

| Phase                     | What                                                                                                                                                                                                                                                                                  | Key decisions             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 002 V4 data foundation    | Schema V4: projects, milestones, board items, decisions, work and off-time sessions, event ledger, progress snapshots, AI sessions. Additive, with repositories, rules and backups. Preflight done.                                                                                   | ADR-046                   |
| 003 Home v2               | Home at `/`, Today at `/today`, the v2 navigation, a GitHub-style Daily Pulse year calendar with day details, project command cards, Needs you, a compact Today, recent activity, and secondary grids. No gym on Home.                                                                | ADR-043, ADR-047, ADR-048 |
| 004 Project Command Room  | Completion ring from milestone weight, milestone pipeline, seven lanes, progress-over-time and time-invested charts, a gold project calendar, a timeline, an editable summary, a state selector, and tabs: Overview, Tasks, Milestones, Docs, AI, GitHub, History.                    | ADR-050                   |
| 005 Work + Sleep Mode     | Start Work (general, college, project, project + task), a global timer bar (pause, resume, finish, today's total) that survives a reload, and Sleep Mode (dims, desaturates, fades nonessential sections, keeps navigation, Wake up; refused while work runs), with focus management. | ADR-049                   |
| 006 Life + Rhythm         | Schema V5 college items. The Life page: personal routines (adherence only, no dosage), sleep and off time with days off, gym (type, duration, note), and college (attended or missed, coursework, study time). Rhythm on the shared grid with 7-day to 12-month ranges.               | ADR-051, ADR-052          |
| 007 Hackathons + Calendar | A seven-stage rail from each sheet's own statuses, an explicit "Track the build as a project" link, a combined calendar, and college coursework in Needs you.                                                                                                                         | ADR-053                   |
| 009 QA and polish         | Vendor chunks (the app entry went from 488 kB to 69 kB), an axe-core sweep with every violation fixed, the overflow sweep, the large-data timing check, the keyboard check, and docs.                                                                                                 | see below                 |

## PARTIAL

**Phase 008, the shared AI context.** The foundation is complete and verified:

- scoped context packs: PROJECT (default), WORKSPACE, GLOBAL with explicit grants;
  protected time is never included;
- the technical workspace export as a ZIP, with the documented hierarchy;
- a local MCP companion over stdio, with read tools and add-only, audit-logged
  `create_note` and `log_ai_session`.

Pending, stated honestly in the UI, the tools and the docs (ADR-054, ADR-055):

- **Record-changing MCP tools** (`record_decision`, `update_project`, `complete_task`,
  `request_approval`, `park_item`): listed, but they refuse and change nothing.
- **Companion-owned SQLite as canonical storage** (ADR-040 stage 2).
- **An HTTP API** (127.0.0.1, token, origin allow-list) for clients that can't start a
  process.
- **GitHub** read access.
- **Importing** workspace notes and AI sessions back into LOWTIDE.

## BLOCKED

Nothing is blocked by an external dependency. The pending items above are future work
that each needs its own phase and security review; none of them is blocked.

## NOT STARTED

- Encrypted backups, sync, and PWA/offline caching (from the v0.1 optional list).
- A theme switcher. Themes follow the OS; the tokens already support `data-theme`.

## TEST COUNTS

- **Vitest:** 45 files and 514 tests, all passing. `npm test -- --run`, with the 15 s
  per-test timeout unchanged.
- **Progression:** 338 at the v0.1 baseline → 356 after v2 PHASE 001 → 514 now.
- **New suites:**
  - migrations: `migration-v4`, `v5-college`;
  - repositories and backup: `v4-repositories`, `v4-backup`;
  - pure logic: `contribution-grid`, `pulse-days`, `project-summary`, `context-engine`;
  - screens: `home-page`, `modes`, `project-room`, `life-page`, `calendar-page`,
    `hackathons-v2`, `ai-page`;
  - the companion: `companion/companion.test.ts`, which includes a real stdio session
    under Node.
- **Browser checks** (Playwright, throwaway profiles, never the bootstrap profile's
  data), for all 13 routes:
  - 0 px horizontal overflow at 320, 360, 390 and 1280 px, light and dark;
  - axe-core: 0 violations at 1280 and 320 px, light and dark, Sleep Mode off and on;
  - no console errors.
- **Large data** (30 projects, 3,000 tasks, 3,650 routine entries, 1,200 work sessions,
  2,410 events):
  - validation 0.2 s, restore 1.4 s;
  - Home's Daily Pulse ready in about 0.9 s on a cold page load;
  - the other screens in 0.1–0.35 s.

## CURRENT ARCHITECTURE

- **Runtime:** a static React 19 SPA (Vite 8, TypeScript strict, Tailwind 4, React
  Router 8). IndexedDB via Dexie 4 is canonical, and repositories are the only way UI
  code reaches data (ESLint-enforced).
- **Schema V5:** the six v0.1 stores, nine V4 stores, and `collegeItems`. Every upgrade
  is additive with no record rewritten. Backups use envelope format 1 with 16 stores,
  and V1–V4 backups still import.
- **Derived, never stored:**
  - the Daily Pulse (ADR-037), capped and fixed-band, where a declared day off can be
    strong;
  - the themed grid levels;
  - project summaries;
  - chart series;
  - the calendar.
- **Ledger:** events are written in the same transaction as their record, reference it
  and never copy it. Private event types are hidden by default.
- **AI:**
  - no AI inside the app, and no network requests;
  - context packs and the workspace export are built on demand from one consistent
    snapshot (the backup export);
  - the companion (`companion/lowtide-mcp.ts`) is a stdio MCP server over the exported
    folder: no port, scoped, add-only, audit-logged.
- **Bundles:** entry 69 kB plus vendors (react 219 kB, data 120 kB, router 92 kB); each
  screen is lazy-loaded.

## KNOWN RISKS

- **Two copies of state for AI.** The workspace is an export, so it's stale until you
  export again, and AI notes and sessions written there don't flow back into LOWTIDE
  yet.
- **Sensitive data is still plaintext at rest.** This is the same model as v0.1
  (SECURITY.md). Hackathon files in the workspace include team names and strategy.
- **jsdom test weight.** Home renders about 370 labelled squares on first paint (five
  more year grids when scrolled to). Tests wait up to 3 s for async UI and Vitest uses
  half the cores. The suite is stable under load (verified three times at load average
  ~11–21), but a much slower machine could still need attention.
- **Pulse inputs.** `tasks.completedAt` and `milestones.completedAt` aren't indexed, so
  the activity query filters those tables in memory. That's fine at 3,000 tasks, but
  worth an index if it grows by 10×.
- **The Research stage** is positional (between knowing the problem and starting work),
  not a recorded status (ADR-053).

## NEXT HUMAN DECISIONS

1. **Restore your real bootstrap** in your own browser, check it, and export a fresh
   backup. The automation profile holds a copy; your browser doesn't yet.
2. **Daily Pulse calibration:** are the 25 and 90 minute thresholds, the caps and the
   day-off rule right for you (ADR-037)?
3. **Hackathon Research stage:** keep it positional, or add a real research status
   field (a schema change)?
4. **Companion stage 2:** when to move canonical storage to a companion-owned SQLite
   database. That unlocks the record-changing MCP tools, the HTTP API and GitHub.
5. **Workspace:** do you want it Git-versioned, and where should it live?
6. **Theme:** add a manual light/dark switch, or keep following the OS?
