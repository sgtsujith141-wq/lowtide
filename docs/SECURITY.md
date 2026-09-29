# Security and privacy

LOWTIDE will hold personal information — tasks, habits, health/fitness consistency,
money experiments, relationship time. This document states what is and is **not**
protected. It does not claim more than is true.

## Where data lives

- All data is stored in **IndexedDB in the browser profile** on the device, database
  name `lowtide`. There is no server copy.
- LOWTIDE makes **no network requests** carrying user data. At runtime it loads only its
  own static files; no analytics, telemetry, fonts CDN, or third-party scripts. (Checked
  in PHASE 000–004 (full capture, plan, protected-time, rhythm and hackathon
  workflows), by recording every request in a headless browser: none left localhost.)
- Data is scoped to the site origin. Anything else running on the **same origin** (e.g.
  another app served from the same host and port during development) can read it.

## What is not protected

- **No encryption at rest by LOWTIDE.** Data is stored as plain structured records.
  Protection depends entirely on the platform: OS disk encryption (FileVault, BitLocker,
  device encryption on phones), the OS user account, and the browser profile.
- Anyone with access to the unlocked device and browser profile, or to browser
  devtools, can read and modify all LOWTIDE data.
- Browser extensions with broad page permissions can read page content.
- **Protected time can be sensitive.** Entries like "Dinner together", "Call home" or
  notes about someone are stored exactly like tasks: unencrypted in IndexedDB, readable
  by anyone with the unlocked device and browser profile. LOWTIDE adds no extra
  protection for them. Removing an entry deletes it from IndexedDB. The browser may
  keep deleted bytes on disk until it compacts its storage, so this is not secure
  erasure.
- **Habit history is revealing.** Rhythm entries record which days you went to the gym,
  took a supplement, studied, coded or worked on money projects, with amounts and
  update times (`createdAt`/`updatedAt` are real timestamps). Together they sketch a
  daily routine and a health picture. They're stored unencrypted in IndexedDB like
  everything else. Archiving hides a habit from logging but keeps all its entries;
  there's no delete for habits yet.
- **Hackathon sheets can hold private strategy.** Teammate names, chosen problem
  statements, competition notes and next steps are stored unencrypted in IndexedDB like
  everything else. LOWTIDE never fetches hackathon sites, and there are no link fields.
  The V3 upgrade may copy unreadable old date values into a record's notes, where they
  stay local.
- **Durability is not guaranteed.** Browsers may evict IndexedDB under storage pressure,
  and clearing site data or using private/incognito mode deletes it.
  - Since PHASE 005 the Data page can ask for persistent storage, but only when you
    press the button. Persistence only makes eviction under pressure less likely; it
    does not survive clearing site data, deleting the profile or losing the device.
  - **Backups (manual JSON export) are the real safeguard.**

## Secrets

- The app needs no API keys, tokens or environment variables. None are committed.
- `.gitignore` excludes `.env*` (except a future `.env.example`) and `lowtide-export*` /
  `lowtide-backup*` JSON files so personal data exports don't get committed by accident.
- Staged diffs are reviewed for secrets before each commit.

## Dependency hygiene

- Dependencies are limited to the approved stack; each addition must have a clear need
  (recorded in DECISIONS.md / phase reports).
- `package-lock.json` is committed for reproducible installs.
- `npm audit` reported **0 vulnerabilities** at the end of PHASE 000 (2026-09-28).
- npm 11 install-script gating is left on; only `fsevents` requests a script and it is
  not needed (see SETUP.md).
- Re-run `npm audit` when changing dependencies; review changelogs for major bumps.

## Input handling

- All persisted records are validated with Zod schemas before writing; the same
  schemas must gate any future import.
- React escapes rendered text. All user text (thoughts, task titles/notes, projects) is
  rendered as plain text with `white-space: pre-wrap`; nothing uses
  `dangerouslySetInnerHTML`. If Markdown rendering is added later it must be sanitized.
- Error messages shown in the UI are fixed plain-language strings; raw exception text
  (which could include internals) is never rendered.

## Backup files (PHASE 005)

- **Backups are plaintext JSON and are not encrypted.** A backup contains everything:
  tasks and notes, inbox history, protected time (relationship and family entries),
  health and gym habits, business activity, hackathon strategy and team names. Anyone
  with the file can read it all. The Data page says so next to the download button.
- **LOWTIDE doesn't control where the file goes.** The browser, the OS, and any cloud
  folder or sync client watching Downloads may copy it. Deleting the file there is up
  to you.
- **Export and import are fully local:** a Blob download and a file you choose. No
  upload, no network, no File System Access API.
- **Import never trusts the file.** It's fully validated (schemas, domain rules,
  integrity) before anything is shown, nothing is written without explicit
  confirmation, and a restore is one atomic transaction.
- **Personal data never enters the repository.** Real personal state (for example a
  bootstrap of current tasks, rhythms and hackathons) is loaded only through a
  `lowtide-backup-*.json` file and the normal restore flow. It's never committed as a
  seed, fixture, migration or script.
- **Keeping backups out of the repo:** `.gitignore` excludes `lowtide-backup*.json` and
  `lowtide-export*.json`.
- **Encryption** (a password-protected backup) isn't implemented. It could be evaluated
  later.

## LOWTIDE v2: workspace export and the companion (PHASE 008)

**The app still makes no network requests.** v2 adds no fetch, no WebSocket, no
analytics and no AI API. "Ask LOWTIDE" is a local search.

**Workspace export (ADR-044, ADR-054)** is a ZIP you download, like a backup, but:

- It holds **technical project knowledge only**:
  - projects, milestones, board items and decisions;
  - reported AI sessions;
  - hackathon sheets (including team names and next steps);
  - a daily log of project work sessions (intent, outcome, minutes).
- It **never** holds:
  - protected time, with no option to include it;
  - sleep or off-time windows;
  - routines or habit entries (medication included);
  - health-type records;
  - college records;
  - raw inbox thoughts.

  A test seeds each of these with a distinctive string and checks that no exported path
  or file contains any of them.

- It's still **plaintext**. Treat it like source documentation: it may reveal project
  plans, hackathon strategy and teammates' names. It's safe to keep in a Git repository
  of your choosing, because it contains no life logs.

**Context packs (ADR-041, ADR-054)** are Markdown you copy or download yourself:

- Project scope (the default) contains one project's technical context.
- Workspace scope lists every live project and hackathon.
- Global scope adds private summaries (routines, off-time windows, college, inbox)
  **only for the areas you tick**. Protected time can't be ticked; it's excluded by
  construction.

**The companion (ADR-055)** is a local MCP server (`companion/lowtide-mcp.ts`) that an AI
client starts as a child process:

- **No network at all.** It speaks JSON-RPC over stdin/stdout and opens no port, so the
  localhost-only, authentication and CORS rules of ADR-041 have nothing to attach to.
  Access control is that only the client that started it can talk to it.
- **Workspace only.** It reads and writes only inside the exported workspace folder.
  Paths are resolved and realpath-checked, so `..`, absolute paths and symlinks
  pointing outside are refused (tested).
- **Scoped.** It's project-scoped by default: other projects, the root README and the
  manifest are invisible. The workspace scope must be chosen explicitly with
  `--scope workspace`.
- **Auditable writes.** It can only _add_ files: a note, or an AI session record. It
  never overwrites or deletes. Every write, and every refused record-change attempt, is
  appended to `.lowtide/audit.log` in the workspace.
- **No record changes yet.** Tools that would change LOWTIDE's own data
  (`record_decision`, `update_project`, `complete_task`, `request_approval`,
  `park_item`) refuse and change nothing, until the companion owns storage (ADR-040
  stage 2).
- **No secrets.** It needs no token and reads no environment variables.

**Not built yet (each needs its own security review):**

- an HTTP API for clients that can't start a process (127.0.0.1 only, a per-install
  bearer token, no wildcard CORS);
- GitHub access (a read-only, repository-scoped token held by the companion or the OS
  keychain);
- the move of canonical storage from IndexedDB to a companion-owned SQLite database.

## Future risks to design for

- **Backup encryption.** If added, be clear that a forgotten password makes the backup
  unrecoverable, and that encryption protects the file, not the live browser data.
- **Synchronization** (if ever added) changes the threat model entirely: transport
  security, authentication, server-side storage, and ideally end-to-end encryption
  so a server never sees plaintext. It must be opt-in and documented before shipping.
- **Service worker / PWA** (if added) must not cache or leak data across origins and
  must not introduce background network calls.
- **Optional app lock / encryption** could be considered later; if added, be honest
  that browser-side encryption with a user passphrase protects data at rest only while
  the app is locked.

## Reporting

This is a personal project. Report issues privately to the repository owner rather
than in public issues if they involve data exposure.
