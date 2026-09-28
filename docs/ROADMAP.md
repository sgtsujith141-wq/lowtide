# Roadmap

Phases are small and each ends with a phase report in `docs/phases/`. Scope after
PHASE 001 is provisional and will be revised as the app is used.

| Phase | Goal                                                                                                                                | Status                  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 000   | Foundation: toolchain, tokens, routing, Dexie DB, repository boundary, types, tests, docs                                           | Done (see PHASE-000.md) |
| 001   | App shell + brain dump capture + inbox processing + tasks + reactive data                                                           | Done (see PHASE-001.md) |
| 002   | Today view: what's due/open today, protected time for today, quick capture                                                          | Next                    |
| 003   | Habits + daily logging + GitHub-style activity squares                                                                              | Planned                 |
| 004   | Hackathons tracker (registration / PPT / build / next action / deadlines)                                                           | Planned                 |
| 005   | Protected time planning; coding/learning and fitness consistency views on habits                                                    | Planned                 |
| 006   | Export / import (validated JSON backup), persistent-storage request                                                                 | Planned                 |
| later | Money/business experiments; theme switcher; committed E2E suite; offline PWA; optional sync (only with a documented security model) | Unscheduled             |

## PHASE 002 starting point

1. Add `src/features/today/` and make Today the first nav item. Keep capture one
   keystroke away; the composer can be reused as it is.
2. Today = open tasks due today or overdue (`describeDeadline` tones) plus today's
   protected time. That needs a `ProtectedTimeRepository` with a
   `watchForDate(localDate)`-style watch, following ADR-015.
3. Carry-overs from PHASE 001 worth doing early:
   - global keyboard shortcuts (e.g. focus capture from anywhere);
   - an undo for Clear/Drop;
   - route-level code splitting (the bundle is 497 kB, just under Vite's warning);
   - a committed browser E2E suite.
