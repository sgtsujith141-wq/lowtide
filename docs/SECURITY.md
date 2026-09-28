# Security and privacy

LOWTIDE will hold personal information — tasks, habits, health/fitness consistency,
money experiments, relationship time. This document states what is and is **not**
protected. It does not claim more than is true.

## Where data lives

- All data is stored in **IndexedDB in the browser profile** on the device, database
  name `lowtide`. There is no server copy.
- LOWTIDE makes **no network requests** carrying user data. At runtime it loads only its
  own static files; no analytics, telemetry, fonts CDN, or third-party scripts. (Checked
  in PHASE 000 and again in PHASE 001, through the full capture → convert → complete
  workflow, by recording every request in a headless browser: none left localhost.)
- Data is scoped to the site origin. Anything else running on the **same origin** (e.g.
  another app served from the same host and port during development) can read it.

## What is not protected

- **No encryption at rest by LOWTIDE.** Data is stored as plain structured records.
  Protection depends entirely on the platform: OS disk encryption (FileVault, BitLocker,
  device encryption on phones), the OS user account, and the browser profile.
- Anyone with access to the unlocked device and browser profile, or to browser
  devtools, can read and modify all LOWTIDE data.
- Browser extensions with broad page permissions can read page content.
- **Durability is not guaranteed.** Browsers may evict IndexedDB under storage pressure
  (persistent-storage permission is not requested yet), and clearing site data or using
  private/incognito mode deletes it. Until export exists, there is no backup.

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

## Future risks to design for

- **Export/backup files** will contain all personal data in plain JSON. Users must be
  told this; files should be named so `.gitignore` catches them; imports must be
  validated and never trusted.
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
