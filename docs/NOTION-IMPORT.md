# Importing from Notion

LOWTIDE can bring a Notion workspace into its own records and into SPACE, its knowledge
hierarchy (ADR-062). The importer is generic; everything about a particular workspace
lives in two private files in the data folder, never in this repository.

## The two inputs

**The snapshot** is what was read from Notion, read-only, one file per object:

```
snapshot/
  snapshot.json            { "capturedAt": "<ISO time>" }
  nodes/<id>.json          a page: id, url, title, icon, parentId, parentKind (page | database), properties, lastEditedAt, truncated
  nodes/<id>.md            its body: Notion's enhanced Markdown, exactly as fetched (empty for a blank page)
  databases/<id>.json      a database: id, url, title, parentId, inline, linkedView, dataSources[{ url, name, schema, rows }]
```

Ids are Notion's 32-character hex ids. Database rows are kept exactly as a view query
returns them (checkboxes as `__YES__`/`__NO__`, relations and multi-selects as JSON
arrays, dates as `date:<name>:start|end|is_datetime`). Every row is also saved as a page,
so its body comes along. Linked views are marked `linkedView: true`; they hold no rows.

A snapshot can be captured by an AI client connected to Notion with read-only use of
`fetch` (pages and databases) and view-mode queries (rows). Nothing in LOWTIDE calls
Notion.

**The plan** (`plan.json`, checked by `migrationPlanSchema` before anything is written):

- `projects`: each canonical project with its `key`, `name`, `slug`, `kind`, and the
  Notion record that is its authority (`source`). `legacy` lists older duplicates of the
  same project (kept as provenance, never a second project); `references` lists related
  pages that aren't authoritative.
- `databases`: a role per database id.
  - `projects`: which properties give the state, objective, phase and next action, how
    states map, and which non-empty properties become open project items (a blocker…).
  - `tasks`: the project (fixed, or through a relation to project rows), which
    properties give title, status, done, priority, due day and notes, an optional select
    whose options become milestones, and `duplicates` (row → canonical row elsewhere).
  - `hackathons`: property names and value maps for status, registration, PPT and build.
  - `decisions`: the project (fixed, or through a relation that must name exactly one
    canonical project; otherwise the decision stays in its SPACE table), and which
    properties make the title, decision, context and consequences.
  - `table`: kept as a SPACE table only. Every database becomes a SPACE table anyway.
- `milestoneSets` (optional): for a project, the task rows a source explicitly treats as
  its milestones (a dashboard counting them, an ordered phase list), in roadmap order,
  with the `evidence` page and a `reason` (ADR-065). Each row becomes one milestone and
  stays a task. Never inferred: only listed rows.
- `placements`: where a page or database goes in SPACE: a section (`projects`,
  `hackathons`, `college`, `ideas`, `personal`, `archive`, optionally with sub-sections
  like `ideas/Research`), a project (`project:<key>`) or one of its slots
  (`project:<key>:planning`). Anything not placed follows its Notion parent; a root
  with no placement goes to `archive/Unsorted Notion`. `archived: true` marks a
  placement and everything under it as archived.
- `skip`: ids that aren't imported, each with its reason.

## What the importer guarantees

- One transaction; a dry run does everything and rolls back.
- Idempotent: each source is remembered in `sourceRecords`; a second run finds it and
  updates or leaves it, never duplicates it.
- LOWTIDE wins: a record changed in LOWTIDE since the import, or one LOWTIDE already had
  (same project slug or hackathon name), keeps its values; decisions are never
  rewritten. Each case is reported as a conflict.
- No invented history: no ledger events, work sessions, progress snapshots or AI
  sessions, no completion times Notion didn't record, and imported records never count
  as activity. A milestone from a milestone set that Notion marks done is done by its
  row's last Notion edit (the latest moment Notion recorded it so).
- Provenance on everything: source id, URL, original title, path, timestamps.
- Files are kept as external references (name and source URL), never claimed as
  downloaded.

## Running it

See [COMPANION.md](COMPANION.md#importing-from-notion). The report lists every source
and what it became, which is what a migration manifest and report are built from.
Manifests and reports name personal records: they stay in the data folder (the
repository ignores `docs/NOTION-MIGRATION-*.md`).
