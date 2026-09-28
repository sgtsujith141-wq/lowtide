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
