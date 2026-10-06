# Upgrading LOWTIDE without downtime (v2.1)

LOWTIDE stays usable while it is upgraded. The app (browser) and the companion (SQLite,
MCP, live events) are upgraded separately. Every schema change is additive, so either
version of each works with the other for the moment between the two steps.

## Rules

- Develop and test against a **disposable copy**: a `VACUUM INTO` copy of the database,
  a copy of the workspace, an alternate companion port and a second Vite server. Nothing
  in development touches `~/.lowtide`.
- **Migrations are additive and backward-compatible**: new nullable columns and new
  tables only, never a new value in a CHECK-constrained column, and writes upsert only the
  columns a build knows, so an older build keeps newer columns intact.
- Before the live switch: a full SQLite backup, `PRAGMA integrity_check` on it, a
  migration dry run on a copy of that backup, and a rollback test (the old build on the
  migrated copy).
- The companion also copies the database into `checkpoints/` by itself before any
  schema upgrade (`before-upgrade-<n>`).

## The procedure

`scripts/upgrade-companion.mjs` does steps 1–6 and refuses to swap if any check fails.

```sh
# 0. Build the new companion and keep the running build for rollback
npm run companion:build            # in the new tree
cp companion/dist/lowtide-companion.js <live tree>/companion/dist/   # the running process already has the old code in memory
#    (the previous build is kept as companion/dist/lowtide-companion-v2.0.js; dist/ is git-ignored)

# 1–6. Backup, integrity, dry run, rollback test, swap, verify
node scripts/upgrade-companion.mjs \
  --data ~/.lowtide \
  --old companion/dist/lowtide-companion-v2.0.js \
  --new companion/dist/lowtide-companion.js
#    --check-only runs 1–4 and leaves the running companion alone.

# 7. Update the app: fast-forward the tree the app is served from
git merge --ff-only v2.1           # Vite reloads open tabs into the new app
```

1. **Preflight**: the running companion answers; its pid and record counts are noted.
2. **Backup**: `VACUUM INTO <data>/backups/pre-upgrade-<time>.sqlite`, then an integrity
   check on the copy.
3. **Dry run**: the new build starts on a scratch copy of the backup on another port,
   runs its migrations and must keep every count; the migrated copy must pass the
   integrity check.
4. **Rollback test**: the old build starts on that migrated copy and must answer with the
   same counts.
5. **Swap**: `SIGTERM` to the running companion (it ends its event streams and closes
   SQLite cleanly), then the new build starts on the same port and data directory. The
   gap is timed until `/api/health` answers. If the new build doesn't answer, the old one
   is started again.
6. **Verify**: health, schema version, counts, the event stream and the MCP endpoint.

The companion keeps the same port and owner token, so the app does not need pairing
again. Open tabs reconnect their event stream by themselves, and MCP clients
re-initialise on their next call.

## Why not blue/green

A second companion on another port would need every open tab and MCP client to be
re-pointed, and two writers on one SQLite file is not safe. The swap is a stop-and-start
on one port instead, kept short. True zero downtime is not claimed: the measured
interruption is below.

## Measured

| Run                                                        | Old stopped | New answering | Companion unavailable |
| ---------------------------------------------------------- | ----------- | ------------- | --------------------- |
| Rehearsal on a copy of the live data                       | 11 ms       | 333 ms        | 344 ms                |
| Rehearsal with the v2.0 app open across the swap           | 11 ms       | 338 ms        | 350 ms                |
| **Live cutover, 2026-10-03** (migrations 6 and 7 included) | 32 ms       | 385 ms        | **417 ms**            |
| **Live cutover, 2026-10-07** (v2.2, migration 8 included)  | 27 ms       | 458 ms        | **485 ms**            |

In the rehearsal with the app open, the v2.0 app kept running against the v2.1
companion. A task created after the swap appeared in the open page 811 ms later, with no
reload, no error and no lingering offline banner. On the live cutover, a real Claude Code
MCP connection read `get_context` from the new companion straight after the swap.

The app update itself is a reload: Vite replaces open tabs with the new app when the
tree it serves is fast-forwarded. That is the one browser refresh the upgrade costs.

## Rollback

The old build runs on the upgraded database (tested in step 4 on every upgrade), so
rollback is a restart, not a restore:

```sh
kill $(lsof -t -iTCP:4318 -sTCP:LISTEN)
node companion/dist/lowtide-companion-v2.0.js --data ~/.lowtide
git reset --keep <previous main>   # only if the app must go back too
```

Only if data, not code, has to go back: the companion's own `before-upgrade-7`
checkpoint is restorable in **Settings → Checkpoints**, and the script's backup in
`~/.lowtide/backups/` can be copied over `lowtide.sqlite` while the companion is stopped.

## Autostart

**Settings → Running in the background → Start the companion when I log in** installs
the `com.lowtide.companion` LaunchAgent (optionally restarting it if it fails). It is
not switched on by the upgrade; the owner chooses it. Under launchd with restart-on-failure, **Restart** exits with
code 75 and launchd starts the new build. Without it, Restart starts a detached copy of
itself.
