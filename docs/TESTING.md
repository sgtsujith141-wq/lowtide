# Testing

## Tools

- **Vitest 5** with the **jsdom** environment (configured in `vite.config.ts`).
- **React Testing Library** + `@testing-library/jest-dom` matchers.
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
- Prefer accessible queries (`getByRole`, `getByText`) in component tests.

## Current coverage (PHASE 000)

| File                       | What it proves                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database.test.ts`         | default name; opens at `SCHEMA_VERSION` with all six stores; one entry per habit per day (unique compound index); data survives close/reopen                                                                                                                              |
| `task-repository.test.ts`  | create with defaults, trims, omits unset optionals; rejects blank title without writing; complete stamps `completedAt`; open list order; `get` of a missing id resolves `undefined`; `complete` of a missing id → `RecordNotFoundError`                                   |
| `inbox-repository.test.ts` | capture trims and rejects blank; convert-to-task creates task + marks item processed and linked; no double conversion; **rollback: if marking processed fails, the task is not created**; missing id; unprocessed ordering                                                |
| `schema.test.ts`           | valid record accepted; `undefined`/`null` optionals rejected; bad enum, id, non-UTC timestamp rejected; habit target must be positive; `relationships` is rejected as a habit category; relationship/family/friends remain valid protected-time kinds                     |
| `time.test.ts`             | UTC timestamp format; local-day derivation; local date round-trip; invalid dates rejected                                                                                                                                                                                 |
| `storage-boundary.test.ts` | runs ESLint on probe sources: feature/component/hook/app imports of the concrete database, Dexie repositories, repository internals, `dexie` (and schemas in features/components/hooks) are errors; repository interfaces, `src/main.tsx`, `src/db` and tests are allowed |
| `app.test.tsx`             | app boots through a memory router, shows database Ready via the repository layer; unknown route offers a link home                                                                                                                                                        |

## Browser smoke checks

There is no committed end-to-end suite yet. During PHASE 000 a throwaway Playwright
script (run from a temporary directory, not a project dependency) loaded the dev server
and the production preview in headless Chromium in light and dark schemes and checked:
foundation screen shows Ready, IndexedDB `lowtide` exists, background token applied,
unknown route renders, **no requests to non-localhost hosts**, no console errors.
Adding a committed E2E suite is on the roadmap.

## Known gaps

- fake-indexeddb is not a real browser engine; quota, eviction and private-mode
  behaviour are untested.
- No migration tests yet (there is only version 1).
- No coverage thresholds configured.
