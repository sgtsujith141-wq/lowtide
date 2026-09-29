# LOWTIDE v2 PHASE 005 — Work Mode + Sleep Mode

**Date:** 2026-09-30 · **Status:** PASS

## Built (ADR-049)

- **Work Mode:**
  - a global Start Work panel: general, college/study, project, project + task, and an
    optional intent;
  - a mode bar on every screen: live timer (stored start minus pauses), today's total,
    Pause/Resume, Finish;
  - a running session survives a reload (tested by re-rendering over the same
    database);
  - Start work here in each Command Room.
- **What sessions feed:** everything is derived from the session records:
  - project time in the cards and the Command Room;
  - the ledger timeline;
  - the Work grid;
  - the Daily Pulse;
  - the project activity calendar.
- **Sleep Mode:**
  - you start the window yourself, and it's refused while work runs, with a Finish work
    session button;
  - the app dims and desaturates, stops animations and fades nonessential sections;
  - navigation and content stay usable;
  - Wake up ends the window;
  - the start and end are recorded, and the duration is derived and shown as a marked
    window, never as sleep.
- **Focus:**
  - starting work moves focus to Pause, and Sleep Mode to Wake up;
  - finishing or waking lands on the page;
  - only this tab's actions move focus;
  - Escape closes the Start Work panel.

## Also in this phase

- **A real focus race in Hackathons, fixed.** A sheet moving between Past and the open
  list could lose keyboard focus. The test held a stale element, and both races showed
  only under load.
- **Test robustness:**
  - async waits allow 3 s, with the 15 s per-test timeout unchanged;
  - IntersectionObserver is stubbed;
  - Home's secondary grids render when scrolled to (fewer squares on first paint).

## Tests

465 tests in 38 files, all green three times in a row under load average ~21.
