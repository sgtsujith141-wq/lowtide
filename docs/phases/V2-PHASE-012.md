# LOWTIDE v2 PHASE 012 — Home v3

**Date:** 2026-10-02 · **Status:** PASS

Home is rebuilt to be understood in seconds, from real records only. Nothing is seeded
and no activity is invented. The Command Room, SPACE and the full Sleep experience are
untouched.

## The hierarchy, and why each part is there

| Order | Section                        | Answers                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----- | ------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | **Header**                     | Where am I, what can I start?  | A greeting by time of day and a quiet date (the h1 "Home" is for screen readers only). Compact actions: **Start Work** (the one filled button), **Sleep**, **⌘K**.                                                                                                                                                                                                                                                                                     |
| 2     | **Daily Pulse** (hero)         | How is the year going?         | The full year in GitHub geometry (7 rows, 53 weeks, month labels, Mon/Wed/Fri, four green levels plus empty, today ringed, selection outlined, tooltip, keyboard grid). It spans the width (squares up to 30 px at 1920). The one figure beside it is the number of days with a pulse, counted from records. No streaks: they would add pressure LOWTIDE doesn't want, and nothing in the product defines them yet.                                    |
| 3     | **Day detail**                 | What happened that day?        | Choosing a day (click, or Enter on the focused square) opens a side drawer: the pulse level in words, only the categories that hold something (work, tasks done, milestones, decisions, resolved blockers, college, routines as a count, off time, day off), then that day's timeline. Escape returns focus to the grid.                                                                                                                               |
| 4     | **Projects** (Project Command) | Which projects are moving?     | A portfolio list, not a card grid: name, state and focus; progress by milestone weight with the milestone pipeline (✓ done, ● current, ○ upcoming), or plainly "No milestones yet" instead of a made-up percentage; Now and Next (the project's own name isn't repeated in front of its work); blockers, approvals and waiting items; time this week only when sessions exist; last movement. At most four rows; **View all projects** links the rest. |
| 5     | **Needs you**                  | What can't move without me?    | Grouped by what it belongs to: approvals and blockers listed by name; overdue and due-today work counted per project ("8 overdue items"), never one line per task; hackathons with a deadline or start within a week; college coursework counted. Groups that can't move without you come first. Hidden when nothing needs you.                                                                                                                        |
| 6     | **Today**                      | What's today, and what's next? | One strip of honest figures: work (always), tasks done of planned (always), and college classes, personal routines done, off time marked and the inbox only when there is something. Then **Next** (today's plan first, otherwise the top project's next action) and any time kept for people and rest, named and never measured. No gym figure; no routine names.                                                                                     |
| 7     | **Recent**                     | What changed lately?           | The latest five ledger events, two lines each at most; private events are left out. Hidden when there are none.                                                                                                                                                                                                                                                                                                                                        |
| 8     | **Rhythms**                    | How are the other rhythms?     | One compact grid at a time, chosen from Work, Sleep, College, Personal, Projects (no gym). Deeper analysis stays on Rhythm and Life.                                                                                                                                                                                                                                                                                                                   |

Removed: the bordered empty-state boxes, the three-box Today summary, five always-on
category grids, the long timeline and its "nothing happened" line, and the "Needs you:
nothing" line. No data or feature was lost: the full Today, Rhythm, Life and project
History screens hold the detail.

## Project focus (schema V8, ADR-064)

Home's order follows the owner's **focus**, a new optional project field: primary,
secondary, supporting, or background ("not current"). It's set from the Command Room
header, it's a viewing priority (setting it leaves `updatedAt` alone and writes no
ledger event, so it never reads as project movement), and a Notion re-import never
overwrites it. Order on Home: focus, then state (needing you first), then the most
recent movement; background projects stay on Projects. The owner's stated priority was
set through the app's own repositories (one primary, one secondary, two supporting, the rest not current); no other field changed and no event was written.

## ⌘K

The search stays honest: a local search over projects, milestones, project items, tasks
and hackathons, now in a modal palette opened by the ⌘K button or ⌘K / Ctrl K on Home.
It names no AI.

## Grids

- An `xl` size for the hero (up to 30 px squares) and a minimum square size, so on
  phones the hero scrolls with readable squares instead of shrinking.
- PHASE 011's known issue is fixed: month labels whose column is scrolled under the
  weekday column are hidden, so no clipped fragment remains.

## Responsive

Checked at 320, 360, 390, 768, 1024, 1440 and 1920 px, dark and light: no horizontal
overflow. Project rows collapse from four columns to a stack; Needs you goes from three
columns to one.

## Accessibility

axe-core 4.13 (WCAG 2.0/2.1 A, AA): 0 violations on Home, Projects and a project room at
every width in both themes on real data, on an empty profile, with Sleep Mode on, and
with the day drawer and the palette open. The grid stays one Tab stop with arrow keys;
the drawer and palette open from the keyboard and return focus; states are words, not
colour alone.

## Real-data screenshots

Taken outside Git against the companion's real data: 1920 dark, 1440 dark, 390 dark,
1920 light. They show the four projects in focus in the owner's order, the rest behind View all,
a blocker and counted overdue work under Needs you, and a real hackathon deadline.

## Tests

58 files, 603 tests, all passing. New: the Home model (greeting, focus-based selection,
Needs you grouping, what's next, prefix handling), Home v3 (hierarchy, hidden empty
sections, the year grid, the drawer by mouse and keyboard, project rows, grouped needs,
no gym figure, one rhythm at a time, ⌘K), and schema V8 (focus without movement, in
backups, kept on re-import, the SQLite migration).

## Known issues

- Only one project has milestones, so the others show "No milestones yet" until
  milestones are defined (conflict C3 from PHASE 010).
- The ⌘K shortcut works on Home only; elsewhere the palette isn't wired yet.
