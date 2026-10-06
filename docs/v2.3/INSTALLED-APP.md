# LOWTIDE as an installed Mac app (v2.3)

After one install, daily use is: log in, click **LOWTIDE**. No Terminal, no npm, no Vite,
and no dependence on the development repository (ADR-073).

## What is where

|                          | Path                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| The app you click        | `/Applications/LOWTIDE.app`                                                                                           |
| The installed runtime    | `~/Library/Application Support/LOWTIDE/runtime/<build>/` (frontend, companion, mcp, app icon, runtime.json)           |
| What runs / the rollback | `…/LOWTIDE/current` → a build, `…/LOWTIDE/previous` → the one before                                                  |
| The launchd agent        | `…/LOWTIDE/launchd/com.lowtide.companion.plist` (and its copy in `~/Library/LaunchAgents` while Start at login is on) |
| Logs                     | `…/LOWTIDE/logs/` (launchd output, launcher, install reports) and `~/.lowtide/companion.log`                          |
| Your data (unchanged)    | `~/.lowtide/` (lowtide.sqlite, companion.json, backups, checkpoints, workspace)                                       |
| LOWTIDE                  | `http://127.0.0.1:4318/` · MCP `http://127.0.0.1:4318/mcp` · health `/api/health`                                     |
| stdio MCP bridge         | `~/Library/Application Support/LOWTIDE/current/mcp/lowtide-mcp.js`                                                    |

## Install and update

From the development repository:

```sh
npm run install:lowtide
```

It builds and checks the runtime, stages it, rehearses it on a fresh backup of your
data (migration, counts, the app, MCP over HTTP and stdio, the previous build on the
migrated copy), then switches, hands LOWTIDE to launchd, and verifies the live install.
The same command updates LOWTIDE later. `npm run install:lowtide -- --check-only` does
everything up to the switch and changes nothing that runs. `npm run build:lowtide` only
builds and checks.

## First time

1. `npm run install:lowtide` (once, from the repository).
2. Open **LOWTIDE** from Applications (drag it to the Dock to keep it there).
3. Settings → **Start LOWTIDE at login** is on by default; leave it on.
4. AI → **Give access** → Claude Code (see [CLAUDE-MCP.md](../integrations/CLAUDE-MCP.md)).
5. Optional: AI → Give access → ChatGPT (see [CHATGPT-MCP.md](../integrations/CHATGPT-MCP.md)).

## Daily use, and after a restart

1. The Mac starts; you log in.
2. launchd starts LOWTIDE in the background (it checks the database's integrity and
   serves the app, API, live events and MCP).
3. Click **LOWTIDE**: it opens in your browser, connected.
4. Claude Code and other configured MCP clients connect as before.

If you turned Start at login off, clicking LOWTIDE starts it.

## When things go wrong

| Situation                                       | What happens                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| LOWTIDE crashes or is killed                    | launchd starts it again (measured: back in 1.5 s after `kill -9`) |
| Already running when you click LOWTIDE          | it just opens; nothing starts twice                               |
| A second LOWTIDE starts for the same data       | it sees the first and exits quietly (a lock in the data folder)   |
| A lock left by a crash                          | the next LOWTIDE takes it over                                    |
| Port 4318 held by a LOWTIDE that doesn't answer | it's stopped and replaced                                         |
| Port 4318 held by another program               | LOWTIDE says which program and doesn't touch it                   |
| The runtime is missing                          | LOWTIDE.app shows an alert: install again                         |
| The development volume isn't mounted            | nothing changes: the runtime has no files there                   |
| The database is busy for a moment               | writes wait (up to 5 s) and go through                            |
| A new build fails during install                | the installer stops before or puts back the previous runtime      |

## Rollback

`previous` is kept after every update. Because LOWTIDE's schema changes are additive,
the previous build runs on the upgraded data (the installer tests this every time):

```sh
cd "$HOME/Library/Application Support/LOWTIDE"
ln -sfn "$(readlink previous)" current
launchctl kickstart -k "gui/$(id -u)/com.lowtide.companion"
```

Data rollback (only if data, not code, must go back) uses the installer's backup in
`~/.lowtide/backups/pre-install-<time>.sqlite` or Settings → Checkpoints.

Limit: a build whose schema change isn't additive could not roll back this way; LOWTIDE's
migration rules forbid such changes.

## Measured

|                                                         | Rehearsal (copy of real data) | Live install        |
| ------------------------------------------------------- | ----------------------------- | ------------------- |
| First install: old companion stopped → new answering    | 1,684 ms                      | see the v2.3 report |
| Update (launchd swap)                                   | 802 ms                        | —                   |
| Crash (`kill -9`) → healthy again                       | 1,529 ms                      | —                   |
| Login load → healthy (start, integrity check, app, MCP) | 1,195 ms                      | —                   |
| Click LOWTIDE while stopped → browser opens             | 1,861 ms                      | —                   |
| New runtime start on a copy (dry run)                   | 479–1,003 ms                  | —                   |

## Not covered

- A real restart of the Mac wasn't tested from the session that built this; a login was
  simulated (agent unloaded, then loaded as at login).
- LOWTIDE uses the Node installed on the Mac (`/usr/local/bin/node`, 22.22 or later); it
  doesn't bundle Node. If Node is removed or downgraded, install again.
- LOWTIDE.app is signed ad hoc, not notarized; it's made on this Mac, so Gatekeeper
  doesn't quarantine it.
