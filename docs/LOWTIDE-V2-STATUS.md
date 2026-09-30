# LOWTIDE v2 — Status after PHASE 011

- **Date:** 2026-10-01
- **Baseline:** v2 PHASE 001 at `8ba660f`; the overnight build ended at `f4ffe5a`;
  PHASE 008B starts at `a638466`
- **Rule followed:** only what was implemented and verified is listed as done

## COMPLETED

| Phase                     | What                                                                                                                                                                                                                                                                                                                                                          | Key decisions             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 002 V4 data foundation    | Schema V4: projects, milestones, board items, decisions, work and off-time sessions, event ledger, progress snapshots, AI sessions. Additive, with repositories, rules and backups.                                                                                                                                                                           | ADR-046                   |
| 003 Home v2               | Home at `/`, Today at `/today`, the v2 navigation, the Daily Pulse year calendar, project cards, Needs you, a compact Today, recent activity, secondary grids.                                                                                                                                                                                                | ADR-043, ADR-047, ADR-048 |
| 004 Project Command Room  | Completion ring, milestone pipeline, seven lanes, charts, a project calendar, a timeline, tabs: Overview, Tasks, Milestones, Docs, AI, GitHub, History.                                                                                                                                                                                                       | ADR-050                   |
| 005 Work + Sleep Mode     | Start Work, a global timer bar that survives a reload, Sleep Mode (dims, keeps navigation, Wake up; refused while work runs).                                                                                                                                                                                                                                 | ADR-049                   |
| 006 Life + Rhythm         | Schema V5 college items; the Life page; Rhythm on the shared grid with 7-day to 12-month ranges.                                                                                                                                                                                                                                                              | ADR-051, ADR-052          |
| 007 Hackathons + Calendar | A seven-stage rail, an explicit "Track the build as a project", a combined calendar, coursework in Needs you.                                                                                                                                                                                                                                                 | ADR-053                   |
| 008 Shared AI context     | Scoped context packs (never protected time) and the workspace export (browser mode).                                                                                                                                                                                                                                                                          | ADR-054                   |
| 008B SQLite companion     | Schema V6 (notes, recorded research status, AI attribution). One storage contract for Dexie and SQLite, with parity tests. The companion: SQLite canonical after an owner-triggered, verified move; companion-backed repositories with live events; MCP with scoped grants, 22 tools, attribution and audit; the live workspace and optional Git; Appearance. | ADR-056 to ADR-061        |
| 010 Data consolidation    | Schema V7: SPACE (sections, pages, typed tables) and source provenance. The Notion importer and `import-notion` (idempotent, LOWTIDE wins, no invented history). The owner's Notion workspace imported: real projects, tasks, milestones, blockers, decisions and hackathons, the rest in SPACE.                                                              | ADR-062                   |
| 011 Visual foundation     | Cold graphite tokens with colour reserved for data, Geist, an icon rail with a launcher, page widths and layout primitives, flattened surfaces, compact controls, fitted contribution grids, motion tokens and a dormant Sleep state; 0 axe violations at 320–1920 px.                                                                                        | ADR-063                   |
| 009 QA and polish         | Vendor chunks, an axe-core sweep, overflow, large-data timing and keyboard checks.                                                                                                                                                                                                                                                                            | see PHASE 009             |

## PARTIAL

**AI client connections.** Everything on LOWTIDE's side is built and tested: the MCP
endpoint, the stdio bridge in real sessions, and the whole flow in a headless browser.
What hasn't happened yet is a session from inside the actual apps:

- **Claude Code:** the bridge it would launch is protocol-tested; not yet run from
  Claude Code itself. First user action.
- **Claude (Claude Desktop):** same bridge, same status.
- **ChatGPT:** not connected. Its MCP connectors reach servers over the internet, and the
  companion deliberately listens only on this computer.
- **Other clients:** stdio and HTTP both work with any MCP client that can hold a token.

LOWTIDE's AI area shows each client's real status, so this becomes visible the moment a
client connects.

## BLOCKED

Nothing is blocked.

## NOT STARTED

- GitHub read access (a repository-scoped token held by the companion; ADR-041).
- Encrypted backups, sync, PWA/offline caching.
- Starting the companion at login (it's started by hand with `npm run companion`).
- A SPACE screen, and SPACE over MCP (the data is there; nothing shows it yet).

## TEST COUNTS

- **Vitest:** 56 files and 589 tests, all passing (`npm test -- --run`).
- **Progression:** 338 at the v0.1 baseline → 356 after v2 PHASE 001 → 514 after the
  overnight build → 521 with schema V6 → 555 now.
- **PHASE 008B suites:** SQLite store and parity, migration and rollback, MCP and the HTTP
  boundary, the workspace, the stdio bridge, the wire contract, the app against a real
  companion, and Settings (see TESTING.md).
- **Real-browser check:** `npm run e2e:companion`, 16 steps, all passing, no console
  errors (headless Chromium, throwaway profile and data folder).
- The overnight build's browser checks (overflow, axe-core, large data) were not re-run
  on the new Settings and AI screens; they follow the same components and tokens.

## CURRENT ARCHITECTURE

- **App:** a static React 19 SPA (Vite 8, TypeScript strict, Tailwind 4, React Router
  8). Repositories are the only way UI code reaches data (ESLint-enforced).
- **Storage, two modes (ADR-058):** browser mode keeps IndexedDB (Dexie) canonical;
  companion mode keeps `~/.lowtide/lowtide.sqlite` canonical, and the app's repositories
  call the companion. The same domain repositories run on both through `StoreDb`
  (ADR-057). There's no fallback between them.
- **Schema V7:** 19 stores; every upgrade additive. Backups: envelope format 1, 19
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
  and saves nothing until it's back (no silent fallback, by design). It isn't started
  at login yet.
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

1. **Move your real profile** into the companion when you're ready
   ([COMPANION.md](COMPANION.md) §2–3): pair, download the backup, move, check the
   report, switch.
2. **Connect Claude Code** with a project-scoped grant and watch it appear as connected
   in the AI area.
3. **Workspace location:** keep `~/.lowtide/workspace`, or point `workspaceDir` at a
   folder of your choice, and decide whether to make it a Git repository.
4. **Start at login:** do you want the companion started automatically (a launch agent),
   or by hand?
5. **Daily Pulse calibration** (ADR-037), still open from the overnight build.
