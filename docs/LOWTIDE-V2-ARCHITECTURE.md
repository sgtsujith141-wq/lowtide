# LOWTIDE v2 — Target architecture and migration plan

- **Status:** proposal (v2 PHASE 000). Nothing here is implemented yet.
- **Date:** 2026-09-30
- **Baseline:** v0.1 at `de8f501`, schema V3
- **Companion:** [LOWTIDE-V2-AUDIT.md](LOWTIDE-V2-AUDIT.md) (current-state audit, the
  KEEP/REFACTOR/MIGRATE/REPLACE/NEW classification, and owner decisions)

v2 turns LOWTIDE from a calm planner into a local-first personal operating system:

- a **Home** with Start Work, Sleep Mode, Ask LOWTIDE, a year contribution grid and
  project cards;
- a **Project Command Room** per project;
- **work and off-time sessions**;
- a **typed event ledger**;
- a **workspace/knowledge hierarchy** that AI coding clients can read.

It's an evolution of the v0.1 codebase, not a rewrite. Every v0.1 store survives, and
every change is additive.

## 1. Non-negotiable principles

1. **Local-first.** The owner's data lives on the owner's machine. No account, no
   cloud, no telemetry. Network features are opt-in and documented (§14).
2. **No destructive migration.** Schema upgrades only add stores, indexes and optional
   fields. A pre-V4 backup always imports, and existing fields are never deleted or
   repurposed.
3. **Truth lives in one place.** Records (tasks, sessions, milestones…) are the source
   of truth. The event ledger _references_ them and never duplicates their state
   (§4).
4. **People are not productivity.** Protected time (relationship, family, friends,
   rest, personal) never becomes an event count, grid square, streak, score or AI
   metric (ADR-013, ADR-021).
5. **Honesty.** No fabricated history, progress or AI activity:
   - a percentage comes from real milestones;
   - a grid square comes from a real record;
   - an AI session record comes from a real client call;
   - sleep is a manually marked window, never "sleep duration" or "quality".
6. **Sensitive life logs stay out of Git.** The workspace exports technical project
   knowledge only (§11).
7. **Minimal AI context.** AI clients get the smallest relevant context pack, never the
   whole database (§12).
8. **The v0.1 engineering rules continue:** repository boundary, strict TS,
   accessibility, 320 px, real migration tests, and a 15 s test timeout.

## 2. Existing store → v2 destination (explicit map)

Every V3 store survives **unchanged in name and shape**. The V4 changes to them are
additive optional fields.

| V3 store / field                      | v2 destination                                                   | V4 change                                                            | Recoverability                                                                      |
| ------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `tasks`                               | `tasks`: the project task list                                   | + `projectId?: Id`, + `milestoneId?: Id`, + index `projectId`        | `project` (free-text label) **kept verbatim**; `projectId` is derived from it (§15) |
| `tasks.project`                       | label of a `projects` record                                     | none (field kept)                                                    | The label stays the fallback display value; unlinking restores v0.1 behaviour       |
| `tasks.status` = done + `completedAt` | source of `task.completed` pulse (§10)                           | none                                                                 | Read-only derivation                                                                |
| `inbox`                               | `inbox`: Home capture / Brain Dump                               | none                                                                 | unchanged                                                                           |
| `habits`                              | `habits`, presented as **routines**                              | none in V4 (a later optional `grid?` override is additive)           | unchanged                                                                           |
| `habitEntries`                        | `habitEntries`: the source for routine grids and the Daily Pulse | none                                                                 | unchanged                                                                           |
| `hackathons`                          | `hackathons`: the hackathon sheet                                | + `projectId?: Id` (link to a `projects` record of kind `hackathon`) | Hackathon fields untouched; the link is optional and removable                      |
| `protectedTime`                       | `protectedTime`: week-ahead protected time                       | none                                                                 | unchanged; **excluded from the ledger, grids, pulse and AI context**                |
| Backup envelope (`formatVersion` 1)   | the same envelope                                                | `data` gains the new stores; `schemaVersion` becomes 4               | V1–V3 backups import through `migrateSnapshot`                                      |

**New V4 stores** (§3): `projects`, `milestones`, `projectItems`, `workSessions`,
`offTimeSessions`, `events`, `progressSnapshots`, `aiSessions`.

## 3. Local database (schema V4)

The store is still Dexie/IndexedDB in the browser, behind the same repository
interfaces. V4 is appended as `this.version(4).stores(STORES_V4).upgrade(...)`, with
every V1–V3 declaration left in place.

```ts
// Proposed STORES_V4: only new stores and new indexes, everything else as V3.
tasks: 'id, status, dueAt, createdAt, plannedFor, projectId',
hackathons: 'id, status, registrationDeadline, eventStart, projectId',
projects: 'id, state, updatedAt, &slug',
milestones: 'id, projectId, [projectId+order]',
projectItems: 'id, projectId, kind, status',   // blocker | approval | decision | note
workSessions: 'id, projectId, startedAt, localDate',
offTimeSessions: 'id, startedAt, localDate',
events: 'id, at, localDate, type, [entityType+entityId]',
progressSnapshots: 'id, projectId, localDate, &[projectId+localDate]',
aiSessions: 'id, projectId, startedAt',
```

The rules carry over from v0.1:

- every store has a Zod schema and repository;
- every invariant lives in `rules.ts`;
- the UI imports only repository interfaces;
- every repository exposes `Watch<T>` queries.

## 4. Typed event ledger

**Purpose:** a single, append-only timeline of _things that happened_, for:

- the contribution grids;
- project timelines;
- "what did I do last Tuesday";
- AI handoff context.

**Shape:**

```ts
interface LedgerEvent<T extends EventType = EventType> {
  id: Id;
  type: T; // discriminated union, e.g. 'work.session.finished'
  at: Timestamp; // when it happened (UTC)
  localDate: LocalDate; // the owner's calendar day, for grids
  entityType: EntityType; // 'task' | 'project' | 'workSession' | …
  entityId: Id; // the record this is about: the source of truth
  data: EventData[T]; // small, typed, immutable facts (e.g. { minutes: 50 })
  source: 'app' | 'import' | 'ai-client';
}
```

**Initial event types:**

- `work.session.started`, `work.session.paused`, `work.session.resumed`,
  `work.session.finished`
- `offtime.started`, `offtime.ended`
- `habit.logged`
- `task.completed`
- `project.created`, `project.state_changed`
- `milestone.completed`
- `decision.recorded`
- `ai.session.completed`

**Rules:**

- **Written in the same transaction as the record change** by the repository. It's
  never written by UI code, so a record can't change without its event, and vice versa.
- **Events reference, never copy.** `task.completed` carries the task id, not its
  title. A timeline renders the current record. If the record is gone, it shows
  "deleted item" and never reconstructs it from the event.
- **Append-only.** Correcting a mistake is a new record change and a new event. The
  only deletions are cascades when the owner deletes the entity itself, which is
  consistent with v0.1's delete semantics.
- **No protected-time or relationship event types exist.** This is enforced by the type
  union and a unit test.
- **No backfilled history.** The V4 upgrade does **not** synthesize past events from
  existing records (that would be fabricated precision: v0.1 never recorded most of
  those moments). Grids read historical `habitEntries` and `tasks.completedAt`
  directly (§10), so pre-V4 history still shows.

## 5. Project command model

```ts
type ProjectState =
  | 'planning'
  | 'active'
  | 'waiting'
  | 'needs_approval'
  | 'blocked'
  | 'parked'
  | 'review'
  | 'done'
  | 'archived';

interface Project {
  id: Id;
  slug: string;
  name: string;
  kind: 'software' | 'hackathon' | 'college' | 'other';
  state: ProjectState;
  objective?: string; // one sentence: what "done" means
  nextAction?: string;
  workspacePath?: string; // relative path in the workspace hierarchy (§11)
  repoUrl?: string; // informational; nothing is fetched without opt-in (§14)
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface Milestone {
  id: Id;
  projectId: Id;
  title: string;
  order: number;
  weight: number; // default 1
  completedAt?: Timestamp;
}

interface ProjectItem {
  // the command-room lists
  id: Id;
  projectId: Id;
  kind: 'blocker' | 'approval' | 'decision' | 'note';
  title: string;
  body?: string;
  status: 'open' | 'resolved';
  createdAt: Timestamp;
  resolvedAt?: Timestamp;
}
```

**Completion %** is `Σ weight(completed milestones) ÷ Σ weight(all milestones)`. It's
shown only when a project has at least one milestone; otherwise the UI says "no
milestones yet" and never shows 0% or a guess. This reverses PRODUCT.md's "deliberately absent:
percentages" (written for hackathons) for projects only, and needs a new ADR (owner decision 2 in the
audit).

**Derived "Needs You"** is open `approval` items, open `blocker` items, and projects in
`needs_approval` or `blocked`, plus v0.1's overdue and due-soon tasks and hackathon
deadlines.

**Valid state transitions** are enforced in `rules.ts`: `archived` is terminal except
for "unarchive", and `done` needs every milestone complete or an explicit override
that's recorded as a decision.

## 6. Progress snapshots and history

- One `progressSnapshots` record per project per LocalDate, upserted (the unique
  `[projectId+localDate]` index) whenever that project's milestones or state change.
- Each snapshot holds `{ completedWeight, totalWeight, state, openBlockers,
openApprovals }`.
- Days without a snapshot carry the previous value forward **at render time**; the
  database never gets filler rows.
- The command room's progress-over-time chart reads the snapshots. It's plain SVG, so
  no chart library enters the bundle.
- No snapshots are created for dates before V4 is installed; the chart starts on the
  day tracking starts.

## 7. Work sessions (Start Work)

```ts
interface WorkSession {
  id: Id;
  projectId?: Id;
  taskId?: Id;
  intent?: string; // "what I'm about to do"
  startedAt: Timestamp;
  endedAt?: Timestamp;
  pauses: { at: Timestamp; resumedAt?: Timestamp }[];
  localDate: LocalDate; // day it started
  outcome?: string; // short note on finish
}
```

- **At most one open session**, a rule enforced in the repository. Opening a second
  asks the owner to finish or switch.
- **Active minutes** are wall time minus pauses, computed and never stored twice.
- **Crash-safe.** The open session is persisted immediately, so a reload restores
  "working on X since 14:05". A session left open across midnight or for more than 12 h
  is shown as "still open?" for the owner to end honestly, and never auto-closed with
  an invented end time.
- **Timers** derive from `startedAt` and the clock (`useToday`-style ticking), never
  from a counter, so a sleeping laptop doesn't lose or invent time.

## 8. Off-time / Sleep Mode sessions

```ts
interface OffTimeSession {
  id: Id;
  kind: 'sleep' | 'rest';
  startedAt: Timestamp;
  endedAt?: Timestamp;
  localDate: LocalDate; // the evening it started
  note?: string;
}
```

- Sleep Mode is a **manually marked window**: "I'm going to bed" → "I'm up". The UI
  says "in sleep mode for 7 h 20 m", **never** "slept 7 h 20 m", quality or stages.
- While a sleep session is open, the shell dims (Sleep tokens), hides work surfaces and
  offers only "I'm up" and capture.
- Starting sleep while a work session is open offers to finish it first.
- The sleep grid (violet) shows _whether and when_ a sleep window was marked, and is
  labelled as such.
- Sleep data is sensitive: it's excluded from workspace export and from AI context
  unless the owner explicitly includes it (§12).

## 9. Routines / life tracking

`habits` and `habitEntries` remain the model: levels 0–4, targets and units (ADR-023,
ADR-024). v2 renames them "routines" in the UI and maps them to secondary grids by
category, with no data change:

| Habit category | v2 grid                                                 | Color token                 |
| -------------- | ------------------------------------------------------- | --------------------------- |
| coding         | Projects / Coding                                       | gold `--lt-grid-projects-*` |
| learning       | College / Learning                                      | blue `--lt-grid-college-*`  |
| fitness        | Gym / Fitness                                           | warm red `--lt-grid-gym-*`  |
| health         | Health (with fitness, as ADR-036's group)               | warm red                    |
| money          | Money                                                   | neutral                     |
| personal       | Personal (the owner's own habits: reading, journaling…) | teal `--lt-grid-personal-*` |

"Personal: teal" means **habits in the `personal` category**, never `protectedTime` of
kind `personal`. Those are different things, and protected time never renders as a
square.

Gym/fitness appears as a secondary grid and inside Routines. It is **not** a primary
Home card (owner rule).

## 10. Contribution grids and the Daily Pulse

**One generic, accessible grid component** is refactored from the v0.1 `ActivityGrid`:

- GitHub geometry: 53 columns, Sunday-first rows, Mon/Wed/Fri labels and month labels;
- per-grid palette tokens (levels 0–4, light and dark);
- the v0.1 ARIA grid, roving tabindex and a text label per cell;
- a day-details callback (a popover or sheet listing what happened that day, from the
  records).

A grid is defined by a **source function** `(range) → Map<LocalDate, number>` and a
**leveller** `(value) → 0..4`. The v0.1 overall and group views become two such
definitions.

**The Daily Pulse** (green master grid) is the sum of **distinct kinds of real
activity** per day, banded like ADR-025:

- ≥ 1 finished work session;
- ≥ 1 routine entry that reaches level ≥ 1;
- ≥ 1 task completed (from `tasks.completedAt`, so pre-V4 history counts);
- ≥ 1 milestone completed or decision recorded.

The exact inputs and bands need the owner's sign-off (audit decision 1) and a new ADR
that supersedes ADR-025 for the master grid.

**Explicitly excluded, enforced by a test that inspects the pulse source list:**

- `protectedTime` of every kind;
- off-time and sleep sessions (they have their own violet grid, which isn't a score);
- inbox captures (capturing a thought isn't output).

**No backfill.** Grids draw from records that already carry dates:

- `habitEntries.date`;
- `tasks.completedAt`;
- sessions from V4 onwards.

Days before the owner's first record are level 0, not hidden and not invented.

## 11. Workspace filesystem hierarchy

The target is a folder the owner chooses, readable by the owner and by AI coding tools:

```
<workspace>/
  README.md                       # generated index of projects
  projects/<slug>/
    PROJECT.md                    # objective, state, next action, milestones
    DECISIONS.md                  # decision items, newest first
    HANDOFF.md                    # latest AI/owner handoff note
    sessions/YYYY-MM.md           # work-session summaries (project work only)
  knowledge/                      # owner-written notes (LOWTIDE never overwrites)
```

**Constraint:** a static SPA can't write to an arbitrary folder reliably. The File
System Access API is Chromium-only and permission-prompting, and v0.1 PHASE 005
deliberately avoided it. Two options:

- **A (first):** "Export workspace" produces these files as a download or zip, using
  the same explicit, owner-triggered model as backups.
- **B (later):** a local companion process (§12) writes them continuously.

**What is exported:**

- **Only** projects, milestones, decisions, project items and project work-session
  summaries.
- **Never** protected time, sleep and off-time sessions, routines or habit entries, or
  inbox content. There's no toggle for protected time. Sleep and routine export would
  need an explicit per-export opt-in and is off by default.

Generated files carry a header (`<!-- generated by LOWTIDE; edits here are overwritten
-->`). The export never touches files outside `projects/<slug>/` that it didn't
create.

The workspace isn't a Git repository by default. If the owner puts it in one, only
technical project knowledge is there to commit.

## 12. AI context engine

**Problem:** AI clients (Claude Code, an MCP host) can't read browser IndexedDB. The
source of truth must be reachable, which is audit decision 3:

- **Option 1 (recommended first):** context packs are **generated in the app** from
  repositories and delivered through the workspace export (§11) or copy-to-clipboard.
  There's no server and ADR-001/004 are unchanged.
- **Option 2 (later):** a **local companion process** (Node, localhost only) owns a
  SQLite database as canonical storage, the SPA becomes a client over a localhost API,
  and an MCP server exposes tools. This is a major ADR-level change and a dedicated
  phase with its own migration (IndexedDB → SQLite via the existing backup format,
  which is exactly what `formatVersion` 1 was designed to carry).

**Context packs** are small, scoped and explainable:

```ts
buildContextPack({ scope: 'project', projectId, budget: 'small' }) → {
  project,                       // objective, state, next action
  milestones,                    // with completion
  openItems,                     // blockers, approvals
  recentDecisions,               // last N
  recentSessions,                // last N summaries, this project only
  handoff,                       // latest HANDOFF note
  sources: [{ entityType, entityId }], // every fact is traceable
}
```

- **Scope first.** Ask LOWTIDE about a project gets that project's pack, and the
  default budget is small. A Home-level question gets a summary (Needs You items,
  today's plan titles), never the full database.
- **Excluded by construction:** protected time. Sleep, off-time and routines are
  included only by explicit owner opt-in per question.
- **No fake AI.** Until a real model client is connected, "Ask LOWTIDE" is a local
  search and context-pack preview, labelled as such. `aiSessions` records are written
  only when a real client reports a session.

## 13. Future MCP / API

MCP and the API come after the companion process (option 2), in their own phase.
Proposed tool surface, read-mostly:

| Tool                                                    | Access           | Notes                                                                               |
| ------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `get_context_pack(projectId, budget)`                   | read             | §12                                                                                 |
| `list_projects()` / `get_project(id)`                   | read             | no life logs                                                                        |
| `record_ai_session(projectId, summary, filesTouched?)`  | write            | creates `aiSessions` and an `ai.session.completed` event with `source: 'ai-client'` |
| `propose_decision(projectId, …)` / `propose_blocker(…)` | write (proposal) | lands as an **approval item** the owner accepts; never edits truth directly         |
| `write_handoff(projectId, markdown)`                    | write            | replaces HANDOFF only                                                               |

AI clients can never read or write protected time, sleep, routines or inbox, and can
never delete. All AI writes are attributed (`source`) and visible in the project
timeline.

## 14. Security model changes

v0.1 (SECURITY.md, ADR-005): no network, no server, and plaintext backups owned by the
owner. v2 keeps that as the default and adds these rules before any code:

- **Companion process:**
  - binds `127.0.0.1` only;
  - uses a random per-install bearer token, stored outside the repo and outside the SPA
    bundle;
  - enforces a strict `Origin` allow-list and has no CORS wildcard;
  - does no remote listening.
- **GitHub info:** opt-in. The token lives in the companion (or the OS keychain), never
  in the browser or Git. Access is read-only and scoped to the repositories listed on
  projects.
- **AI clients:** see §13's capability table. Every write is attributed and reviewable,
  and proposals don't take effect without owner approval.
- **Git hygiene:** `lowtide-backup-*.json` stays ignored, and the workspace export
  contains no life logs. A pre-commit check for personal strings remains the owner's
  release practice.
- SECURITY.md must be updated **in the phase that introduces** each capability, not
  before.

## 15. Migration plan: V3 → V4 (non-destructive)

**Before the upgrade:**

- The app encourages a backup ("LOWTIDE is about to update its data format; download a
  backup first"), using the existing Data & backup export.
- Every owner test run keeps a pre-upgrade backup file (ignored).

**`version(4).upgrade(tx)`:**

1. Create the new stores. They're empty, apart from step 2.
2. For each **distinct, trimmed, non-empty `tasks.project` label**:
   - create one `projects` record with `name` = label, a unique `slug`,
     `state: 'active'` and `kind: 'other'`;
   - set `projectId` on matching tasks;
   - **keep `task.project` unchanged.**

   Labels are matched case-sensitively after trimming, so two spellings stay two
   projects. The owner can merge them, and nothing is guessed.

3. Hackathons are **not** auto-converted to projects. Linking is an owner action
   ("Track as project"). The upgrade doesn't decide scope.
4. No events, snapshots or sessions are synthesized (§4, §6).

**Backup:**

- `STORE_NAMES` gains the new stores.
- `migrateSnapshot` gains a V3 → V4 step that performs the step-2 derivation on
  imported data.
- Cross-store integrity adds:
  - milestone/item/session/snapshot → existing project;
  - `task.projectId` → existing project;
  - event → existing entity, or a documented "deleted" allowance.
- `BACKUP_FORMAT_VERSION` stays **1**, because the envelope is unchanged. A V4 backup
  refused by a V3 app gets the existing "made by a newer LOWTIDE" message.

**Tests (required, as in `migration-v3.test.ts`):**

- a real V3 database with labelled tasks upgrades, and labels and all V3 data are
  byte-identical afterwards;
- V1, V2 and V3 backups import into V4;
- V4 export → import round-trips;
- protected time survives untouched and appears in no V4 store.

**Rollback:** V4 only added data, so restoring a pre-upgrade backup into a fresh
profile gives the exact V3 state. IndexedDB can't downgrade in place, which is
documented rather than worked around.

## 16. Suggested phase order (not started; each needs the owner's prompt)

1. Fix the date time-bomb test; record ADRs for audit decisions 1–8.
2. Schema V4 + repositories for projects, milestones, items and the ledger, plus the
   migration and backup tests. No UI change.
3. The generic grid component + palette tokens; Daily Pulse from existing records.
4. Home at `/` (Today moves to `/today`); 320 px navigation restructure.
5. Start Work sessions; Sleep Mode sessions + dimmed shell.
6. Project Command Room (milestones, %, snapshots chart, blockers/approvals/decisions).
7. Workspace export + context packs (option 1).
8. Companion process / MCP / GitHub (option 2): only after a security review.
