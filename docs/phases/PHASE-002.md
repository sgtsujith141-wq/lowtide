# PHASE 002 — Today and protected time

- **Date:** 2026-09-28
- **Status:** Complete (see "Tests actually run" and "Browser checks actually run")
- **Starting point:** `9955d4f` (verified: local `HEAD` = `origin/main`, clean tree)
- **Commits:**
  - `d6d1b41` — `feat(data): today planning (schema v2) and protected time repository`
  - `da511a8` — `perf(time): drop date-fns from the data layer's date helpers`
  - `6884ce2` — `feat(today): Today page, protected time, and per-screen code splitting`
  - a follow-up `docs(phase-002): …` commit containing this report. It can't record its
    own SHA; find it with `git log --oneline -- docs/phases/PHASE-002.md`.

Each code commit was checked on its own with `npm run check` before committing, with
the rest of the working tree stashed.

## Objective

A calm Today page that shows at a glance:

- what needs attention;
- what you chose to work on;
- what time you've kept for people and rest;
- where to dump a thought.

## Scope

**In:**

- Today at `/`, replacing Home;
- `Task.plannedFor` with schema V2;
- planning from Today;
- `ProtectedTimeRepository` and its Today UI;
- route-level code splitting;
- tests and docs.

**Out (deliberately):**

- habits, activity squares, hackathons, money, fitness;
- analytics and calendars;
- time-of-day blocks;
- previous/next-day navigation;
- undo.

## Files created

- **Data:** `src/db/repositories/dexie-protected-time-repository.ts`
- **Today:** `src/features/today/`: `TodayPage.tsx`, `compose.ts`, `PlanPicker.tsx`,
  `ProtectedTimeSection.tsx`, `ProtectedTimeForm.tsx`, `SectionHeading.tsx`,
  `protected-time-kinds.ts`
- **Tasks (shared with Today):** `src/features/tasks/TaskLine.tsx`,
  `src/features/tasks/planning.ts`
- **Tests:** `src/test/`: `migration.test.ts`, `protected-time-repository.test.ts`,
  `today-logic.test.ts`, `today-page.test.tsx`, `use-today.test.tsx`
- **Docs:** `docs/phases/PHASE-002.md`

## Files modified

- **Data:** `src/types/domain.ts`, `src/db/schema.ts`, `src/db/database.ts`,
  `src/db/repositories/{types,index,dexie-task-repository}.ts`, `src/lib/time.ts`
- **App:** `src/app/{routes,Shell}.tsx`, `src/main.tsx`
- **UI:** `src/components/ui/Button.tsx` (accepts `ref`),
  `src/features/inbox/CaptureComposer.tsx` (label is an `h2`, 2 rows),
  `src/features/tasks/TaskRow.tsx` (built on `TaskLine`)
- **Tests:** `src/test/`: `render.tsx` (async, awaits lazy screens), `app`, `capture`,
  `inbox-page`, `tasks-page`, `schema`, `task-repository`
- **Docs:** `README.md` and `docs/`: `ARCHITECTURE`, `DATA-MODEL`, `DECISIONS`,
  `PRODUCT`, `ROADMAP`, `CHANGELOG`, `TESTING`, `SECURITY`. `SETUP.md` is unchanged
  because setup didn't change.

**Deleted:** `src/features/home/HomePage.tsx`. Today replaces it; there's no redundant
Home route.

## Today UX decisions

- **Order, top to bottom:**
  1. "Today" and the full local date.
  2. The existing brain-dump composer, reused unchanged except for a quieter `h2`
     label and 2 rows.
  3. "N thoughts waiting in your inbox", only when there are some. It's a link, not a
     badge.
  4. Needs attention.
  5. My plan.
  6. Protected time.
- **Sections are lines, not cards:** a small muted heading with a rule, then one- or
  two-line rows.
- **Empty states are one plain line** and are shown rather than hidden, because
  "nothing pressing" is itself the answer: "Nothing pressing today.", "Nothing else
  planned.", "Nothing protected yet."
- **De-duplication (ADR-020):** a task due or overdue _and_ planned today appears once,
  under Needs attention, with an "In today's plan" note. My plan leaves out anything
  already shown above.
- **Planning is two clicks:**
  - "Add from Tasks" opens a picker of open tasks not already on Today, ordered by
    deadline, priority, then age. Each row has "Plan for today".
  - The picker stays open so several tasks can be planned in a row. Focus moves to the
    next candidate, or back to the toggle when none are left.
  - Escape closes the picker and returns focus to the toggle.
- **Taking a task out of the plan** ("Take out of today's plan", a calendar-minus icon
  with a name and tooltip) clears `plannedFor` only. The task stays in Tasks, and a
  due task stays under Needs attention.
- **Completing from Today** works as in Tasks. The task leaves Today (active views
  exclude closed tasks) and keeps its `plannedFor` in history.
- **Focus:** after completing or unplanning, focus moves to the section heading
  (`tabIndex=-1`), so keyboard users stay in place.
- **No date navigation:** previous/next day was skipped to keep Today about today.
- **Midnight rollover:** `useToday` rolls the date over just after local midnight, and
  every Today watch re-keys to the new day.

## Protected-time UX decisions

- Shown as **margin notes**: a left accent rule, a kind icon (heart, house, people,
  moon, leaf), the title, then "Kind · note". There are no row rules, so it doesn't
  read as a to-do list.
- **"Protect time"** opens an inline form:
  - "What's it for?" with the placeholder "Dinner together, call home, do nothing…";
  - Kind: Relationship, Family, Friends, Rest or Personal;
  - Note (optional).
- Enter saves and Escape cancels. A missing title shows "Give it a short title.",
  associated with the field.
- **Edit is inline; Remove deletes.** There's no confirmation because it's your own
  plan and trivially re-added. Undo is postponed.
- **No completion semantics anywhere:**
  - no checkbox, no done or complete button, no counts;
  - no goal, streak or target wording (tested).
- **Ordering:** within a day, entries are ordered by title, since the model has no time
  of day.

## Repository / API changes

`TaskRepository`:

- `planFor(id, day)`: open tasks only; `RecordStateError` otherwise.
- `removeFromPlan(id)`: any status.
- `watchForDay(day)`: open tasks planned for `day` or due on or before it. It uses the
  `plannedFor` and `dueAt` indexes and unions the two results by id.

`ProtectedTimeRepository` (new):

- `create`, `update`, `remove` (missing → `RecordNotFoundError`), `watchForDate(date)`.

Other changes:

- New types: `NewProtectedTime`, `ProtectedTimeChanges`.
- `Repositories` gains `protectedTime`.
- No generic query API was added, and Dexie types still don't cross the interface.

## Schema V2 migration

- `SCHEMA_VERSION` changed from 1 to 2.
- `STORES_V2 = { tasks: 'id, status, dueAt, createdAt, plannedFor' }` is appended as
  `this.version(2).stores(STORES_V2)`. `STORES_V1` and `version(1)` are unchanged.
- **Exact behaviour when a V1 database opens:**
  - Dexie runs the version-2 step, which adds the `plannedFor` index to the `tasks`
    store.
  - IndexedDB builds the index from existing records. None have the field, so it
    starts empty.
  - No record is read-modified-written, no other store or index changes, and there is
    no `upgrade()` function.
  - V1 tasks validate against the V2 `taskSchema` as they are, because `plannedFor`
    is `exactOptional(localDate)`.
- **Proof:** `migration.test.ts` creates a database with a bare Dexie V1 definition,
  seeds tasks (open and done) and an inbox item, then reopens it with
  `LowtideDatabase`. It checks:
  - `verno` is 2;
  - records are unchanged and schema-valid;
  - `plannedFor` is absent;
  - `planFor` and index queries work on migrated tasks;
  - the task indexes are exactly the V1 ones plus `plannedFor`.

## Architecture decisions

- **ADR-019 — `plannedFor`:** a `LocalDate` independent of `dueAt`. It's kept after
  completion, never invented on reopen, and never carried over.
- **ADR-020 — Today composition:** one day watch feeds the pure `composeToday`.
  Deadlines take precedence, and nothing is shown twice.
- **ADR-021 — Protected time:** entries are plans, with no status or scoring.
- **ADR-022 — Code splitting:** per-screen `lazy` routes with idle prefetch, and
  date-fns removed from the data layer.

## Route splitting decision

React Router's own `lazy` route property, so no new dependency and no loading-screen
system:

- `prefetchScreens()` runs through `requestIdleCallback`, or a 200 ms timeout where that
  isn't available.
- `HydrateFallback` renders nothing for the first local chunk load.
- During later navigations, React Router keeps the current screen until the next one is
  ready, so focus doesn't jump.

In the browser run, the first load fetched the entry plus the Today, shared-format and
`TaskLine` chunks; the Inbox and Tasks chunks arrived by prefetch.

## Bundle / chunk measurements (`npm run build`, real output)

| Chunk                               | Before (PHASE 001)      | After                       |
| ----------------------------------- | ----------------------- | --------------------------- |
| entry `index-*.js`                  | 497.24 kB (154.80 gzip) | **440.62 kB (140.84 gzip)** |
| `TodayPage`                         | —                       | 14.31 kB (5.03 gzip)        |
| `TasksPage`                         | —                       | 9.29 kB (3.33 gzip)         |
| `InboxPage`                         | —                       | 3.02 kB (1.34 gzip)         |
| `TaskLine` (shared)                 | —                       | 3.63 kB (1.71 gzip)         |
| `format` (date-fns display, shared) | —                       | 20.89 kB (6.30 gzip)        |
| `when` (shared)                     | —                       | 0.42 kB                     |
| CSS                                 | 20.59 kB                | 21.37 kB                    |

The `da511a8` commit alone (before splitting) took the single chunk from 497.24 kB to
479.12 kB. Most of the entry is framework baseline: react-dom, React Router, Zod and
Dexie.

## Dependencies

None added and none removed. date-fns is still used, now only by feature chunks.

## Tests actually run

All on 2026-09-28, Node 24.19.0, macOS.

| Command                                        | Result                                            |
| ---------------------------------------------- | ------------------------------------------------- |
| `npm test -- --run` during development         | failures found and fixed (see Bugs), then passing |
| `npm run check` on `d6d1b41` alone             | pass: 13 files, 122 tests, build OK               |
| `npm run check` on `da511a8` alone             | pass: 13 files, 122 tests, build 479.12 kB        |
| `npm run check` on the full tree (= `6884ce2`) | pass: **16 files, 152 tests**, build OK           |

Per-file counts are in `docs/TESTING.md`.

## Browser checks actually run

Headless Chromium (Playwright in a scratch directory, not a project dependency) against
`vite preview` of the production build:

| #   | Check                                                                                                        | Result                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 1   | `/` opens Today                                                                                              | yes; the composer is focused                                                                                      |
| 2   | Quick capture saves and persists                                                                             | box cleared; the "1 thought waiting in your inbox" link appeared and survived reload                              |
| 3   | Task due today → Needs attention                                                                             | yes                                                                                                               |
| 4   | Future task doesn't appear automatically                                                                     | 0 matches on Today                                                                                                |
| 5   | Add the future task to today's plan                                                                          | appeared under My plan                                                                                            |
| 6   | Take it out of the plan                                                                                      | left My plan; still in Tasks (then planned again for step 8)                                                      |
| 7   | Protected time: relationship ("Dinner together", with a note) and rest ("Do absolutely nothing for an hour") | both shown; 0 checkboxes in the section                                                                           |
| 8   | Reload                                                                                                       | attention 1, plan 1, protected 2, inbox link 1                                                                    |
| 9   | Complete the due task on Today                                                                               | left Today; still gone after reload; listed under Finished in Tasks                                               |
| 10  | Layout                                                                                                       | horizontal overflow 0 px on Today, Inbox and Tasks at 1280 (light and dark), 360 (light and dark) and 320 (light) |
| 11  | Light and dark                                                                                               | screenshots reviewed                                                                                              |
| 12  | Console                                                                                                      | no errors or warnings                                                                                             |
| 13  | Network                                                                                                      | **no requests to non-localhost hosts**                                                                            |

The design review then led to one change: protected-time rows lost their bottom rules so
they read as notes, not tasks. The whole run was repeated after that change, with the
same results.

**Not tested:** Safari, Firefox, real phones, screen readers, and a real midnight
rollover in a browser (rollover is unit-tested with fake timers).

## Bugs found

1. **Focus races.** Three new tests failed: after planning from the picker, and after
   adding or saving protected time, focus was moved on `requestAnimationFrame`. That
   could fire before the live query re-rendered, landing focus on a stale button or
   closing the picker when the list looked empty.
2. **Escape didn't close the picker** when focus was on its toggle; only the list
   handled Escape.
3. **The React hooks linter** rejected passing heading refs into a render-time helper.
4. **A second `banner` landmark.** The Today page used `<header>` inside `<main>`, and
   the test environment reported it as a banner.
5. **ESLint `react-refresh`** flagged a fallback component declared in `routes.tsx`.
6. **Test-side:**
   - lazy screens meant tests queried before the screen existed (13 failures), so
     `renderApp` now awaits the screen's `h1`;
   - one app-test replacement silently didn't apply;
   - two queries matched screen-reader announcements or the picker list.

## Bugs fixed

1. Focus now moves in an effect keyed on the watched data (the pattern InboxPage already
   used): the next candidate or the toggle, and the entry's Edit button after saving.
2. Escape is handled on the whole picker.
3. Headings are focused by `id` from the handler.
4. The page heading block is a `div`.
5. The fallback is an inline `() => null`.
6. `renderApp` is async and awaits the lazy screen; the test edits were re-applied with
   asserted replacements; the queries were scoped (assert on "Complete: …" buttons,
   exact text in the browser script).

## Known limitations

- **No carry-over.** A task planned for an earlier day and not finished doesn't appear
  on Today. It's still in Tasks and offered by the picker. This is deliberate, but it
  means an unfinished plan quietly disappears.
- **No date navigation.** Protected time and plans can only be added for today from the
  UI; the repository supports any date.
- **Protected time** has no time of day and is ordered by title.
- **No undo** for Remove (protected time), Clear (inbox) or Drop. Undo was postponed to
  keep this phase about Today; a small undo is suggested early in PHASE 003.
- **Tasks screen:** it shows plan labels, but you can't plan from it; planning happens
  on Today.
- **Relative-time labels** ("just now") refresh on the next data change or navigation;
  the date line and sections roll over at midnight.
- **Bundle:** the entry is still 441 kB of framework baseline.

## Security / privacy notes

- Still local-only: no analytics, telemetry, external APIs or network sync. Verified
  again in the browser run.
- **Protected-time entries may be sensitive** (names, relationships, notes). They're
  stored unencrypted in IndexedDB like everything else; `SECURITY.md` now says so
  explicitly. Removing one deletes it from IndexedDB, but that isn't secure erasure.
- All user text is rendered as React text. There's no `dangerouslySetInnerHTML`
  (staged diffs scanned for it, for network calls and for secrets: none found).
- No dependencies added.

## Next phase

**PHASE 003 — Habits and activity squares.** See
[ROADMAP.md § PHASE 003 starting point](../ROADMAP.md#phase-003-starting-point).
