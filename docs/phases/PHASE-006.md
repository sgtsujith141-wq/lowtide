# PHASE 006 — Week-ahead protected time, Rhythm groups, final sweep

- **Date:** 2026-09-28
- **Status:** Complete. **CORE V0.1 ROADMAP COMPLETE.**
- **Starting point:** `b680072` (verified: local `HEAD` = `origin/main`, clean tree)
- **Commits:**
  - `9063b4a` — `feat(protected-time): plan protected time for the week ahead`
  - `dd423d6` — `feat(rhythm): coding & learning and fitness & health activity views`
  - `bbd8617` — `fix(a11y): unique inbox action names and race-free focus after actions`
  - `9b514c6` — `fix(test): wait for effect-driven focus and title instead of racing them`
  - a follow-up `docs(phase-006): …` commit containing this report. It can't record its
    own SHA; find it with `git log --oneline -- docs/phases/PHASE-006.md`.

`9063b4a` and `dd423d6` were each verified on their own, with later changes stashed:
typecheck, lint, all tests (330 and 338) and build. `bbd8617` is the tree that passed the
full `npm run check`.

## Personal-state bootstrap (done before this phase's source work, nothing committed)

The owner's current state went into LOWTIDE through the PHASE 005 pipeline, not
through code:

1. A **safety backup** of the automation profile's database was exported via Data &
   backup. That profile was empty.
2. A **bootstrap backup** was built by a throwaway script kept outside the repository.
   It has fresh UUID v4 ids, real timestamps, protected time dated on the local day of
   execution, **zero habit entries** and no closed tasks.
3. The bootstrap was validated by the real `backup.inspect` and restored through the
   real preview → confirm → atomic-restore UI, in a production build.

Both files are `lowtide-backup-*.json` in the working directory, ignored by
`.gitignore` (verified with `git check-ignore`), and never staged. No seed, fixture,
migration or script with personal data exists in the repository. New test fixtures
were scanned for bootstrap strings, and three generic-sounding names that matched were
renamed.

The owner's Firefox profile holds only the old prototype's database (a different
schema, untouched). Loading the bootstrap into a personal browser means choosing the
file on its Data & backup page.

## Objective

1. Protected-time planning for the next seven days.
2. Coding & learning and Fitness & health views in Rhythm.
3. A final regression, accessibility, responsive and documentation sweep, completing
   the numbered roadmap.

## Scope

**In:**

- `watchRange`;
- the week planner on Today;
- the Day select in the protected-time form;
- Rhythm category groups;
- a backup regression test;
- the accessibility, responsive and performance sweeps and their fixes;
- docs.

**Out:**

- a Money & personal group (optional, not needed);
- new routes or tabs;
- calendars, hours or drag-and-drop;
- body metrics;
- everything under optional future work.

## Files

- **Created:** `src/features/today/week.ts`, `src/test/protected-time-week.test.ts`,
  `src/test/rhythm-groups.test.ts`, `docs/phases/PHASE-006.md`
- **Data:** `src/db/repositories/{types,dexie-protected-time-repository}.ts`
- **Today:** `src/features/today/{ProtectedTimeSection,ProtectedTimeForm,PlanPicker}.tsx`
- **Rhythm:** `src/features/rhythm/{grid.ts,RhythmPage.tsx}`
- **Inbox:** `src/features/inbox/InboxPage.tsx`
- **Tests:** `src/test/{today-page,rhythm-page,inbox-page}.test.tsx`
- **Docs:** `README.md` and `docs/{ARCHITECTURE,PRODUCT,ROADMAP,CHANGELOG,DECISIONS,DATA-MODEL,TESTING,SECURITY}.md`.
  `SETUP.md` is unchanged because setup didn't change.

## Protected-time range design (ADR-035)

`watchRange(start, end)` is one `where('date').between(start, end, true, true)` query:

- inclusive at both ends;
- sorted by date, then title, then id;
- a single `where` call, which a test asserts (not a query per day).

`watchForDate(d)` is now `watchRange(d, d)`. The days are `LocalDate`s from `addDays`,
so there's no instant arithmetic. Everything stays inside `src/db`.

## Weekly UX

The Protected time section on Today has a short note, "This week: today and the next
six days", then seven rows:

- a **day heading** (`h3`): "Today", "Tomorrow", then weekday names, each with a short
  date ("Thu 1 Oct");
- the day's entries (kind icon, title, "Kind · note"), or "Nothing planned here yet.";
- one **"Add protected time for {day}"** button.

The add and edit form is the existing one, plus a **Day** select over the seven days,
so an entry can be moved. Escape cancels.

- **No completion semantics:** no checkbox, no done, no counts, streaks, targets or
  "missed" wording (tested).
- **Unique names:** buttons include the day ("Edit Dinner (tomorrow)"), so repeated
  titles such as a daily "Evening together" never produce duplicate names.
- **Focus after add or edit:** the entry's Edit button, once the data shows it on its
  (possibly new) day.
- **Focus after remove:** that day's Add button.
- **Focus after cancel:** that day's Add button, or the entry's Edit button.

## Rhythm category filtering (ADR-036)

`Show` lists, in order:

1. All rhythms;
2. **Groups:** Coding & learning, Fitness & health;
3. **Rhythms:** each active rhythm;
4. **Archived:** each archived rhythm.

The grid's accessible name states the view ("Coding & learning, last six months").

The selector changes **only the history grid**. Today's logging always lists every
active rhythm, so habits never seem to disappear when the view changes. That was
verified: logging Coding while Fitness & health was selected left that view's square
unchanged.

## Aggregation behaviour

`GridView` is now `overall`, `group` or `habit`.

- **Group views** include only entries whose habit's category is in the group,
  archived habits included, combined with the unchanged ADR-025 banded sum.
- **Single-habit views** use ADR-024 levels, unchanged.
- **Unknown-habit entries** are ignored, so protected time can never contribute.
- **Only two groups exist,** covering coding, learning, fitness and health.
  Relationship-type categories don't exist (ADR-013).

## Accessibility (final sweep)

Chromium's accessibility tree was checked on all six pages of the populated profile
(`ariaSnapshot`): heading levels, unnamed controls and duplicate names.

- **Final result:**
  - no heading-level skips (Today `1,2…2,3×7`; Hackathons `1,2,3×9`);
  - 0 unnamed controls;
  - 0 duplicate names.
- **Inbox names:** its button names contain ":", so the snapshot pattern skipped them.
  They were verified directly instead: 8 buttons, 8 unique names.
- **Fixed during the sweep:**
  1. Protected-time day headings read "Thursday**Thu** 1 Oct". A real space now
     separates the words.
  2. After moving an entry to another day, focus landed on the old row, which then
     unmounted (found in the browser, where focus was `null`). Focus now waits for the
     entry on its new day.
  3. After removing an entry, focus could miss when the live update arrived first. Focus
     now moves directly to the day's Add button, which always exists.
  4. All Inbox buttons shared the names "Make task" and "Clear". They're now "Make task:
     {first line}" and "Clear: {first line}", keeping the visible label in the name.
  5. Inbox buttons were disabled while saving (ADR-030's focus-loss pattern). They now
     stay enabled and ignore repeats.
  6. Inbox and the plan picker set their focus marker after the write but only re-ran on
     data changes, so focus could be lost if the update arrived first. The marker now
     records which item left, a state tick re-runs the effect, and focus moves once the
     item is gone.

## Responsive sweep

All six pages were checked at 1280, 768, 360 and 320 px (light), and at 320 and 1280 px
(dark), with populated data including long task and project names, nine hackathon
sheets, the Rhythm grid, the week planner and the backup preview.

- Page overflow was **0** everywhere, and nav overflow was **0**.
- There were exactly **5** primary tabs.
- The Data & backup link was visible at every width.
- The contribution grid still scrolls within its own box on phones, as intended.

## Schema impact / backup compatibility

**None.** There are no new stores or fields, and no migration. `SCHEMA_VERSION` stays
3 and `BACKUP_FORMAT_VERSION` stays 1.

A regression test exports protected time for today and six days ahead, coding, learning
and fitness habits, and entries; restores them over different data; re-exports; and
gets identical `data`. In the browser, the final populated state was exported,
restored, and re-exported identically.

## Tests actually run

All on 2026-09-28, Node 24.19.0, macOS. `testTimeout` stays 15 s.

| Command                                        | Result                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Development runs                               | failures found and fixed (see Bugs)                                                                                                  |
| `9063b4a` alone: typecheck, lint, tests, build | pass: 330 tests                                                                                                                      |
| `dd423d6` alone: typecheck, lint, tests, build | pass: 338 tests                                                                                                                      |
| Full `npm run check` (tree = `bbd8617`)        | **pass: typecheck, lint, format, 28 files / 338 tests, build**                                                                       |
| Intermittent failures (two seen)               | captured with full output: focus and title asserted before the effect that sets them. Fixed in `9b514c6`                             |
| After `9b514c6`                                | **6 consecutive full `npm run check` runs and 4 runs under parallel `tsc` + ESLint load: all 338/338**; final `npm run check` passed |

## Browser checks actually run

Headless Chromium, production build, on a **persistent profile holding the restored
bootstrap**. Test-only additions were removed afterwards, so the profile ended equal to
the bootstrap.

| #     | Check                               | Result                                                                                                                         |
| ----- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Today populated                     | inbox link with the bootstrap's 4 items; the bootstrap's relationship entry shown for today                                    |
| 2     | Week                                | 7 rows: Today Mon 28 Sep … Sunday Sun 4 Oct                                                                                    |
| 3     | Add 3 days ahead                    | added on Thursday; focus "Edit Walk by the lake (Thursday)"                                                                    |
| 4–5   | Edit + move to Friday               | focus "Edit Long walk (Friday)" (after the fix; first run: `null`)                                                             |
| 6     | Remove                              | focus "Add protected time for Friday"                                                                                          |
| 7     | Bootstrap relationship entry        | shown as "Relationship · …" under Protected time only                                                                          |
| 8     | Relationship rhythm                 | none (8 rhythms)                                                                                                               |
| 9     | All rhythms                         | today's square: a coding rhythm 30 min + a fitness rhythm done → "(moderate activity across 2 habits)"                         |
| 10    | Coding & learning                   | today's square: only the coding rhythm → "(light activity across 1 habit)"                                                     |
| 11    | Fitness & health                    | today's square: only the fitness rhythm → "(moderate activity across 1 habit)"; grid named "Fitness & health, last six months" |
| 12    | Single rhythm (one with no entries) | "nothing recorded"                                                                                                             |
| 13    | Logging while filtered              | the coding rhythm logged with Fitness & health selected; logging list unchanged                                                |
| 14    | Grid keyboard                       | Tab → today; ← → one week earlier; 1 tab stop                                                                                  |
| —     | Cleanup                             | test entries cleared; today's square back to "nothing recorded"                                                                |
| 15–16 | Hackathons / Tasks                  | 9 / 10 intact                                                                                                                  |
| 17    | Final export                        | 10 tasks · 4 inbox · 8 rhythms · 0 entries · 9 hackathons · 3 protected time                                                   |
| 18    | Restore that export                 | identical `data` after re-export                                                                                               |
| 19–26 | 1280/768/360/320 px; light and dark | overflow 0 on all six pages; nav overflow 0; 5 tabs; Data & backup visible                                                     |
| 27    | Console                             | no errors or warnings                                                                                                          |
| 28    | Network                             | **no non-localhost requests**                                                                                                  |

## Bugs discovered / fixed

These are sweep items 1–6 above, plus:

- **Test races (`9b514c6`).**
  - One failure was first seen as "edits a habit's name and target but never its
    unit", with only the name captured. A later `npm run check` failed "adds on a
    future day, edits, moves and removes…". Its full output showed the cause:
    `expect(await findByRole(…)).toHaveFocus()` asserts the instant the button renders,
    but focus is set in a `useEffect` just after. The first test uses the identical
    pattern.
  - A stress run then failed the same way on `document.title`, which is also set in an
    effect.
  - All 31 focus assertions now use `expectFocus` (waits, still fails if focus never
    comes), and the title assertion waits. No timeout was changed.

Test-side fixes:

- `user-event` matches `<option>` elements by `innerHTML` ("&amp;"), so the tests
  select groups by value.
- The Phase 006 test file was split by topic, so each commit stands on its own.
- Three test-fixture names that looked like bootstrap strings were renamed.

## Bundle changes (`npm run build`, real output)

| Chunk              | PHASE 005               | PHASE 006               |
| ------------------ | ----------------------- | ----------------------- |
| entry `index-*.js` | 452.54 kB (144.44 gzip) | 452.62 kB (144.47 gzip) |
| `TodayPage`        | 15.29 kB                | 17.26 kB (5.85 gzip)    |
| `RhythmPage`       | 17.64 kB                | 18.25 kB                |
| `InboxPage`        | 3.05 kB                 | 3.22 kB                 |

There's no new library or calendar package, and lazy routing is intact.

## Known limitations

- **The week planner shows only today to +6.** Protected time further ahead can't be
  added from the UI, though the repository supports any date.
- **No Money & personal group.** Not needed for this phase.
- **Only Chromium was checked.** The accessibility sweep is automated (the accessibility
  tree), not a screen-reader session.
- **The bootstrap wasn't loaded into the owner's own browser.** That's one file-choose
  on its Data & backup page.

## Final roadmap state

000–006 are all done. **CORE V0.1 ROADMAP COMPLETE.** Optional future work (not
numbered or scheduled) is listed in `docs/ROADMAP.md`.
