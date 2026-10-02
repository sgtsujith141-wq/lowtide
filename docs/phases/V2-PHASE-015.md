# LOWTIDE v2 PHASE 015 — Work Mode and Sleep Mode

**Date:** 2026-10-02 · **Status:** PASS

The two global modes are redesigned as experiences. Their data is unchanged: a work
session and an off-time window are the same repository records, with the same ledger
events, the same effective-time rules and the same place in the Daily Pulse, the work
grid, project time, the timeline and today's total. Nothing is backfilled.

## Sleep Mode

"LOWTIDE has gone dormant with me." Starting Sleep Mode puts a full-viewport,
near-black layer (`#030405`) over the app. The app stays mounted underneath but is
`inert` (no interaction, hidden from assistive technology) and its page can't scroll.
The layer shows only:

- the timer, large, tabular, `HH:MM:SS`;
- **Off time** (or **Resting** for a rest window);
- "started 12:41 AM", and the day, very quiet;
- **Wake up**, the only action.

No navigation, no project or status information, no colour, no card, no explanation.
The wording "a marked window, not a sleep measurement" stays in Life's off-time history,
where details live. Nothing claims physiological sleep.

**Transition.** About 0.8 s: the app beneath desaturates and darkens (the existing
dormant styles) while the layer fades in; the timer arrives last. Reduced motion makes it
immediate.

**Running work.** Sleep never silently stops work. A minimal decision opens: "Work is
still running.", what it is and for how long, **Finish work & sleep** (the session is
finished normally, then off time begins) or **Go back**.

**Waking.** Wake up reverses the transition (about 0.7 s) and LOWTIDE returns with a
small passing summary at the bottom: "Off time 7h 14m · 12:41 AM → 7:55 AM". It leaves
by itself after 10 s or on Dismiss; there's no modal. The window appears in Life and
Rhythm as before.

**Phones.** Full screen, centred timer, Wake up a full-width button within thumb reach
above the safe area, no bottom navigation, no scrolling.

## Work Mode

"I am actively working on this one thing." Work Mode is a focused surface over the page
(the page stays mounted, inert, and comes back as it was); the rail stays, receding on
the desktop. It shows:

- the project (or General work / College / study) and the task or intent;
- the timer, large, tabular, `HH:MM:SS`, effective time (pauses excluded);
- "working since 10:14", or "paused at 11:02";
- **Pause** / **Resume** and **Finish**;
- **Today**: the day's effective total, this session included;
- **Next**: the project's next step, never the thing being worked on.

Nothing unrelated: no blockers from elsewhere, life metrics, hackathons, settings or AI
status. **Back to LOWTIDE** folds it into a one-line bar (what, timer, today, Pause or
Resume, Finish, back to focus) so the rest of LOWTIDE stays usable; navigating also
folds it. ⌘/Ctrl ⇧ Enter, the bar, Home's working button or the palette bring it back.
Work Mode survives a reload (the session from storage, the surface remembered for the
tab) and a companion restart (the session is the stored record).

**Pause.** "Paused", the timer stops (it's derived from stored pauses, never counted),
the status and timer soften over 300 ms.

**Finish.** The session is finished at once (its end time is the click), then a light
summary: "Worked 1h 42m", the project, the task, and an optional "What changed?". Done
(Enter) closes it; a note is kept as the session's outcome (`work.describe`, which
changes only the outcome and writes no event).

## Start Work

A fast chooser, not a form: one field (type to narrow), arrows, Enter starts, Escape
closes, an optional intent below. It offers, in order:

1. **This project**, when the page is about one: the Command Room's project, the project
   of the SPACE page open, or what the caller asked for. Its open tasks follow (in
   progress first). Starting from a task (the room's Tasks tab) preselects that task.
2. **Recent**: the last distinct things worked on (30 days).
3. **Projects**: every live project, by focus.
4. **General**: General work, College / study.

Searching narrows projects, open tasks and the general kinds. Life's Start study enters
Work Mode too.

## Project and SPACE integration

The Command Room shows "Working here · 42m" live; its Start work enters Work Mode on the
project at once, and its chevron opens the chooser with the project first. Home's Start
Work becomes "Working · <project> · 42m" while a session runs. A SPACE page that
belongs to a project shows "Working now · 42m" in its inspector, or "Start work" with
that project first. There is still one session record; nothing is duplicated.

## Command palette and shortcuts

⌘/Ctrl K lists the mode actions that can happen now, and only those: Start work and
Sleep mode when idle; Return to Work Mode, Pause or Resume, Finish work and Sleep mode
while working; Wake up while dormant (the palette sits above the dormant layer).

| Shortcut       | Does                                     |
| -------------- | ---------------------------------------- |
| ⌘/Ctrl K       | Command palette                          |
| ⌘/Ctrl ⇧ Enter | Start Work Mode, or return to it         |
| Escape         | Close the chooser, a summary or a dialog |

⌘/Ctrl ⇧ W was considered and rejected: it closes the browser window.

## Accessibility

- Timers are `role="timer"` (not live): they're never read out every second.
- State changes are announced once each in a polite status region: Work started, Paused,
  Resumed, Finished, Sleep Mode started, Off time ended.
- Focus moves with the mode: to Pause on entering Work Mode, to Done in the summary, to
  the first choice in the chooser and the conflict, to Wake up in Sleep Mode, and back to
  the page afterwards.
- axe-core 4.13 (WCAG 2.0/2.1 A, AA): 0 violations and no overflow across the chooser,
  Work Mode, paused, the compact bar, the Sleep conflict, Sleep Mode, after waking and
  the finish summary, at 320, 360, 390, 768, 1024, 1440 and 1920 px, dark and light
  (112 combinations); 0 on Home, Projects, a Command Room, a SPACE page, Life and More
  (84).

## Responsive

Sleep Mode never scrolls at any size. Work Mode keeps the timer and both actions on
screen from 320 px up; on phones the header stays, the surface fills the rest, and Today
and Next sit at the bottom.

## Real data

Run against a disposable copy of the companion data (so no screenshot writes into the
owner's history): Home → the primary project → its current task by typing a few
letters; the Command Room's chooser with its project first; a SPACE page offering
its own project first; General work; College / study; work running → Sleep → Finish work
& sleep; Sleep → Wake with the summary; the room's "Working here" and the SPACE
inspector's "Working now" while work ran. No console errors.

## Tests

64 files, 663 tests. Rewritten: `src/test/modes.test.tsx` (the chooser, Work Mode and
focus, pause and resume with announcements, the compact bar, the finish summary and
note, project, task, SPACE and recent defaults, reload persistence, Sleep's full layer
and inert app, waking and its summary, the running-work decision, reduced motion, the
palette's state-aware actions). New: a work session across a companion restart (SQLite),
and the SPACE inspector's "Working now". Updated: Life, the Command Room and Settings for
the new modes.

## Known issues

- The Recent group appears only once there are finished sessions in the last 30 days;
  the owner's data has none yet.
- Starting rest from Life's off-time area uses the same dormant screen, labelled
  "Resting"; it doesn't open the running-work decision (it says to finish first, as
  before).
