# LOWTIDE v2 PHASE 008B — SQLite companion + permanent shared AI context

**Date:** 2026-09-30 · **Status:** COMPLETE. The only open item is outside LOWTIDE:
a session from inside the Claude Code and Claude Desktop apps themselves (see
Limitations). ChatGPT isn't connected, by design.

## Built

- **Schema V6 (ADR-056):**
  - project notes;
  - a recorded hackathon research status (replacing the inferred stage);
  - AI attribution on events, decisions, notes and AI sessions;
  - AI session detail (task, result, next action, commits, handoff).
  - 17 stores; V1–V5 backups still import.
- **One storage contract (ADR-057):** the repositories depend on `StoreDb`, not Dexie.
  - The browser passes Dexie through `asStore()`.
  - The companion passes `SqliteStore`: strict tables generated from the domain enums,
    deferred foreign keys, unique indexes, one serialized connection with real
    transactions and change events.
  - Parity is proven across all 17 stores and 13 live queries.
- **The companion (ADR-058):** `npm run companion`, a process on 127.0.0.1 owning
  `~/.lowtide/lowtide.sqlite`. It serves:
  - the owner's repository RPC, dispatched only through the wire contract;
  - a server-sent event stream after every commit;
  - the verified move;
  - AI grants, audit and client status;
  - workspace status and Git init;
  - MCP.
- **The move (stage B):**
  - pairing (a pairing link or the owner token);
  - a required backup, checked by the restore-preview path;
  - the companion validates again, refuses unless empty, and keeps an exact owner-only
    copy;
  - one transaction: insert every record with its id, read it all back, compare record
    by record, check foreign keys at commit; roll back on any difference;
  - a per-store report and every check shown in Settings.
  - IndexedDB is never deleted or changed.
- **Companion mode (stage C):**
  - the app's repositories come from the wire contract;
  - live queries re-ask on change events (no polling) and pass on only real changes;
  - a banner when the companion can't be reached;
  - no IndexedDB fallback;
  - switching back is explicit.
- **MCP (ADR-059):** Streamable HTTP at `/mcp`, protocols 2025-06-18, 2025-03-26 and
  2024-11-05.
  - Per-client grants: one project, every technical project, or global with private
    categories granted one by one; never protected time. Read or write, with approvals
    delegated separately. The token is shown once and stored as a SHA-256.
  - 12 read and 10 write tools. Writes go through the domain repositories as an
    attributed AI client. Every call is audited (refusals and errors too), with before
    and after summaries.
- **The stdio bridge:** `companion/lowtide-mcp.ts`, for Claude Code and Claude Desktop.
  - It pings every minute so connection status stays honest.
  - It re-opens a session by itself after a companion restart.
  - It answers calmly when the token is refused or the companion is down.
- **The live workspace (ADR-060):**
  - the per-project hierarchy, plus `hackathons/`, `shared/` and `archive/`;
  - regenerated after every commit, with marker-owned files only and no timestamps (quiet
    Git diffs);
  - people's files never touched, and clashes reported;
  - link-safe paths;
  - "Make it a Git repository": `git init` and a `.gitignore`, with no remote and no
    commits.
- **App:**
  - Settings: Appearance (Auto, Light or Dark; ADR-061) and "Where LOWTIDE keeps your
    data";
  - the AI area: real connection status, giving access with tested commands, revoking,
    a live audit, and the live workspace;
  - the Project Room's Docs tab: notes, and who recorded each decision;
  - the timeline names the AI client.
- **Docs:** ADR-056 to ADR-061, with the superseded and amended ADRs marked; COMPANION.md
  rewritten; SECURITY.md, ARCHITECTURE.md, DATA-MODEL.md, TESTING.md, README.md,
  CHANGELOG.md and LOWTIDE-V2-STATUS.md updated.

## Data safety

- No real LOWTIDE data was read, moved or changed.
  - The implementation environment can't reach your browser's IndexedDB, so nothing
    was migrated for real.
  - Every migration ran on fixtures or throwaway profiles.
  - The move is a user-triggered flow in Settings.
- The move never deletes IndexedDB. The browser copy stays as it was, and rollback is
  documented (COMPANION.md §7) and tested:
  - switching back in Settings;
  - a backup restored into the companion through the app's own repositories.
- Test and e2e companions use temporary folders and fresh tokens, and are removed
  afterwards. No database, backup, token or personal data is committed. `.gitignore`
  also excludes SQLite files, `companion.json` and `.lowtide/`.

## Tests

53 files and 555 tests, all passing: 514 after the overnight build, minus the 9
stage-1 companion tests, plus 50 new.

| File                                    | Tests | What                                                                                                                  |
| --------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `src/test/v6-schema.test.ts`            | 7     | V6 upgrade from a genuine V5 database, schema-5 import, notes, attribution                                            |
| `companion/server/sqlite/store.test.ts` | 8     | schema, constraints, rollback, queue isolation, change events, Dexie/SQLite parity                                    |
| `companion/server/migrate.test.ts`      | 5     | exact move, refusals, rollback on mismatch and on a foreign-key failure                                               |
| `companion/server/mcp.test.ts`          | 9     | protocol and sessions; tools, attribution, audit; scopes; privacy; HTTP boundary; live events; RPC; backup round trip |
| `companion/server/workspace.test.ts`    | 4     | generation, clashes, archive moves, path and link security, Git init                                                  |
| `companion/server/bridge.test.ts`       | 2     | a real stdio MCP session with the app seeing changes live; failure paths                                              |
| `companion/server/contract.test.ts`     | 3     | the wire contract against the real and the companion repositories                                                     |
| `companion/app-integration.test.tsx`    | 4     | the real app against a real companion: the move, live AI changes, access, switching back                              |
| `src/test/settings-page.test.tsx`       | 8     | appearance, the backend setting, pairing links and errors                                                             |

**Real-browser run** (`npm run e2e:companion`): 16 of 16 steps, no console errors. It
covers:

- a project created in IndexedDB;
- pairing and the required backup;
- the verified move and the switch;
- access for Claude Code;
- over the stdio bridge: read the project, request approval, read it back, resolve it,
  update the next action, with the open Project Room updating live and attributed;
- the audit, and Claude Code shown as Connected;
- the workspace updating itself;
- Sleep Mode over Dark.

Two load-sensitive UI waits on heavy screens now allow up to 8 s. The assertions are
unchanged.

## Validation

- `tsc -b`: 0 errors (app, node config and the companion project).
- `eslint .`: 0 problems.
- `prettier --check .`: clean.
- `vitest run`: 555/555.
- `npm run build`: passes (entry 83 kB).
- `npm run companion:build`: passes.
- A smoke run of the built companion checked:
  - health, and status with the owner token;
  - 401 without a token, 403 for a foreign Origin, 403 for a foreign Host;
  - owner-only file modes.

## Commits

- `a638466` feat(data): schema V6 with notes, real hackathon research status and AI
  attribution
- `704e852` refactor(data): one storage contract for Dexie and SQLite (ADR-057)
- `fe29f14` feat(companion): SQLite companion with verified migration, live sync and
  scoped MCP
- `6aff00a` feat(app): companion mode, Settings with theme and verified migration, AI
  access
- `7aaac9e` test(e2e): real-browser run with the companion; name AI clients in the
  timeline
- the documentation commit that adds this report

Each code commit was checked on its own (typecheck, lint and tests) before the next.

## Limitations

- **AI client apps:** Claude Code and Claude Desktop haven't yet run a session
  themselves. The bridge they launch is protocol-tested, and the AI area will show
  their real status. ChatGPT's connectors need an internet-reachable server, which the
  companion deliberately isn't.
- **GitHub read access** isn't built (ADR-041).
- **The companion isn't started at login.** It's started by hand. In companion mode
  LOWTIDE can't read or save until it runs; that's deliberate, so the two stores never
  split.
- **The audit log isn't pruned.**
- **Browser checks not re-run** on the new Settings and AI screens: the overnight
  build's overflow and axe-core sweeps predate them.
- **Stage D** (IndexedDB as a cache) isn't built, as nothing justifies it (ADR-040).

## First user action

Start the companion (`npm run companion`), pair LOWTIDE with the link from
`npm run companion -- pair`, and follow Settings to move your real profile: download the
backup, move, read the report, switch. Then give Claude Code a project-scoped grant and
run the `claude mcp add` command the AI area shows.
