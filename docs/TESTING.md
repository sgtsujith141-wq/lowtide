# Testing

## Tools

- **Vitest 5** with the **jsdom** environment (configured in `vite.config.ts`).
- **React Testing Library** + `@testing-library/jest-dom` matchers.
- **`@testing-library/user-event`** (added in PHASE 001) for realistic typing and key
  combinations (Enter, Shift+Enter, Cmd/Ctrl+Enter, Escape). IME cases use `fireEvent`
  because user-event can't simulate composition.
- **fake-indexeddb** — an in-memory, spec-compliant IndexedDB, loaded in
  `src/test/setup.ts` via `fake-indexeddb/auto`. jsdom has no IndexedDB; this lets
  tests run real Dexie code (transactions, unique indexes, rollback) instead of mocks.
  It is the only extra test dependency added for persistence.

## Running

```bash
npm test              # watch mode
npm test -- --run     # single run (CI style)
npm run check         # everything, including tests
```

## Conventions

- Tests live in `src/test/` and are named `*.test.ts(x)`.
- `setupTestDatabase()` (`src/test/helpers.ts`) returns a factory for a fresh, uniquely
  named database per test and deletes it afterwards — no shared state between tests.
- `steppingClock()` gives deterministic timestamps (starts at a fixed instant, +1 min
  per call) for asserting exact `createdAt`/`completedAt` values.
- Test behaviour through repository interfaces, not Dexie internals, except for
  database-level guarantees (versions, unique indexes).
- Prefer accessible queries (`getByRole`, `getByText`) in component tests. Scope text
  queries to a list/region: the screen-reader announcer repeats titles ("Added: …").
- `renderApp(path, repositories)` (`src/test/render.tsx`) renders the real app (shell +
  routes) with a memory router, **awaits the lazily loaded screen's `h1`**, and returns
  a `user-event` instance. Always `await` it.
- `testTimeout` stays at 15 s (`vite.config.ts`) and must not be raised further; if tests
  time out on a responsive machine, investigate the specific test. PHASE 004's runs had
  no timeouts (full check ≈ 20 s, tests ≈ 8 s).
- `testTimeout` is 15 s (`vite.config.ts`). On this machine, cold starts after a stall
  pushed the first lazy-screen render and the first ESLint run past the 5 s default.
- Date rollover is tested with Vitest fake timers (`use-today.test.tsx`); nothing else
  uses fake timers, since Dexie and user-event rely on real ones.
- Today UI tests seed data relative to the real current date (`toLocalDate(new Date())`).
- The migration test builds a database with a bare Dexie V1 definition (`STORES_V1`),
  exactly as an older build would, then opens it with the current `LowtideDatabase`.
- To test failure handling, spread the real repositories and replace one method with a
  rejecting `vi.fn()`. Components only know the interfaces, so this needs no mocking of
  Dexie.
- `recordWatch(watch)` records every emission of a repository `Watch`; `until(pred)`
  waits for the latest emission to satisfy a condition.
- Deadline tests set `process.env.TZ` at runtime (Node honours it immediately) to check
  behaviour across time zones and DST, and restore it afterwards (deleting the key if
  it was unset).
- `setupTestDatabase` unmounts rendered trees before deleting the database, so no live
  subscription outlives it.

## Current coverage (PHASE 004): 24 files, 278 tests

| File                                | Tests | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migration-v3.test.ts`              | 8     | **a genuine V2 database (legacy timestamp, missing, already-local and malformed hackathon dates, plus tasks with `plannedFor`, habits, entries, protected time) opens at V3**: timestamps become their UTC date, absent stays absent, local dates kept, malformed values moved to notes, all other records unchanged and schema-valid, indexes intact and range-queryable; pure-function cases for offset timestamps, impossible dates, end-before-start, no input mutation                                                                                                                                                                                                                              |
| `hackathon-repository.test.ts`      | 8     | minimal create with defaults; full create trimming and omitting blanks; blank name, impossible or timestamp dates, end-before-start and end-without-start rejected, writing nothing; one-day event and independent deadline allowed; update keeps id/createdAt, bumps updatedAt, clears with null/blank, re-validates ranges, missing → `RecordNotFoundError`; finished/dropped keep everything; watchAll order and reactivity; **no habits, entries or tasks created**                                                                                                                                                                                                                                  |
| `hackathon-schedule.test.ts`        | 31    | registration and event wording at every boundary; resolved registration says nothing; range formatting incl. month/year boundaries; ordering (upcoming, undated, past), registered deadlines ignored, deterministic ties under reordering, primary line; **Today: due today, overdue unresolved, resolved ignored, today/now/≤7 days shown, 8+ hidden, ended hidden, finished/dropped/rejected hidden, two reasons → one row, max 3 with a count**                                                                                                                                                                                                                                                       |
| `hackathons-page.test.tsx`          | 12    | calm empty state; quick add (name + date, no big form) with focus on the new sheet; name and range errors associated with fields; full edit incl. deadline, problem statement, team, next action, notes, status; **quick status selects keep focus and stay enabled**; next action added and edited in place, Escape cancels; finishing moves to Past (focus to its summary) and reopening brings it back; ordering; failed save surfaced; **Today: one row with both reasons and the next action, distant/finished hidden, no controls, link to /hackathons; section absent when nothing is relevant; capped at 3 with "See all"**; **the habit repository is a trap that throws, and is never called** |
| `habit-repository.test.ts`          | 12    | create (trim, optional target); rejects blank name, unknown or relationship category, a target on a check habit, non-positive/NaN/∞ targets, fractional count targets; update and clear target (unit-aware error); **archive keeps entries, blocks logging, restore works**; watchAll includes archived and reacts; log check/count/minutes; **upsert keeps id and createdAt, one row**; unique index rejects a raw duplicate; unit value rules (0, 2, −1, 1.5, 1441, NaN rejected, nothing written); clear removes (idempotent; missing habit rejected); days and habits independent; **watchEntries is range-inclusive and reacts to set/update/clear**                                                |
| `calendar.test.ts`                  | 8     | month/year boundaries; leap days (2028 has 366 days); Monday-first weekdays; impossible dates rejected; **a full year in London, New York, Sydney and Kolkata has 365 unique consecutive days, including DST change days**                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `rhythm-logic.test.ts`              | 33    | per-habit level for no entry, check, every target band boundary (1/14/15/29/30/59/60/240 min), count targets, no-target = 2; overall bands incl. one extreme entry capped at 2; grid = 26 Monday-first weeks ending today with no future days and unique dates; empty days level 0 with "nothing recorded"; text labels for overall and single views; archived history in both views; deterministic under reordering; **entries of unknown habits (e.g. protected time) ignored**; month labels; year-boundary and leap-day ranges; value wording; **relationship-type categories absent from habits, present in protected time**                                                                        |
| `rhythm-page.test.tsx`              | 12    | calm empty state without grid or scoring words; create via the form (target only for amounts; focus to the new row; creating records nothing); name/target validation errors; check toggle via `aria-pressed` and square label; minutes log, edit (light→high in habit view) and clear; **save on leaving the field**; invalid count keeps the text with an associated error; failed save surfaced; archive keeps history (overall and archived view) and restore; edit never changes the unit; **grid is one tab stop, arrows/Home/End move focus, the detail line follows**; 7 rows and ~26 weeks of cells                                                                                             |
| `database.test.ts`                  | 4     | default name; opens at `SCHEMA_VERSION` (2) with all six stores; one entry per habit per day; data survives close/reopen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `migration.test.ts`                 | 3     | **a V1-built database opens at V2 with every task/inbox record unchanged and schema-valid; `plannedFor` absent; the new index works for migrated tasks; tasks keeps its V1 indexes plus only `plannedFor`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `schema.test.ts`                    | 8     | record validation incl. `undefined`/`null` optionals; relationships never a habit category; `plannedFor` optional and must be a real `YYYY-MM-DD` (no timestamps, no Feb 29 in non-leap years)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `time.test.ts`                      | 10    | UTC timestamps; local days; invalid dates rejected; UTC-noon deadlines keep their day across zones up to 17 h apart and DST                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `task-repository.test.ts`           | 24    | create/update/complete/reopen/drop semantics and errors; watches; **planFor/removeFromPlan never touch `dueAt` and vice versa; invalid date, closed and missing tasks rejected; `plannedFor` kept through complete/reopen and never invented; `watchForDay` returns exactly the open planned/due/overdue tasks once each and reacts to plan/unplan/complete**                                                                                                                                                                                                                                                                                                                                            |
| `inbox-repository.test.ts`          | 9     | capture, atomic convert with rollback, markProcessed, watches                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `protected-time-repository.test.ts` | 6     | create (trim, blank notes omitted); rejects blank title, invalid date, unknown kind; update incl. clearing notes; remove (and missing → `RecordNotFoundError`); `watchForDate` returns only that day, ordered, and reacts (incl. moving to another day); relationship/family/friends kinds kept and absent from habit categories                                                                                                                                                                                                                                                                                                                                                                         |
| `task-logic.test.ts`                | 16    | deadline labels, open-task order, task drafts, relative times                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `today-logic.test.ts`               | 13    | `composeToday`: overdue and due-today → attention; planned today → plan; **due-and-planned shown once (under attention)**; future deadlines, other days' plans, closed and unrelated tasks hidden; deterministic order regardless of input order; `planCandidates`; plan labels                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `use-today.test.tsx`                | 1     | `useToday` rolls over just after midnight, and again a day later (fake timers)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `storage-boundary.test.ts`          | 12    | the ESLint storage boundary fires / allows as intended                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `app.test.tsx`                      | 8     | shell landmarks; nav Today/Inbox/Tasks/Rhythm/Hackathons; Today at `/` with capture focused and title set; `aria-current`; skip link; unknown route; **each lazy screen (incl. Rhythm and Hackathons) loads; prefetch doesn't throw**                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `capture.test.tsx`                  | 8     | all PHASE 001 capture guarantees (the retry test waits for the error to clear; racy assertion fixed in PHASE 004), now on Today (inbox link updates live)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `inbox-page.test.tsx`               | 7     | inbox listing, Make task, Clear, focus, errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `tasks-page.test.tsx`               | 11    | create/edit/complete/drop/reopen, deadlines, errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `today-page.test.tsx`               | 12    | Today layout and empty states; overdue/due-today shown, future not; **plan from the picker in two clicks (plannedFor set, dueAt untouched), take out of plan (task kept, focus to section)**; Escape closes the picker and returns focus; due+planned shown once and stays after unplanning; completing leaves Today and keeps `plannedFor` in history; failed plan change surfaced; capture works on Today; **protected time add/edit/remove by keyboard with focus handling; no checkbox, no complete/done control, no goal/streak/target wording**; title required with an associated error; Escape cancels; only today's entries shown; failed save keeps the form                                   |

## Browser smoke checks

There is still no committed end-to-end suite. Each phase so far ran a throwaway
Playwright script from a temporary directory (not a project dependency) against the
**production build** (`vite preview`) in headless Chromium.

PHASE 002 run (details in `docs/phases/PHASE-002.md`):

- Today at `/`;
- capture persists;
- a due-today task shows under Needs attention, a future one doesn't;
- plan it, then take it out of the plan (still in Tasks), then plan it again;
- protected relationship and rest time;
- reload keeps everything;
- completing a task removes it from Today, even after reload;
- only the entry, Today and shared chunks load first; the rest arrive by prefetch;
- no overflow at 1280, 360 and 320 px, light and dark;
- no console errors or warnings;
- no non-localhost requests.

PHASE 004 run (details in `docs/phases/PHASE-004.md`):

- `/hackathons` empty state, quick add, registration deadline, status selects,
  problem statement, team, next action, a multi-day event;
- ordering across five hackathons;
- finishing one → Past;
- Today shows the two near-term ones (one row each) and hides a 10-day-away one;
- reload persistence; keyboard;
- nav and page overflow 0 at 1280/360/320 px, light and dark;
- no console errors or warnings;
- no non-localhost requests.

PHASE 003 run (details in `docs/phases/PHASE-003.md`):

- `/rhythm` empty state;
- create Coding (minutes, target 60), log 30 then 60, with square labels and levels
  checked;
- create Gym (check) and toggle it;
- overall and per-habit levels;
- archive Gym, with its history still shown in the archived view;
- reload persistence;
- keyboard: one tab stop, arrow moves, Tab leaves the grid;
- no page overflow at 1280, 360 and 320 px (the grid scrolls inside its own box,
  starting at the newest weeks), light and dark;
- no console errors or warnings;
- no non-localhost requests.

Chromium's accessibility tree also revealed run-together words that jsdom's text
matching had hidden (fixed).

PHASE 001's run caught a capture race; PHASE 002's unit tests caught three
focus-timing bugs before the browser run.

## Known gaps

- fake-indexeddb is not a real browser engine; quota, eviction and private-mode
  behaviour are untested.
- No migration tests yet (there is only version 1).
- No coverage thresholds configured.
- `field-sizing: content` (auto-growing composer) and `<input type="date">` rendering
  are only exercised in Chromium; Safari/Firefox untested.
- No automated accessibility audit (axe) yet; checks are by role/label/description
  queries and manual screenshot review.
