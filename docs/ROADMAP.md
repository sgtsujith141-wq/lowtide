# Roadmap

Phases are small and each ends with a phase report in `docs/phases/`. Scope after
PHASE 001 is provisional and will be revised as the app is used.

| Phase | Goal                                                                                                                                | Status                  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 000   | Foundation: toolchain, tokens, routing, Dexie DB, repository boundary, types, tests, docs                                           | Done (see PHASE-000.md) |
| 001   | App shell + brain dump capture + inbox processing + tasks + reactive data                                                           | Done (see PHASE-001.md) |
| 002   | Today view: what's due/open today, protected time for today, quick capture                                                          | Done (see PHASE-002.md) |
| 003   | Rhythm: habits, daily logging, contribution-style activity squares                                                                  | Done (see PHASE-003.md) |
| 004   | Hackathons: project sheets, LocalDate dates (schema V3), Today section                                                              | Done (see PHASE-004.md) |
| 005   | Backup: validated JSON export, replace-import, atomic restore, persistent-storage request                                           | Done (see PHASE-005.md) |
| 006   | Protected time planning beyond today; coding/learning and fitness views on habits                                                   | Next                    |
| later | Money/business experiments; theme switcher; committed E2E suite; offline PWA; optional sync (only with a documented security model) | Unscheduled             |

## PHASE 006 starting point

Protected time beyond today, and category views on habits:

1. **Protected time for the week ahead.** `ProtectedTimeRepository` already takes any
   date (`watchForDate`).
   - Add a small date-range watch for the next 7 days.
   - Add a compact "This week" view: plan dinner on Friday, a rest block on Sunday.
   - It must never show completion, counts or "missed" (ADR-021).
2. **Coding/learning and fitness views on Rhythm.** Filter the existing grid by
   category (the categories already exist) instead of new screens. Keep ADR-024/025
   levels, and never a relationship category (ADR-013).
3. **Keep backups whole.** Any new store or field must appear in the backup envelope,
   in `STORE_NAMES`, and in import validation, and needs a schema bump plus a
   `migrateSnapshot` step if records change.
4. **Carry-overs:**
   - undo for Clear, Drop, protected-time Remove and clearing a habit day;
   - global keyboard shortcuts;
   - a committed browser E2E suite;
   - an explicit "Send next action to Tasks";
   - encrypted backups (evaluate first).
