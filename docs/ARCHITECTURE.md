# Architecture

LOWTIDE is a static single-page app. There is no server: the browser is the runtime
and IndexedDB is the database.

## Layers

```
 components / routes (src/app, src/features/*)
        │  useRepositories()
        ▼
 repository interfaces        src/db/repositories/types.ts
        │  implemented by
        ▼
 Dexie repositories           src/db/repositories/dexie-*.ts
        │  validate with            ▲
        ▼                           │
 Zod schemas + store layout   src/db/schema.ts
        │
        ▼
 LowtideDatabase (Dexie)      src/db/database.ts  →  IndexedDB "lowtide"
```

Domain types (`src/types/domain.ts`) are plain TypeScript and are shared by every layer.

### The repository boundary

- UI and feature code never touch the concrete database. ESLint
  (`no-restricted-imports` in `eslint.config.js`) enforces, for everything under `src/`:
  - importing the `dexie` package, `db/database`, `db/repositories/dexie-*` or
    `db/repositories/shared` is a lint error;
  - in `src/features/**`, `src/components/**` and `src/hooks/**`, importing
    `db/schema` (Zod persistence schemas, store layout) is also a lint error.
  - Exempt: `src/db/**` itself, the composition root `src/main.tsx`, and `src/test/**`
    (persistence-level tests need the real database).
  - Allowed everywhere: `db/repositories` (the index: interfaces, error classes) and
    `hooks/useRepositories`.
  - `src/app/**` may still import `db/schema`: the temporary foundation screen reads
    `SCHEMA_VERSION`. It may not import the database.
  - `src/test/storage-boundary.test.ts` lints probe sources at those paths and asserts
    the rule fires (and doesn't fire for allowed imports), so a config regression
    fails `npm test`.
  - Limits: this is static import checking. It does not see dynamic `import()` or a
    `LowtideDatabase` instance handed to UI code at runtime. The composition root is
    the only place that creates one, and it gives UI code only repositories.
- Components get data through `useRepositories()`, which reads a React context.
- The concrete implementation is chosen once, in the composition root `src/main.tsx`:
  `createDexieRepositories(openDatabase())`. Tests pass their own database.
- Repository methods are async, take/return plain domain objects, validate before
  writing, and enforce invariants (e.g. converting an inbox item to a task is a single
  IndexedDB transaction across both stores).

This is what allows a later sync/cloud layer: a new implementation of the same
interfaces can be swapped in at the composition root without touching components.

PHASE 000 implements only `TaskRepository` and `InboxRepository`, enough to prove the
pattern (single-store writes, queries, and a cross-store transaction). Habits,
hackathons and protected time have types, schemas and stores but no repository yet.

### Injected clock and ids

Repositories accept optional `clock` and `newId` dependencies (defaults:
`systemClock`, `crypto.randomUUID`). Tests inject a deterministic clock; production
never needs to.

### Errors

Missing records follow one rule (documented on the interfaces in
`src/db/repositories/types.ts`):

- **Lookups** (`get`) resolve to `undefined` when nothing has that id. Absence is a
  normal answer.
- **Operations that need an existing record** (`complete`, `convertToTask`, future
  update/delete) reject with `RecordNotFoundError`.
- **Operations not allowed in the record's current state** (e.g. converting an
  already-processed inbox item) reject with `RecordStateError`.
- Invalid input rejects with a Zod error before anything is written.
  Domain error names deliberately avoid DOMException names — see
  [DECISIONS.md ADR-010](DECISIONS.md).

## App shell and routing

- `src/app/App.tsx` receives `repositories` and a `router` as props (so tests can use
  a memory router and a throwaway database) and provides the repository context.
- `src/app/routes.tsx` is the route table. PHASE 000 has `/` (temporary foundation
  screen) and a catch-all "Nothing here" route.
- Browser history routing (`createBrowserRouter`). Static hosting must serve
  `index.html` for unknown paths; `vite preview` does this already.

## Styling

- Tailwind CSS 4 via `@tailwindcss/vite`, entry `src/styles/index.css`.
- Semantic tokens are CSS custom properties on `:root` (`--lt-paper`, `--lt-ink`,
  `--lt-line`, `--lt-accent`, …) and exposed to Tailwind via `@theme inline`, giving
  utilities like `bg-paper`, `text-ink-muted`, `border-line`, `text-accent`.
- Components use the semantic utilities only — no raw hex values in components.
- Dark theme: follows `prefers-color-scheme` by default; `<html data-theme="light|dark">`
  overrides it. A switcher UI is a later phase; the CSS already supports it.
- System font stacks only, so the app makes no font network requests.
- Motion: a 140 ms default transition and `prefers-reduced-motion` respected globally.

## Directory conventions

| Path                     | Holds                                                         |
| ------------------------ | ------------------------------------------------------------- |
| `src/app/`               | Composition: App, routes, context objects, app-level screens  |
| `src/features/<area>/`   | Feature UI + feature logic (from PHASE 001)                   |
| `src/components/ui/`     | Small presentational primitives (created when first needed)   |
| `src/components/shared/` | Cross-feature composed components (created when first needed) |
| `src/db/`                | Everything that knows about IndexedDB                         |
| `src/hooks/`             | Cross-feature hooks                                           |
| `src/lib/`               | Pure helpers (ids, time)                                      |
| `src/types/`             | Domain types                                                  |
| `src/styles/`            | Global CSS and tokens                                         |
| `src/test/`              | Test setup, helpers and tests                                 |

Empty folders are not created ahead of time.
