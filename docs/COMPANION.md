# The LOWTIDE companion

The companion is a small program that runs on your computer, next to LOWTIDE. Once you
move LOWTIDE into it:

- your data lives in a **SQLite database** in `~/.lowtide/` instead of the browser;
- a **technical workspace** folder stays up to date by itself (PROJECT.md, CONTEXT.md,
  decisions, notes and AI sessions for every project);
- **AI clients you choose** (Claude Code, Claude Desktop, others) can read and change
  LOWTIDE through the Model Context Protocol (MCP), each only within the scope you give
  it, and everything they do is attributed to them and recorded in an audit log that you
  can read in LOWTIDE's AI area.

It listens only on `127.0.0.1` (this computer), needs a token for everything, and never
talks to the internet. Moving is always your decision, and your browser's copy is never
deleted. Decisions behind it: ADR-056 to ADR-061 in [DECISIONS.md](DECISIONS.md).

## 1. Start the companion

It needs Node 22.22 or later (the same as LOWTIDE) and nothing else. In the LOWTIDE
folder:

```sh
npm install          # once
npm run companion    # builds it, then runs it; Ctrl-C stops it
```

It prints where everything is:

```text
Data:       ~/.lowtide
Database:   ~/.lowtide/lowtide.sqlite
Workspace:  ~/.lowtide/workspace
MCP:        http://127.0.0.1:4318/mcp
```

- `npm run companion -- --data <folder>` uses another data folder.
- `npm run companion -- --port <n>` or `--workspace <folder>` change them for one run.
  To change them for good, edit `port`, `workspaceDir` or `allowedOrigins` in
  `~/.lowtide/companion.json` (owner-only, created on first start).

Keep it running while you use LOWTIDE in companion mode. If it stops, LOWTIDE shows a
banner, saves nothing until it's back, and reconnects by itself.

## 2. Pair LOWTIDE with it

```sh
npm run companion -- pair
```

prints a link like `http://localhost:5173/settings#companion=…&token=…`. Open it in the
browser where you use LOWTIDE (add `--app http://localhost:4173` if you use
`npm run preview`). The link fills in **Settings → Where LOWTIDE keeps your data**;
choose **Pair**. LOWTIDE removes the token from the address bar straight away.

The link carries your **owner token**: keep it to yourself. To replace it, run
`npm run companion -- rotate-token`, then pair again.

## 3. Move your data into the companion

In **Settings → Where LOWTIDE keeps your data**, after pairing:

1. **Download a backup.** Required. LOWTIDE exports everything and checks the file the
   same way a restore preview does. Keep the file somewhere safe; it's your copy of
   everything, untouched by what follows.
2. Tick **I have the backup file somewhere safe**, then **Move LOWTIDE into the
   companion**. The companion:
   - validates the backup again and refuses if it already holds data;
   - keeps an exact copy of it in `~/.lowtide/backups/pre-migration-<time>.json`;
   - in one transaction, copies every record with its id, reads every store back,
     compares it with the backup record by record, and commits only if everything
     matches and every link between records holds. Otherwise nothing is kept.
3. Read the report: records per store (backup and companion), and each check (counts,
   ids, identical records, no invented projects, events or sessions, protected time
   unchanged, decision history, work and off-time timestamps, no hackathon turned into
   a project, links intact).
4. Choose **Switch to the companion**. LOWTIDE reloads and from now on reads and saves
   through the companion.

Your browser's own copy (IndexedDB) is **not deleted or changed**. It stays as it was at
the moment you moved.

If the companion already holds data (you moved before, from this or another browser),
the move isn't offered, so two copies can't be mixed. You can switch to the companion's
data as it is instead.

## 4. Connect AI clients

In **AI & workspace → Give an AI client access**, choose:

- **Client:** Claude Code, Claude, ChatGPT or Other. Its **name** is shown on
  everything it does.
- **What it can see:**
  - **One project** (the default for coding agents);
  - **Every project (technical):** all projects and hackathons;
  - **Global:** also tasks that aren't in a project, all non-private activity, and,
    only if you tick them one by one, routines, off time, college and inbox.
  - **Protected time** can't be shared with any client, in any scope.
- **What it can do:** read only, or read and make changes. **Resolving approvals** is a
  separate tick: approvals are yours to give unless you delegate them.

**Create access** shows the client's **token once**, with the exact command for that
client. LOWTIDE keeps only a fingerprint of it; if you lose it, revoke and create a new
one.

**What has been tested (PHASE 008B):** the stdio bridge in real MCP sessions (the
handshake, tool listing and every tool, driven by a test client exactly as a client that
launches a local command would), the HTTP endpoint directly, and a headless-browser run
of the whole flow (`npm run e2e:companion`). The commands below follow each client's
documented configuration, but they haven't been run inside the Claude Code or Claude
Desktop apps yet: LOWTIDE's AI area will show whether they connect.

### Claude Code

Claude Code launches the stdio bridge itself:

```sh
claude mcp add lowtide --scope user -e LOWTIDE_TOKEN=<token> -- node /path/to/lowtide/companion/lowtide-mcp.ts
```

(`--scope user` makes it available in every project; leave it out to add it to the
current project only.) Claude Code speaks MCP over HTTP too:
`claude mcp add --transport http lowtide http://127.0.0.1:4318/mcp --header "Authorization: Bearer <token>"`.
With the bridge, LOWTIDE shows Claude Code as connected for as long as it's attached.

### Claude (Claude Desktop)

In `claude_desktop_config.json` (Settings → Developer → Edit Config), under
`"mcpServers"`:

```json
{
  "lowtide": {
    "command": "node",
    "args": ["/path/to/lowtide/companion/lowtide-mcp.ts"],
    "env": { "LOWTIDE_TOKEN": "<token>" }
  }
}
```

Restart Claude Desktop afterwards.

### ChatGPT

ChatGPT's MCP connectors reach servers over the internet. The companion deliberately
listens only on this computer, and LOWTIDE doesn't offer a way to expose it, so there's
no tested ChatGPT connection. If your ChatGPT app can launch a local MCP command, it's
the same bridge command as above.

### Other clients

- Clients that launch a local command (stdio):
  `LOWTIDE_TOKEN=<token> node /path/to/lowtide/companion/lowtide-mcp.ts`
  (`--url http://127.0.0.1:<port>` if you changed the port).
- Clients that speak MCP over HTTP: `http://127.0.0.1:4318/mcp` with the header
  `Authorization: Bearer <token>`.

### What a client can do

| Reads                                                     | Writes (read-and-change access)                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `get_context`: the scoped context as Markdown; start here | `create_note`: a note, research, handoff or summary                  |
| `get_project`, `get_project_summary`                      | `record_decision` (never edits one; can supersede)                   |
| `get_recent_activity`, `get_waiting`, `get_parked`        | `update_project`: phase, next action, objective, state (not archive) |
| `get_approval_requests`, `get_decisions`                  | `complete_task`, `complete_milestone`                                |
| `get_tasks`, `get_milestones`                             | `request_approval`; `resolve_approval` if delegated                  |
| `search_workspace`, `get_document`                        | `park_item` (or a new parked idea by title), `resume_item`           |
| `get_space_tree`, `get_space_page`, `search_space`        | `log_ai_session`: what the session did, factually                    |
|                                                           | `create_space_page`: save at a path such as `Projects / X / Notes`   |
|                                                           | `create_space_subpage`, `append_space_blocks`, `update_space_block`  |
|                                                           | `add_space_table_row`, `link_space_entity`, `archive_space_page`     |

SPACE is reached by scope: a project grant sees its project's folder (made the first time
it writes there), a workspace grant sees Projects, Hackathons, Ideas and Archive, and a
global grant sees everything except College and Personal unless you tick those
permissions (**Personal SPACE** is its own permission). SPACE writes show in the page's
history and on each block as the client's ("Updated by Claude · 2m ago"). The generated
`PROJECT.md` and `CONTEXT.md` files aren't SPACE and can't be written by a client.

Every change goes through the same rules as the app itself (a project can't be marked
done with open milestones, for example) and is attributed to the client. LOWTIDE never
stores hidden reasoning; a session record holds what the client reports: summary, result,
next action, files, commits and a handoff.

### Status, audit and revoking

The **AI clients** panel says **Connected** only when LOWTIDE heard from that client
over MCP in the last two minutes. **What AI clients did** lists every call (changes and
refusals by default, reads too if you untick the filter) with before and after. **Revoke**
stops a token at once.

## 5. The technical workspace

`~/.lowtide/workspace` (or your `workspaceDir`):

```text
projects/<slug>/
  PROJECT.md  CONTEXT.md          generated
  decisions/                      generated, one file per decision
  ai/sessions/                    generated from AI session records
  ai/handoffs/  ai/summaries/     handoff and summary notes (generated)
  docs/notes/                     notes (generated)
  research/                       research notes (generated), beside your own files
  planning/  docs/  files/  assets/  archive/   yours
hackathons/                       generated, one file per hackathon
shared/  archive/                 yours (archived projects move to archive/projects/)
```

- Files that start with **"Generated by LOWTIDE"** are rebuilt whenever LOWTIDE
  changes. Edit their content in LOWTIDE, not in the file.
- **Everything else is yours** and is never changed or deleted. If you replace a
  generated file with your own, LOWTIDE leaves it alone and lists it as a clash in the AI
  area.
- Nothing private is ever written there: protected time, sleep and off-time logs,
  routines and medication, health records, college records and raw inbox stay in the
  database.

**Git:** in the AI area, **Make it a Git repository** runs `git init` in the workspace
and adds a `.gitignore`. LOWTIDE never adds a remote and never commits: you decide what
to commit and whether to publish it.

## 6. Backups

- **Data & backup** works the same in companion mode: export a JSON backup any time,
  and restore one (the companion validates it again before replacing anything).
- The database itself is `~/.lowtide/lowtide.sqlite` (with `-wal` and `-shm` files
  while it runs). To copy it, stop the companion and copy all three, or run
  `sqlite3 ~/.lowtide/lowtide.sqlite ".backup lowtide-copy.sqlite"` while it runs.
- `~/.lowtide/backups/` keeps the exact file of every move.

Backups aren't encrypted. Keep them somewhere you trust.

### Importing from Notion

`import-notion` brings a Notion snapshot into the companion's database (ADR-062). It
never talks to Notion: an AI client with read-only Notion access captures the snapshot
first, and you keep a plan saying which records are your canonical projects, which
databases hold tasks, hackathons and decisions, and where each page lives in SPACE.
See [NOTION-IMPORT.md](NOTION-IMPORT.md). Keep both in `~/.lowtide/imports/`, never in
the repository.

```sh
# stop the companion first (Ctrl-C), then:
npm run companion:build
node companion/dist/lowtide-companion.js import-notion \
  --snapshot ~/.lowtide/imports/<run>/snapshot --plan ~/.lowtide/imports/<run>/plan.json --dry-run
node companion/dist/lowtide-companion.js import-notion \
  --snapshot ~/.lowtide/imports/<run>/snapshot --plan ~/.lowtide/imports/<run>/plan.json
npm run companion
```

- It refuses while the companion is running.
- Before writing, it saves `~/.lowtide/backups/pre-notion-import-<time>.sqlite` (an
  exact copy) and `.json` (a LOWTIDE backup you can restore in Data & backup).
- The report goes to `~/.lowtide/imports/notion-<time>.json`: every source, what it
  became, conflicts, skips and anything kept in SPACE only.
- Running it again is safe: nothing is imported twice, and anything you've changed in
  LOWTIDE since is kept.

**Undo an import:** stop the companion, move `~/.lowtide/lowtide.sqlite*` aside, copy the
`pre-notion-import-<time>.sqlite` backup to `~/.lowtide/lowtide.sqlite`, and start the
companion again.

## 7. Going back (rollback)

- **Back to the browser:** Settings → **Use this browser's storage** (after ticking the
  confirmation). The browser still holds LOWTIDE exactly as it was when you moved. To
  bring later changes along, first export a backup (Data & backup) while still in
  companion mode, then switch, then restore it in Data & backup.
- **Undo a move on the companion's side:** stop the companion, move
  `~/.lowtide/lowtide.sqlite*` somewhere else (don't delete it until you're sure), and
  start it again. It starts empty, and you can move again.
- The backup file you downloaded before moving is always a complete copy.

## 8. Security, briefly

- Loopback only (`127.0.0.1`), a Host check against DNS rebinding, and an origin
  allow-list (`allowedOrigins` in `companion.json`; add yours if you serve LOWTIDE on
  another port). Never a wildcard.
- The owner token (the app) and each client's grant token are separate; tokens are
  compared in constant time; grant tokens are stored only as SHA-256 fingerprints.
- Request size and rate limits; every AI call audited; all files owner-only (0600/0700).

More in [SECURITY.md](SECURITY.md).

## 9. If something's wrong

| You see                                  | What to do                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| "Can't reach the LOWTIDE companion"      | Start it: `npm run companion`. LOWTIDE reconnects by itself.                                |
| "The companion didn't accept that token" | Run `npm run companion -- pair` and open the new link.                                      |
| "That port is already in use"            | The companion is already running, or use `--port`.                                          |
| The app can't pair from another address  | Add that origin to `allowedOrigins` in `~/.lowtide/companion.json`, restart.                |
| A client says the token was refused      | It was revoked or mistyped: give that client new access.                                    |
| A generated file isn't updating          | You edited it; the AI area lists it as a clash. Remove your edits (or move them to a note). |
