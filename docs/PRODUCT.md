# Product

## What LOWTIDE is

A personal, local-first life-management app for one person. The design target is the
end of a long day: you are tired, your head is full, and you want to put things down,
see what actually matters tomorrow, and keep a few things alive (a habit, a hackathon,
time with someone you love) without being managed by software.

It should feel **calm, cozy, personal**, and be **dense enough to be useful** — more
like a well-kept paper notebook than a SaaS dashboard.

## Planned areas

| Area                         | Purpose                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Today                        | What matters today, at a glance. The default screen.                               |
| Brain dump / Inbox           | Capture anything in one keystroke; decide what it is later.                        |
| Tasks                        | Things to do, with status, priority, optional due time and project label.          |
| Habits                       | Small recurring commitments, logged per day.                                       |
| Activity squares             | GitHub-style grid showing consistency over time.                                   |
| Hackathons                   | Registration, PPT and build progress, next action, deadlines.                      |
| Coding / learning            | Consistency tracking (via habits in the first versions).                           |
| Fitness                      | Consistency tracking (via habits in the first versions).                           |
| Money / business experiments | Lightweight tracking of experiments (modelled in a later phase).                   |
| Protected time               | Time reserved for relationship, family, friends, rest — visible so it is defended. |

## LOWTIDE v2 (in progress)

- **Home** (`/`) opens on three actions (Start Work, Sleep Mode, Ask LOWTIDE), then a
  large green **Daily Pulse** calendar of the last year, GitHub-style, with one square
  per day coloured only by what actually happened (ADR-037, ADR-047). Select a day to
  see what it held. Below that:
  - project cards: completion from milestones, what's happening now, next, waiting,
    approvals, blockers, time this week, when it last moved;
  - **Needs you**;
  - a compact Today;
  - recent activity;
  - smaller Work, Projects, College, Personal and Sleep grids.

  The gym isn't on Home.

- **Projects** (`/projects`) and each project's **Command Room** answer at a glance:
  - how far along it is, by milestone weight;
  - the milestone pipeline;
  - what's working now, next, waiting, needs approval, blocked, parked and done;
  - progress over time;
  - time invested;
  - its own activity calendar and timeline.

  Tabs cover Tasks, Milestones, Docs (the decision log), AI (real sessions only) and
  GitHub (not connected, and it says so).

- **Start Work** runs one work session at a time: general, college/study, project, or
  project + task. It has a live timer, pause/resume and finish, and survives a reload.
- **Sleep Mode** marks an off-time window you start and end yourself. The app dims but
  stays usable; it's a marked window, never a sleep measurement.
- **Ask LOWTIDE** is a local search until a real AI client is connected. It never
  pretends otherwise.

## What works today (core v0.1 complete, PHASE 006)

- **Today** (`/today` since v2; `/` in v0.1) answers "what about today?" at a glance:
  - the date, and a box to dump a thought (Enter saves). A quiet link says how many
    thoughts are waiting in the inbox, only when there are some;
  - **Needs attention**: tasks due today or overdue, in words ("Due today", "Was due
    26 Sep");
  - **My plan**: tasks you chose to work on today. "Add from Tasks" takes one click to
    open and one click to add. "Take out of today's plan" never deletes or drops
    anything, and a deadline keeps a task under Needs attention regardless;
  - **Protected time**, for today and the next six days: dinner together on Friday,
    call home tomorrow, do nothing for an hour on Sunday. Add, edit, move between days,
    remove. Never ticked off, counted or scored.
- **Inbox** lists thoughts oldest first. Each can become a task (the first line becomes
  the title, the rest the notes) or be cleared if it needs nothing more. Cleared items
  are kept, not deleted.
- **Tasks**: add by title; notes, priority, deadline and project are optional behind
  "Details". Rows are one or two lines and show "In today's plan" / "Planned for Fri"
  when relevant. Complete, drop, edit inline, reopen from "Finished".
- **Rhythm** (`/rhythm`) answers "where have I been showing up?":
  - **Six months of squares**, all rhythms together or one at a time. A square gets
    deeper the more you did that day, and every square says in words what was
    recorded.
  - **Today** logging: one tap for done-or-not habits (Gym, Creatine), or a number
    for counts and minutes (DSA 3, Coding 45 min). Typing a new number replaces the
    day's amount; the × clears it.
  - **Your rhythms**: name, broad category (coding, learning, fitness, health, money,
    personal), how to record it, and an optional daily target. The name carries the
    specifics ("LeetCode / DSA", "Money Lab").
  - **Show** switches the squares between all rhythms, **Coding & learning**,
    **Fitness & health**, or a single rhythm. It changes the history only; today's
    logging always lists every rhythm.
  - **Archive** instead of delete: an archived rhythm leaves daily logging but keeps
    its squares and can be restored.
  - **Deliberately absent:** streak counts, "missed day" colours, scores, levels,
    badges, reminders and schedules. Rest days are just quiet squares. Relationships
    and protected time never appear here.
- **Hackathons** (`/hackathons`) answer "which one is next, and what do I do for it?":
  - Every event you're considering or in is a compact sheet:
    - where it stands in time: "Registration due tomorrow", "Starts in 4 days",
      "Happening now", with the dates;
    - a prominent **Next:** line you can edit in place;
    - Registration, PPT, Build and Status, each changeable with one select.
  - Problem statement, team and notes are a click away. Adding one needs only a name
    and a date.
  - Sheets are ordered by what's next. Registration deadlines stop mattering once
    you've registered.
  - Finished and dropped hackathons move to a collapsed "Past" with everything kept.
  - **Deliberately absent:** percentages, progress rings, Kanban, fetching event sites,
    turning next actions into tasks automatically.
  - **v2 (decided, not built):** hackathons stay their own domain and may show visual
    stages derived only from Registration, PPT and Build (ADR-039). Still no
    percentages. Only technical Projects show a percentage, from weighted milestones
    (ADR-038). A hackathon links to a Project only when you choose to.
- **Today** also shows up to three hackathons that genuinely need attention this week:
  a pending registration that's overdue or due within 7 days, or an event starting
  within 7 days or happening now. One line each, with the next action, and nothing when
  nothing's near.
- **Data & backup** (`/data`, linked from the sidebar footer, or from the page footer
  on phones):
  - "Download backup" saves everything as `lowtide-backup-YYYY-MM-DD-HHmm.json`, with a
    plain note that the file isn't encrypted.
  - Restore: choose a file. LOWTIDE checks it completely and shows what it holds next to
    what's in the browser now. You confirm that it replaces the current data, and it
    restores in one step that either fully happens or doesn't happen at all.
  - A browser-storage line says whether the browser treats LOWTIDE's storage as
    persistent, and can ask it to. It's honest that this is no substitute for backups.
- Copy stays calm and plain; empty states are quiet ("Nothing pressing today."), not
  celebrations or warnings.

## Principles

- **Low cognitive load.** Few decisions per screen. Capture first, organise later.
- **Keyboard-friendly.** Every frequent action reachable from the keyboard.
- **Small and fast.** Instant start, no spinners for local data.
- **Local-first.** Works offline; data stays on the device unless the user exports it.
- **Honest.** No fake AI, no invented numbers, no demo data shipped as real.
- **People are not productivity.** Relationships and quality time are never tasks,
  habits, streaks, scores or activity-grid squares. They appear only as protected time,
  reserved and visible, never measured.

## Explicit non-goals

- Team/collaboration features, accounts, or a backend (for v0.1).
- Analytics, telemetry, tracking.
- Giant KPI dashboards, points, badges, or streak shaming. Activity squares show
  consistency; they don't punish gaps.
- "AI" features that aren't real.

## Visual direction

"Warm paper at low tide": warm off-white paper and warm charcoal (never pure white or
black), strong readable type, subtle muted borders, one restrained sea-glass accent,
compact spacing, minimal motion, no gradients, no giant cards. Tokens live in
`src/styles/index.css`; see [ARCHITECTURE.md](ARCHITECTURE.md#styling).
