# LOWTIDE v2 PHASE 013 — Projects flagship experience

**Date:** 2026-10-02 · **Status:** PASS

The Projects overview and the Project Command Room are rebuilt as LOWTIDE's flagship
surfaces, on real records only. SPACE, Hackathons, Rhythm and Life are untouched.

## 0. Milestone reconciliation (ADR-065)

PHASE 010 imported Notion's task rows as tasks and refused to guess milestones from
them. This phase reconciles only what Notion states unmistakably.

- **What counts:** a set of task rows that a source explicitly treats as a project's
  milestones. In the owner's workspace that was a dashboard counting a project's rows as
  "N / 7 milestones", with the order given by the project row's own ordered task
  relation (and, for one project, confirmed by its page's "next milestone is …,
  followed by …, then …"). Two projects had such a set (7 milestones each). One project
  already had phase milestones from PHASE 010. The rest had none (their dashboard counts
  were "tracked tasks", not milestones), so they were left alone. A longer phase plan in
  one project's reference page stayed in SPACE: the dashboard, not the reference page, is
  the canonical source, and the two can't both be the roadmap.
- **How:** the import plan gained `milestoneSets` (project, ordered rows, evidence page,
  reason). The importer makes one milestone per listed row, in that order, after any
  milestones the project already has, with the project-name prefix dropped. The rows stay
  tasks. Nothing is derived from ordinary tasks or from time worked.
- **Provenance:** each milestone has a canonical source record naming its row (original
  title, path, URL, Notion's timestamps). The Command Room's History shows the run as
  "Milestones reconciled from Notion", with its source rows.
- **No fake history:** no ledger events, no progress snapshots, no work sessions. A row
  Notion marks done becomes a milestone done _by_ that row's last Notion edit (the
  latest moment Notion recorded it so), shown as "Recorded done by …". Imported records
  never count as activity, so no square lights.
- **Idempotent:** a dry run on a copy, then the real run (with its automatic pre-import
  backup), then a second run: `milestone: 18 unchanged`, nothing else changed. The
  ledger held the same events before and after.
- Completion stays ADR-038: weight, rounded down. Two of seven reads 28%, not the
  dashboard's rounded 29%.

The detailed report names the owner's records, so it stays out of Git
(`docs/NOTION-MIGRATION-RECONCILIATION.md`).

## 1. Projects overview hierarchy

No card gallery. One full-width page, grouped by tier, each tier labelled in a left
column on wide screens:

| Tier        | From                                             | Reads as                                                                                                                      |
| ----------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Primary     | focus `primary`                                  | The largest row: 28 px name, a thick milestone line with a tick at each stage, the roadmap, now, next, needs you, last moved. |
| Secondary   | focus `secondary`                                | The same row, one size down.                                                                                                  |
| Supporting  | focus `supporting`                               | Compact rows, two to a line on very wide screens.                                                                             |
| Active      | no focus set                                     | As Supporting.                                                                                                                |
| Later       | focus "not current" and state planning or parked | One quiet line: name, state, next, needs-you count, last moved.                                                               |
| Not current | focus "not current", any other state             | The same quiet line.                                                                                                          |

Each row answers: what it is, its state, how far it is (milestone weight, or "No
milestones yet, so no percentage"), where on the roadmap (✓ done, ● current, ○ upcoming;
wraps, never scrolls the page), now, next, whether it needs you, and when it last moved.
Done and archived projects fold away at the end. Nothing in a record changes to produce
the order.

## 2. Command Room hierarchy

1. **Identity:** the name large, the project's own one-line purpose, and state and
   priority as two compact chip controls (no large select).
2. **Start Work:** one press starts general work on this project; the chevron chooses
   the item in progress or an open task. Once running, the room says "Working here",
   the time, and what it's for.
3. **Progress:** the milestone-derived figure (64 px, counts up once on arrival), "N of
   M milestones", and the line with a tick per stage.
4. **Roadmap:** horizontal from 1280 px, vertical below. The current stage is labelled
   "Current" and its marker announces itself once. Each milestone opens a drawer: stage,
   status, weight, dates, tasks under it, its source, and Complete or Reopen.
5. **Project summary:** five facts, no prose: objective, current stage, last meaningful
   change, next meaningful action, health. Health is words ("Needs you: 1 blocker",
   "Nothing blocked or waiting on you"), never a score. Details are edited in a drawer.
6. **Sub-navigation:** Overview, Work, Tasks, Milestones, Docs, AI, History, with an
   underline that glides between tabs. No GitHub tab: there is no GitHub integration,
   and an empty tab saying so would be noise.

Overview: the work plane and the progress and time charts side by side on wide screens,
then the gold activity grid with the project timeline beside it.

- **Work plane:** Now, Next and Needs you first (Needs you is marked by a warm rule and
  lists approvals and blockers with Approve/Resolve and Details); Waiting, Blocked
  (anything else in that lane) and Parked second; Done folded. Next is ordered by the
  roadmap. Moving things between lanes stays on the Work tab.
- **Docs:** the project's SPACE slots (Planning, Architecture, Research, Decisions, Build
  Plans, Notes, Overview, Tables) with counts and the latest three pages; a click opens a
  read-only preview. The decision log and notes follow.
- **History:** the full ledger, and beside it the import and reconciliation trail.

## 3. Summary policy (display text)

Imported text is often long. Portfolio surfaces show a deterministic display title; the
record's own wording is always one step away (a tooltip, the item drawer, the milestone
drawer). Rules, in order (`concise()`):

1. Drop the project's own name in front, and status labels such as "Blocked:" or
   "CONFLICT:".
2. Say known imported phrasings plainly, by fixed pattern ("not listed in either
   portfolio … confirm" → "Portfolio position needs confirmation"; "X lists Y as
   SECONDARY instead" → "Priority recorded differently in X").
3. Remove parentheticals; keep the first clause of a long sentence.
4. Cut at a word boundary at 64 characters.

No AI runs at render time, and nothing is written back.

## 4. Activity policy

- The project timeline shows only events that mean the project moved: a finished work
  session (as "Worked 1h 42m"), completed tasks and milestones, state changes, approvals
  asked for, parked items, decisions, AI sessions and notes. Starts, pauses and resumes
  are left out. Each line leads with who: You, the AI client by name, or Decision.
- AI summaries are cut to one line; the full session opens in a drawer.
- The gold grid covers the last six months and lights only from LOWTIDE's own ledger and
  work sessions. Imported plans, milestone reconciliation and Notion dates never colour a
  square.

## 5. Visualisation rules

- Progress over time comes only from real progress snapshots: a step line with a soft
  area, a point per recorded day, carried days drawn flat (and said so on hover), the
  live value marked at today. Before the first recorded change it says so and draws
  nothing.
- Time invested comes only from finished work sessions: this week, the last twelve
  weeks as bars, and the total. Without sessions, one quiet line.
- Plain SVG and HTML, no chart library. Every chart has a text equivalent.
- Motion (all off under reduced motion): the progress figure counts up, the current
  stage pulses once, the line fills, the tab underline glides, drawers slide in.

## Responsive

Checked at 320, 360, 390, 768, 1024, 1440 and 1920 px, dark and light, on real data:
no horizontal overflow. The roadmap turns vertical below 1280 px, the work plane stacks,
the grid keeps squares of at least 10 px, Start Work stays at the top.

## Accessibility

axe-core 4.13 (WCAG 2.0/2.1 A, AA): 0 violations across the overview, five Command Rooms
and Home at 320, 1440 and 1920 px in both themes (98 route/width/theme checks for
overflow), and with the milestone drawer, the item drawer and the Start Work chooser
open, and on every tab. The roadmap is an ordered list of buttons with each stage's
status in words; the current stage carries `aria-current`; drawers return focus.

## Tests

59 files, 624 tests. New or rewritten: display rules (concise text, now and next,
roadmap order, tiers, health, activity lines), the overview (focus order, tiers, rows,
concise needs, no records changed), the Command Room (hero before tabs, milestone
progress and drawer, sparse charts, the work plane, the Work tab, the summary, Done
refused with open milestones, decisions, SPACE preview, tabs without GitHub, Start Work
general and on a task, meaningful activity, the grid from real records, the
reconciliation in History), and the importer's milestone sets (order, done-by,
provenance, still tasks, no events or squares, idempotent, refusing a non-task row).

## Known issues

- No work sessions and almost no ledger events exist yet, so the progress chart, time
  and grid are honestly empty for most projects.
- Only one project has an objective set; the summary shows "Not set" for the rest.
- Under heavy machine load, a few jsdom screen tests can exceed their waits; they pass
  when run again.
