# LOWTIDE v2 PHASE 007 — Hackathons + Calendar + integration

**Date:** 2026-09-30 · **Status:** PASS

## Built (ADR-053)

- **Hackathon stage rail** on every sheet: Registration, Problem, Research, PPT,
  Prototype / build, Testing, Submission. Derived from the existing statuses (Research
  is positional), with a text alternative per stage.
- **Track the build as a project:** an explicit, one-transaction link to a new
  technical project, and Unlink. Hackathons are never converted automatically.
- **Calendar** (`/calendar`, desktop nav and More): college, hackathons, milestone due
  dates, deadlines, plans, work done, days off and protected time. A month grid plus the
  agenda for the selected day.
- **Home Needs you** includes college coursework due today or overdue.

## Verified in a browser

Calendar at 1280 px (light) and 390 px (dark), and hackathons with the rail: 0 px
overflow, no console errors.

## Tests

`calendar-page.test.tsx` (3), `hackathons-v2.test.tsx` (3), the updated stage rules in
`v2-rules.test.ts`, and a Needs-you coursework test.

## Known

The entry chunk reached 500.4 kB (warning threshold 500 kB). It's addressed in the QA
phase.
