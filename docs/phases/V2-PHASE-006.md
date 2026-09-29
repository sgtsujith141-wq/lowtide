# LOWTIDE v2 PHASE 006 — Life + Rhythm

**Date:** 2026-09-30 · **Status:** PASS · **Schema:** V5 (additive)

## Built

- **Schema V5 (ADR-051):** `collegeItems` (class, lab, assignment, exam, event with
  status rules). A genuine V4 database upgrades with its records deep-equal. Attended
  and done items feed the college signal of the Daily Pulse; missed classes never count
  against you.
- **Life (`/life`, ADR-052):**
  - **Personal:** personal and health routines logged today. Tablets record adherence
    only, with no dosage.
  - **Sleep & off time:** start sleep or rest windows (refused while work runs), recent
    windows as marked lengths, and days off declared ahead.
  - **Gym:** a session is a fitness routine's entry (type, minutes, note).
  - **College:** today's classes and labs, coursework coming up, study time this week,
    Start study.

  Each area has its own themed grid with a range switch.

- **Rhythm** on the shared grid (ADR-052), with the 7-day, 30-day, 90-day, six-month
  and 12-month views.
- **Navigation:** Life on desktop and in More.

## Verified in a browser

- Life and Rhythm at 1280 px (light) and 390 px (dark) in a throwaway demo profile: 0 px
  overflow, no console errors.
- Fixed a visual bug: the pinned weekday labels need the grid's own surface colour.

## Tests

`v5-college.test.ts` (5), `life-page.test.tsx` (9), and a Rhythm range test. Tests that
pinned schema 4 or 15 stores now expect V5 and 16.
