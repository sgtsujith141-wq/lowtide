# Roadmap

Phases are small and each ends with a phase report in `docs/phases/`. Scope after
PHASE 001 is provisional and will be revised as the app is used.

| Phase | Goal                                                                                                                                | Status                  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 000   | Foundation: toolchain, tokens, routing, Dexie DB, repository boundary, types, tests, docs                                           | Done (see PHASE-000.md) |
| 001   | App shell + brain dump capture + inbox processing + tasks + reactive data                                                           | Done (see PHASE-001.md) |
| 002   | Today view: what's due/open today, protected time for today, quick capture                                                          | Done (see PHASE-002.md) |
| 003   | Rhythm: habits, daily logging, contribution-style activity squares                                                                  | Done (see PHASE-003.md) |
| 004   | Hackathons tracker (registration / PPT / build / next action / deadlines)                                                           | Next                    |
| 005   | Protected time planning; coding/learning and fitness consistency views on habits                                                    | Planned                 |
| 006   | Export / import (validated JSON backup), persistent-storage request                                                                 | Planned                 |
| later | Money/business experiments; theme switcher; committed E2E suite; offline PWA; optional sync (only with a documented security model) | Unscheduled             |

## PHASE 004 starting point

1. `HackathonRepository` over the existing `hackathons` store (V1 already has `status`,
   `registrationDeadline` and `eventStart` indexes), following ADR-015 watches.
   Decide first whether its deadlines are date-only (reuse ADR-016's UTC-noon
   convention) or real instants (registration closes at a time).
2. `src/features/hackathons/` as a lazy route: a compact list by status with the next
   action visible, and registration/PPT/build status editing.
3. Surface hackathon deadlines on Today's Needs attention only if they fit ADR-020's
   one-place-per-item rule.
4. **Consider pulling export/backup (006) forward.** With tasks, protected time and
   habit history now stored only in one browser profile, losing that profile loses
   everything (SECURITY.md).
5. Carry-overs:
   - a small undo for Clear, Drop, protected-time Remove and clearing a habit day;
   - global keyboard shortcuts;
   - a committed browser E2E suite;
   - an optional compact "Rhythm today" line on Today.
