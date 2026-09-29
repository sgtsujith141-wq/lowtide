# LOWTIDE v2 PHASE 009 — QA, polish, performance, accessibility, docs

**Date:** 2026-09-30 · **Status:** PASS

## Performance

- **Vendor chunks** (react, router, data): the app entry is 69 kB, down from 488 kB,
  and no chunk warning remains. Heavy screens (Home, Command Room, Life, Calendar, AI)
  stay lazy, and Home's secondary grids render when scrolled to.
- **Large data** (synthetic, in a throwaway profile, never committed):
  - 30 projects, 3,000 tasks, 3,650 routine entries, 1,200 work sessions, 2,410
    events;
  - validation 0.2 s, restore 1.4 s;
  - Home's Daily Pulse in about 0.9 s on a cold page load;
  - the Command Room, Life, Rhythm, Calendar and AI in 0.1–0.35 s.

## Accessibility (axe-core 4.13, all 13 routes)

Before the fixes:

- Sleep Mode's 45% fade put nonessential text at 1.8:1. It's now 75% with full-ink
  text, about 5:1.
- Faint-ink placeholders and out-of-month calendar days were below 4.5:1.
- A `<dl>` row had a stray `<span>`.
- Headings skipped levels (Projects cards, board lanes).
- The pipeline's scroll area couldn't be reached by keyboard.

After: **0 violations** at 1280 and 320 px, in light and dark, with Sleep Mode off and
on.

**Keyboard:** a logical tab order (skip link, navigation, actions, one stop per grid,
then content); every stop has a visible focus style; arrow keys and Enter work inside
the grid.

## Responsive

0 px horizontal overflow on every route at 320, 360, 390 and 1280 px, in light and
dark, with reduced motion emulated. No console errors.

## Docs

`LOWTIDE-V2-STATUS.md` (the final state), README, roadmap, testing, changelog and the
phase reports.
