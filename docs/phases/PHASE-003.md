# PHASE 003 — Rhythm: habits and activity squares

- **Date:** 2026-09-28
- **Status:** Complete (see "Tests actually run" and "Browser verification actually run")
- **Starting point:** `a3dd0d1` (verified: local `HEAD` = `origin/main`, clean tree;
  starting entry chunk 440.62 kB)
- **Commits:**
  - `eaa7fce` — `feat(data): habit repository with per-day upserts and LocalDate calendar maths`
  - `78ad7d6` — `fix(a11y): stop screen readers running adjacent words together`
  - `b540bb8` — `feat(rhythm): habit logging and contribution-style activity grid`
  - a follow-up `docs(phase-003): …` commit containing this report. It can't record its
    own SHA; find it with `git log --oneline -- docs/phases/PHASE-003.md`.

`eaa7fce` and `78ad7d6` were each verified on their own (other changes stashed):
typecheck, lint and tests, plus the build for `eaa7fce`. `b540bb8` is exactly the
tree that passed the full `npm run check`.

## Objective

A habits and consistency system with contribution-style squares that shows "where have
I been showing up?" without guilt, games or scores. Relationships and protected time
never enter it.

## Scope

**In:**

- the `/rhythm` route;
- `HabitRepository`;
- today's logging;
- the overall and per-habit grid;
- archive and restore;
- LocalDate calendar maths;
- tests and docs.

**Out (deliberately):**

- hackathons;
- body or fitness metrics;
- revenue;
- schedules, reminders and notifications;
- GitHub API integration;
- undo;
- a Rhythm line on Today (kept calm; suggested for later).

## Files created

- **Data:** `src/db/repositories/dexie-habit-repository.ts`, `src/lib/calendar.ts`
- **Rhythm:** `src/features/rhythm/`: `RhythmPage.tsx`, `ActivityGrid.tsx`,
  `HabitLogRow.tsx`, `HabitForm.tsx`, `grid.ts`, `intensity.ts`, `levels.ts`, `labels.ts`
- **Tests:** `src/test/`: `habit-repository.test.ts`, `calendar.test.ts`,
  `rhythm-logic.test.ts`, `rhythm-page.test.tsx`
- **Docs:** `docs/phases/PHASE-003.md`

## Files modified

- **Data:** `src/db/repositories/{types,index,errors}.ts`
- **App:** `src/app/{routes,Shell}.tsx`, `src/styles/index.css` (activity tokens)
- **A11y fix:** `src/features/tasks/TasksPage.tsx`, `src/features/today/PlanPicker.tsx`
- **Tests:** `src/test/{app,tasks-page}.test.tsx`, `src/test/render.tsx`,
  `vite.config.ts` (`testTimeout`)
- **Docs:** `README.md` and `docs/{ARCHITECTURE,DATA-MODEL,DECISIONS,PRODUCT,ROADMAP,CHANGELOG,TESTING,SECURITY}.md`.
  `SETUP.md` is unchanged because setup didn't change.

## Repository / API changes

`HabitRepository` (new; `Repositories.habits`):

| Method                                  | Behaviour                                                |
| --------------------------------------- | -------------------------------------------------------- |
| `create(NewHabit)`                      | name, category, unit, optional target                    |
| `update(id, HabitChanges)`              | name, category, `target` (null clears); never the unit   |
| `archive(id)` / `restore(id)`           | toggles `archived`; entries untouched                    |
| `watchAll`                              | every habit, archived included, oldest first             |
| `setEntry(habitId, date, value, note?)` | upsert for (habit, day)                                  |
| `clearEntry(habitId, date)`             | deletes that day's entry if any                          |
| `watchEntries(start, end)`              | all entries with `start ≤ date ≤ end`, one indexed query |

New error: `InvalidInputError` (name chosen to avoid DOMException names, ADR-010). The
missing-record and state rules follow ADR-014.

## Schema / migration status

**No change.** `SCHEMA_VERSION` stays **2**. Everything uses the V1 `habits` and
`habitEntries` stores:

- the unique `[habitId+date]` index for upserts and integrity;
- the `date` index for range reads.

`archived` isn't indexed (booleans can't be IndexedDB keys); active habits are filtered
in memory.

## Habit value semantics (ADR-023)

- **One entry per habit per local day.** `setEntry` looks it up through
  `[habitId+date]`, then creates it or updates `value`, `note` and `updatedAt`, keeping
  `id` and `createdAt`.
- **No entry = no recorded activity.** Clearing deletes the row; zero is never stored.
- **Value rules by unit:**
  - `check`: exactly 1;
  - `count`: a positive whole number;
  - `minutes`: over 0, up to 1440;
  - otherwise `InvalidInputError`, and nothing is written.
- **Targets** are optional and only for `count` and `minutes`: positive, a whole
  number for `count`, and at most 1440 for `minutes`. A target is never required.
- **Archived habits** can't be logged (`RecordStateError`).
- **Only explicit actions** create entries: a tap, Enter, or leaving an amount field
  after typing. Nothing is inferred and nothing is seeded.

## Intensity algorithm (ADR-024)

The level is display-only and never persisted:

| Situation                                  | Level          |
| ------------------------------------------ | -------------- |
| no entry                                   | 0              |
| `check` logged                             | 4              |
| count/minutes with target, share < 25%     | 1              |
| 25% ≤ share < 50%                          | 2              |
| 50% ≤ share < 100%                         | 3              |
| share ≥ 100%                               | 4              |
| count/minutes without a target, any amount | 2 ("recorded") |

## Overall aggregation (ADR-025)

For each day, add up the per-habit levels of every habit with an entry that day,
archived habits included, then band the sum: 0 → 0, 1–3 → 1, 4–7 → 2, 8–11 → 3,
12 or more → 4.

- One fully done habit reads "moderate", two "strong", three or more "high".
- There's no denominator, so adding or archiving a habit never changes past squares.
- One extreme entry can't max out a day, since each habit contributes at most 4.
- Only habit entries count. Tasks, inbox, protected time, money and app usage never
  enter; entries of unknown habit ids are ignored (tested).

## LocalDate / grid generation rules

- `src/lib/calendar.ts` treats a `LocalDate` as a (year, month, day) triple and does
  arithmetic on UTC date fields, where every day is exactly 24 hours. Time zones and
  DST can't skip or repeat a day. This was tested over all of 2026 in London, New York,
  Sydney and Kolkata, and across month, year and leap-day boundaries.
- **The grid** is `gridRange(today)`: 26 weeks starting on the Monday 25 weeks before
  this week's Monday, ending today. Days after today in the current week aren't drawn.
- **Month labels** go on the first column that contains a new month.
- **Days come from the stored date:** an entry's `date` alone decides its square;
  `createdAt` and `updatedAt` never do.

## Activity-grid accessibility (ADR-026)

- The grid is `role="grid"` with 7 `row`s (Monday to Sunday), `gridcell`s per week,
  and an `aria-label` naming the view ("Coding, last six months").
- **Keyboard:** it's a single Tab stop (roving `tabindex`, starting on today). ↑ and ↓
  move by one day, ← and → by one week, Home and End jump to the first day and today.
  Moves past the ends are ignored, and Tab leaves the grid.
- **Text for every square:** each cell has a full label, e.g. "Monday 28 September
  2026: Coding 60 of 60 min, Gym done (strong activity across 2 habits)". A visible
  line under the grid shows the focused or hovered day, so nothing depends on hover.
- **Today** has `aria-current="date"` and a ring.
- A screen-reader-only description explains the shading and the keys. The legend is
  decorative (`aria-hidden`), since the labels carry the meaning.

## Visual design decisions

- **Tokens:** `--lt-activity-0…4` form a muted sea-glass ramp, not GitHub green.
  - light: `#e4ddd0 → #b5d2c9 → #7fb2a7 → #4b8b82 → #285c57`;
  - dark: `#2c2925 → #27403b → #2f6258 → #4f9489 → #93cfc4`;
  - adjacent steps differ by at least 1.19:1 (light) and 1.30:1 (dark), rising
    steadily.
  - The first light ramp had a 1.05:1 first step and was retuned.
- **Squares:** 11 px on phones and 15 px from `sm` up (`--cell`), 3 px gaps, 2 px
  radius. The grid scrolls in its own box on phones and starts scrolled to the newest
  weeks.
- **Page structure:** Rhythm heading and "Where you've been showing up.", then the
  grid with a "Show" selector, then Today's logging rows (a small level square, the
  name, and a toggle or number field), then "Your rhythms" management.
- **No cards and no charts:** lines and quiet headings, like the other screens.
- **Wording avoids** streak, score, missed and perfect. Unlogged days are just the
  quietest square.
- **Nav:** Rhythm uses a waveform icon. Below 420 px the nav hides icons so all four
  labels fit at 320 px.

## Archive behaviour

- Archive removes a habit from Today's logging and the management list, and moves it
  under "Archived · N" with Restore.
- Its entries stay:
  - they still count in the overall grid's history;
  - it stays selectable under "Show → Archived" to view its own squares.
- Archived habits can't be logged until restored. There's no delete.

## Dependencies

None added and none removed. There's no chart or D3 library; the grid is plain React
and CSS.

## Tests actually run

All on 2026-09-28, Node 24.19.0, macOS.

| Command                                                | Result                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `npx vitest run` during development                    | failures found and fixed (see Bugs), then passing                       |
| `eaa7fce` alone: typecheck, lint, tests, build         | pass: 172 tests, build OK                                               |
| `78ad7d6` alone: typecheck, lint, tests                | pass: 172 tests                                                         |
| Full `npm run check` (the tree committed as `b540bb8`) | **pass: typecheck, lint, format, 20 files / 218 tests (7.21 s), build** |

**Honest note on flaky runs.** During the phase the machine stalled several times:

- one run reported tests "taking" about 822 s and a worker failing to start;
- `npm run check` took more than 400–600 s of wall time.

In those runs, between 1 and 12 tests failed on timeouts, mostly the first render of a lazy
screen in each file and the first ESLint call in the boundary test. They passed on
every run once the machine was responsive: 218/218 at about 7 s, many times.

`testTimeout` was raised to 15 s to absorb cold starts. The failing test names from a
stalled `npm run check` weren't captured (that output was filtered), so the claim is
limited to what's stated here.

## Browser verification actually run

Headless Chromium (Playwright in a scratch directory) against `vite preview` of the
production build:

| #   | Check                              | Result                                                                                                                                                                          |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/rhythm` loads                    | yes                                                                                                                                                                             |
| 2   | No habits                          | "Nothing here yet…" shown; no grid                                                                                                                                              |
| 3   | Create Coding (minutes, target 60) | row "Coding · 60 min a day"                                                                                                                                                     |
| 4–5 | Log 30 today                       | square: "Coding 30 of 60 min (light activity across 1 habit)", class `bg-activity-1`                                                                                            |
| 6   | Edit to 60                         | overall "moderate", `bg-activity-2`                                                                                                                                             |
| 7–8 | Create Gym (check), toggle         | `aria-pressed=true`                                                                                                                                                             |
| 9   | Overall with both                  | "Coding 60 of 60 min, Gym done (strong activity across 2 habits)", `bg-activity-3`                                                                                              |
| 10  | Coding only                        | "60 of 60 min (high)", `bg-activity-4`                                                                                                                                          |
| 11  | Archive Gym                        | gone from Today's logging (0); archived view still shows "done (high)"                                                                                                          |
| 12  | Reload                             | overall label unchanged, Coding input 60, "Archived · 1"                                                                                                                        |
| 13  | Layout                             | page overflow 0 px on Rhythm, Today, Inbox and Tasks at 1280 (light and dark), 360 (light and dark) and 320 (light). The grid scroller starts at its end (e.g. 64/64 px at 360) |
| 14  | Light and dark                     | screenshots reviewed                                                                                                                                                            |
| 15  | Keyboard                           | Tab lands on today's square; ←↑ moves to 7 and then 8 days earlier; next Tab leaves the grid; 1 tab stop in the grid                                                            |
| 16  | Console                            | no errors or warnings                                                                                                                                                           |
| 17  | Network                            | **no non-localhost requests**                                                                                                                                                   |

**Design review fixes** (the browser run was repeated after them):

- the amount field had crushed habit names to one letter per line (next section);
- squares were enlarged to 15 px on desktop.

The Gym toggle looked empty in two screenshots. A DOM probe showed it filled
(`aria-pressed=true`, accent background); the screenshots had caught its 140 ms colour
transition.

## Bugs discovered

1. **`update` threw a generic `ZodError`** for a bad target instead of the documented
   `InvalidInputError`, because it validated before the unit-aware target check.
2. **Amount fields relied on implicit form submission** on Enter. That doesn't happen
   in the test environment, and phone number pads often have no Enter key, so values
   could be impossible to save on a phone.
3. **Crushed habit names:** the shared `fieldClass` (`w-full`) overrode the amount
   input's `w-20`, so the input took the whole row and wrapped the name one letter per
   line (seen only in screenshots).
4. **Run-together words for assistive tech:**
   - "CodingCoding · minutes" and "LaundryDone just now";
   - "Coding , minutes today" as the input name;
   - spans were separated only by margin, or split by an absolutely positioned
     `sr-only` span.

   jsdom's text matching hid all of these; Chromium's accessibility tree showed them.
   The Tasks and plan-picker cases date back to PHASE 001 and 002.

5. **Light activity ramp:** the first step was only 1.05:1, too close to tell apart.
6. **Several wrong expectations in my own tests:**
   - the 26-week start date;
   - a sum-7 day is "moderate", not "strong";
   - 20/60 min is "moderate", not "light";
   - leap-year range labels.

   The algorithm was kept; the tests were corrected to match it.

7. **Slow or stalled environment** caused timeouts (see Tests).

## Bugs fixed

1. Target check before parse in `update`.
2. Amounts save on Enter (explicit key handling) and on leaving the field; an invalid
   value keeps the text with an associated error. There's a test for the blur path.
3. `max-w-20 shrink-0` on the amount input.
4. The fixes for run-together words:
   - each secondary span starts with a real space;
   - the input uses an explicit `aria-label`;
   - regression assertions for rhythm rows and Finished rows.
5. The ramp was retuned.
6. Test expectations were corrected to the documented algorithm.
7. `testTimeout` was raised to 15 s, and `renderApp` waits up to 5 s.

## Known limitations

- **No undo** (postponed again to keep this phase about Rhythm). Clearing a day or
  toggling off is one tap to redo.
- **Today:** no Rhythm line yet, by design.
- **Grid range:** fixed at 26 weeks, with no year view and no zoom.
- **Notes:** entry notes are stored by the API but not editable in the UI.
- **No habit delete**, only archive (on purpose).
- **Target-less** amount habits always show level 2 in their own view (by design;
  documented).
- **Browsers:** only Chromium checked. Safari's handling of `field-sizing`, number
  inputs and `requestIdleCallback` wasn't tested.
- **Flakiness:** the intermittent timeout flakiness on a stalled machine is mitigated,
  not root-caused.

## Security / privacy

- **Sensitive data:** habit history can reveal health routines, gym attendance,
  study/work patterns and financial effort, with timestamps. It's stored locally and
  unencrypted in IndexedDB like everything else. SECURITY.md now says so.
- No analytics, telemetry, cloud, trackers or chart libraries; zero non-localhost
  requests in the browser run. No GitHub API.
- Staged diffs were scanned for secrets, network calls and unsafe HTML: none.
- Nothing personal was committed: tests and scripts use invented habits, and the
  screenshots stayed in a scratch directory outside the repository.

## Bundle measurements (`npm run build`, real output)

| Chunk                                              | PHASE 002               | PHASE 003               |
| -------------------------------------------------- | ----------------------- | ----------------------- |
| entry `index-*.js`                                 | 440.62 kB (140.84 gzip) | 443.95 kB (141.82 gzip) |
| `RhythmPage`                                       | —                       | 17.81 kB (6.03 gzip)    |
| `TodayPage`                                        | 14.31 kB                | 14.27 kB                |
| `TasksPage`                                        | 9.29 kB                 | 9.33 kB                 |
| `InboxPage`                                        | 3.02 kB                 | 3.02 kB                 |
| shared `format` (date-fns)                         | 20.89 kB                | 20.89 kB                |
| other shared (`TaskLine`, `useToday`, `when`, `x`) | 4.05 kB                 | 4.30 kB                 |
| CSS                                                | 21.37 kB                | 23.83 kB                |

The entry grew 3.3 kB (the habit repository is part of the data layer). Rhythm UI
code lives entirely in its lazy chunk.

## Next phase

**PHASE 004 — Hackathons tracker.** See
[ROADMAP.md § PHASE 004 starting point](../ROADMAP.md#phase-004-starting-point), which
also suggests weighing export/backup earlier.
