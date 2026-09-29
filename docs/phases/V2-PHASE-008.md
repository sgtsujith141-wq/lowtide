# LOWTIDE v2 PHASE 008 — Shared AI context + companion/MCP foundation

**Date:** 2026-09-30 · **Status:** PARTIAL, by design: the stage-1 foundation is
complete, and the storage move and record-changing tools are pending.

## Built

- **Context engine (ADR-054):**
  - pure, scoped packs: PROJECT (the default), WORKSPACE, GLOBAL with explicit grants;
  - the GLOBAL → PROJECT → SUBAREA → CURRENT TASK hierarchy;
  - sources listed for every pack;
  - CONTEXT.md rendering.
- **Technical workspace export (ADR-044, ADR-054):**
  - `projects/<slug>/{PROJECT.md, CONTEXT.md, planning, decisions, research, docs, files, assets, ai/{sessions,handoffs,summaries}, archive}`;
  - `hackathons/`, `daily/`, `inbox/` (always empty), `archive/`;
  - a manifest and per-project summary JSON;
  - downloaded as a ZIP from **AI & workspace** (`/ai`).
- **Context previews** (copy or download) on `/ai` and in the Command Room's AI tab.
- **Companion stage 1 (ADR-055):** `companion/lowtide-mcp.ts`, an MCP server over
  stdio:
  - project-scoped by default;
  - read tools, plus `create_note` and `log_ai_session` (add-only, audit-logged);
  - record-changing tools listed as not available, and refusing;
  - usage in `docs/COMPANION.md`.
- **SECURITY.md:** the export, the context scopes and the companion's model.

## Pending (not faked)

- Companion-owned SQLite storage (ADR-040 stage 2), and with it the record-changing
  MCP tools.
- An HTTP API (127.0.0.1, token, origin allow-list) for clients that can't spawn a
  process.
- GitHub read access.
- Importing workspace AI sessions and notes back into LOWTIDE.

## Tests

- `context-engine.test.ts` (8): packs, the privacy guarantees, the workspace layout and
  the zip format.
- `companion/companion.test.ts` (9):
  - scope and path-traversal refusal, including through a symlink;
  - summaries, add-only writes with an audit log, and refusals;
  - the MCP protocol;
  - a real stdio session with the CLI under Node.
- `ai-page.test.tsx` (4).
