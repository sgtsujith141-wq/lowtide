# Roadmap

Phases are small and each ends with a phase report in `docs/phases/`. Scope after
PHASE 001 is provisional and will be revised as the app is used.

| Phase | Goal                                                                                                                                | Status                  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 000   | Foundation: toolchain, tokens, routing, Dexie DB, repository boundary, types, tests, docs                                           | Done (see PHASE-000.md) |
| 001   | App shell (navigation, layout, keyboard shortcuts) + Inbox capture and processing + Tasks list                                      | Next                    |
| 002   | Today view: what's due/open today, protected time for today, quick capture                                                          | Planned                 |
| 003   | Habits + daily logging + GitHub-style activity squares                                                                              | Planned                 |
| 004   | Hackathons tracker (registration / PPT / build / next action / deadlines)                                                           | Planned                 |
| 005   | Protected time planning; coding/learning and fitness consistency views on habits                                                    | Planned                 |
| 006   | Export / import (validated JSON backup), persistent-storage request                                                                 | Planned                 |
| later | Money/business experiments; theme switcher; committed E2E suite; offline PWA; optional sync (only with a documented security model) | Unscheduled             |

## PHASE 001 starting point

1. Add `src/features/inbox/` and `src/features/tasks/`.
2. Replace `FoundationScreen` with an app shell in `src/app/` and routes `/` (Today
   placeholder or Inbox), `/inbox`, `/tasks`.
3. Extend `InboxRepository` (e.g. discard/mark processed without converting) and
   `TaskRepository` (update, reopen, drop, list by project) only as screens need them.
4. Decide how components react to data changes (e.g. expose Dexie `liveQuery`
   through the repository layer) — record it as an ADR.
