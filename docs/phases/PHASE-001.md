# PHASE 001 — Shell, brain dump, inbox and tasks

- **Date:** 2026-09-28
- **Status:** Complete (see "Tests actually run" and "Real browser checks")
- **Starting point:** `464e110` (verified: local `HEAD` = `origin/main`, clean tree)
- **Commits:**
  - `29feb62` — `feat(data): reactive repositories and task/inbox lifecycle`
  - `975d8a1` — `feat(app): shell, brain dump capture, inbox processing and tasks`
  - a follow-up `docs(phase-001): …` commit containing this report. It can't record its
    own SHA; find it with `git log --oneline -- docs/phases/PHASE-001.md`.

## Objective

Make LOWTIDE usable for real thoughts and tasks: a real shell, zero-friction brain
dump capture, inbox processing, a usable Tasks view, and reactive local data.

## Scope

In: app shell (desktop + mobile), Home capture, `/inbox`, `/tasks`, repository
extensions and live subscriptions, date-only deadlines, error/empty states,
accessibility basics, tests, docs.

Out (deliberately): Today view, habits, activity squares, hackathons, money, fitness,
protected-time UI, an inbox history screen, undo, global keyboard shortcuts,
drag-to-reorder, tags.

## Files created

- **App:** `src/app/Shell.tsx`, `src/app/RouteError.tsx`
- **UI primitives:** `src/components/ui/Button.tsx` (Button, IconButton),
  `src/components/ui/Notice.tsx` (ErrorNotice, Announcer),
  `src/components/ui/styles.ts`
- **Features:**
  - `src/features/home/HomePage.tsx`
  - `src/features/inbox/{CaptureComposer,InboxPage}.tsx`
  - `src/features/tasks/{TasksPage,NewTaskForm,TaskEditor,TaskFields,TaskRow}.tsx`
  - `src/features/tasks/{deadline,order,draft}.ts`
- **Hooks:** `src/hooks/{useWatch,useToday,useDocumentTitle}.ts`
- **Lib:** `src/lib/when.ts`
- **Tests:** `src/test/{capture,inbox-page,tasks-page}.test.tsx`,
  `src/test/task-logic.test.ts`, `src/test/render.tsx`
- **Docs:** `docs/phases/PHASE-001.md`

## Files modified

- **Data layer:** `src/db/repositories/{types,shared,index,dexie-task-repository,dexie-inbox-repository}.ts`,
  `src/lib/time.ts`
- **App:** `src/app/routes.tsx`, `src/app/NotFound.tsx`, `src/styles/index.css`
- **Config:** `eslint.config.js`, `package.json`, `package-lock.json`
- **Tests:** `src/test/{app,helpers,task-repository,inbox-repository,time,storage-boundary}`
  test files and helpers
- **Docs:** `README.md` and
  `docs/{ARCHITECTURE,DATA-MODEL,DECISIONS,PRODUCT,ROADMAP,CHANGELOG,TESTING,SECURITY}.md`

**Deleted:** `src/app/FoundationScreen.tsx`. It was the temporary PHASE 000 screen and
nothing else used it.

## Architecture decisions

- **ADR-015 — Reactive data:** repositories expose `Watch<T>` subscriptions, built on
  Dexie `liveQuery` inside `src/db`. Components use `useWatch`. No Dexie types reach the
  UI, screens don't reload by hand, and nothing is optimistic.
- **ADR-016 — Date-only deadlines:** a chosen day is stored as UTC noon of that date and
  read back from the UTC date part, so it's the same in every time zone. No schema
  change. The first approach (local noon) failed tests for zones 12.5 h or more apart.
- **ADR-017 — Capture:** saving clears the box at once, writes in order, and puts the text
  back if a write fails.
- **ADR-018 — History:** processing never deletes anything; cleared inbox items and
  dropped or completed tasks are kept.
- **Lint rule:** the persistence-schema ban now also covers `src/app`, because the
  foundation screen that needed `SCHEMA_VERSION` is gone.

## UX decisions

- **Home is capture, not a dashboard.** One question as the page heading ("What's taking
  up space?"), a focused textarea, a one-line hint. Below it, up to 5 waiting thoughts
  (newest first) and a "Sort through…" link; when there are none, "Your inbox is clear."
- **No choices during capture.** No category, priority, date, project or tags.
  Everything lands in the Inbox.
- **Keys:** Enter or Cmd/Ctrl+Enter saves, Shift+Enter adds a line. Enter during IME
  composition (`isComposing` or keyCode 229) never saves. There's also a quiet "Save"
  button for touch and mouse.
- **Inbox actions** are "Make task" and "Clear", labelled in plain words. "Clear" means
  "needs nothing more". Each button is described by its thought for screen readers.
  After an action, focus moves to the next item, or to the heading when the inbox is empty.
- **Task rows** are one or two lines: a completion circle (24 px hit area), the title,
  a two-line clamp of notes, then a meta line (deadline · project · priority). Edit and
  Drop are icon buttons with names.
- **Priority is understated:** "normal" shows nothing; "High priority" and "Low
  priority" appear as small muted text, and low-priority titles are dimmed.
- **Deadlines are always in words:**
  - "Was due 12 Sep" or "Was due yesterday" uses the warn tone and medium weight.
  - "Due today" uses the accent tone.
  - Others are muted: "Due tomorrow", "Due Friday", "Due 12 Oct".
  - Colour only reinforces the words.
- **Ordering:** tasks with deadlines first (soonest first), then priority, then
  capture order.
- **Adding tasks:** title first, with "Details" to reveal notes, deadline, priority and
  project. The project field suggests existing project labels via a `datalist`. Enter
  in the title adds.
- **Editing and history:** tasks are edited inline, and Escape cancels. Completed and
  dropped tasks sit in a collapsed "Finished" disclosure with Reopen. Nothing is deleted.
- **Errors** are fixed plain sentences with `role="alert"`, tied to the field via
  `aria-describedby` and `aria-invalid` where there is one. Successes go to a polite
  live region. No raw error text.
- **Loading:** lists render nothing until the first local read (milliseconds); no
  skeletons. Empty states are plain sentences.
- **Navigation:** a narrow sidebar on desktop with a note at the bottom, "Everything
  here stays on this device." (true, and quietly reassuring). On mobile it's one top bar.
  The current page is shown by weight and an accent bar (left on desktop, underline on
  mobile), plus `aria-current`. Below 360 px the wordmark text is visually hidden.
  No counts, streaks or scores in the navigation.

## Repository / API changes

`TaskRepository` (new members):

- `watchOpen`
- `watchClosed` (done and dropped, most recently changed first)
- `update(id, TaskChanges)`
- `reopen(id)`
- `drop(id)`

Other task changes:

- `complete` now requires an open task.
- Transitions are guarded with `RecordStateError`.
- Blank `notes`/`project` are omitted on create.

`InboxRepository` (new members):

- `watchUnprocessed`
- `markProcessed(id)`

`convertToTask` is unchanged and still atomic.

New exported types: `Watch<T>`, `Unsubscribe`, `TaskChanges`. The missing-record
semantics from PHASE 000 are kept.

**Not added:** list/watch by project, delete methods, and inbox history queries. No
screen needs them yet.

## Database / schema changes

**None.** `SCHEMA_VERSION` stays 1 and the V1 store definitions are untouched. New
behaviour uses existing fields:

- `processedAt` and `convertedToTaskId`
- task `status`, `completedAt` and `dueAt`

The deadline convention (ADR-016) is a rule for _how_ `dueAt` is written and read, not
a shape change. Existing `dueAt` values stay valid.

## Dependencies

- **Added (dev):** `@testing-library/user-event` 14.6.7. It's needed to test real typing
  and key combinations (Enter vs Shift+Enter vs Cmd/Ctrl+Enter, Escape). `npm audit`:
  0 vulnerabilities.
- **Not added:** no UI framework, state library, animation library or date picker.
- **Removed:** none.

## Tests actually run

All run on 2026-09-28, Node 24.19.0, macOS.

| Command                                                                       | Result                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm test -- --run` during development                                        | failures found and fixed (see Bugs), then passing                               |
| Data-layer commit checked on its own (other changes stashed): `npm run check` | pass: 7 files, 60 tests, build OK                                               |
| Full tree `npm run check` (typecheck, lint, format check, tests, build)       | pass: **11 files, 105 tests**, build OK                                         |
| Mutation check of the capture race tests (old composer logic swapped back in) | the 2 new race tests failed; restored, all 8 capture tests passed               |
| `npm run build` bundle                                                        | JS 497.24 kB (154.80 kB gzip), up from 434 kB, just under Vite's 500 kB warning |

## Real browser checks

Headless Chromium (Playwright from a scratch directory, not a project dependency)
against the production build served by `vite preview`:

| #   | Check     | Result                                                                                                                                           |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | App boots | composer focused on load                                                                                                                         |
| 2   | Capture   | three thoughts (one with Shift+Enter) typed at full speed and saved separately; box empty and still focused                                      |
| 3   | Reload    | all 3 thoughts still in "Waiting in your inbox"                                                                                                  |
| 4   | Inbox     | "Make task" on the first, "Clear" on another; 1 item left                                                                                        |
| 5   | Tasks     | converted task present with its notes line                                                                                                       |
| 6   | Tasks     | added one by title; one with details (high, due tomorrow, project, notes); dropped a third; completed the converted one                          |
| 7   | Reload    | Open = [Submit hackathon PPT, Renew passport], Finished = [Book the dentist (Done), Old side project idea (Dropped)]; "Due tomorrow" label shown |
| 7b  | Edit      | inline edit saved; focus returned to "Edit: Renew passport (book slot)"                                                                          |
| 8   | Layout    | horizontal overflow 0 px at 1280 (desktop), 360 (light + dark) and 320 wide, on Home, Inbox and Tasks                                            |
| 9   | Console   | no errors or warnings                                                                                                                            |
| 10  | Network   | **no requests to any non-localhost host**                                                                                                        |

Screenshots were reviewed for the design pass (not committed): desktop Home, Inbox,
Tasks, the edit form and Finished; mobile 360 px light and dark; 320 px; desktop dark.

**Not checked:** Safari, Firefox, real phones, real screen readers, and real IME input
(IME is covered by unit tests with synthetic events only).

## Design review

The review asked: does this read as LOWTIDE rather than SaaS, is it compact, can I dump
a thought in seconds, does it ask for unnecessary decisions, is the navigation quiet,
and does mobile work? Changes made as a result:

- **`!` prefix removed** from high-priority titles. It repeated "High priority" and was
  louder than intended.
- **Completion circle** hit area enlarged from 20 px to 24 px.
- **Mobile nav indicator:** the left accent bar looked like a stray bracket on the
  horizontal bar, so mobile now uses an underline.
- **Nav transition removed.** A screenshot caught a mid-fade frame; the nav doesn't
  need animation.
- **Wordmark at 320 px:** the text is visually hidden below 360 px so the three nav
  items fit without overflow.

Left as is:

- Content is left-aligned at max-width 42 rem next to the sidebar, which leaves open
  space on wide screens. It reads as a notebook page, not a dashboard.

## Bugs discovered

1. **Deadline shifted a day across time zones.** The first local-noon encoding showed
   a Kolkata-entered date a day earlier in Los Angeles, and Auckland/New York was off
   too. Found by the new TZ tests.
2. **Capture race.** Typing during an in-flight save merged the next thought into the
   saved one and left text in the box. Found only in the real browser, where
   Playwright types at full speed; unit tests with sequential awaits hadn't hit it.
3. **Test cleanup set `TZ` to the string "undefined".** Assigning `undefined` to
   `process.env.TZ` does that. Found in review of my own test.
4. **Data-layer commit wasn't buildable on its own.** The staged `FoundationScreen`
   deletion broke `routes.tsx`. Found by checking that commit in isolation before
   committing.
5. **Light-mode `warn` below AA.** It measured 3.62:1 on paper; found by computing
   token contrast before building screens.
6. **Minor:**
   - `eslint-disable` for a rule from a plugin that isn't installed;
   - an `exhaustive-deps` warning in `TasksPage`;
   - a meaningless assertion in one test;
   - several test/script queries matching screen-reader announcements.

## Bugs fixed

1. UTC-noon-of-date encoding (ADR-016). Tests cover four zone pairs up to 17 h apart,
   plus a DST change.
2. Composer reads the live textarea value, clears immediately, queues writes in order,
   and restores failed text (ADR-017). Two regression tests use a slowed-down
   `capture`; both fail against the old logic.
3. The test restores `TZ` by deleting the key when it was unset.
4. Unstaged the deletion from the data commit, then re-verified the commit on its own
   with `npm run check`.
5. `warn` is now `#8a5a1c` (≥ 4.43:1 on sunken, ≥ 5.15:1 on paper). Primary buttons use
   `accent-ink` with the new `on-accent` token.
6. Each minor item fixed:
   - removed the comment;
   - memoised `closedTasks`;
   - replaced the assertion;
   - scoped queries to lists/regions, and gave the inbox list the accessible name
     "Inbox items".

## Known limitations

- **No undo.** Clear, Drop and Complete can't be undone in place. Drop and Complete are
  reversible from Finished, but there is no way back from Clear in the UI (the record
  is kept).
- **No inbox history screen, and no delete** for tasks or thoughts.
- **No global keyboard shortcuts** (e.g. "focus capture from anywhere"). The app is
  fully keyboard-operable with Tab, Enter and Escape.
- **Status `doing`** exists in the model but has no UI.
- **Other tabs:** when another tab changes data, lists update live (Dexie cross-tab
  change events), but that wasn't browser-tested.
- **Clock-based labels** ("just now", "14:05") are computed at render time; they refresh
  on the next data change or navigation. Only the deadline "today" rolls over on a timer
  (`useToday`).
- **Browser coverage:** the auto-growing composer uses `field-sizing: content` (Chromium
  and recent Safari; elsewhere it's a fixed 3-row box with scrolling). Browser checks
  were Chromium only.
- **Bundle:** 497 kB (155 kB gzip). Route-level code splitting is suggested for PHASE 002.
- **Stack traces:** `RouteError` catches render errors, but there is no error reporting
  (by design: no telemetry).

## Security / privacy considerations

- Still no network use: verified through the whole workflow in a real browser.
- User text is always rendered as React text with `pre-wrap`; nothing uses
  `dangerouslySetInnerHTML` (checked in the staged diff).
- Error UI shows fixed strings, never exception messages.
- Nothing is deleted, which is honest history but also means cleared thoughts remain on
  the device. That's worth knowing for anyone sharing the device; `SECURITY.md` covers
  device access.
- No new runtime dependencies. The one new dev dependency passes `npm audit` with 0
  vulnerabilities.
- The staged diffs of both code commits were scanned for secrets, network calls and
  unsafe HTML: none.

## Screenshots / demo notes

Not committed. To see it, run `npm run dev` and then:

1. Type a thought and press Enter.
2. Open Inbox → Make task.
3. Open Tasks → Details → set a deadline → Add.
4. Complete a task, then open Finished.

## Next phase

**PHASE 002 — Today.** See [ROADMAP.md § PHASE 002 starting point](../ROADMAP.md#phase-002-starting-point).
