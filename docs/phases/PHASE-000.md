# PHASE 000 — Foundation

- **Date:** 2026-09-28
- **Status:** Complete (see "Tests actually performed")
- **Commits:** `5233a6d` — `chore(repo): bootstrap LOWTIDE application foundation` (code);
  a follow-up `docs(phase-000): …` commit adds this report and the rest of `docs/`.
  That docs commit cannot contain its own SHA; find it with
  `git log --oneline -- docs/phases/PHASE-000.md`.

## Objective

Create a clean, runnable LOWTIDE foundation — tooling, styling tokens, routing, IndexedDB
persistence behind a repository boundary, domain types, test infrastructure and
documentation — so PHASE 001 can start building real features.

## Scope

In: project scaffold, configuration, design tokens, router, database + schema v1,
two repositories proving the boundary, domain types for six entities, tests, docs.

Out (deliberately): any real feature UI, CRUD screens, repositories for habits /
hackathons / protected time, theme switcher, export/import, PWA/offline caching,
committed E2E suite.

## Starting state and the decision to start fresh

The repository was **not** empty. `main` (in sync with `origin/main`) held 9 commits
(2026-09-17 → 09-19, up to `94dcde8`) of an earlier LOWTIDE prototype built on `idb`,
oxlint, a PWA plugin and a Playwright acceptance script. At the start of this phase every
tracked file had already been deleted in the working tree (uncommitted); only
`.gitignore` and `.oxlintrc.json` remained.

This conflicted with the brief's "assume this is the beginning of the project", so work
paused and the owner was asked. The answer: **delete all existing data and start fresh**,
and push when done. Implemented as ordinary commits on top of the existing history —
**no history rewrite, no force push** — so the prototype is still recoverable at `94dcde8`.

## Files created

Config: `.prettierrc.json`, `.prettierignore`, `eslint.config.js`
App: `src/app/App.tsx`, `src/app/routes.tsx`, `src/app/FoundationScreen.tsx`,
`src/app/NotFound.tsx`, `src/app/repositories-context.ts`
Data: `src/types/domain.ts`, `src/db/schema.ts`, `src/db/database.ts`,
`src/db/repositories/{types,errors,shared,index,dexie-task-repository,dexie-inbox-repository}.ts`
Other source: `src/hooks/useRepositories.ts`, `src/lib/time.ts`, `src/styles/index.css`
Tests: `src/test/{helpers,database.test,task-repository.test,inbox-repository.test,schema.test,time.test}.ts`,
`src/test/app.test.tsx`
Docs: `docs/{ARCHITECTURE,PRODUCT,ROADMAP,CHANGELOG,DECISIONS,SETUP,DATA-MODEL,TESTING,SECURITY}.md`,
`docs/phases/PHASE-000.md`

## Files modified

Paths that existed in the prototype and were rewritten from scratch (Git shows them as
modified): `.gitignore`, `README.md`, `index.html`, `package.json`, `package-lock.json`,
`public/favicon.svg`, `src/main.tsx`, `src/lib/ids.ts`, `src/test/setup.ts`,
`tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`.

Removed: `.oxlintrc.json`, `e2e/acceptance.mjs`, `public/icon-192.png`,
`public/icon-512.png` and all prototype sources under `src/components`, `src/lib`,
`src/routes`, `src/test`.

## Architecture decisions

Recorded in [DECISIONS.md](../DECISIONS.md): ADR-001 React/Vite SPA · 002 IndexedDB via
Dexie · 003 repository abstraction · 004 no cloud/auth in v0.1 · 005 no analytics ·
006 local-first · 007 ISO-UTC timestamps + local `YYYY-MM-DD` dates · 008 UUID v4 ids ·
009 `zod/mini` validation · 010 domain error naming vs Dexie · 011 TypeScript pinned to
6.0 · 012 ESLint/Prettier, system fonts, browser routing.

## Foundation implemented

- **Toolchain:** Vite 8, React 19, TypeScript 6.0 (strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), ESLint 10 flat config, Prettier 3, `npm run check`.
- **Styling:** Tailwind 4; semantic CSS tokens (`--lt-paper`, `--lt-ink`, `--lt-line`,
  `--lt-accent`, …) exposed as Tailwind utilities; light + dark (OS preference, plus
  `data-theme` override); system fonts; focus ring; reduced-motion.
- **Routing:** React Router 8 route table; `/` foundation screen; `*` not-found.
- **Persistence:** Dexie DB `lowtide` with six stores; Zod schemas for all six record
  types; `TaskRepository` (create/get/listOpen/complete) and `InboxRepository`
  (capture/listUnprocessed/countUnprocessed/convertToTask — atomic across two stores).
- **Boundary:** components use `useRepositories()`; composition root in `main.tsx`;
  ESLint `no-restricted-imports` blocks `dexie` outside `src/db` (verified with a probe
  file that produced the expected lint error, then removed).
- **Temporary screen:** identifies LOWTIDE and shows database status (read through
  the inbox repository), schema version and unprocessed inbox count.

## Database / schema changes

New database `lowtide`, schema version 1 (native IndexedDB version 10, Dexie ×10):

| Store         | Primary key | Indexes                                  |
| ------------- | ----------- | ---------------------------------------- |
| tasks         | id          | status, dueAt, createdAt                 |
| inbox         | id          | createdAt                                |
| habits        | id          | createdAt                                |
| habitEntries  | id          | habitId, date, unique [habitId+date]     |
| hackathons    | id          | status, registrationDeadline, eventStart |
| protectedTime | id          | date                                     |

Migration procedure: [DATA-MODEL.md § Migrations](../DATA-MODEL.md#migrations).

## Dependencies added

Runtime: `react` 19.3, `react-dom` 19.3, `react-router` 8.4, `dexie` 4.4, `zod` 4.6,
`date-fns` 4.4, `lucide-react` 1.48.

Dev: `vite` 8.3, `@vitejs/plugin-react` 6.1, `typescript` ~6.0.3, `tailwindcss` +
`@tailwindcss/vite` 4.3, `vitest` 5.0, `jsdom` 30.1, `fake-indexeddb` 6.2 (IndexedDB for
tests), `@testing-library/react` 16.3, `@testing-library/dom` 10.4 (peer),
`@testing-library/jest-dom` 7.0, `eslint` 10.11, `@eslint/js` 10, `typescript-eslint`
8.70, `eslint-plugin-react-hooks` 7.1, `eslint-plugin-react-refresh` 0.5, `globals` 17,
`eslint-config-prettier` 10.1, `prettier` 3.9, `@types/react`, `@types/react-dom`,
`@types/node`.

Installed then removed: `@testing-library/user-event` (no interaction tests yet).

## Tests actually performed

All run on 2026-09-28, Node 24.19.0, npm 11.17.0, macOS.

| Command / check                                                                       | Result                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`                                                                         | success, 0 vulnerabilities                                                                                                                                                                                             |
| `rm -rf node_modules dist && npm ci`                                                  | success (clean install from lockfile)                                                                                                                                                                                  |
| `npm run typecheck` (`tsc -b`)                                                        | pass                                                                                                                                                                                                                   |
| `npm run lint`                                                                        | pass, 0 problems                                                                                                                                                                                                       |
| `npm run format:check`                                                                | pass                                                                                                                                                                                                                   |
| `npm test -- --run`                                                                   | **6 files, 25 tests passed**                                                                                                                                                                                           |
| `npm run build`                                                                       | pass; JS 434.17 kB (138.44 kB gzip), CSS 8.29 kB                                                                                                                                                                       |
| `npm run check` (all of the above)                                                    | pass, before the code commit (after `npm ci`)                                                                                                                                                                          |
| `npm audit`                                                                           | 0 vulnerabilities                                                                                                                                                                                                      |
| Schema/type drift guard                                                               | removed `priority` from `taskSchema` → `tsc` failed as intended; restored                                                                                                                                              |
| Headless Chromium smoke (dev server `:5199` and `vite preview` `:5198`, light + dark) | foundation screen reached "Ready"; IndexedDB `lowtide` present; background `rgb(244,239,230)` light / `rgb(31,29,26)` dark; unknown route shows link home; **0 requests to non-localhost hosts**; **0 console errors** |

The smoke test used Playwright installed in a temporary scratch directory (not a
project dependency) with a cached Chromium; the Playwright MCP browser was unavailable
because Google Chrome is not installed.

## Bugs discovered

1. **Zod optional vs `exactOptionalPropertyTypes`.** `.optional()` infers
   `T | undefined`, which isn't assignable to the domain types' `field?: T`; `tsc` failed.
2. **Domain errors swallowed by Dexie.** `NotFoundError`/`InvalidStateError` thrown inside
   transactions reached callers as `DexieError` (3 tests failed). Cause: Dexie maps errors
   whose `name` matches a DOMException name to its own classes.
3. **Lint false positive.** Test helper `useTestDatabase` tripped `react-hooks/rules-of-hooks`
   because of its `use` prefix.
4. **Bundle-size warning.** First build produced a 500.67 kB chunk (Vite warning); Zod's
   classic API contributed ~66 kB minified.

## Bugs fixed

1. Switched to `exactOptional` — matches the documented "omit, never `undefined`" rule
   and rejects explicit `undefined`/`null` at runtime (tested).
2. Renamed to `RecordNotFoundError`/`RecordStateError`; ADR-010 and a code comment
   explain why. All 25 tests pass.
3. Renamed helper to `setupTestDatabase`.
4. Moved schemas to `zod/mini`: 500.67 → 434.17 kB (156.31 → 138.44 kB gzip), warning gone.

## Known limitations

- Temporary UI only; no feature screens.
- Only Task and Inbox repositories exist; Habit, HabitEntry, Hackathon and ProtectedTime
  have types, schemas and stores but no repository.
- No reactive data subscription yet (screen reads once on mount). To be decided in
  PHASE 001.
- No export/backup, no persistent-storage request, no encryption — see SECURITY.md.
- No committed E2E tests; the browser smoke run above was ad hoc.
- `processedAt` isn't indexed; unprocessed items are a filtered scan (fine at personal scale).
- Tests use fake-indexeddb, not a real browser engine.
- npm 11 prints an install-script warning for `fsevents` on every install (harmless;
  documented in SETUP.md).
- The bundle is still ~434 kB (React DOM, React Router, Dexie). Route-level code
  splitting can come when there are routes worth splitting.

## Demo / screenshot notes

Screenshots of the foundation screen were taken in light and dark during the smoke run
and reviewed, but not committed (temporary UI; not worth repository weight). To see it:
`npm run dev` and open `http://localhost:5173` — expect "LOWTIDE", "Local database:
Ready", "Schema version: 1", "Unprocessed inbox items: 0".

## Security considerations

- No secrets, env vars or credentials exist or were committed; staged diff was scanned
  (only false positives such as the `css-tokenizer` package and "design tokens").
- No network calls at runtime (verified); no analytics; system fonts only.
- `.gitignore` covers `.env*` and `lowtide-export*/backup*` JSON.
- Data is unencrypted in IndexedDB; protection relies on the OS/browser. Documented
  honestly in SECURITY.md.

## Post-review corrections

An independent review of `8208b4e` accepted the foundation but found three issues.
They were fixed in one follow-up commit on 2026-09-28
(`fix(phase-000): tighten domain and storage boundaries`; find its SHA with
`git log --oneline -- docs/phases/PHASE-000.md`, since it can't record its own).

1. **Relationships were a habit category.** `HABIT_CATEGORIES` contained
   `relationships`, contradicting the principle that time with people is never a
   habit, streak or activity square. Removed it with no replacement; `ProtectedTime`
   keeps `relationship | family | friends | rest | personal`. Updated DATA-MODEL,
   PRODUCT, DECISIONS (ADR-013). Tests added: the habit schema rejects `relationships`,
   and protected time still accepts relationship/family/friends. No migration needed:
   nothing in PHASE 000 writes habits.
2. **Repository contract overstated errors.** `types.ts` said missing records always
   reject with `RecordNotFoundError`, but `TaskRepository.get` resolves `undefined` (by
   design). The contract now says: lookups resolve `undefined`; operations needing an
   existing record reject with `RecordNotFoundError`; invalid-state operations reject
   with `RecordStateError` (ADR-014, ARCHITECTURE § Errors). Test added for `get` on a
   missing id. No behaviour changed.
3. **Storage boundary only blocked the `dexie` package.** UI code could still import
   `src/db/database.ts` and use `LowtideDatabase` directly. `eslint.config.js` now also
   blocks, anywhere in `src/`, imports of `db/database`, `db/repositories/dexie-*` and
   `db/repositories/shared`, and additionally `db/schema` in
   features/components/hooks. `src/db`, `src/main.tsx` and `src/test` are exempt. No
   new dependency. `src/test/storage-boundary.test.ts` (11 tests) lints probe sources
   through the ESLint API. Mutation check: with the database regex disabled, 7 of its 11
   tests failed; restored, all passed. Known limit (documented in ARCHITECTURE):
   dynamic `import()` isn't covered.

The "Boundary" bullet under "Foundation implemented" describes the original state;
this section supersedes it.

**Checks run after the corrections (2026-09-28):** `npm run check`, which runs
`typecheck` → `lint` → `format:check` → `npm test -- --run` → `build` in sequence and
stops on the first failure: all passed, **7 test files, 39 tests** (was 6 / 25).

## Next phase

**PHASE 001 — App shell, Inbox and Tasks.** Start from
[ROADMAP.md § PHASE 001 starting point](../ROADMAP.md#phase-001-starting-point): add
`src/features/inbox` and `src/features/tasks`, replace `FoundationScreen` with a real
shell and routes, extend the two repositories only as screens need, and record an ADR
for how components subscribe to data changes.
