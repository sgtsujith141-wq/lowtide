# LOWTIDE

**Put the day down.**

LOWTIDE is a local-first place to unload a busy mind. You write things down without
deciding what they are, file them later if you feel like it, keep the thread of
unfinished projects, and close the day properly so there is somewhere to come back to.

It is not a to-do list. There are no streaks, no scores, no productivity guilt, and
nothing leaves your device.

---

## Running it

Node 20+ and npm.

```bash
npm install
npm run dev        # http://localhost:5173/
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run preview` | Serve the built app (offline behaviour only exists here) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | oxlint |
| `npm test` | Unit and storage tests (vitest) |
| `npm run test:e2e` | Browser suite — needs a server running (see below) |
| `npm run test:all` | typecheck + lint + unit tests + build |

The browser suite runs against whichever server you point it at:

```bash
npm run dev &                 # or: npm run preview &
node e2e/acceptance.mjs                                         # dev server
E2E_URL=http://localhost:4173/ OFFLINE=1 node e2e/acceptance.mjs  # built app + offline pass
```

---

## The shape of it

**Home is a desk, not a dashboard.** A greeting, the notebook, today’s page, where you
stopped, and a companion column with tonight’s ritual and anything close. A quiet rail
on the left; on a phone, a reachable bar at the bottom.

**The notebook** is the most important control in the app.

- `Enter` saves. `Shift+Enter` makes a new line inside one thought. `⌘/Ctrl+Enter` also saves.
- Empty and whitespace-only input create nothing.
- An IME composition keeps `Enter` for itself, so Japanese, Chinese and Korean input
  can accept a candidate without submitting.
- After saving, the composer clears **and keeps focus**, so the next thought can be
  typed immediately.
- If the write fails, the complete text comes straight back into the notebook with an
  explanation and a “Try again” button. Nothing is ever thrown away.
- An unsent draft survives a refresh.

**Filing** happens on the row itself: a small chip opens a menu of the seven kinds
(Action, Commitment, Waiting, Idea, On my mind, Project, Archive), with `1`–`7` on the
keyboard during a filing pass. Dates, projects and return tickets open as a strip under
the line — never a dialog. Changing your mind is always allowed, and the words you
first wrote are kept if you edit a thought.

There is **no suggestion engine**. Keyword matching is not intelligence and would not
be described as such. `src/lib/suggestions.ts` defines the interface a real model would
implement; nothing is plugged into it.

**The Black Box** keeps one project’s memory: name, description, where it stands, what
you last finished, what is in the way, the last decision, the exact next action, notes
and links. “Save my place” writes a **new snapshot** — earlier ones are never
overwritten and stay readable under *Earlier places*. Reopening a project leads with
“Here’s where you left off.”

**The evening ritual** is one quiet page: what is close, what is still loose, where your
projects stand, tomorrow’s starting point (up to three), and a line to the person who
comes back. Everything on it is optional. It states plainly what is already saved and
that closing the day schedules nothing. Then a still screen: *Your day is saved.*

**The gentle return** shows the real hand-off — the note you wrote, what you chose,
return tickets whose day has arrived, commitments inside a week with overdue ones
first, and where each project was left. The whole backlog is one click away, not on
the first screen.

**Return tickets** put something aside until a date you pick. On or after that day it
appears on Home, on Return, and in the ritual. **LOWTIDE has no background
notifications** — there is no server and no push, so a parked item comes back when you
open the app. The app says so wherever a ticket is set.

---

## Design

WARM PAPER: `#E8E4D8` desk, `#FAF7F0` paper, `#F0EDE3` second surface, `#29392F` ink,
`#35644C` forest for action, `#936D45` brown for what you owe someone, `#D8D2C3` lines,
with sage and sand for quiet emphasis. A single inline SVG grain gives the desk a
surface; the composer sits on ruled lines whose spacing is the text’s own line-height.

Editorial serif (the system’s Iowan Old Style / Palatino / Georgia stack — no web
fonts, so nothing is fetched at runtime) for anything you wrote or are meant to read;
a system sans for controls. Italic serif stands in for handwriting, which stays
readable where a script face would not.

Two palette tones are deepened for contrast: `#936D45` and `#77786C` measure 4.35:1 and
3.52:1 as small text, under WCAG AA, so text uses `#7F5B39` and `#646558` and the
originals remain for fills and lines. Ink is 11.4:1, forest 6.4:1, and paper on a
forest button 6.4:1.

Accessibility: landmarks and headings, a skip link, visible focus rings, labelled
fields, `aria-pressed` / `aria-expanded` / `aria-current` on stateful controls, menus
with roving focus and `Esc`, native `<dialog>` for the few real modals, live regions
for save confirmations and failures, full keyboard operation, and
`prefers-reduced-motion` honoured globally. Entry animations use `backwards` fill so a
finished animation leaves no transform behind — a lingering transform creates a
stacking context that would trap popovers under their neighbours.

---

## Architecture

```
src/
  lib/
    types.ts        domain records — plain, serialisable, id + timestamps
    model.ts        product rules as pure functions (no IO, unit-tested)
    db.ts           IndexedDB: schema v2, one write path, op log, migrations
    repo.ts         the persistence seam — load() and commit()
    store.tsx       React provider: commit-then-update, failures surfaced
    transfer.ts     export, import, validation, older-format reading
    router.ts       hash router (~50 lines)
    clock.ts        the single place "now" enters the app
    suggestions.ts  the interface a future classification engine implements
  components/       shell and rail, composer, thought row, menu, capsule form,
                    dialogs, toasts, icons
  routes/           home, things, projects, project detail, return, ritual,
                    closed, data
```

Every write goes through `db.write`, which records an append-only op log beside the
data — a sync engine would replay that log and nothing else would change. `repo.ts` is
an interface with one implementation today. Domain rules are pure functions, testable
without a browser.

Hash routing is deliberate: the built app works from any static host or straight off
disk, with no rewrite rules.

### Storage and migrations

The database is `lowtide`, now at **version 2**. Migrations only ever add: version 2
gave projects a `description`, and the upgrade fills it in for existing records without
deleting or rewriting anything else. Records are also repaired on read, so the app
never depends on a migration having completed and never shows `undefined` where a value
should be. `npm test` and the browser suite both build a version 1 database by hand and
assert that the data survives the upgrade.

Nothing in the redesign wipes IndexedDB or localStorage.

**Coming from a `file://` prototype:** a page opened from disk and this app are
different origins, so this app cannot read that storage — no app can. Export the old
JSON (`copy(localStorage.getItem('lowtide.v1'))` in that page’s console) and paste it
into *Backups → Or paste JSON*. The importer reads that shape, maps its older category
names, and keeps anything it cannot interpret as unfiled.

---

## Offline

The production build precaches the app shell with a service worker, so after the first
load LOWTIDE opens and works with no network. Data lives in IndexedDB and never leaves
the device.

Verified, not assumed: the `OFFLINE=1` pass waits for the service worker to become
active, switches the browser context offline, reloads, and writes a new thought with
the network down.

---

## Tests

`npm test` — 30 tests over the model, storage (including a version 1 → 2 migration
built by hand), import validation and recovery, and the full workflow.

`node e2e/acceptance.mjs` — 49 checks in a real Chromium (52 with the offline pass),
covering the sixteen behaviours this milestone requires:

1. Enter submits · 2. Shift+Enter inserts a newline · 3. IME composition does not
submit · 4. Empty input creates nothing · 5. Capture restores focus (and a second
thought can be typed straight away) · 6. A failed write keeps the complete draft and
can be retried · 7. Thoughts survive a refresh · 8. Classification, including changing
it again · 9. Editing and deleting, with undo and the original text kept · 10. Black
Box snapshots persist · 11. Earlier snapshots stay readable · 12. Hand-offs persist ·
13. Gentle Return shows the real saved data · 14. Return tickets surface on their day ·
15. JSON export and import, including restoring a wiped device · 16. Data written by
the previous schema survives the migration.

The failed-write test breaks `IDBDatabase.prototype.transaction` inside the page, so
the failure path is exercised for real rather than mocked.

---

## Limitations

- **One device, one browser.** No accounts, no sync. A backup file is the only way to
  move data.
- **No background notifications.** Return tickets and due dates surface when you open
  the app, and the app never claims otherwise.
- **No AI.** The seam exists; nothing is behind it.
- **Browsers can clear site data.** *Backups* asks for persistent storage and reports
  the browser’s real answer. Export anyway.
- Projects are soft-deleted only (so undo restores their snapshots); individual
  thoughts can be removed permanently from *Backups*.
- Dark mode is not in this milestone.
