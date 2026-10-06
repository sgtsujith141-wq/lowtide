# Security and privacy

LOWTIDE will hold personal information — tasks, habits, health/fitness consistency,
money experiments, relationship time. This document states what is and is **not**
protected. It does not claim more than is true.

## Where data lives

- **Browser mode** (the default): all data is stored in **IndexedDB in the browser
  profile** on the device, database name `lowtide`. There is no server copy.
- **Companion mode** (PHASE 008B, only after you move LOWTIDE there yourself): the data
  lives in `~/.lowtide/lowtide.sqlite`, owned by the local companion process. See
  [The companion](#the-companion-phase-008b) below. The browser's IndexedDB copy is kept,
  unchanged, from the moment you moved.
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

- The app needs no API keys or environment variables, and none are committed. In
  companion mode it holds one token, the owner token you pair it with (see
  [The companion](#the-companion-phase-008b)).
- The companion's tokens live only in `~/.lowtide` (owner-only) and are never written to
  the repository or the workspace. `.gitignore` also excludes `companion.json`, SQLite
  files and `.lowtide/`.
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

**In browser mode the app still makes no network requests.** v2 adds no analytics, no
AI API and no third-party requests; "Ask LOWTIDE" is a local search. In companion mode
(PHASE 008B) its only requests go to the paired companion on 127.0.0.1.

**Workspace export (ADR-044, ADR-054)** is a ZIP you download, like a backup, but:

- It holds **technical project knowledge only**:
  - projects, milestones, board items and decisions;
  - notes and reported AI sessions (with their handoffs);
  - hackathon sheets (including team names and next steps).

  (PHASE 008B replaced the daily work log with a per-project folder layout, the same
  one the companion keeps up to date: ADR-060.)

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

The stage-1 stdio companion described here in PHASE 008 was replaced in PHASE 008B:

## The companion (PHASE 008B)

The companion (ADR-058, ADR-059, ADR-060) is a local process that owns LOWTIDE's SQLite
database once you move LOWTIDE into it. What protects what:

**Network surface**

- It listens on **127.0.0.1 only**. Nothing on your network, let alone the internet, can
  reach it, and it makes no outbound requests at all.
- **DNS rebinding:** requests whose `Host` isn't `127.0.0.1:<port>` or
  `localhost:<port>` are refused.
- **Browsers:** only the origins in `allowedOrigins` (`~/.lowtide/companion.json`;
  LOWTIDE's dev and preview addresses by default) get CORS headers, echoed per origin,
  never `*`. A request from any other origin is refused. There are no cookies, so a
  website can't ride on your session: every request needs a bearer token.
- **Tokens.** The app uses the **owner token**; each AI client uses its **own grant
  token**, and neither works in the other's place. Tokens are 256-bit random values,
  compared in constant time; grant tokens are stored only as SHA-256 fingerprints and
  shown once. Failed attempts are rate-limited, as is each token's traffic. Request
  bodies are size-limited (1 MB for MCP).
- The app keeps the owner token in `localStorage` for its origin, so anything able to
  run script on that origin could read it. LOWTIDE loads no third-party scripts; don't
  serve it from an origin shared with other apps. `npm run companion -- rotate-token`
  replaces the token (then pair again).

**Data at rest**

- `~/.lowtide` and everything in it are owner-only (0700 folders, 0600 files): the
  database, `companion.json` (the owner token), `backups/` (the exact file of every
  move) and, by default, the workspace. Other users on the computer can't read them;
  programs running as you can, as with the browser profile.
- The database is **not encrypted** by LOWTIDE. Use disk encryption (FileVault,
  BitLocker).
- The audit log is in the same database and holds short summaries of what clients did
  (titles, states), not record contents.

**AI clients**

- Each client sees only the scope you grant (one project, every technical project, or
  global with private categories ticked one by one). **Protected time is reachable from
  no scope**, and no grant can include it. Tested with distinctive strings across every
  read tool, the workspace files and search.
- Writes go through the same validation, rules and ledger as the app, attributed to the
  client, and every call (refused ones too) is in the audit log you see in the AI area.
  Resolving approvals needs a separate delegation. AI clients can't write workspace
  files, run commands or reach anything outside LOWTIDE's own tools.
- **What a client reads leaves LOWTIDE through that client.** An AI client sends what it
  reads to its model provider as part of its conversation, under that provider's terms.
  LOWTIDE itself sends nothing anywhere; choose scopes with that in mind.
- The stdio bridge takes its token from `LOWTIDE_TOKEN`. Prefer that to `--token`, which
  other local users could see in the process list.

**The workspace**

- Only generated, marked files are ever written; people's files are never modified or
  deleted. Paths are checked after following links, so traversal, absolute paths and
  links out of the workspace are refused (tested). No private life data is written there.
- "Make it a Git repository" never adds a remote and never commits. If you add a remote,
  what you push is up to you; the generated `.gitignore` keeps bookkeeping, databases,
  backups and secrets out.

**Not built yet:** GitHub access (a read-only, repository-scoped token held by the
companion or the OS keychain, ADR-041) and encrypted backups.

## The installed app and the standard MCP server (v2.3)

- **Still only on this Mac.** The companion binds `127.0.0.1` only, checks `Host` (DNS
  rebinding) and an Origin allow-list (its own origin added), and never binds `0.0.0.0`,
  opens firewall ports or starts a tunnel. Remote access means a tunnel the owner sets
  up (docs/integrations/CHATGPT-MCP.md).
- **The served app** carries a Content-Security-Policy (`default-src 'self'`, scripts
  from the app and the one inline theme script by hash, `connect-src 'self'`,
  `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and
  `nosniff`; nothing outside the app folder is served (traversal tested).
- **Pairing codes** (ADR-075): one minute, one use, stored as a hash, accepted only from
  the companion's own page; the owner token never appears in a URL or a log. It still
  lives in that origin's browser storage, as before.
- **MCP over HTTP** needs a grant token (Bearer); invalid and revoked tokens get `401`;
  identity comes from the grant, never from the client. The SDK adds protocol handling
  only; LOWTIDE's own authentication, rate limits, permissions and audit stay in front.
- **Health** is unauthenticated and carries no tokens, paths or record contents (a test
  checks); the data folder is named by a short hash.
- **launchd agent**: runs as the user, GUI sessions only, `PATH=/usr/bin:/bin:/usr/sbin:/sbin`,
  no secrets in its plist or environment, logs in the owner's Library. The runtime,
  launchd and logs folders are owner-only (0700); the plist is 0644, as launchd requires.
- **One writer**: a lock in the data folder; LOWTIDE stops only processes it can identify
  as a LOWTIDE companion, never anything else on its port.
- **LOWTIDE.app** is a shell launcher signed ad hoc; it reads the owner token from
  `~/.lowtide/companion.json` (0600) only to ask for a pairing code.
- **Install reports** (`…/LOWTIDE/logs/install-*.json`) record paths, versions, timings
  and checks, never tokens.

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
