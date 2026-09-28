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
  routes) with a memory router and returns a `user-event` instance.
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

## Current coverage (PHASE 001): 11 files, 105 tests

| File                       | Tests | What it proves                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database.test.ts`         | 4     | default name; opens at `SCHEMA_VERSION` with all six stores; one entry per habit per day; data survives close/reopen                                                                                                                                                                                                                                                                                    |
| `schema.test.ts`           | 6     | valid record accepted; `undefined`/`null` optionals rejected; bad enum/id/non-UTC timestamp rejected; habit target positive; `relationships` rejected as a habit category; relationship/family/friends valid protected-time kinds                                                                                                                                                                       |
| `time.test.ts`             | 10    | UTC timestamp format; local-day derivation and round-trip; invalid dates rejected; deadlines stored as UTC noon of the date; **day unchanged across 4 zone pairs up to 17 h apart and across a DST change**                                                                                                                                                                                             |
| `task-repository.test.ts`  | 18    | create defaults/trim/omits blanks; blank title rejected; complete/listOpen/get semantics; update (trim, clear with null/blank, untouched fields, blank title rejected, missing → `RecordNotFoundError`); reopen clears `completedAt`; drop keeps the record; invalid transitions → `RecordStateError`; **watchOpen emits on create/update/complete; watchClosed ordering; unsubscribe stops emissions** |
| `inbox-repository.test.ts` | 9     | capture trims/rejects blank; atomic convert incl. **rollback**; no double conversion; missing id; ordering; markProcessed keeps the item and creates no task; double/missing processing rejected; **watchUnprocessed emits on capture/convert/process, and tasks.watchOpen sees converted tasks**                                                                                                       |
| `task-logic.test.ts`       | 16    | deadline labels/tones for overdue, yesterday, today, tomorrow, weekday, later, next year; open-task ordering; draft ↔ NewTask/TaskChanges (clears sent explicitly); relative capture times                                                                                                                                                                                                              |
| `storage-boundary.test.ts` | 12    | ESLint rule blocks concrete DB / Dexie repos / internals / `dexie` from UI code, and schemas from app/features/components/hooks; allows interfaces, `main.tsx`, `src/db`, tests                                                                                                                                                                                                                         |
| `app.test.tsx`             | 4     | shell landmarks and nav; composer focused on load; `aria-current` follows navigation; skip link focuses `<main>`; unknown route inside the shell                                                                                                                                                                                                                                                        |
| `capture.test.tsx`         | 8     | Enter saves, clears, keeps focus, item appears live; Shift+Enter newline without saving; Cmd+Enter and Ctrl+Enter save; whitespace ignored; IME Enter (`isComposing`, keyCode 229) never saves; **failed save keeps the draft with an associated error, retry works**; **rapid captures during slow saves stay separate and ordered**; failed text restored ahead of newer typing                       |
| `inbox-page.test.tsx`      | 7     | lists oldest first with capture time; Make task removes the item, moves focus to the next item, task shows in Tasks with notes; Clear keeps the record, creates no task, focuses the heading when empty; buttons described by their thought; conversion and clear failures surfaced, item kept; empty state                                                                                             |
| `tasks-page.test.tsx`      | 11    | create by title with Enter; create with notes/priority/deadline/project (stored `dueAt` checked); empty title error associated with the field; failed create keeps input; inline edit incl. clearing the deadline; Escape cancels; empty-title edit refused; complete → Finished → reopen; drop kept under Finished; failed completion surfaced, task stays open; overdue/today labels and ordering     |

## Browser smoke checks

There is still no committed end-to-end suite. Each phase so far ran a throwaway
Playwright script from a temporary directory (not a project dependency) against the
**production build** (`vite preview`) in headless Chromium.

PHASE 001 run (details in `docs/phases/PHASE-001.md`):

- boot with the composer focused;
- three quick captures, including Shift+Enter;
- reload keeps them;
- Make task and Clear, then the task shows in Tasks with its notes;
- add tasks with details, drop one, complete one;
- reload keeps the open and finished lists;
- edit a task, and focus returns to its Edit button;
- no horizontal overflow at 1280, 360 and 320 px, light and dark;
- no console errors or warnings;
- no requests to non-localhost hosts.

That run caught a real capture race (ADR-017), which unit tests then reproduced.

## Known gaps

- fake-indexeddb is not a real browser engine; quota, eviction and private-mode
  behaviour are untested.
- No migration tests yet (there is only version 1).
- No coverage thresholds configured.
- `field-sizing: content` (auto-growing composer) and `<input type="date">` rendering
  are only exercised in Chromium; Safari/Firefox untested.
- No automated accessibility audit (axe) yet; checks are by role/label/description
  queries and manual screenshot review.
