# LOWTIDE

**Put the day down.**

LOWTIDE is a local-first place to unload mental clutter, keep the thread of unfinished
work, and come back to it without having to reconstruct where you stopped. It is not a
to-do app: there are no streaks, no scores, no productivity dashboard, and nothing is
sent anywhere. Everything lives in your browser, on your device.

This repository contains **Milestone 001** — a complete, working vertical slice.

---

## Running it

Requires Node 20+ (developed on Node 24) and npm.

```bash
npm install      # install dependencies
npm run dev      # development server on http://localhost:5173/
```

Other commands:

```bash
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build (http://localhost:4173/ unless that port is busy)
npm run typecheck  # TypeScript project build, no emit
npm run lint       # oxlint
npm test           # unit + data-layer tests (vitest)
node e2e/acceptance.mjs                                  # browser acceptance run (needs `npm run dev` first)
E2E_URL=http://localhost:4173/ OFFLINE=1 node e2e/acceptance.mjs   # same run + offline check against `npm run preview`
                                                         # (match the port `npm run preview` actually printed)
```

---

## What is in it

### The Dump (`#/dump`)
A single, distraction-free field. `Enter` saves what you have written, `Shift+Enter`
starts a new line inside one thought, and `⌘/Ctrl+Enter` saves each line as its own
thing. What you type is stored verbatim; editing a thought keeps the original text
underneath, viewable at any time. The field is only cleared **after** a write has
succeeded — if storage fails, the text stays on screen and you are told plainly. A
half-written thought also survives a page reload.

### Mental load router (`#/things`)
Each captured thing is filed by hand into one of seven drawers — Action, Commitment,
Waiting on, Idea, On my mind, Project, Archive. The queue is keyboard-driven: `1`–`7`
file the focused card, `J`/`K` move between them. Every classification is editable
forever, along with due dates, who you are waiting on, project links, return tickets
and notes.

There is **no suggestion engine in this milestone**. Keyword matching is not
intelligence, and dressing it up as such would be a lie. `src/lib/suggestions.ts`
defines the interface a real engine would implement, and the UI already has the place
to show suggestions when one exists.

### Black Box (`#/projects`)
One context capsule per project: where it stands, what you last finished, what is in
the way, the last decision you made, the exact next action, notes and links. "Save my
place" writes a **new version** — capsules are never overwritten, and the full history
stays on the project page. Reopening a project leads with *Start here* and the next
action you wrote down.

### Closure engine (`#/close`)
Five short passes, each of which can be skipped: loose ends still unfiled, commitments
due or past, choosing up to three things for next time, saving your place in projects,
and a line to the person who comes back. Nothing is required, nothing is invented, and
the summary before you close says exactly what will be written down — including how
many things you are deliberately leaving unfiled. Closing leads to a quiet screen with
no navigation at all.

### Gentle return (`#/return`)
Your last hand-off and its note, the things you chose, return tickets whose day has
arrived, commitments inside a week (overdue ones first and never hidden), and where
each project was left. The full backlog is one click away, not in your face.

### Return tickets
Any thing can be parked until a date you choose. On or after that day it appears on
Return, on the closing screen's "what is owed" pass, and in the counter on the landing
page. **LOWTIDE cannot notify you in the background.** There is no server and no push
in this milestone, so a parked item can only resurface when you open the app. That is
stated in the app itself wherever a ticket is set.

### Data (`#/data`)
Export a JSON backup, import one with a preview first, restore deleted things, see
what the browser reports about storage, and — behind a confirmation — erase everything.
An import **never overwrites or deletes** what is already stored: records whose id is
already here are counted as duplicates and skipped. Anything unreadable is listed
rather than silently dropped.

**Importing a v1 prototype backup.** The older prototype stored its data under the
browser key `lowtide.v1`. A page opened from `file://` and this app are different
origins, so this app cannot reach that storage by itself — no app can. Open the old
page, copy its JSON (`copy(localStorage.getItem('lowtide.v1'))` in the console), and
paste it into the import box. The importer accepts that shape, maps its older category
names onto this milestone's kinds, and keeps anything it cannot interpret as unfiled.

---

## Offline

The production build registers a service worker that precaches the whole app shell, so
after the first load LOWTIDE opens and works with no network at all. Data is in
IndexedDB and never leaves the device.

This is verified, not assumed: `OFFLINE=1 node e2e/acceptance.mjs` waits for the
service worker to become active, switches the browser context offline, reloads, and
asserts that the app and the saved data still come up.

The development server does not register a service worker; use `npm run preview` to
exercise offline behaviour.

---

## Architecture

```
src/
  lib/
    types.ts       domain records — plain, serialisable, id + timestamps
    model.ts       pure factories and selectors (no IO, fully unit-tested)
    db.ts          IndexedDB: schema, one write path, op log, failure messages
    repo.ts        the persistence seam — load() and commit()
    store.tsx      React provider: commit-then-update, error surfacing
    transfer.ts    export, import, validation, legacy v1 reading
    router.ts      ~50-line hash router
    clock.ts       the single place "now" enters the app
    suggestions.ts the interface a future classification engine implements
  components/      shell, dialogs, capsule form, thing item and details, toasts
  routes/          landing, dump, things, projects, project detail, return,
                   closure, closed, data
```

Three decisions make later work cheap:

- **Every write goes through one function** (`db.write`) which records an append-only
  op log next to the data. A sync engine can replay that log; nothing else changes.
- **`repo.ts` is an interface with one implementation.** A cloud adapter implements
  `load`/`commit` and the components never learn about it.
- **Domain rules are pure functions** in `model.ts`, so they are testable without a
  browser and reusable on a server.

Hash routing (`#/things`) is deliberate: the built app works from any static host or
straight off disk, with no rewrite rules.

---

## Design

The PAPER direction: `#F4F1E8` paper, `#21382C` ink, `#206849` accent, `#FFFDF8`
surface, `#D9DFD4` rules. Editorial serif for anything you wrote or are meant to read
(the system's Iowan Old Style / Palatino / Georgia stack — no web fonts, so nothing is
fetched at runtime), a system sans for controls. No icons that carry meaning alone, no
decoration that costs legibility.

One deliberate deviation: the brief's secondary text colour `#68766B` measures 4.23:1
against the paper background, just under WCAG AA for body text. The text tone is two
steps deeper (`#626F64`, 4.68:1) and the stated value is kept as `--color-muted-soft`.
Every other pairing in the palette passes AA comfortably (ink 11.2:1, accent 5.9:1,
accent on primary buttons 6.6:1).

Accessibility: semantic landmarks and headings, a skip link, visible focus rings,
labelled fields, `aria-pressed`/`aria-expanded`/`aria-current` on stateful controls,
native `<dialog>` for modals (so focus containment and Esc come from the platform),
live regions for save confirmations and errors, full keyboard operation, and
`prefers-reduced-motion` honoured globally.

---

## Tests

`npm test` runs 29 tests over the parts that must not break:

- **model** — text preserved verbatim, edits keep the original, classification stays
  editable, due/overdue/return-ticket selection, capsule versioning, hand-off records.
- **storage** — round trip through IndexedDB, survival across a close/reopen, in-place
  replacement, the op log, and explicit wiping.
- **transfer** — export/import round trip, duplicate skipping (no overwrite), the v1
  prototype shape, recovery from damaged records, unreadable files, orphaned capsules.
- **workflow** — the brief's acceptance path end to end against real storage.

`e2e/acceptance.mjs` drives a real Chromium through the same path: dump → file →
project → capsule → close the day → reload → return → export → wipe → restore, with an
optional offline pass.

---

## Known limitations

- **One device, one browser.** No accounts, no sync. A backup file is the only way to
  move data.
- **No background notifications.** Return tickets and due dates surface when you open
  the app.
- **No AI.** The seam exists; nothing is plugged into it.
- **Browsers can clear site data.** The Data page asks for persistent storage and
  reports the browser's real answer, but a "clear browsing data" always wins. Export.
- **No undo for a capsule save** — it does not need one: saving adds a version and the
  old one stays in history.
- Deleted projects keep their capsules (so undo restores everything); only things can
  be permanently removed from the Data page.
