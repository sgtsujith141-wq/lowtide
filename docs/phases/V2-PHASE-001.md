# LOWTIDE v2 PHASE 001 — Lock decisions, fix baseline, prepare V4

**Date:** 2026-09-30 · **Status:** PASS · **Schema:** still V3 (no migration)

## Goal

Remove ambiguity and leave the existing app on a fully green baseline before any schema
work. Out of scope, by instruction: implementing V4, redesigning Home, building the
Project Command Room, and building MCP.

## Done

1. **Date-dependent test fixed.** `inbox-page.test.tsx` › "lists unprocessed thoughts
   oldest first with their capture time":
   - Cause: the test captured at a fixed clock (2026-09-28 09:00Z), but `formatWhen`
     labelled it against the real date. From 29 September to 4 October the label was
     "yesterday" or a weekday, and the `/\d/` match failed.
   - Fix: fake only `Date`, still ticking, at 09:05Z. Assert both items' exact
     `datetime`, local `HH:mm` text (computed in the test) and full-date `title`.
   - Checked under `TZ` = America/Los_Angeles, Pacific/Kiritimati, Pacific/Pago_Pago
     and UTC, and in the local zone (Asia/Kolkata).
2. **PHASE 000 documentation corrected.** All seven errors are listed in
   `LOWTIDE-V2-AUDIT.md` §7, and the audit and architecture documents now agree.
3. **Decisions recorded** as ADR-037 to ADR-046:
   - Older ADRs weren't rewritten. ADR-001, ADR-004, ADR-005, ADR-006, ADR-020 and
     ADR-025 gained dated status notes saying what's still in force and what later
     supersedes it.
   - PRODUCT.md gained a note under Hackathons.
4. **V4 schema design locked.** `LOWTIDE-V2-ARCHITECTURE.md` §3–§9, ADR-046:
   - nine new stores, including a dedicated `decisions` store, justified in §5.4;
   - lane-based `projectItems` that don't duplicate tasks;
   - optional `workSessions.projectId`, validated against the task's project;
   - `offTimeSessions` kinds: sleep, rest and day_off;
   - one canonical event list, with no protected-time types.

   The V4 upgrade now **writes nothing to existing records**. This is a change from
   PHASE 000, which derived projects from task labels.

5. **Grid presets:** `CATEGORY_PRESET`, presentation only. Money is unmapped, and
   habit records are unchanged.
6. **PHASE 002 preflight:** ten items, in the architecture document §16.

## New pure logic (not rendered anywhere yet)

| Module                            | ADR     | What it does                                                                      |
| --------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `features/pulse/daily-pulse.ts`   | ADR-037 | `dailyPulse(signals)`: capped points, bands 0 · 1 · 2–3 · 4–5 · 6+, day-off rule  |
| `features/projects/completion.ts` | ADR-038 | weighted milestone percent; `null` without milestones; 100 only when all are done |
| `features/hackathons/progress.ts` | ADR-039 | stages from registration, PPT and build statuses only                             |
| `features/rhythm/presets.ts`      | ADR-045 | category → preset, and per-day routine signal counts                              |

The production bundle is unchanged in size (entry 452.62 kB): nothing imports these
modules yet.

## Validation

| Check                  | Result                                       |
| ---------------------- | -------------------------------------------- |
| `npm run typecheck`    | pass                                         |
| `npm run lint`         | pass                                         |
| `npm run format:check` | pass                                         |
| `npm test -- --run`    | **29 files, 356 tests, all pass** (338 + 18) |
| `npm run build`        | pass; entry 452.62 kB (144.46 kB gzip)       |

## Not done (by design)

- No schema change, no data migration, and no UI change.
- No companion, MCP, GitHub or network code.
