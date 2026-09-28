# Roadmap

Phases are small and each ends with a phase report in `docs/phases/`. Scope after
PHASE 001 is provisional and will be revised as the app is used.

| Phase | Goal                                                                                                                                | Status                  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 000   | Foundation: toolchain, tokens, routing, Dexie DB, repository boundary, types, tests, docs                                           | Done (see PHASE-000.md) |
| 001   | App shell + brain dump capture + inbox processing + tasks + reactive data                                                           | Done (see PHASE-001.md) |
| 002   | Today view: what's due/open today, protected time for today, quick capture                                                          | Done (see PHASE-002.md) |
| 003   | Rhythm: habits, daily logging, contribution-style activity squares                                                                  | Done (see PHASE-003.md) |
| 004   | Hackathons: project sheets, LocalDate dates (schema V3), Today section                                                              | Done (see PHASE-004.md) |
| 005   | **Backup: export / import** (validated JSON), persistent-storage request                                                            | **Next — priority**     |
| 006   | Protected time planning beyond today; coding/learning and fitness views on habits                                                   | Planned                 |
| later | Money/business experiments; theme switcher; committed E2E suite; offline PWA; optional sync (only with a documented security model) | Unscheduled             |

## PHASE 005 starting point: backup, export, import

Everything now lives in one browser profile with no copy: tasks, protected time, habit
history and hackathons. Losing that profile, whether by clearing site data, eviction or
switching browser, loses it all (SECURITY.md).

1. **Export:** a single versioned JSON file. Include `SCHEMA_VERSION`, an export
   timestamp and every store, read through the repositories. It's a user-initiated
   download (a Blob), with no network. Warn plainly that the file is unencrypted
   personal data, and name it `lowtide-backup-YYYY-MM-DD.json`; `.gitignore` already
   covers `lowtide-backup*`.
2. **Import:** validate every record with the existing Zod schemas. Run older exports
   through the same migrations (`migrateHackathonToV3`, etc.). Preview counts before
   writing. Choose and document replace-vs-merge semantics (ids are UUIDs, so merge is
   possible). Write atomically in one transaction.
3. **Persistence:** call `navigator.storage.persist()` and show the result honestly.
4. **Tests:** round-trip export → import; import of a V1/V2-era export; malformed and
   partial files rejected without writing.
5. **Carry-overs:**
   - undo for Clear, Drop, protected-time Remove and clearing a habit day;
   - global keyboard shortcuts;
   - a committed browser E2E suite;
   - an optional compact "Rhythm today" line on Today;
   - an explicit "Send next action to Tasks".
