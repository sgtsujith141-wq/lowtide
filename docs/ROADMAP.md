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
