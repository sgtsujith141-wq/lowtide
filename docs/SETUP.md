# Setup

## Requirements

- **Node.js ≥ 22.22** (React Router 8's engine requirement; developed on Node 24.19).
- **npm** (developed with npm 11.17). The lockfile is `package-lock.json`.
- A modern browser with IndexedDB and `crypto.randomUUID` (all current evergreen
  browsers). Use `http://localhost` or HTTPS — `randomUUID` needs a secure context.

## Install and run

```bash
git clone https://github.com/sgtsujith141-wq/lowtide.git
cd lowtide
npm install
npm run dev
```

Open the printed URL (default `http://localhost:5173`). You should see "LOWTIDE —
Foundation is operational" with **Local database: Ready**.

## Build

```bash
npm run build      # tsc -b, then vite build → dist/
npm run preview    # serve dist/ at http://localhost:4173
```

`dist/` is plain static files. Any static host works if unknown paths fall back to
`index.html` (needed for client-side routes).

## The companion (optional)

```bash
npm run companion            # build and run the local companion on 127.0.0.1:4318
npm run companion -- pair    # print the link that pairs LOWTIDE with it
```

It keeps its data in `~/.lowtide` (`LOWTIDE_DATA_DIR` or `--data` to change). Moving
LOWTIDE into it, connecting AI clients, backups and rollback:
[COMPANION.md](COMPANION.md).

## Before committing

```bash
npm run check      # typecheck, lint, prettier check, tests, build
```

## Notes

- **No environment variables** are needed. The companion optionally reads
  `LOWTIDE_DATA_DIR` (its data folder), and the stdio bridge reads `LOWTIDE_TOKEN` (an AI
  client's grant token, set in that client's own config). Do not add `.env` files with
  secrets.
- **npm install-script approval.** npm 11 prints
  `npm warn allow-scripts … approve-scripts`. The only dependency with an install script
  is `fsevents` (optional, macOS file watching, pulled in by Vite). It ships prebuilt
  binaries; the script is not needed and has been left unapproved. Everything builds,
  tests and runs without it.
- **Backups.** Use Data & backup (`/data`) to export before experimenting, and to
  restore afterwards. Backup files (`lowtide-backup*.json`) are git-ignored; never commit
  one, since they contain personal data.
- **Resetting local data.** Devtools → Application → IndexedDB → delete `lowtide`.
  This permanently deletes your LOWTIDE data in that browser profile.
