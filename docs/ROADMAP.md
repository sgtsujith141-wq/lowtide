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

| v2 phase | Goal                                                                                                  | Status                     |
| -------- | ----------------------------------------------------------------------------------------------------- | -------------------------- |
| 000      | Audit, safeguards, migration plan                                                                     | Done                       |
| 001      | Green baseline, decisions locked (ADR-037 to ADR-046), V4 design locked, pure rules tested            | Done (see V2-PHASE-001.md) |
| 002      | Schema V4, repositories, rules, ledger, backup V4, with the preflight in the architecture doc §16     | Done (see V2-PHASE-002.md) |
| 003+     | Grids and Daily Pulse; Home and navigation; Start Work and Sleep Mode; Project Command Room; later AI | Not started                |

## Optional future work

- A money/business-native LOWTIDE area
- A theme switcher (the CSS already supports `data-theme`)
- A committed browser end-to-end suite
- Offline/PWA
- Optional sync, only with a documented security model
- Undo (Clear, Drop, protected-time Remove, clearing a habit day)
- Global keyboard shortcuts
- "Send hackathon next action to Tasks"
- Encrypted backups

Whatever comes next must keep backups whole. Any new store or field has to appear in
the backup envelope, `STORE_NAMES` and import validation, with a schema bump and a
`migrateSnapshot` step if records change.
