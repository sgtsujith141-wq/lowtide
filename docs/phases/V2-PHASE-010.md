# LOWTIDE v2 PHASE 010 — Canonical data consolidation and the Notion import

**Date:** 2026-10-01 · **Status:** PASS (data only; no screen changed)

## What was built

- **Schema V7** (ADR-062): `spaceNodes` and `sourceRecords`, additive, on Dexie and in the
  companion's SQLite (companion migration 3). Backups carry 19 stores; V1–V6 still import.
- **SPACE**: a hierarchy of sections, pages and typed tables with links to LOWTIDE records,
  attachments kept as references, provenance and archive status; six maintained roots
  (Projects, Hackathons, College, Ideas, Personal, Archive) and per-project slots. A
  repository for it; no UI yet.
- **The Notion importer** (`src/db/import/notion`): generic, pure over the storage
  contract, driven by a snapshot and an owner plan that both live in the data folder.
  Idempotent through `sourceRecords`; LOWTIDE wins where it changed or already had the
  record; duplicates are provenance, never second projects; every database is also a
  SPACE table; no invented history; one transaction; dry runs roll back.
- **`lowtide-companion import-notion`**: refuses while the companion runs, copies the
  database before anything else, writes a LOWTIDE backup, a report, and regenerates the
  workspace.
- **Activity honesty:** imported records never count toward the Daily Pulse or grids.
- **Workspace:** each project's SPACE subtree is projected into `projects/<slug>/space/`
  and listed in CONTEXT.md; nothing outside a project's own subtree.

## The import (owner's data, not in the repository)

- Notion was read only through the Notion MCP: `fetch` and unfiltered view queries. No
  Notion page, database or row was created, changed, moved or deleted.
- Sources: 47 pages, 293 database rows, 27 databases, 12 linked views (379 in all),
  every one listed with its destination in a private manifest.
- Verification against live Notion: all 242 rows of the 19 databases with rows matched
  value for value; 31 of the 34 largest pages matched exactly and the 3 edited after the
  crawl were re-captured, plus 2 pages created meanwhile.
- Result: 6 projects (16 legacy duplicates and 11 related sources kept as provenance),
  43 tasks (8 duplicate rows merged), 4 milestones, 2 open blockers, 10 decisions, 9
  hackathons, and 140 SPACE nodes (26 tables, 292 rows, 22 archived). 0 import conflicts,
  0 failures; 11 conflicts inside Notion itself are documented for the owner rather than
  guessed. Re-running changes nothing.
- The app, paired with the companion in a throwaway browser profile, shows the projects on
  Projects and Home, the blockers and overdue tasks in Needs you, and the hackathons; the
  Daily Pulse gained no days.
- Private documents (git-ignored, copies in `~/.lowtide/imports/notion-2026-09-30/`):
  `docs/NOTION-MIGRATION-MANIFEST.md`, `docs/NOTION-MIGRATION-CONFLICTS.md`,
  `docs/NOTION-MIGRATION-REPORT.md`.

## Tests

56 files, 589 tests (was 53 and 555). New: the importer (with a made-up workspace), the
SPACE repository, the import command. Parity (Dexie/SQLite) now includes an import.

## Risks

- The snapshot is a point in time and Notion is still being edited; running the import
  again with a new snapshot brings later changes in, safely.
- Two recent pages were copied from the fetch output by hand and spot-checked, not
  mechanically diffed.
- The first import's SQLite backup was taken after the additive V7 step (the data is
  identical; the JSON backup is complete). The command now copies the file first.
- Heavy jsdom screens (Life, Work Mode, Tasks) can exceed their waits when the machine
  is busy; seen during this phase, not in the final interleaved runs.
- SPACE has no screen and no MCP access yet.

## Next

PHASE 011, when the owner issues it.
