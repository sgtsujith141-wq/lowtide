# Roadmap

Phases are small and each ends with a phase report in `docs/phases/`.

| Phase | Goal                                                                                                                                               | Status                  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 000   | Foundation: toolchain, tokens, routing, Dexie DB, repository boundary, types, tests, docs                                                          | Done (see PHASE-000.md) |
| 001   | App shell + brain dump capture + inbox processing + tasks + reactive data                                                                          | Done (see PHASE-001.md) |
| 002   | Today view: what's due/open today, protected time for today, quick capture                                                                         | Done (see PHASE-002.md) |
| 003   | Rhythm: habits, daily logging, contribution-style activity squares                                                                                 | Done (see PHASE-003.md) |
| 004   | Hackathons: project sheets, LocalDate dates (schema V3), Today section                                                                             | Done (see PHASE-004.md) |
| 005   | Backup: validated JSON export, replace-import, atomic restore, persistent-storage request                                                          | Done (see PHASE-005.md) |
| 006   | Protected time for the week ahead; Coding & learning and Fitness & health Rhythm views; final regression, accessibility, responsive and docs sweep | Done (see PHASE-006.md) |

## CORE V0.1 ROADMAP COMPLETE

Every numbered phase is done. What follows is **optional future work**. None of it is
required for v0.1, none of it is scheduled or numbered, and each item would need its
own decision first.

## LOWTIDE v2

v2 grows LOWTIDE into a local-first personal operating system inside this repository.
Plan: [LOWTIDE-V2-ARCHITECTURE.md](LOWTIDE-V2-ARCHITECTURE.md); audit:
[LOWTIDE-V2-AUDIT.md](LOWTIDE-V2-AUDIT.md). Each phase starts only on the owner's prompt.

| v2 phase | Goal                                                                          | Status                                        |
| -------- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| 000      | Audit, safeguards, migration plan                                             | Done                                          |
| 001      | Green baseline, decisions locked (ADR-037 to ADR-046), V4 design locked       | Done (see V2-PHASE-001.md)                    |
| 002      | V4 data foundation: schema, repositories, ledger, backup V4, preflight        | Done (see V2-PHASE-002.md)                    |
| 003      | Home v2: Daily Pulse calendar, project cards, Needs you, Today, activity, nav | Done (see V2-PHASE-003.md)                    |
| 004      | Project Command Room                                                          | Done (see V2-PHASE-004.md)                    |
| 005      | Work Mode + Sleep Mode                                                        | Done (see V2-PHASE-005.md)                    |
| 006      | Life + Rhythm                                                                 | Done (see V2-PHASE-006.md)                    |
| 007      | Hackathons + Calendar + integration                                           | Done (see V2-PHASE-007.md)                    |
| 008      | Shared AI context architecture + local companion/MCP foundation               | Done, completed by 008B (see V2-PHASE-008.md) |
| 008B     | SQLite companion + permanent shared AI context                                | Done (see V2-PHASE-008B.md)                   |
| 009      | QA, polish, performance, accessibility, docs                                  | Done (see V2-PHASE-009.md)                    |
| v2.1     | Operator parity over MCP, SPACE databases and views, creation, live upgrades  | Done (see v2.1/)                              |
| v2.2     | Operating plan in LOWTIDE: Areas, CTFs and selection (schema V11)             | Built; live upgrade awaits owner (see v2.2/)  |

The current state is in [LOWTIDE-V2-STATUS.md](LOWTIDE-V2-STATUS.md).

## LOWTIDE as a product: what comes next

Each needs its own owner-issued phase; none starts automatically.

1. **Major UI redesign.** Calm and low-cognitive-load: the usual view shows the current
   focus, deadlines, next actions, active projects, learning progress and what needs
   attention; everything else is one step away.
2. **Task / todo redesign.** Fast capture, a clear next action, visible deadlines and
   project context, separated into Critical, Today, This Week, Can Wait, Parked, Waiting
   and Someday; effort, energy, urgency, recurrence and review dates.
3. **Brain-dump capture and triage.** A dump split into items with a suggested class,
   home, priority, deadline and next action, each accepted into a real record.
4. **Capacity-aware planning.** Workload, capacity, sleep mode, protected time, critical
   deadlines, low-energy days and parked work; overload never produces more red.
5. **SPACE and Notion parity, additively.** Row-level relations in the picker, linked
   views per page, row templates, board grouping by any property, toggles, uploads.
6. **Onboarding, production hardening, packaging and deployment, a beta.**

## Optional future work

- A money/business-native LOWTIDE area
- GitHub read access through the companion (ADR-041)
- Starting the companion at login
- A committed browser end-to-end suite beyond `npm run e2e:companion`
- Offline/PWA
- Optional sync, only with a documented security model
- Undo (Clear, Drop, protected-time Remove, clearing a habit day)
- Global keyboard shortcuts
- "Send hackathon next action to Tasks"
- Encrypted backups

Whatever comes next must keep backups whole. Any new store or field has to appear in
the backup envelope, `STORE_NAMES` and import validation, with a schema bump and a
`migrateSnapshot` step if records change.
