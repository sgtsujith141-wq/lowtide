# Roadmap

Phases are small and each ends with a phase report in `docs/phases/`. Scope after
PHASE 001 is provisional and will be revised as the app is used.

| Phase | Goal                                                                                                                                | Status                  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 000   | Foundation: toolchain, tokens, routing, Dexie DB, repository boundary, types, tests, docs                                           | Done (see PHASE-000.md) |
| 001   | App shell + brain dump capture + inbox processing + tasks + reactive data                                                           | Done (see PHASE-001.md) |
| 002   | Today view: what's due/open today, protected time for today, quick capture                                                          | Done (see PHASE-002.md) |
| 003   | Habits + daily logging + GitHub-style activity squares                                                                              | Next                    |
| 004   | Hackathons tracker (registration / PPT / build / next action / deadlines)                                                           | Planned                 |
| 005   | Protected time planning; coding/learning and fitness consistency views on habits                                                    | Planned                 |
| 006   | Export / import (validated JSON backup), persistent-storage request                                                                 | Planned                 |
| later | Money/business experiments; theme switcher; committed E2E suite; offline PWA; optional sync (only with a documented security model) | Unscheduled             |

## PHASE 003 starting point

1. `HabitRepository` + `HabitEntryRepository` following ADR-015 (watches, not
   reloads). Enforce one entry per habit per local day; the unique `[habitId+date]`
   index already exists in V1, so no schema bump is needed for that.
2. `src/features/habits/`: a compact habits list with a one-tap log for today. Today may
   gain a small "Habits" line only if it stays calm.
3. Activity squares: a plain grid of `LocalDate`s coloured by logged value. No streak
   counters, no "missed" shaming, and never for relationships (ADR-013, ADR-021).
4. Carry-overs worth taking early:
   - undo for Clear, Drop and protected-time Remove;
   - global keyboard shortcuts;
   - a committed browser E2E suite.
