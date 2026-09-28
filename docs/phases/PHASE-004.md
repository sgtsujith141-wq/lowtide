# PHASE 004 — Hackathons

- **Date:** 2026-09-28
- **Status:** Complete (see "Tests actually run" and "Browser verification actually run")
- **Starting point:** `890ad37` (verified: local `HEAD` = `origin/main`, clean tree).
  Baseline `npm run check` passed: 20 files, 218 tests, entry 443.95 kB, 19.8 s total.
- **Commits:**
  - `cd5dab6` — `feat(data): hackathon repository and schema v3 LocalDate migration`
  - `35c4e3a` — `fix(a11y): keep Rhythm logging controls focused while saving`
  - `868c4b1` — `feat(hackathons): hackathon sheets, ordering, and a small Today section`
  - a follow-up `docs(phase-004): …` commit containing this report. It can't record its
    own SHA; find it with `git log --oneline -- docs/phases/PHASE-004.md`.

`cd5dab6` was verified on its own (typecheck, lint, 234 tests, build), and so was
`35c4e3a` (typecheck, lint, 234 tests). `868c4b1` is exactly the tree that passed the
full `npm run check`.

## Objective

A Hackathon Manager that makes several simultaneous hackathons understandable in
seconds:

- what's next, and which dates matter;
- where registration, PPT and build stand;
- the problem statement;
- the exact next action.

It's not a dashboard, a task list or a habit.

## Scope

**In:**

- LocalDate hackathon dates with schema V3;
- `HackathonRepository`;
- the `/hackathons` route and nav entry;
- sheets with quick status updates and an inline next action;
- ordering and wording;
- the Today section;
- a 320 px nav fix;
- tests and docs.

**Out (deliberately):**

- backup/export (PHASE 005);
- links and fetching event sites;
- a problem-statement database;
- team contact entities;
- sending the next action to Tasks;
- auto-finishing past events;
- any Rhythm connection.

## Files created

- **Data:** `src/db/migrations.ts`, `src/db/repositories/dexie-hackathon-repository.ts`
- **Hackathons:** `src/features/hackathons/`: `HackathonsPage.tsx`, `HackathonSheet.tsx`,
  `HackathonForm.tsx`, `schedule.ts`, `labels.ts`
- **Today:** `src/features/today/TodayHackathons.tsx`
- **Tests:** `src/test/`: `migration-v3.test.ts`, `hackathon-repository.test.ts`,
  `hackathon-schedule.test.ts`, `hackathons-page.test.tsx`
- **Docs:** `docs/phases/PHASE-004.md`

## Files modified

- **Data:** `src/types/domain.ts`, `src/db/{schema,database}.ts`,
  `src/db/repositories/{types,index}.ts`
- **App:** `src/app/{routes,Shell}.tsx`, `src/features/today/TodayPage.tsx`
- **Focus fix:** `src/features/rhythm/HabitLogRow.tsx`
- **Tests:** `src/test/{app,rhythm-page}.test.tsx`, `src/test/migration.test.ts`
- **Docs:** `README.md` and `docs/{ARCHITECTURE,DATA-MODEL,DECISIONS,PRODUCT,ROADMAP,CHANGELOG,TESTING,SECURITY}.md`.
  `SETUP.md` is unchanged because setup didn't change.

## LocalDate decision (ADR-027)

`registrationDeadline`, `eventStart` and `eventEnd` are now `LocalDate`
(`YYYY-MM-DD`), not timestamps and not UTC-noon encodings. Rules:

- all dates are optional;
- `eventEnd` needs `eventStart` and can't be earlier;
- the registration deadline is independent (no invented ordering rule);
- exact clock times go in notes.

## Schema V3 migration

- `SCHEMA_VERSION` changed from 2 to 3.
- `STORES_V3 = { hackathons: 'id, status, registrationDeadline, eventStart' }` is
  appended as `version(3).stores(STORES_V3).upgrade(...)`. The indexes are the same;
  the version exists to run the upgrade. V1 and V2 are untouched.
- The upgrade runs `migrateHackathonToV3` (pure, in `src/db/migrations.ts`) over every
  hackathon record.

**Behaviour for legacy values**, per date field:

| Stored value                                              | After V3                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| absent                                                    | absent                                                               |
| real `YYYY-MM-DD`                                         | kept                                                                 |
| ISO timestamp (`Z` or `±hh:mm` offset)                    | its UTC date component (`2026-10-04T01:00:00+05:30` → `2026-10-03`)  |
| anything else (`"next friday"`, `20261011`, `2026-02-30`) | field removed; `notes` gains `[Moved by LOWTIDE upgrade] field: raw` |

Afterwards, an `eventEnd` without an `eventStart`, or before it, is moved to notes the
same way. Nothing is silently discarded, and every migrated record validates against
the V3 schema.

**Proof** (`migration-v3.test.ts`): a genuine V2 database, built with bare Dexie V1 and
V2 definitions, is seeded with four hackathons (legacy, missing, already-local and
malformed dates), a task with `plannedFor`, a habit, a habit entry and protected time.
Opening it with `LowtideDatabase` gives:

- `verno` is 3;
- the hackathon conversions are exactly as tabled above;
- all other records are unchanged and schema-valid;
- the `hackathons` indexes are unchanged and range-queryable by LocalDate.

## Repository API

`HackathonRepository` (`Repositories.hackathons`):

- `create(NewHackathon)`: only `name` is required. Defaults are `considering`,
  `not_registered`, PPT `not_started` and build `not_started`. Optional text is
  trimmed; blanks are omitted.
- `update(id, HackathonChanges)`: keeps `id` and `createdAt`, bumps `updatedAt`.
  `null` or blank clears an optional field. Every write re-validates with Zod plus the
  date rules. A missing id gives `RecordNotFoundError`; a bad range gives
  `InvalidInputError`.
- `watchAll`: every hackathon, oldest first.
- **No delete.** Finished and dropped keep everything. Nothing here touches tasks or
  habits.

## Sorting logic (ADR-028)

Open hackathons (considering or active) are ordered by `orderHackathons`:

1. **Upcoming.** The key is the earliest of:
   - the registration deadline, if registration is still `not_registered` and it's
     today or later;
   - the event start, if the event hasn't ended. An ongoing event keys on its start,
     so it sorts first.
2. **No dates.**
3. **Only past dates**, most recent first.

Ties are broken by `createdAt`, then name, then id. Registered, waitlisted or rejected
deadlines never drive urgency. Past events stay "active" until the user changes them.

## Today relevance algorithm (ADR-029)

`hackathonsForToday` includes a hackathon when it's open and not `rejected`, and at
least one of these holds:

- registration is pending and the deadline is overdue or at most 7 days away;
- the event starts 0–7 days from now, or is happening now.

- **One row per hackathon.** When both reasons apply, the label joins them
  ("Registration due tomorrow · Starts in 4 days"), followed by "Next: …".
- **Order:** by the earliest relevant date.
- **Limit:** at most 3, then "See all hackathons (N more coming up)".
- **Placement:** between My plan and Protected time, and absent when nothing
  qualifies.
- **Links, no controls:** each name links to `/hackathons`.

## UX decisions

- **Sheet, not card.** Each sheet has:
  - an `article` with an `h3` name and an Edit icon;
  - the date line ("Starts in 4 days · 2 Oct"; tone only for today/now);
  - **Next:** in accent weight with an inline editor (Enter saves, Escape cancels), or
    a quiet "Add a next action";
  - a text-first status line of four small selects (Registration, PPT, Build, Status)
    that save on change;
  - a disclosure named after what it holds ("Problem statement, Team, Notes").
- **Quick add** asks only for name, start and optional end. The full editor groups
  dates and progress, the next action, the problem statement, team and status, and
  notes.
- **Past** is a collapsed `details` element with the same sheets, so a hackathon can be
  reopened by changing its Status.
- **Wording** is calm and factual (see ADR-028). "Rejected" displays as "Not selected".
  Nothing is red, and the tone never carries meaning alone.
- **No** percentages, rings, Kanban, KPI cards or charts.
- **Focus handling:**
  - after adding → the new sheet's Edit button;
  - after editing → its Edit button;
  - after finishing or dropping → the "Past" summary;
  - after reopening → its Edit button;
  - status selects keep focus.
- **Mobile nav:** below `md`, items stack icon over a 10 px label (tab-bar style) and
  the wordmark hides its text below 440 px. This was measured before and after: the
  overflow at 320, 360, 390 and 420 px went from 28, 68, 38 and 121 px to 0, 0, 0 and
  0 px.

## Status semantics

- **Registration, PPT and Build** describe the work. **Status** (considering, active,
  finished, dropped) says whether it's in play.
- Only the user changes any of them. A past event isn't auto-finished, and a submitted
  build doesn't finish the hackathon.
- A resolved registration (registered or waitlisted) removes the deadline from
  ordering and from Today. Rejected removes the hackathon from Today altogether.
- There's no aggregate percentage or "complete" state.

## Tests actually run

All on 2026-09-28, Node 24.19.0, macOS.

| Command                                                | Result                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Baseline `npm run check` at `890ad37`                  | pass: 218 tests, 19.8 s total                                                                |
| `npx vitest run` during development                    | failures found and fixed (see Bugs), then passing                                            |
| `cd5dab6` alone: typecheck, lint, tests, build         | pass: 234 tests                                                                              |
| `35c4e3a` alone: typecheck, lint, tests                | pass: 234 tests                                                                              |
| Full `npm run check` (the tree committed as `868c4b1`) | **pass: typecheck, lint, format, 24 files / 278 tests (7.89 s), build; 21.0 s total**        |
| Final `npm run check` with the docs                    | 1 run failed 1 test (Bug 7). After the test fix: **3 consecutive passes, 278/278, build OK** |

## Test-timeout observations

- **One real flaky test**, now fixed (Bug 7). It wasn't a timeout or resource
  starvation: it was an assertion racing an async write, and it failed intermittently
  inside `npm run check`, more often right after typecheck and lint had heated the CPU.
  It passed alone. Found by repeating the check with full output instead of retrying
  blindly.
- **No timeouts this phase.** Every run was 7.9–8.7 s for tests, and full checks took
  about 20–21 s. The machine was responsive (load average about 1.4–2.9 at the start).
- `testTimeout` stays at 15 s and was not raised.
- There was a separate environment issue: the auto-mode safety check for shell commands
  intermittently gave no verdict, which blocked some commands until retried. That
  didn't affect any result.

## Browser verification actually run

Headless Chromium (Playwright in a scratch directory) against `vite preview` of the
production build:

| #   | Check                          | Result                                                                                                                                             |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/hackathons` lazy route loads | yes                                                                                                                                                |
| 2   | Empty state                    | "Nothing on the radar…"                                                                                                                            |
| 3   | Minimal add (name + start)     | "Starts in 4 days · 2 Oct"                                                                                                                         |
| 4   | Registration deadline via Edit | "Registration due tomorrow · 2 Oct"                                                                                                                |
| 5   | Registration → Registered      | line returns to "Starts in 4 days · 2 Oct"                                                                                                         |
| 6   | Problem statement + team       | disclosure "Problem statement, Team" appears                                                                                                       |
| 7   | Next action (inline)           | "Next: Finish PPT outline"                                                                                                                         |
| 8   | PPT → In progress              | saved; focus stayed on the PPT select (with the select actually focused; see Bugs)                                                                 |
| 9   | Build changes                  | saved                                                                                                                                              |
| 10  | Multi-day event                | "Starts 8 Oct · 8–9 Oct"                                                                                                                           |
| 11  | Ordering of five               | Weekend Jam (in 2 days) → Hackurity (4) → AI Build Week (10) → Idea only (undated) → Last month (past)                                             |
| 12  | Finish "Last month"            | moved to "Past · 1"; focus on the summary                                                                                                          |
| 13  | Today                          | two rows: "Weekend Jam — Registration closed 1 day ago · Starts in 2 days · Next: …" and "Hackurity — Starts in 4 days · Next: Finish PPT outline" |
| 14  | Distant (10 days) on Today     | 0 matches                                                                                                                                          |
| 15  | Reload                         | same order; Past 1; PPT and Build still "in_progress"                                                                                              |
| 16  | Layout                         | page overflow 0 on Hackathons, Today, Inbox, Tasks and Rhythm at 1280 (light and dark), 360 (light) and 320 (light and dark)                       |
| 17  | Light and dark                 | screenshots reviewed                                                                                                                               |
| 18  | Mobile nav                     | header overflow 0 at 320 and 360                                                                                                                   |
| 19  | Console                        | no errors or warnings                                                                                                                              |
| 20  | Network                        | **no non-localhost requests**                                                                                                                      |

**Keyboard:** Tab after "Add hackathon" lands on the first sheet's Edit button. A
Rhythm check was added to the run: the done toggle, activated with Enter, keeps focus
after saving.

## Bugs found

1. **Five-item nav overflowed** at every narrow width (28–121 px), measured in Chromium
   before the fix.
2. **"Add a next action"** had the accessible name "Add a next action**for** Hackurity".
   The leading space inside a `sr-only` span is dropped during name computation, the
   same class of bug as PHASE 003. Caught by a failing test and confirmed with
   `computeAccessibleName`.
3. **Disabled-while-saving controls** (Rhythm toggle, amount field, clear button, and
   hackathon selects during development): disabling a focused element drops keyboard
   focus in Chromium. Honest note: the first browser report of `null` focus on the PPT
   select was confounded, because Playwright's `selectOption` doesn't focus the select.
   With real focus, the fixed build keeps it. I didn't reproduce the loss in the browser
   before fixing; the fix rests on known Chromium behaviour plus post-fix verification.
4. **`watchAll` returned primary-key (random id) order** despite documenting "oldest
   first".
5. **The PHASE 002 migration test pinned `SCHEMA_VERSION` to 2** (correctly failed when
   V3 arrived).
6. **Two edit scripts silently failed** on Prettier-reformatted text. The asserting
   ones stopped; two unasserted doc table replacements were noticed and redone.
7. **A flaky PHASE 001 test** (`capture.test.tsx`, "keeps the draft … saves on retry").
   After the docs were written, one full `npm run check` failed that test at a normal
   speed (tests 7.93 s, not a stall). It passed in 5 plain runs, then failed again on
   the first repeat of `npm run check`, with full output captured. The cause was
   deterministic: on retry the composer clears at once (ADR-017) but removes the error
   only after the write succeeds, while the test asserted the error was gone right
   after the box emptied.

## Bugs fixed

1. Stacked icon-and-label nav items below `md`, and the wordmark text hidden below
   440 px. Overflow is now 0 from 320 to 768 px.
2. An explicit `aria-label` on the button.
3. Those controls stay enabled with a busy guard in the handler, and focus goes to the
   amount field after clearing (ADR-030). There are test assertions, and browser
   verification for the Rhythm toggle and the PPT select.
4. Sorted by `createdAt`, then id.
5. It now asserts `verno === SCHEMA_VERSION`.
6. Re-applied, and verified with grep.
7. The test now waits for the error to disappear (the real completion signal). Three
   consecutive full `npm run check` runs passed afterwards (278/278 each). No timeout
   was changed.

## Known limitations

- **No clock times.** A deadline at 11:59 pm lives in notes, and "Registration due
  today" doesn't know the hour.
- **Past events** stay active until changed (by design); they sort last with "Ended …".
- **Problem statement, team and notes** are free text only: no shortlist, no links.
- **Today section:** no per-hackathon deep link (every name goes to the list), and no
  hackathon lines on Tasks.
- **No undo** for status changes. Every change is one select back.
- **Browsers:** only Chromium checked.
- **Tests:** jsdom may not reproduce the focus loss from disabled elements, so those
  assertions guard the new behaviour but can't prove the old one failed.

## Privacy / security

- Hackathon sheets can hold teammate names, strategy and private notes. They're stored
  unencrypted in IndexedDB; SECURITY.md now says so.
- No fetching of hackathon sites, no external APIs, no analytics or telemetry. The
  browser run saw zero non-localhost requests.
- The V3 upgrade may copy unreadable date values into notes; they stay local.
- Staged diffs were scanned for secrets, network calls and unsafe HTML: none. Test and
  browser data are invented ("Hackurity", "Asha, Ravi"); screenshots stayed in a
  scratch directory.

## Bundle measurements (`npm run build`, real output)

| Chunk              | PHASE 003               | PHASE 004               |
| ------------------ | ----------------------- | ----------------------- |
| entry `index-*.js` | 443.95 kB (141.82 gzip) | 447.78 kB (143.02 gzip) |
| `HackathonsPage`   | —                       | 11.96 kB (3.95 gzip)    |
| `TodayPage`        | 14.27 kB                | 15.29 kB (5.25 gzip)    |
| `RhythmPage`       | 17.81 kB                | 17.64 kB                |
| CSS                | 23.83 kB                | 25.02 kB                |

The entry grew 3.8 kB: the hackathon repository and V3 migration (the data layer lives
in the entry). The hackathon UI and scheduling logic are lazy. Today's `TodayHackathons`
imports `schedule.ts`, adding about 1 kB to the Today chunk.

## Next phase

**PHASE 005 — Backup: export and import.** This is the priority: everything lives in
one browser profile. See [ROADMAP.md § PHASE 005 starting point](../ROADMAP.md#phase-005-starting-point-backup-export-import).
