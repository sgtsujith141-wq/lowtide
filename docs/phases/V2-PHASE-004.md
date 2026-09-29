# LOWTIDE v2 PHASE 004 — Project Command Room

**Date:** 2026-09-30 · **Status:** PASS

## Built (ADR-050)

- **Projects page:** live projects as cards, New project, and a collapsed list of done
  and archived projects.
- **The Command Room at `/projects/:slug`:**
  - a large completion ring from milestone weight, or "No milestones yet";
  - the milestone pipeline;
  - seven command lanes, with items plus tasks by status (a task an item refers to
    appears once);
  - progress over time from real snapshots;
  - weekly time invested from real work sessions;
  - a gold project activity calendar;
  - a recent-activity timeline;
  - a compact summary (objective, phase, next action, last moved) that you can edit in
    place;
  - a state selector that refuses Done while milestones are open, and says how to
    proceed.
- **Tabs:**
  - Overview;
  - Tasks: add, link an existing open task, complete;
  - Milestones: add with weight and due date, complete or reopen, reorder, remove;
  - Docs: the decision log, never edited, with supersession;
  - AI: real reported sessions only;
  - GitHub: not connected, and it says so;
  - History: the full timeline.

## Not built here

- GitHub data: no network access exists yet (ADR-041).
- AI sessions come only from a real client; the companion phase is still to come.

## Tests

`project-room.test.tsx` (9) and `project-summary.test.ts` (5).
