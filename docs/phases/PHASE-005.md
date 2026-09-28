# PHASE 005 — Backup, export, import and storage safety

- **Date:** 2026-09-28
- **Status:** Complete (see "Tests actually run" and "Browser verification actually run")
- **Starting point:** `9e91380` (PHASE 004 lock commit; verified local `HEAD` =
  `origin/main`, clean tree)
- **Commits:**
  - `7f18172` — `feat(backup): validated snapshot export and atomic replace restore`
  - `cabfefd` — `feat(backup): Data & backup screen with preview, confirmation and storage status`
  - a follow-up `docs(phase-005): …` commit containing this report. It can't record its
    own SHA; find it with `git log --oneline -- docs/phases/PHASE-005.md`.

`7f18172` was verified on its own, with the UI files stashed: typecheck, lint, 309
tests, build. `cabfefd` is exactly the tree that passed `npm run check` twice.

## Objective

Make LOWTIDE recoverable, locally and explicitly. That means:

- a full JSON export;
- a strictly validated import with a preview;
- an atomic replace-restore;
- compatibility with older schemas;
- an honest persistent-storage status and request;
- clear warnings that backups are plaintext.

No cloud, accounts or sync.

## Scope

**In:**

- the backup envelope and pure validation pipeline;
- `BackupRepository`;
- the lazy `/data` screen;
- shared domain rules;
- migration orchestration;
- tests, browser checks and docs.

**Out (deliberately):**

- merge import;
- encryption;
- ZIP or streaming;
- cloud destinations;
- automatic or scheduled backups;
- the File System Access API;
- schema V4 (no persisted-data change was needed).

## Files created

- **Data:** `src/db/backup.ts`, `src/db/rules.ts`,
  `src/db/repositories/dexie-backup-repository.ts`
- **Lib:** `src/lib/storage-persistence.ts`
- **Screen:** `src/features/backup/`: `DataPage.tsx`, `download.ts`, `counts.ts`,
  `schema-label.ts`
- **Tests:** `src/test/backup.test.ts`, `src/test/data-page.test.tsx`
- **Docs:** `docs/phases/PHASE-005.md`

## Files modified

- **Data:** `src/db/migrations.ts` (`STORE_NAMES`, `migrateSnapshot`),
  `src/db/repositories/{types,index}.ts`
- **Repositories:** `dexie-habit-repository.ts` and `dexie-hackathon-repository.ts` now
  import their rules from `src/db/rules.ts`, with behaviour unchanged.
- **App:** `src/app/{routes,Shell}.tsx`
- **Docs:** `README.md` and `docs/{ARCHITECTURE,DATA-MODEL,DECISIONS,PRODUCT,ROADMAP,CHANGELOG,TESTING,SECURITY,SETUP}.md`

## Backup format (ADR-031)

```json
{
  "format": "lowtide-backup",
  "formatVersion": 1,
  "schemaVersion": 3,
  "exportedAt": "2026-09-28T11:33:51.758Z",
  "data": {
    "tasks": [],
    "inbox": [],
    "habits": [],
    "habitEntries": [],
    "hackathons": [],
    "protectedTime": []
  }
}
```

Each collection contains the records exactly as stored in IndexedDB. The file is
pretty-printed, and named `lowtide-backup-YYYY-MM-DD-HHmm.json` in local time. The time
suffix stops two exports on the same day overwriting each other.

## Backup format version vs database schema version

- **`formatVersion`** (`BACKUP_FORMAT_VERSION = 1`) versions the envelope: the wrapper's
  shape and meaning.
- **`schemaVersion`** is the database schema the records were written under (currently
  3).
- They move independently. A new field bumps the schema, and the envelope can stay
  at 1. A new envelope (say, encryption) bumps the format.
- **Newer versions are rejected.** A `formatVersion` above 1, or a `schemaVersion`
  above this build's, is refused rather than guessed at. Values below 1 are invalid.

## Exact collections exported

`tasks`, `inbox`, `habits`, `habitEntries`, `hackathons` and `protectedTime`: every
store in the database (`STORE_NAMES`).

## Snapshot consistency

`exportBackup()` reads all six tables inside one `db.transaction('r', allTables, …)`, so
the file reflects a single moment. A test spies on `db.transaction` and asserts exactly
one read-only transaction naming all six stores.

Each store is sorted deterministically:

- by `createdAt`, then id;
- habit entries by date, habit, then id;
- protected time by date, then id.

Two exports of the same data are byte-identical in `data`, and exporting never writes
(tested).

## Validation pipeline

The pipeline is `inspectBackup(text)`, pure and in `src/db/backup.ts`. The database is
never touched.

1. **JSON.** A parse failure gives `not-json`.
2. **Envelope:**
   - an object with `format: "lowtide-backup"`, otherwise `not-lowtide`;
   - an integer `formatVersion`: above 1 gives `newer-format`, below 1 is invalid;
   - an integer `schemaVersion`: above this build's gives `newer-schema`, below 1 is
     invalid;
   - `exportedAt` must be an ISO timestamp;
   - all six `data` arrays must be present, holding records.
3. **Migrate** (see below).
4. **Records.** Every record is parsed with the **current** Zod schema for its store.
   Unknown extra fields are dropped; invalid fields reject.
5. **Domain rules**, the same ones the repositories use (`src/db/rules.ts`):
   - habit targets (none on done-or-not habits; positive; whole for counts; at most
     1440 minutes);
   - entry values per unit (check = 1, count a positive whole number, minutes over 0
     and up to 1440, so zero activity is invalid);
   - hackathon date ranges (an end needs a start and can't precede it).
6. **Cross-store integrity:**
   - unique ids per store;
   - every habit entry's habit is in the backup;
   - at most one entry per habit per day;
   - every inbox item's `convertedToTaskId` is a task in the backup.

   This last one is rejected rather than silently severed: a dangling link means the
   file isn't a faithful snapshot.

Any problem yields `{ ok: false, problem, issues }`. `issues` holds developer-facing
details, capped at 25. The UI shows one calm sentence per problem. Nothing is repaired
or partially imported. Success yields a `ValidatedBackup`, a branded type, with the
migrated, sorted data and counts.

## Older-schema migration behaviour

There was no backup feature before this phase. **No older backup files exist.** The
format can still carry data from schema 1, 2 or 3, which is tested with compatibility
fixtures only.

`migrateSnapshot(snapshot, from)` (in `src/db/migrations.ts`) reuses the database's own
upgrade function:

- **V1 → V2:** no record change (V2 only added an index). A missing `Task.plannedFor`
  is valid.
- **V2 → V3:** every hackathon goes through **`migrateHackathonToV3`**, the same
  function the V3 database upgrade runs:
  - timestamps become their UTC date;
  - real dates are kept;
  - anything unreadable is moved into notes.
- **V3:** no migration. A timestamp in a V3 hackathon is simply invalid (tested).

After migrating, everything must validate against the **current** schemas.

## Replace, not merge (ADR-032)

Import replaces all LOWTIDE data in this browser. Merge was rejected because of:

- same ids with different content;
- duplicate habits and entries;
- conflicting task history;
- no answer to "whose timestamp wins".

A restore recreates one known snapshot. A test proves it: records added after the
export, in every store, are gone after restoring.

## Preview behaviour

1. Choosing a file only reads and inspects it; nothing is written.
2. If it's valid, a preview appears and takes focus. It shows:
   - the backup's date and file name;
   - "Database version N", or "…, upgraded on import";
   - a small table of counts per store: in the backup vs now in this browser;
   - "Importing this backup will replace the LOWTIDE data currently stored in this
     browser."
3. **Restore backup** stays disabled until "I understand this replaces the LOWTIDE data
   in this browser." is checked.
4. Cancel clears the preview and returns focus to the file input.

Rejections show one calm, specific message, associated with the file input, and no
Restore button:

- "That doesn't look like a LOWTIDE backup."
- "This backup was created by a newer LOWTIDE version."
- "That backup contains invalid data. Nothing was changed."
- "Couldn't read that file. Nothing was changed."

## Transaction / rollback semantics (ADR-033)

`restore(backup)` runs one `db.transaction('rw', allSixTables, …)`:

1. clear every store;
2. `bulkAdd` in order: habits, tasks, hackathons, protected time, inbox, habit entries.

A rejection anywhere aborts the transaction, and IndexedDB rolls every store back.
Nothing is cleared outside the transaction.

**Proof (not pre-validation):**

- **Test 1.** A genuinely validated backup is tampered after validation, so the _last_
  write (habit entries, after every clear and every other insert) violates the unique
  `[habitId+date]` index. `restore` rejects, `tasks.bulkAdd` is confirmed to have run,
  and all six stores equal the originals record for record.
- **Test 2.** `inbox.bulkAdd` rejects in the middle of the sequence. The current data,
  including a task added after the export, is unchanged.
- **Mutation check.** Moving the `clear()` calls outside the transaction makes both
  tests fail; restored, they pass.

**After success:** live watches update every screen (verified in the browser: Tasks,
Hackathons, Rhythm and Today). There's no reload. Focus moves to "Backup restored.
LOWTIDE now holds the data from …", and the preview and file input are cleared.

## Persistent-storage behaviour (ADR-034)

- On load, `navigator.storage.persisted()` is read. This never prompts.
- "Ask browser to keep LOWTIDE data" calls `persist()` only when pressed. The button is
  shown only if storage isn't already persistent (and the browser supports it).
- The result is stated as-is:
  - "Browser storage is marked persistent.";
  - "Browser granted persistent storage.";
  - "Browser didn't grant persistent storage. Keep backup files somewhere safe.";
  - "This browser doesn't expose persistent-storage controls."
- Always shown: persistence only lowers the chance of eviction under storage pressure.
  It doesn't survive clearing site data, deleting the profile or losing the device.
- In headless Chromium the status was "not persistent", and the request was **refused**.
  Both outcomes were displayed as such.

## Download behaviour

`downloadText` builds a `Blob` (`application/json`), creates an object URL, and clicks a
temporary hidden `<a download>`. It revokes the URL on the next tick.

- Nothing else is involved: no library, no network, no File System Access API.
- The file is `JSON.stringify(doc, null, 2)`.
- Failures show "Couldn't create the backup. Nothing was changed."
- Success updates an always-present `role="status"` line: "Downloaded
  lowtide-backup-….json."

## Security / privacy warning

- The page says, next to the download button: **"Backup files are not encrypted.
  Anyone with the file can read everything in it."** SECURITY.md details what that
  covers:
  - tasks and notes;
  - protected time (relationship and family entries);
  - health and gym habits;
  - business activity;
  - hackathon strategy and team names.
- LOWTIDE doesn't control where the file goes afterwards: the browser, the OS, or a
  cloud or sync folder watching Downloads.
- Everything is local: no upload, no telemetry, no external API. The browser run
  recorded zero non-localhost requests.
- `.gitignore` covers `lowtide-backup*.json`. No backup file, screenshot or Playwright
  artifact is in the repository; they stayed in a scratch directory.

## Tests actually run

All on 2026-09-28, Node 24.19.0, macOS.

| Command                                                        | Result                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npx vitest run src/test/backup.test.ts` during development    | 30/31, then 31/31 after fixing one fixture (see Bugs)                      |
| Rollback mutation check (clears moved outside the transaction) | both rollback tests **failed**, as they should; restored: 31/31            |
| `7f18172` alone: typecheck, lint, tests, build                 | pass: 309 tests                                                            |
| Full `npm run check` × 2 (tree = `cabfefd`)                    | **pass: typecheck, lint, format, 26 files / 323 tests, build** (both runs) |

No timeouts. `testTimeout` stays 15 s.

## Browser verification actually run

Headless Chromium (Playwright from a scratch directory) against `vite preview` of the
production build. All data was invented ("Essay draft", "Gym", "Hackurity", "Call
home").

| #     | Check                      | Result                                                                                                                                |
| ----- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `/data` loads              | yes                                                                                                                                   |
| 2     | Access path                | desktop sidebar link visible at 1280; phone footer link visible at 360 and 320; still 5 tabs                                          |
| 3     | Export triggers a download | real Playwright `download` event: `lowtide-backup-2026-09-28-1703.json`; status "Downloaded lowtide-backup-2026-09-28-1703.json."     |
| 4     | Downloaded JSON inspected  | `format: lowtide-backup`, `formatVersion: 1`, `schemaVersion: 3`, `exportedAt` ISO; all six collections (1 record each from the seed) |
| 5     | Data added after export    | a task "Added after export" and a hackathon "Later hackathon"                                                                         |
| 13    | Malformed file             | "That doesn't look like a LOWTIDE backup."; no Restore button                                                                         |
| 6–7   | Select the exported file   | preview "Backup from 28 Sep 2026, 17:03", focused; table shows Tasks 1 vs 2 and Hackathons 1 vs 2                                     |
| 8     | Before confirming          | Restore disabled; Tasks still shows "Added after export" (1)*                                                                         |
| 9     | Confirm + restore          | "Backup restored. LOWTIDE now holds the data from 28 Sep 2026, 17:03.", focused                                                       |
| 10–11 | Replace semantics          | Tasks: "Essay draft" 1, "Added after export" 0. Hackathons: "Later hackathon" 0                                                       |
| 12    | Reactive screens           | Rhythm Gym still pressed; Today shows the restored protected time*, the inbox link and the Hackurity row; the same after reload       |
| 14    | Persistent storage         | "isn't marked persistent…"; pressing Ask gave "Browser didn't grant persistent storage. Keep backup files somewhere safe."            |
| 15–17 | Layout                     | `/data` page overflow 0 and nav overflow 0 at 1280 (light and dark), 360 (light) and 320 (light and dark)                             |
| 18    | Console                    | no errors or warnings                                                                                                                 |
| 19    | Network                    | **no non-localhost requests**                                                                                                         |

\* The first run counted these two immediately after a lazy-route navigation and got 0. Re-measured with a wait for the list to render, they were 1 and 1. Other evidence
agreed with that: the preview table showed "now 2" before confirming, and a reload
showed the protected time.

## Bugs discovered

1. **Test fixture:** the "two entries for one habit and day" case picked the first
   entry, which after sorting belonged to a habit with only one entry.
2. **Duplicate announcement:** the export success text existed twice (visible text plus
   a hidden announcer). Also, a live region inserted together with its text is often
   not announced.
3. **Browser-script races:** two counts were taken before lazy lists rendered (see the
   footnote above).
4. **PHASE 004 lock:** a capture test with a fixed-delay failure raced typing under load
   (see PHASE-004 "Finalization"; fixed in `28492a5` before this phase began).

## Bugs fixed

1. The fixture now targets the habit with two entries.
2. There's one always-present `role="status"` line for export success.
3. The script waits for list content before counting.
4. The capture test fails the save on cue after typing. No timeout was changed.

## Known limitations

- **Replace only.** There's no merge, and no partial or selective restore.
- **No encryption,** and no password protection.
- **Whole-file JSON** in memory: no streaming or ZIP. Very large histories would be
  slower but still work.
- **No automatic or scheduled backups, and no reminder.** Backing up is always a
  deliberate action.
- **Unknown fields are dropped.** A hand-edited backup with extra fields restores
  without them.
- **Headless Chromium refused persistence,** so a "granted" outcome was covered by unit
  tests only.
- **Only Chromium was checked.** Safari's and Firefox's download and `persist()`
  behaviour wasn't tested.

## Bundle / chunk impact (`npm run build`, real output)

| Chunk              | PHASE 004               | PHASE 005               |
| ------------------ | ----------------------- | ----------------------- |
| entry `index-*.js` | 447.78 kB (143.02 gzip) | 452.54 kB (144.44 gzip) |
| `DataPage` (lazy)  | —                       | 8.89 kB (3.25 gzip)     |
| CSS                | 25.02 kB                | 26.13 kB                |

The entry grew by 4.8 kB: the validation pipeline and backup repository, which live in
the data layer. The screen, download helper and persistence helper are lazy. The bundler's
chunking also regrouped some shared helpers (`useWatch`, `calendar`, `schedule`,
`styles` are now separate small chunks). No backup, ZIP or crypto library was added.

## Next phase

**PHASE 006 — Protected time planning beyond today; coding/learning and fitness views
on habits.** See [ROADMAP.md § PHASE 006 starting point](../ROADMAP.md#phase-006-starting-point).
Any new store or field must also flow through the backup envelope, `migrateSnapshot`
and import validation.
