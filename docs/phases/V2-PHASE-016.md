# LOWTIDE v2 PHASE 016 — Final product refinement and QA

**Date:** 2026-10-02 · **Status:** PASS

The last refinement pass of LOWTIDE v2: every main screen reviewed on the owner's real
data, one real bug fixed at its root, the remaining rough edges smoothed, and the whole
product re-verified (tests, builds, end-to-end, accessibility, overflow, data safety and
MCP). No schema change; no data was rewritten.

## Bug fix: the rhythm stepper

Quick taps on a rhythm's − / + could start from a stale amount. After a save completed,
the "wanted" amount was cleared and the next tap fell back to the `saved` prop before the
live entry had caught up, so two fast taps could store 1 instead of 2.

**Root cause and fix** (`src/features/rhythm/HabitLogRow.tsx`): the row now keeps the
pending amount until the stored value equals it _and_ no save is in flight; saves are
queued in order, and a failure clears the pending state and says nothing changed. The
test was strengthened, not weakened: rapid increments, decrements, mixed sequences,
clearing to zero, and a reload that shows the stored amount.

## Screens

- **Home.** When nothing has happened today (minutes counted as shown, so a few seconds
  of off time still reads 0 m), Today says "Nothing started yet." with **Start ‹the
  primary project›**, which enters Work Mode directly. The rhythm preview is quieter:
  one small grid, a muted heading, no extra section. AI session summaries in Recent are
  concise.
- **Hackathons.** A progress view: one row per hackathon (name, how soon, stage rail,
  next action, status); **Open** shows and edits the rest in a side sheet.
- **Rhythm.** Leads with history: "History of" Overall, Work, Sleep, Projects, College,
  Personal, Gym or Routines on a large 12-month grid; choosing a day lists what happened.
- **Life.** Each area leads with state (Personal: done today and the last 7 days; Sleep:
  the last off time; Gym: sessions this week and the last one) and a 30-day pattern;
  forms appear only when asked for. **Start Sleep** is the primary action.
- **Calendar.** The month beside an agenda and an **Upcoming** list (45 days of
  coursework, hackathons, milestones, tasks and days off); arrow keys, Home/End and
  Page Up/Down move through days.
- **AI and Settings.** Compact admin: grants open on **Give access**, the workspace and
  context packs sit in details; Settings is Appearance, Data & companion, Backup,
  Privacy and (in companion mode) Advanced.
- **Data.** Restore wording says where it writes: "on this computer" when the companion
  holds the data, "in this browser" otherwise.

## SPACE

- **Long-text tables.** Columns are sized from their content (prose gets 16–22 rem,
  short values stay narrow), wide tables scroll sideways, the first column stays fixed
  while scrolling, and long cells clamp to three lines until **Rows: Show full text**
  (read-only cells also carry their full text as a tooltip). Nothing about the table
  data changes.
- **Code and Mermaid.** Code blocks show their language and a **Copy** action
  (monospace, wrapped). Mermaid is shown as labelled **Mermaid diagram source**, never
  redrawn: rendering it would need a diagram library and would no longer show exactly
  what was imported.
- **SPACE home.** Sections as a quiet row, then **Recently opened** (this device only),
  **Recently updated**, **Projects** (with page counts) and **Ideas** (with **New page
  in Ideas**). All from real pages; nothing is shown that doesn't exist. Pinning isn't
  modelled, so there's no Pinned list.
- **Tree.** When the open page is archived (hidden from the tree), the tree's first row
  takes Tab focus, so the tree stays reachable (an axe finding on real data).

## Command palette

New create commands beside the mode actions: **New task** (Tasks, title focused),
**New SPACE page** (a page in Ideas, opened — as SPACE itself does), **New project** and
**New hackathon** (each page's own form, also when that page is already showing). Only
New SPACE page saves anything; the rest open the normal form.

## Copy and empty states

Destination hints are plain ("Which AI tools can see what", "Appearance, privacy").
Empty states are one short line: "No open tasks.", "No milestones yet. Progress comes
only from milestones.", "Nothing recorded yet.", "No AI sessions yet. Only a connected
AI client can report one." Technical wording stays in AI, Settings, Data and details
drawers.

## Reviews

- **Light theme:** cool, neutral greys, no cream; Sleep stays near-black in both themes.
- **Mobile (320, 360, 390):** every main screen, 0 horizontal overflow.
- **Large desktop (1440, 1920):** 0 overflow; content keeps its measured widths.
- **Performance (real data, dev build, cold load):** every screen settles in under
  0.9 s; the heaviest is a 44-row imported table (~6,700 DOM nodes, ~370 ms of long
  tasks). Palette search over everything keeps up with typing. No obvious problem, so
  nothing was changed for speed.

## Accessibility and overflow

- **Route sweep:** 17 routes (including the primary project's Command Room, a long
  table and a page with code) × 7 widths (320–1920) × dark and light = 238
  combinations. One finding (the archived-page tree, above), fixed and re-swept: 0.
- **Interactive states:** Work and Sleep modes, the chooser, the palette and its
  actions: 112 state/width/theme combinations, 0. SPACE overlays (slash menu, block
  menu, tree menu, move, search, tree and details sheets), dark and light, 0, and 0
  overflow at 390. Command Room overlays (milestone drawer, item details, work chooser,
  every tab), dark and light, 0.

## Data safety (on a disposable copy)

A `VACUUM INTO` copy of the real database, served by its own companion on port 4399
with its own token; the live profile was never written. Twice (before and after the MCP
smoke test, so AI-written pages, decisions, approvals and protected time were included):

1. **Download backup** from Data: schema 9, every store present.
2. **Restore preview:** every count in the backup equals the current count.
3. **Restore** into the disposable copy.
4. **Checks:** `PRAGMA integrity_check` ok before and after; all 21 tables row-for-row
   identical after the round trip (content hashes), including SPACE pages with
   provenance and blocks, source records, milestones, decisions, work and off-time
   sessions, routines and entries, hackathons, protected time, AI grants and audit;
   the workspace regenerated.

The disposable copies were deleted afterwards; the live database was checked read-only
(integrity ok, nothing from the tests present).

## MCP smoke test (on a disposable copy)

Through MCP over HTTP with real grants: read context and a project; create a SPACE note
(the open app showed it in ~110 ms, no reload); record a decision; request an approval
(and fail to resolve it without that permission). **Personal SPACE is refused** to a
workspace grant and to a global grant without the Personal permission. **Protected time
is unreachable** from every scope, including a global grant with every private category
ticked (searched by title, in context and in recent activity); no tool exposes it. The
audit log holds the writes and the refusals. All grants were revoked and the copy
deleted.

## Validation

- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- Vitest: 65 files, 677 tests, all passing (companion and MCP suites included: 9 files,
  47 tests).
- `npm run build` and `npm run companion:build`: pass.
- `npm run e2e:companion`: 16 steps, all passing, no console errors. Three steps were
  updated to the current UI (Give access, attribution in the Command Room's activity,
  Sleep as a dialog).

## Screenshots

Taken on real data (a disposable copy for Work and Sleep), kept outside Git: dark
desktop Home, Projects, the primary project's Command Room, SPACE, a long table,
Hackathons, Rhythm, Life, Calendar, Work Mode and Sleep; 390 px Home, Command Room,
SPACE and Sleep; light Home and SPACE.

## Known limitations

- **GitHub integration:** not built (the GitHub tab says so).
- **ChatGPT:** no direct connection; the companion listens only on this computer.
- **Notion:** a one-way, read-only import; no sync.
- **File uploads:** SPACE references files; it doesn't store uploads.
- **Workspace Git:** optional local repository only; no remote, no sync.
- **Claude / Claude Code:** the MCP endpoint and stdio bridge are built and tested end
  to end; a session from inside the real apps hasn't been run yet.
- **Other AI clients:** any MCP client that can hold a grant token should work; none
  besides the test harness has been tried.
- **Mermaid** is shown as source, not drawn. **Pinned** SPACE pages aren't modelled.
  **Recently opened** is per device.
