# LOWTIDE v2 PHASE 003 — Home v2

**Date:** 2026-09-30 · **Status:** PASS

## Built

- **Routes and navigation (ADR-043):**
  - `/` is Home, and Today moved to `/today`, reusing ADR-020's composition;
  - new routes `/projects`, `/projects/:slug` and `/more`;
  - phones get five tabs: Home, Projects, Hackathons, Rhythm, More;
  - desktop shows every destination.
- **`ContributionGrid`** (ADR-047): GitHub geometry, seven palettes in light and dark,
  tooltip, day selection, and keyboard navigation as an ARIA grid.
- **Daily Pulse on Home:** derived from real records at read time (`summariseDays` →
  `dailyPulse`). Selecting a day opens that day's details. Days without records stay
  empty; nothing is backfilled.
- **Home sections (ADR-048):**
  - Start Work, Sleep Mode and Ask LOWTIDE (a local search, labelled as such);
  - project command cards;
  - Needs you;
  - a compact Today;
  - recent activity;
  - the Work, Projects, College, Personal and Sleep grids.

  No gym on Home.

- **Work Mode and Sleep Mode shell (ADR-049),** built here because Home's header needs
  them. Phase 005 covers what's left.

## Verified in a browser

- **Chromium via Playwright:** the automation profile holding the restored bootstrap,
  and a throwaway demo profile for synthetic data (never committed).
- **Home** in light and dark, at 1280, 390 and 320 px. No console errors.
- **Overflow:** 0 px of horizontal overflow on every route at 320 px, after two fixes:
  - grid cards needed `min-w-0`;
  - a visually hidden label escaped its scroll container, so scroll containers are now
    `relative`.

## Tests

`home-page.test.tsx`, `contribution-grid.test.tsx`, `pulse-days.test.ts` and
`modes.test.tsx`. v0.1 tests that assumed Today at `/` now use `/today` (ADR-043).
