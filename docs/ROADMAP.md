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

The current state is in [LOWTIDE-V2-STATUS.md](LOWTIDE-V2-STATUS.md).

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
