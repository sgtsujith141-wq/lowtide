# LOWTIDE v2 PHASE 002 — V4 data foundation

**Date:** 2026-09-30 · **Status:** PASS · **Schema:** V4 (additive)

## Preflight (architecture §16)

| #   | Item                             | Result                                                                                                                                                                                                                                                                       |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fresh V3 backup of real data     | Exported from the Chromium profile holding the restored bootstrap, on the V3 build, before any V4 code: `lowtide-backup-preflight-v3-2026-09-30-0045.json` (ignored, not committed). The owner's own browser hasn't had the data restored yet, so it has nothing to back up. |
| 2   | It parses                        | The app's own restore preview accepted it: 10 tasks, 4 inbox, 8 rhythms, 0 entries, 9 hackathons, 3 protected time. Cancelled without restoring.                                                                                                                             |
| 3   | V1/V2/V3 imports preserved       | `migration-v4.test.ts` imports schema-1, -2 and -3 envelopes; the existing backup fixtures still pass                                                                                                                                                                        |
| 4   | V3 → V4 migration test           | A genuine V3 database upgrades with every record deep-equal                                                                                                                                                                                                                  |
| 5   | V4 round trip                    | `v4-backup.test.ts`: export → restore → export gives identical data, with every V4 store filled                                                                                                                                                                              |
| 6   | All 15 `STORE_NAMES`             | Export has 15; a schema-4 backup missing one, or any backup with an unknown store, is refused                                                                                                                                                                                |
| 7   | Validation and integrity         | 15 rejection cases (refs, lanes, sessions, days off, events, snapshots, AI scope, hackathon link), each writing nothing                                                                                                                                                      |
| 8   | Protected-time exclusion         | no protected-time event type; no V4 field mentions it; the upgrade leaves it untouched and in no V4 store                                                                                                                                                                    |
| 9   | No fabricated history            | after the upgrade all nine new stores are empty                                                                                                                                                                                                                              |
| 10  | No automatic hackathon → project | after the upgrade `projects` is empty and no task or hackathon has a `projectId`                                                                                                                                                                                             |

## Built

- **Schema V4** (`STORES_V4`, `SCHEMA_VERSION = 4`): nine stores, two `projectId`
  indexes, Zod schemas, and rules in `rules.ts` (item lanes, project transitions, work
  sessions and pauses, off time, event/entity pairing, AI scope).
- **Repositories:**
  - `projects` (projects, milestones, lane items, decisions, snapshots, a project's
    tasks);
  - `work` (start, pause, resume, finish, discard, active, range, per project);
  - `offTime` (sleep/rest windows, days off);
  - `events` (read-only ledger, private events hidden by default);
  - `aiSessions` (record for real clients only);
  - `activity` (raw records behind grids and the Daily Pulse).
- **Ledger:** events are appended inside the same transaction as their record:
  `task.completed`, `habit.logged`, `work.*`, `offtime.*`, `milestone.completed`,
  `project.updated`, `project.approval_requested`, `project.item_parked`,
  `decision.recorded`, `ai.session.completed`. Deleting an entity (a cleared habit
  entry, a discarded session, a removed item or milestone) removes its events.
- **Snapshots:** every project change upserts that day's snapshot; past days are never
  recomputed.
- **Links:** tasks can link a project and one of its milestones; hackathons can link a
  project, only by an explicit call.
- **Backup:** 15 stores; the Data page's restore preview lists them all.

## Tests

- 32 files and 415 tests, all passing.
- New tests: `migration-v4.test.ts` (14), `v4-repositories.test.ts` (27) and
  `v4-backup.test.ts` (18).
- Existing tests that pinned schema 3 or the six-store list were updated to V4, because
  ADR-046 changed those facts on purpose. No other assertion was weakened.

## Not done here

No UI. Home, the Command Room, and Work and Sleep Mode build on this in later phases.
