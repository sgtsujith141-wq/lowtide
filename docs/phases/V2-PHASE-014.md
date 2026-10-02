# LOWTIDE v2 PHASE 014 — SPACE

**Date:** 2026-10-02 · **Status:** PASS

SPACE becomes LOWTIDE's working home for project knowledge: the hierarchy imported from
Notion in PHASE 010, readable and editable in a three-pane workspace, and reachable by
authorised AI clients over MCP. Projects, Home, Sleep and Work are untouched apart from
the global command palette.

## Architecture

- **Data:** `SpaceNode` (schema V7) stays the one record for sections, pages and tables.
  Schema V9 adds three optional fields: `blocks`, `revision` and `edits` (ADR-067). No
  new store; Dexie version 9 and companion migration 5 add them additively.
- **Content:** `src/lib/space-blocks.ts` reads a page's content. A page written in
  LOWTIDE has `blocks`; an imported page keeps its Notion body untouched and is parsed
  into blocks on the fly. The first edit writes `blocks` beside the original body, which
  stays as it was.
- **Repository:** `space.saveContent` (against a revision), `appendBlocks`,
  `updateBlock`, `setCell`, `addRow`, `addLink`/`removeLink`, `duplicate`,
  `ensureProjectSpace`, and `move` now inserts at a position. Every change bumps the
  revision and adds to the page's batched history, attributed to the owner or the AI
  client. Still no ledger events: knowledge is not activity.
- **Screen:** `src/features/space/`: the tree, the editor, tables, the inspector, the
  model (paths, project ownership, backlinks, search) and the record lookup.
- **MCP:** ten SPACE tools in `companion/server/tools.ts` (ADR-068).

## Page and block model

Blocks: paragraph, heading 1–3, bullet and numbered lists (indent 0–3), checklist,
quote, callout, code, divider, file reference, link (to a page, project, task,
milestone, decision, hackathon or item), table embed, an imported static table (`grid`),
and `fallback`: imported content LOWTIDE can't edit, kept exactly and shown read-only.
Text blocks hold a small inline Markdown subset (bold, italic, code, strike, links;
`space:<id>` links a page). A block an AI client wrote carries its name and time.

## Hierarchy (tree)

The left pane is the real hierarchy: Projects (each project's folder with its standard
sections), Hackathons, College, Ideas, Personal, Archive. A WAI-ARIA tree: arrows move
and fold, Enter opens, F2 renames, Shift+F10 or the menu key opens a row's menu (new page
inside, rename, duplicate, move to…, archive or restore). Rows drag before, after or into
another. The open page's location opens once and stays highlighted. Counts show on
top-level sections only. A filter keeps the path to every match; archived pages show on
request. Live projects with no pages yet appear as quiet placeholders; their folder and
standard sections are made only when first used.

## Editor

Quiet until used: no toolbar. Enter splits a block (lists and checklists continue; an
empty item leaves the list), Shift+Enter breaks a line, Backspace at the start outdents,
turns a block back into text, merges it into the one before, or removes a reference
before it. Markdown shortcuts: `#`, `##`, `###`, `-`, `1.`, `[]`, `>`, ` ``` `
and `---`. `/` opens a short menu (twelve commands at a time; typing finds the rest:
links, files). Cmd/Ctrl B, I and E format; Alt+Shift+↑/↓ or drag moves a block; each
block has an options menu (move, turn into, delete). Undo and redo are the editor's own
(Cmd/Ctrl Z, Shift+Cmd/Ctrl Z). Pasting several lines makes blocks.

## Tables

Imported tables are first-class: typed columns (text, number, yes/no, date, choice,
status, multi-choice, URL, links), sorted by any column, filtered by text and by a
choice, edited in place where safe (text, number, yes/no, date, choice, status, URL);
multi-choice and link cells are shown and linked, not edited. Rows can be added. Long
tables show 100 rows, then more on request. A page can embed a table; the slash menu
makes a new one.

## Links and backlinks

A page's links come from three places, read live and never copied into text: its own
links (the inspector's Link, or an AI client's `link_space_entity`), link and table
blocks, and inline `space:` links. Backlinks are every page whose links include it,
including table rows. The inspector shows both.

## Context inspector

Location; for a page under a project, the project's live state (state and focus,
milestone completion, current and next, counts of tasks, decisions, milestones and
SPACE pages, Open Command Room); links and backlinks; source (Imported from Notion, the
original title and path, a link to the original); files; created, updated and AI
activity; the batched history. Personal pages say they're private.

## Search

Cmd/Ctrl P in SPACE finds pages, tables, sections and decisions by title, content, table
names and cells, import provenance and linked project names, with location, type and an
excerpt; arrow keys and Enter. Cmd/Ctrl K, now global, also finds SPACE pages, tables and
decisions, and offers places to go by name. All local; no AI.

## AI writes and permissions (ADR-068)

| Tool                                                                | Does                                                                                                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_space_tree`                                                    | The hierarchy in scope, a few levels deep.                                                                                                    |
| `get_space_page`                                                    | Content as Markdown and blocks (with ids), table, links, subpages, revision, source.                                                          |
| `search_space`                                                      | Find pages and tables in scope.                                                                                                               |
| `create_space_page`                                                 | Save at a path of titles, making what's missing (a project's standard sections in place); adds to an existing page instead of duplicating it. |
| `create_space_subpage`, `append_space_blocks`, `update_space_block` | Write content.                                                                                                                                |
| `add_space_table_row`, `link_space_entity`, `archive_space_page`    | Rows, links, archiving (never a maintained section).                                                                                          |
| `park_item`                                                         | Also records a new parked idea by title.                                                                                                      |

Scope: a project grant sees its project's folder; workspace sees Projects, Hackathons,
Ideas and Archive; global sees everything except College and Personal without those
permissions. **Personal SPACE** is a new sensitive permission, off by default. Every call
is audited; every write goes through the SPACE repository as the client, so it is
attributed in the page's history and on each block, and the app updates live. Generated
context (`PROJECT.md`, `CONTEXT.md`) is not SPACE and can't be written by a client.

The two workflows from the brief, run against a copy of the owner's data through the
real MCP endpoint: "save this under the primary project → Architecture → PDF Engine"
made the Architecture section and the page in one call, attributed; "put this idea under
the secondary project → Ideas and park it" made the page, a parked idea, and linked them
(three calls). A repeated save appended instead of duplicating; Personal was refused to
the workspace grant; every call was in the audit log.

## Autosave and conflicts

The editor saves 0.7 s after the last change, against the revision it loaded. A change
from elsewhere while nothing is unsaved simply appears (only the changed blocks
re-render). With unsaved text, the page says who changed it and offers: use the new
version, save mine as a copy, or keep mine (replacing it). A save that races a write is
refused by the repository (`SpaceConflictError`) and gets the same choice. Leaving the
page saves what's pending.

## History

Each page keeps up to 200 entries: who (you or the AI client by name), what kind
(created, edited, renamed, moved, archived, restored, table, linked) and when. One
author's edits within 15 minutes are one entry with a count. No content and no hidden
reasoning is stored.

## Provenance and files

Imported pages say "Imported from Notion" under the title; the inspector holds the
original title, path and link. Editing keeps the original body. Files are references:
an imported attachment reads "External reference (not downloaded)"; a new reference
keeps a name, type, size and URL and says "Reference only". Nothing claims a file was
downloaded.

## Keyboard

Cmd/Ctrl K (palette, everywhere), Cmd/Ctrl P (find in SPACE), `/` (blocks), Escape
(menus, drawers, dialogs), the tree's arrow keys, F2 and Shift+F10, the editor's
shortcuts above, and arrow keys on the pane edges to resize them.

## Responsive

From 1024 px: the tree pane (200–440 px) and, from 1280 px, the inspector (260–480 px),
each resizable by drag or arrow keys and folded away from the top bar; the page keeps
most of the width. Below 1024 px the page is alone; the tree is a left sheet and the
inspector a right sheet. No horizontal overflow at 320–1920 px.

## Verification

- axe-core 4.13 (WCAG 2.0/2.1 A, AA): 0 violations on SPACE home, a planning page, a
  table, a project folder and a long page with imported tables, at 320, 1440 and 1920 px,
  dark and light (70 route/width/theme overflow checks, 0 problems); 0 on the slash menu,
  block menu, tree menu, move dialog, search and both mobile sheets.
- Real browser (Chromium): creating, typing, Enter, shortcuts, the slash menu, a divider,
  undo and redo, and the content surviving a reload, with no console errors.
- Real data in the browser: SPACE with its tree in about 0.3 s, a whole-tree filter in
  0.2 s, an 11-character search in 0.24 s, opening a page in 0.08 s.
- All 67 imported bodies parse in 16 ms; nothing is lost (code languages and page links
  become block fields); four `<table_of_contents/>` placeholders show as a plain note.

## Tests

64 files, 658 tests, all passing. New: block parsing (Markdown, Notion structures,
fallbacks, links), schema V9 and the repository (revisions, conflicts, batching, AI
attribution, tables, links, duplicate, lazy project folders, migration 5 on SQLite), the
SPACE model (paths, privacy, backlinks, search at real-import scale), the SPACE screen
(tree and drawers, imported content, editing and autosave, the slash menu, live writes
and conflicts, tables, backlinks, search, the global palette, tree operations), and the
SPACE MCP tools (paths, appends, blocks, rows, links, archive, scopes, Personal
permission, audit).

## Known issues

- Inline formatting shortcuts use the browser's `execCommand`, which is deprecated but
  still supported; Markdown typed literally (`**x**`) renders on the next load.
- Table cells edited in SPACE don't change the LOWTIDE tasks those rows were imported
  from; the table is SPACE's own copy.
- No two-column layout and no uploads: files are references, as before.
