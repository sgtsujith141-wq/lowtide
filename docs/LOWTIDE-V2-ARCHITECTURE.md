# LOWTIDE v2 — Target architecture and migration plan

- **Status:** decisions locked (v2 PHASE 001). Schema V4 (§3–§9) is the approved design
  for PHASE 002, and nothing in it is implemented yet. The pure rules for Daily Pulse,
  project completion, hackathon stages and grid presets exist and are tested.
- **Implementation status (overnight build, 2026-09-30):**
  - §3–§10 are built, with schema V5 adding `collegeItems` (ADR-051).
  - §11–§12 are built as the workspace export and in-app context packs (ADR-054).
  - §13 is stage 1: a stdio MCP companion over the exported workspace (ADR-055).
  - [LOWTIDE-V2-STATUS.md](LOWTIDE-V2-STATUS.md) lists what's complete, partial and
    pending. Where this document and a later ADR differ, the ADR wins.
- **Date:** 2026-09-30
- **Baseline:** v0.1 at `de8f501`, schema V3
- **Companions:**
  - [LOWTIDE-V2-AUDIT.md](LOWTIDE-V2-AUDIT.md): current-state audit and the owner
    decisions on its conflicts;
  - [DECISIONS.md](DECISIONS.md): ADR-037 to ADR-046.

v2 turns LOWTIDE from a calm planner into a local-first personal operating system:

- **Home**, with Start Work, Sleep Mode, Ask LOWTIDE, the Daily Pulse and project
  cards;
- a **Project Command Room** per project;
- **work and off-time sessions**;
- a **typed event ledger**;
- a technical **workspace** and **context service** that AI clients can use.

It's an evolution of the v0.1 codebase, not a rewrite. Every v0.1 store survives, and
every change is additive.

## 1. Non-negotiable principles

1. **Local-first.** Your data lives on your machine. No account, no cloud, no
   telemetry. Network features are opt-in (ADR-041).
2. **No destructive migration.** Schema upgrades only add stores, indexes and optional
   fields. The V4 upgrade writes nothing to existing records. Every older backup still
   imports.
3. **Truth lives in one place.** Records are the source of truth. Events reference
   them and never replace them (§4).
4. **People are not productivity.** Protected time never becomes an event, grid
   square, streak, score, workspace file or AI context (ADR-013, ADR-021, ADR-037,
   ADR-041, ADR-044).
5. **Honesty.** No fabricated history, progress or AI activity:
   - percentages come only from milestones (ADR-038);
   - squares come only from real records (ADR-037);
   - AI session records come only from real clients;
   - Sleep Mode records a manually marked window, never physiological sleep.
6. **Private by default.** Sensitive life state stays in private LOWTIDE storage, never
   in the workspace or Git (ADR-044).
7. **Minimal, scoped AI context** (ADR-041).
8. **The v0.1 engineering rules continue:** repository boundary, strict TS,
   accessibility, 320 px, real migration tests, and a 15 s test timeout.

## 2. Existing store → v2 destination

Every V3 store keeps its name and its record shape. V4 adds optional fields only.

| V3 store / field                    | v2 destination                                                    | V4 change                                             | Recoverability                                                    |
| ----------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `tasks`                             | `tasks`; shown in Command Room lanes by status                    | + `projectId?`, + `milestoneId?`, + index `projectId` | unchanged records; links only by owner action                     |
| `tasks.project` (free-text label)   | kept as is                                                        | none; **nothing is derived from it**                  | the label stays the display value until you link a real project   |
| `tasks.completedAt`                 | a Daily Pulse `progressMoves` source (ADR-037)                    | none                                                  | read-only derivation                                              |
| `inbox`                             | `inbox`: Brain Dump, reachable from Home and More                 | none                                                  | unchanged; never in the pulse, workspace or default AI context    |
| `habits`                            | `habits`, shown as routines; category → grid preset (ADR-045)     | none                                                  | categories never rewritten                                        |
| `habitEntries`                      | `habitEntries`: routine grids and pulse routine signals           | none                                                  | unchanged                                                         |
| `hackathons`                        | `hackathons`: an independent domain with stage progress (ADR-039) | + `projectId?`, + index `projectId`                   | never converted; the link is set only by an explicit owner choice |
| `protectedTime`                     | `protectedTime`: week-ahead protected time                        | none                                                  | unchanged; excluded from events, grids, pulse, workspace and AI   |
| Backup envelope (`formatVersion` 1) | the same envelope                                                 | `data` gains 9 stores; `schemaVersion` 4              | V1–V3 backups import via `migrateSnapshot`                        |

**Changed since the PHASE 000 proposal:** the V4 upgrade no longer derives `projects`
from `tasks.project` labels. Labels like "college" or "misc" aren't necessarily
projects, and creating records you didn't ask for is a guess. Linking is always your
action.

## 3. Schema V4 (approved design)

Storage stays Dexie/IndexedDB (ADR-040 stage 1). V4 is appended as
`this.version(4).stores(STORES_V4).upgrade(...)`, with V1–V3 left in place. The upgrade
function only verifies, and writes nothing to existing stores.

```ts
export const STORES_V4 = {
  // changed: one new index each
  tasks: 'id, status, dueAt, createdAt, plannedFor, projectId',
  hackathons: 'id, status, registrationDeadline, eventStart, projectId',
  // new
  projects: 'id, &slug, state, updatedAt',
  milestones: 'id, projectId, [projectId+order]',
  projectItems: 'id, projectId, [projectId+lane], taskId',
  decisions: 'id, projectId, decidedAt',
  workSessions: 'id, kind, projectId, taskId, localDate, startedAt',
  offTimeSessions: 'id, kind, localDate, startedAt',
  events: 'id, at, localDate, type, projectId, [entityType+entityId]',
  progressSnapshots: 'id, projectId, &[projectId+localDate]',
  aiSessions: 'id, projectId, startedAt',
} as const;
```

That's 9 new stores. This is the audit's 8 plus `decisions`, which ADR-046 justifies
and §5.4 describes.

**Common rules**, as in v0.1:

- Every record has `id: Id` (UUID v4).
- Timestamps are ISO UTC, and calendar days are `LocalDate`.
- Optional fields are absent, never `undefined` (`exactOptionalPropertyTypes`).
- Text fields are trimmed and non-empty when present.
- Every store gets a Zod schema, a repository interface and `Watch<T>` queries.
- Invariants live in `src/db/rules.ts` and are shared with backup import.

### 3.1 Links on existing stores

```ts
interface Task {
  // …V3 fields unchanged
  projectId?: Id; // an existing project
  milestoneId?: Id; // requires projectId; a milestone of that same project
}
interface Hackathon {
  // …V3 fields unchanged
  projectId?: Id; // an existing project; set only by an explicit owner choice
}
```

## 4. Typed event ledger

**Purpose:** a timeline of things that happened, for project timelines, day details,
"what did I do last Tuesday", and AI handoffs. Grids and the pulse read **records**,
not events, so history from before V4 still counts (§10).

```ts
export const EVENT_TYPES = [
  'work.started',
  'work.paused',
  'work.resumed',
  'work.finished',
  'offtime.started',
  'offtime.ended',
  'habit.logged',
  'task.completed',
  'milestone.completed',
  'project.updated',
  'project.approval_requested',
  'project.item_parked',
  'decision.recorded',
  'ai.session.completed',
] as const;

interface LedgerEvent {
  id: Id;
  type: EventType;
  at: Timestamp;
  localDate: LocalDate; // your calendar day of `at`
  entityType: EntityType; // see the table
  entityId: Id; // the source record
  projectId?: Id; // for project timelines; required for project-scoped types
  data: EventData[EventType]; // small immutable facts, never a copy of the record
  source: 'app' | 'ai-client';
}
```

| Type                         | `entityType`     | `data`                                                                    | Private¹ |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------- | -------- |
| `work.started`               | `workSession`    | `{ kind }`                                                                |          |
| `work.paused`                | `workSession`    | `{}`                                                                      |          |
| `work.resumed`               | `workSession`    | `{}`                                                                      |          |
| `work.finished`              | `workSession`    | `{}` (minutes are derived from the session)                               |          |
| `offtime.started`            | `offTimeSession` | `{ kind: 'sleep' \| 'rest' }`                                             | yes      |
| `offtime.ended`              | `offTimeSession` | `{ kind: 'sleep' \| 'rest' }`                                             | yes      |
| `habit.logged`               | `habitEntry`     | `{ habitId, date }`                                                       | yes      |
| `task.completed`             | `task`           | `{}`                                                                      |          |
| `milestone.completed`        | `milestone`      | `{}`                                                                      |          |
| `project.updated`            | `project`        | `{ change: 'created' \| 'state' \| 'details', from?: State, to?: State }` |          |
| `project.approval_requested` | `projectItem`    | `{}`                                                                      |          |
| `project.item_parked`        | `projectItem`    | `{ fromLane }`                                                            |          |
| `decision.recorded`          | `decision`       | `{ supersedesId? }`                                                       |          |
| `ai.session.completed`       | `aiSession`      | `{ scope }`                                                               |          |

¹ Private events never reach the workspace, and reach AI context only under an explicit
GLOBAL grant (ADR-041).

**Rules:**

- **Written by repositories, in the same transaction as the record change.** UI code
  never writes events.
- **Reference, never copy.** Events carry ids. A timeline renders the current record,
  or "deleted item" if it's gone.
- **Append-only.** Mistakes are corrected by a new record change, which produces a new
  event. The only removals are cascades when you delete the entity itself.
- **No protected-time event types, and no `day_off` events.** Declaring a day off
  isn't an activity. `EVENT_TYPES` is pinned by a test.
- **No backfill.** The upgrade creates no events for past records.
- Adding a type needs an ADR.

## 5. Project command model

### 5.1 Projects

```ts
export const PROJECT_STATES = [
  'planning',
  'active',
  'waiting',
  'needs_approval',
  'blocked',
  'parked',
  'review',
  'done',
  'archived',
] as const;
export const PROJECT_KINDS = ['software', 'research', 'other'] as const;

interface Project {
  id: Id;
  name: string; // 1–120 chars
  slug: string; // unique, [a-z0-9-], 1–64; the workspace folder name
  kind: ProjectKind;
  state: ProjectState;
  objective?: string; // what "done" means, in a sentence
  nextAction?: string;
  repoUrl?: string; // informational; nothing is fetched (ADR-041)
  createdAt: Timestamp;
  updatedAt: Timestamp;
  stateChangedAt: Timestamp;
}
```

**Transitions:**

- Any state can move to any other state, except:
  - `archived` → only `parked` (unarchive);
  - → `done` needs every milestone completed, or a recorded decision whose id is given
    as the override. With no milestones, `done` is allowed.
- Projects are archived, not deleted, in V4.
- Every state change emits `project.updated { change: 'state', from, to }`.

### 5.2 Milestones and completion

```ts
interface Milestone {
  id: Id;
  projectId: Id;
  title: string;
  notes?: string;
  order: number; // integer ≥ 0; unique per project
  weight: number; // finite, > 0; the repository defaults it to 1
  dueOn?: LocalDate;
  completedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Completion** is `projectCompletion()` (ADR-038):

- the weighted share, rounded down to a whole percent;
- `null` (nothing shown) without milestones;
- 100 only when all milestones are done;
- never from time, task counts or AI.

Completing a milestone emits `milestone.completed`.

### 5.3 Project items and lanes

The Command Room shows seven visual lanes. **Project items** are command, status and
context information that isn't naturally a Task: what's in focus, what you're waiting
on, what needs your approval, what blocks progress, ideas you've parked, and notes.
Tasks aren't copied into items.

```ts
export const PROJECT_LANES = [
  'working_now',
  'next',
  'waiting',
  'needs_approval',
  'blocked',
  'parked',
  'done',
] as const;
export const PROJECT_ITEM_KINDS = [
  'focus', // what's being worked on, when it isn't a single task
  'step', // a next step too coarse or too soon to be a task
  'dependency', // waiting on a person, a reply, a delivery…
  'approval', // something only you can sign off
  'blocker', // what prevents progress
  'idea', // parked for later
  'note', // context that should stay visible
] as const;

interface ProjectItem {
  id: Id;
  projectId: Id;
  kind: ProjectItemKind;
  lane: ProjectLane;
  title: string;
  body?: string;
  waitingOn?: string; // who or what; only in lane 'waiting'
  taskId?: Id; // an existing task of the same project, annotated rather than copied
  milestoneId?: Id; // a milestone of the same project
  order: number; // position within the lane
  createdAt: Timestamp;
  updatedAt: Timestamp;
  laneChangedAt: Timestamp;
  resolvedAt?: Timestamp; // set exactly when lane is 'done'
}
```

**Lane rules** (`rules.ts`):

- `resolvedAt` is present if and only if `lane === 'done'`.
- An unresolved `approval` sits in `needs_approval`, and an unresolved `blocker` in
  `blocked`. Other kinds may sit in any lane.
- Moving to `needs_approval` emits `project.approval_requested`, and moving to `parked`
  emits `project.item_parked`.
- Resolving a `blocker` or `approval` counts as a progress move (ADR-037).

**Tasks in lanes are derived, not stored:**

- a project's tasks with status `doing` show in `working_now`, `todo` in `next`, and
  recently `done` in `done`;
- `dropped` tasks are hidden;
- a task can appear as waiting or blocked only through an item that references it
  (`taskId`), which adds the why without duplicating the task.

**Needs You (Home)** is derived:

- unresolved `approval` and `blocker` items;
- projects in `needs_approval` or `blocked`;
- plus v0.1's overdue and due-soon tasks and near hackathon deadlines.

### 5.4 Decisions (dedicated store)

```ts
interface Decision {
  id: Id;
  projectId: Id;
  title: string;
  context?: string;
  decision: string; // what was decided
  consequences?: string;
  decidedAt: Timestamp;
  supersedesId?: Id; // an earlier decision of the same project
  origin: 'owner' | 'accepted-proposal'; // an AI proposal becomes a decision only when you accept it
  createdAt: Timestamp;
}
```

**Why a store rather than an item kind:**

- A decision is **immutable**. It's never edited, only superseded by a new decision.
- It doesn't move through lanes.
- It's the override record for `done`, and it's the source of the workspace's
  `decisions/` folder.

Folding it into `projectItems` would need lane and resolution exceptions everywhere.
Recording a decision emits `decision.recorded`.

## 6. Progress snapshots

```ts
interface ProgressSnapshot {
  id: Id;
  projectId: Id;
  localDate: LocalDate; // unique with projectId
  completedWeight: number;
  totalWeight: number;
  milestoneCount: number;
  completedCount: number;
  state: ProjectState;
  laneCounts: Record<ProjectLane, number>; // items only
  updatedAt: Timestamp;
}
```

- One snapshot per project per day, **upserted in the same transaction** as any change
  to that project's milestones, state or items.
- Days without a snapshot carry the previous values forward at render time, so there
  are no filler rows.
- There's no snapshot for any day before V4. The chart starts when tracking starts.
- Past snapshots are never recomputed, so an added milestone lowers today's percentage
  without rewriting yesterday's.

## 7. Work sessions (Start Work)

```ts
export const WORK_KINDS = ['project', 'task', 'college', 'general'] as const;

interface WorkSession {
  id: Id;
  kind: WorkKind;
  projectId?: Id; // required for kind 'project'; optional otherwise
  taskId?: Id; // required for kind 'task'
  intent?: string;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  pauses: { at: Timestamp; resumedAt?: Timestamp }[];
  localDate: LocalDate; // the day it started
  outcome?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Rules:**

- At most **one open session** (no `endedAt`).
- Pauses are ordered and don't overlap. Only the last may be open, and a finished
  session has none open. Everything lies within `[startedAt, endedAt]`.
- **Task consistency:** if `taskId` refers to a task with a `projectId`, the session's
  `projectId` must equal it. The repository fills it in when absent, and rejects a
  mismatch. Backup import checks the same.
- **Active minutes** = (end − start − Σ pauses) / 60 000, derived and never stored.
- Timers derive from `startedAt` and the clock, never from a counter.
- A session left open over 12 hours shows as "Still open?" for you to end. It's never
  closed automatically with an invented time.
- Kind `college` feeds the pulse's `collegeMinutes`; every other kind feeds
  `workMinutes`.

## 8. Off-time sessions and Sleep Mode

```ts
export const OFFTIME_KINDS = ['sleep', 'rest', 'day_off'] as const;

interface OffTimeSession {
  id: Id;
  kind: OffTimeKind;
  localDate: LocalDate; // the start day, or the declared day off
  startedAt?: Timestamp; // required for sleep/rest (a button press)
  endedAt?: Timestamp; // sleep/rest only
  note?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Sleep and rest:**

- Manually started ("I'm going to bed") and ended ("I'm up").
- At most one open window at a time.
- The UI says "in Sleep Mode for 7 h 20 m", never "slept", and never quality or
  stages.
- A window counts as `offTimeCompleted` on the local day its `endedAt` falls on.
- Emits `offtime.started` and `offtime.ended`.

**Day off:**

- A whole `LocalDate` you declare, which may be planned in advance; at most one per
  date.
- No start or end, and no event.
- It feeds the pulse's `dayOff`.
- It's **not** protected time. Protected time (including kind `rest`) is a plan for
  people and rest and never scores (ADR-021). A day off is your own statement about
  the day's pulse.

**Sleep Mode UI** (ADR-042): dims, lowers saturation, reduces motion and noise, and
keeps navigation visible.

All off-time records are private (§11, ADR-044).

## 9. Routines and grid presets

`habits` and `habitEntries` are unchanged (ADR-023, ADR-024), and are called "routines"
in the v2 UI. Presets (ADR-045, `src/features/rhythm/presets.ts`) map categories to
themed grids and pulse signals, as presentation only:

| Category | Preset          | Pulse signal       | Grid palette (ADR-042) |
| -------- | --------------- | ------------------ | ---------------------- |
| coding   | Work / Projects | `workRoutines`     | amber / gold           |
| learning | College         | `collegeRoutines`  | blue                   |
| fitness  | Gym             | `movementRoutines` | warm red               |
| health   | Personal        | `personalRoutines` | teal                   |
| personal | Personal        | `personalRoutines` | teal                   |
| money    | unmapped        | none               | none                   |

The gym is a secondary grid and part of Routines. It's never a primary Home card
(ADR-043). ADR-036's Rhythm group views are unchanged.

## 10. Grids and the Daily Pulse

**Generic grid component**, refactored from `ActivityGrid`:

- a year of weeks, month labels and weekday labels;
- a per-grid palette with light and dark variants, and inactive cells that follow the
  theme;
- the v0.1 ARIA grid, roving tabindex and text per cell (ADR-026);
- a day-details view built from records.

A grid is a **source** `(range) → Map<LocalDate, value>` plus a **leveller**
`(value) → 0–4`.

**Daily Pulse** (green master grid, ADR-037): `dailyPulse(signals)` in
`src/features/pulse/daily-pulse.ts`.

- Signals are derived per day from records:
  - finished work sessions;
  - `tasks.completedAt`, `milestones.completedAt`, `decisions.decidedAt`,
    `projectItems.resolvedAt` (blockers and approvals);
  - routine levels by preset;
  - completed off-time windows;
  - day-off records.
- Capped points: work 0–2, progress 0–1, college 0–1, personal 0–2, movement 0–1,
  recovery 0–1.
- Bands: 0 · 1 · 2–3 · 4–5 · 6+. A declared day off can reach 3–4 on rest alone.
- **Never counted:** protected time, inbox, money, hours beyond the cap.
- **No backfill.** Pre-V4 days score from the records they already have
  (`habitEntries`, `tasks.completedAt`), and nothing is invented.
- The pulse is derived at read time, never stored. Replacing the algorithm means a new
  version number and a new ADR.

## 11. Workspace (technical knowledge only)

The layout, per ADR-044:

```
<workspace>/projects/<slug>/
  PROJECT.md        # objective, state, next action, milestones and completion
  CONTEXT.md        # the curated context a coding agent should read first
  planning/  decisions/  research/  docs/  files/  assets/
  ai/sessions/  ai/handoffs/  ai/summaries/
  archive/
```

- **Written:** project records, milestones, decisions, project items, and project work
  sessions (intent, outcome and time; no sleep or other personal context).
- **Never written by default:** raw sleep logs, routines, health-type records, habit
  logs, inbox contents. **Never at all:** protected time.
- **How it's written:** while IndexedDB is canonical, as an explicit, owner-triggered
  export (the same model as backups). Continuous sync waits for the companion
  (ADR-040 stage 3).
- Generated files are marked as generated. LOWTIDE never overwrites files it didn't
  create. Technical knowledge may be Git-versioned; life state never is.

## 12. Context service and AI access

**Staged source of truth** (ADR-040):

1. **Now:** IndexedDB (Dexie) is canonical. Context packs are built **in the app** from
   repositories and handed over explicitly: copy, or workspace export. No companion is
   needed for this.
2. **Later, in a dedicated phase:** a LOWTIDE **local companion** owns a **SQLite**
   canonical database. Data moves from IndexedDB through the backup envelope, after a
   verified backup and with no loss. The SPA becomes a client, and the repository
   interfaces are the seam.
3. **Then:** the companion runs the **context service**, continuous workspace sync, and
   **MCP/API** (§13).

**Context packs:**

```ts
buildContextPack({ scope: 'project', projectId, budget: 'small' }) → {
  project, milestones, completion, openItems, recentDecisions,
  recentSessions,                 // this project's work sessions only
  handoff,                        // latest ai/handoffs entry
  sources: { entityType, entityId }[], // every fact is traceable
}
```

- **Scopes** (ADR-041): PROJECT (the default for coding agents), WORKSPACE, and GLOBAL
  (only when you explicitly authorize a specific assistant).
- **Protected time is excluded from every scope.** Private records (sleep, routines,
  health, habit logs, inbox) appear only under an explicit GLOBAL grant, and are never
  written to files to provide context.
- **No fake AI.** Until a real client is connected, "Ask LOWTIDE" is local search plus
  a context-pack preview, labelled as such. `aiSessions` has no writer until the
  MCP/API phase.

```ts
export const AI_SCOPES = ['project', 'workspace', 'global'] as const;

interface AiSession {
  id: Id;
  client: string; // as reported by the authenticated client, e.g. 'claude-code'
  scope: AiScope;
  projectId?: Id; // required when scope is 'project'
  startedAt: Timestamp;
  endedAt: Timestamp;
  summary: string;
  filesTouched?: string[]; // workspace-relative paths
  createdAt: Timestamp;
}
```

## 13. Future MCP / API (companion stage only)

| Tool                                          | Access           | Notes                                                                    |
| --------------------------------------------- | ---------------- | ------------------------------------------------------------------------ |
| `get_context_pack(scope, projectId?, budget)` | read             | §12; limited by the client's granted scope                               |
| `list_projects()` / `get_project(id)`         | read             | no private records                                                       |
| `record_ai_session(…)`                        | write            | creates `aiSessions` + `ai.session.completed` with `source: 'ai-client'` |
| `propose_decision(…)` / `propose_item(…)`     | write (proposal) | lands as an `approval` item; it takes effect only when you accept it     |
| `write_handoff(projectId, markdown)`          | write            | writes under `ai/handoffs/` only                                         |

AI clients can never delete, never touch protected time, and never write private
records. Every AI write is attributed and visible in the project timeline.

## 14. Security model

v0.1 (SECURITY.md, ADR-004, ADR-005) stays in force for the app as shipped. The future
companion (ADR-041):

- binds `127.0.0.1` only by default;
- authenticates every request with a per-install secret;
- uses an explicit origin allow-list, with no wildcard CORS;
- keeps secrets out of the frontend bundle;
- keeps the GitHub token in the companion or OS secure storage. GitHub is opt-in,
  read-only and scoped to repositories you list.

AI access is scope-based (§12). Backups stay plaintext and are your files; the
workspace never holds private records. SECURITY.md is updated **in the phase that adds
each capability**.

## 15. Migration plan: V3 → V4 (non-destructive)

**`version(4).stores(STORES_V4).upgrade(tx)`:**

1. Creates the nine new stores (empty) and the two new indexes.
2. Writes **nothing** to existing records:
   - no projects from task labels;
   - no hackathon conversion;
   - no events, snapshots or sessions synthesized.
3. The upgrade callback may count records for a test hook, but changes none.

**Backup:**

- `STORE_NAMES` gains `projects`, `milestones`, `projectItems`, `decisions`,
  `workSessions`, `offTimeSessions`, `events`, `progressSnapshots` and `aiSessions`
  (15 in total).
- `migrateSnapshot` V3 → V4 adds each new store as an empty array and changes nothing
  else.
- `BACKUP_FORMAT_VERSION` stays **1**, and `schemaVersion` becomes 4. A V3 app refuses
  a V4 backup with the existing "made by a newer LOWTIDE" message.

**Cross-store integrity** (repositories and import):

- The `projectId` of milestones, items, decisions, snapshots, events,
  `tasks.projectId` and `hackathons.projectId` must refer to an existing project.
- `tasks.milestoneId` requires `tasks.projectId`, and the milestone must be in that
  project.
- `projectItems.taskId` must be a task whose `projectId` equals the item's, and
  `projectItems.milestoneId` must be in the same project.
- For `workSessions`, `projectId` must exist, and `taskId` must exist and match the
  task's project (§7).
- `decisions.supersedesId` must be a decision in the same project.
- `events`: the type must fit its `entityType`, and a missing entity is allowed
  (deleted).
- At most one open work session, one open sleep/rest window, and one `day_off` per
  date.
- `aiSessions.projectId` is required when the scope is `project`.

**Rollback:** V4 adds only. Restoring a pre-V4 backup into a fresh profile gives the
exact V3 state. IndexedDB can't downgrade in place; this is documented, not worked
around.

## 16. Phase 002 preflight (before V4 touches real data)

Each item must be done and checked before PHASE 002 is reported PASS:

1. **Fresh V3 backup of real data:** export from Data & backup on the current app
   (schema V3). Keep it as an ignored `lowtide-backup-*.json`, never committed.
2. **Verify it parses:** run it through `inspectBackup` (the Data page's restore
   preview) and confirm the store counts.
3. **Preserve V1/V2/V3 backup imports:** the existing backup tests keep passing, and new
   tests import V1, V2 and V3 envelopes into V4.
4. **V3 → V4 migration test:** a real V3 database (created with `STORES_V1`–`V3`, like
   `migration-v3.test.ts`) upgrades, and every V3 record is deep-equal before and after.
5. **V4 round-trip backup test:** export → import → export gives identical `data`.
6. **All new `STORE_NAMES`:** export includes all 15 stores, import requires them for
   schema 4, and a missing or unknown store is refused.
7. **Validation and integrity:** each rule in §5–§8 and §15 has an accepting and a
   rejecting test, both in repositories and in import.
8. **Protected-time exclusion:**
   - `EVENT_TYPES` has no protected-time type;
   - the pulse signal list excludes it (already pinned);
   - no V4 store has a field referring to protected time;
   - protected time is untouched by the upgrade.
9. **No fabricated history:** after the upgrade, `events`, `progressSnapshots`,
   `workSessions`, `offTimeSessions`, `decisions` and `aiSessions` are empty.
10. **No automatic hackathon → project conversion:** after the upgrade, `projects` is
    empty and no hackathon or task has a `projectId`.

## 17. Phase order (each phase needs the owner's prompt)

- **001 (done):** baseline fixed, decisions locked (ADR-037 to ADR-046), pure rules
  tested.
- **002:** schema V4, repositories, rules, ledger writes, and backup V4, with the §16
  preflight. No UI.
- **003:** generic grid + palettes; Daily Pulse from records.
- **004:** Home at `/`, Today at `/today`, and v2 navigation (ADR-043).
- **005:** Start Work sessions; Sleep Mode sessions and the dimmed shell.
- **006:** Project Command Room: lanes, milestones, completion, decisions, snapshots
  chart.
- **Later:** workspace export and in-app context packs; then the companion + SQLite
  migration; then the context service, MCP/API and GitHub, each after a security
  review.
