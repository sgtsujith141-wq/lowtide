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

## What works today (PHASE 003)

- **Today** (`/`, first in the nav) answers "what about today?" at a glance:
  - the date, and a box to dump a thought (Enter saves). A quiet link says how many
    thoughts are waiting in the inbox, only when there are some;
  - **Needs attention**: tasks due today or overdue, in words ("Due today", "Was due
    26 Sep");
  - **My plan**: tasks you chose to work on today. "Add from Tasks" takes one click to
    open and one click to add. "Take out of today's plan" never deletes or drops
    anything, and a deadline keeps a task under Needs attention regardless;
  - **Protected time**: dinner together, call home, do nothing for an hour. Add, edit,
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
  - **Archive** instead of delete: an archived rhythm leaves daily logging but keeps
    its squares and can be restored.
  - **Deliberately absent:** streak counts, "missed day" colours, scores, levels,
    badges, reminders and schedules. Rest days are just quiet squares. Relationships
    and protected time never appear here.
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
