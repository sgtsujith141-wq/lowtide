# Operator parity (v2.1)

LOWTIDE v2.1 lets a connected AI client (Claude over MCP) do what the owner does in the
app, within the access the owner gives it. Every change is attributed, audited, previewable
and, where it can be, undoable by the owner. The full table of operations is in
[MCP-CAPABILITY-MATRIX.md](MCP-CAPABILITY-MATRIX.md).

## The rule

For every kind of record and every operation (read, create, update, move, archive,
delete) the matrix names the app surface and the MCP tool that does the same. A gap is
either **implemented** or **intentionally restricted with a reason**. The matrix lives in
code (`companion/server/tools/matrix.ts`), so `get_lowtide_capabilities` returns it to a
connected client, and a test fails if it names a tool that doesn't exist.

Intentional restrictions:

| What                                   | Why                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Permanent deletion of anything         | Off for AI clients. Projects, tasks, pages and milestones are archived; the owner restores or deletes. |
| Protected Time (read or write)         | Never available to any AI client, the Full operator included.                                          |
| Grants and tokens                      | Only the owner gives, changes or revokes access; tokens are shown once.                                |
| Backup restore over MCP                | Owner only. Claude can take a checkpoint (`create_checkpoint`) but not restore one.                    |
| Moving projects                        | Projects have no place to move to.                                                                     |
| Deleting college entries, routine logs | Mark cancelled or clear the day's log instead (both reversible).                                       |

## Permissions

A grant is a set of capabilities (`projects.read`, `projects.create`, `tasks.edit`,
`space.structure`, `life.write`, …) plus a scope (one project, every technical project,
or global) and the private categories it may see. The owner chooses a preset or Custom
in **AI → Give access**:

| Preset                    | For                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read only                 | Reading projects, tasks, decisions, hackathons and SPACE. Changes nothing.                                                                           |
| Project operator          | Running one project: tasks, milestones, decisions, its SPACE pages, sessions.                                                                        |
| Workspace operator        | Every technical project, creating and archiving projects, all of SPACE.                                                                              |
| **Full LOWTIDE operator** | Everything the owner can do, including routines, college, inbox, off time and Personal SPACE — except Protected Time, tokens and permanent deletion. |

Grants made before v2.1 keep working: their old read/write access maps onto the
equivalent capabilities. An owner can change a grant's capabilities later without a new
token.

A refused call says what and why, in one form: `Cannot <action>. Grant lacks
<capability>.` Tools a grant cannot use are not listed to it.

## How Claude works safely

- **Context first.** `get_context` returns the global picture, a project's, or a SPACE
  path's. `get_lowtide_capabilities` lists what this grant may do.
- **Names, not ids.** Projects, milestones, pages and folders resolve by name, slug or
  path (`Projects/Engine/Docs`). If a name matches more than one record, the call is
  refused with the candidates, never guessed.
- **Idempotent creation.** Creating a project, folder, page or database that already
  exists with that name in that place returns the existing one.
- **Atomic high-level tools.** `create_project_from_brief`, `organize_space`,
  `document_project_session` and bulk moves run in one transaction: all or nothing.
- **Preview.** Structural and bulk tools take `dryRun: true`. LOWTIDE runs the change in
  a transaction, reports exactly what would happen, and rolls it back.
- **Checkpoints.** Bulk changes above a tool's threshold take a SQLite checkpoint first
  (also taken before a backup restore and before a schema upgrade). Checkpoints are
  listed and restorable in **Settings → Checkpoints** (owner only).
- **Concurrency.** Page edits carry the revision they were based on; a stale revision is
  refused, never overwritten.
- **No LLM inside LOWTIDE.** The companion runs only deterministic code. Claude's
  reasoning stays with Claude; `log_ai_session` records a factual summary, never hidden
  reasoning.

## Review and undo

Every AI write is recorded twice: in the audit log (what, who, when, which tool) and,
when it can be reversed, as a change with its inverse operations. **AI → What AI
changed** lists them, with a count on the rail badge while there are unseen ones.

**Undo** applies the inverse, but only if the record is still as Claude left it (same
revision, timestamp or fields). If the owner or anyone else changed it since, undo is
refused with a message rather than overwriting the later edit. Batches undo together.

## The Claude Operating Guide

A page at **SPACE → LOWTIDE → AI → Claude Operating Guide** explains the conventions
(where project docs go, how to name things, when to preview, how to hand off a
session). The companion keeps it in place on start; `get_context` points to it.

## The thirty workflows

`companion/server/operator-mcp.test.ts` runs thirty real owner workflows over the MCP
protocol against a real SQLite store, as a Full operator: create a project with its SPACE
home and from a brief (idempotently); folders, subfolders, pages and documentation;
tasks, subtasks, milestones and reordering; decisions and superseding; blockers and
approvals; park and resume; hackathons and stages; a database with properties, rows, a
relation and rollup, views and queries; links; moving, archiving and restoring pages
and the project; a session handoff written into SPACE; reading the resulting context;
the audit; and live updates to the app. Further tests cover undo (and its refusal after a
later edit), dry runs and checkpoints, permission refusals, Protected Time under the Full
preset, ambiguity, and the matrix itself.

## What still needs the owner

- Giving, changing and revoking access; seeing a token (once).
- Permanent deletion (from the Trash or a project's archive).
- Restoring a backup or checkpoint.
- Anything in Protected Time.
- Installing the companion's autostart LaunchAgent and restarting it from Settings.
