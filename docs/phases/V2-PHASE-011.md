# LOWTIDE v2 PHASE 011 — Complete visual foundation

**Date:** 2026-10-01 · **Status:** PASS (visual system only; no data semantics, route
or feature removed)

The warm-paper journal look is replaced by a cold, neutral, dark instrument panel:
"low tide at night". The shell is monochrome graphite; colour belongs to data. Home and
the Project Command Room keep their current composition (their structural redesigns
come later); every screen now shares one visual system.

## Design tokens (`src/styles/index.css`)

Semantic CSS custom properties, exposed to Tailwind by `@theme inline`. Components
never use raw colours.

| Role           | Token (utility)                            | Dark                  | Light                |
| -------------- | ------------------------------------------ | --------------------- | -------------------- |
| Canvas         | `--lt-canvas` (`bg-canvas`)                | `#07090C`             | `#F7F8FA`            |
| Surface        | `--lt-surface` (`bg-surface`)              | `#0C0F13`             | `#EFF1F4`            |
| Raised         | `--lt-raised` (`bg-raised`)                | `#11151A`             | `#FFFFFF`            |
| Hover          | `--lt-hover` (`bg-hover`)                  | `#171C22`             | `#E6E9ED`            |
| Text           | `--lt-fg` (`text-fg`)                      | `#E6EAEF`             | `#0E1217`            |
| Text secondary | `--lt-fg-muted`                            | `#A1AAB5`             | `#454D57`            |
| Text muted     | `--lt-fg-subtle`                           | `#808A96`             | `#5F6874`            |
| Hairline       | `--lt-line` / `--lt-line-strong`           | white at 7% / 13%     | ink at 9% / 17%      |
| Brand accent   | `--lt-accent`, `--lt-accent-ink`           | `#9DB9D2` pale steel  | `#3D6C92`            |
| Primary action | `--lt-primary` / `--lt-on-primary`         | off-white on graphite | ink on paper-white   |
| Status         | `--lt-warn`, `--lt-danger`, `--lt-success` | amber, coral, green   | darker equivalents   |
| Sleep          | `--lt-dormant`, `--lt-dormant-bar`         | `#030405`, `#000000`  | `#ECEEF1`, `#E3E6EA` |

Every text token is at least 4.5:1 on every surface of its theme (checked by script,
then by axe-core in the running app). Dark is the reference design; Light is its cool
daylight twin, and Appearance (Auto/Light/Dark) is unchanged. The old `paper` and `ink`
tokens are gone from the code (a mechanical rename across 54 files).

## Colour belongs to data

The shell has no colour of its own. Accents appear where data does:

| Data        | Palette   | Where                                      |
| ----------- | --------- | ------------------------------------------ |
| Daily Pulse | green     | the Home year grid, Rhythm                 |
| Projects    | gold      | percentages, progress bars, project grids  |
| Work        | amber     | the work bar, its timer, work grids        |
| Sleep       | violet    | the moon on the off-time bar, sleep grids  |
| College     | blue      | college grids                              |
| Personal    | teal      | "kept for people and rest", personal grids |
| Gym         | muted red | gym grids                                  |

The brand accent marks focus, the current place and in-text links, sparingly. The one
filled button on a screen is off-white (Start Work, New project, Wake up).

## Typography

- One family: **Geist Variable**, bundled (`@fontsource-variable/geist`, OFL); no font
  is fetched from the internet. No serif anywhere in the app.
- Scale (body 14 px, rem stays 16 px): 11 meta · 12 small · 13 control · 14 body ·
  16 section (`text-section`) · 20 page (`text-page`) · 30 figure (`text-figure`).
  Hierarchy comes from weight, not large size jumps.
- Tabular figures everywhere; `.figure` (tighter tracking) for timers, percentages and
  counts. Labels are sentence case; the tracked all-caps labels are gone.

## Navigation

- **Desktop:** a 56 px icon rail. Primary: Home, Projects, SPACE, Hackathons, Rhythm.
  Each link's name is its accessible name and a tooltip on hover and keyboard focus
  (drawn from `data-label`, so the name exists once in the DOM). A short bar slides in
  beside the current place (`aria-current` marks it too).
- **Launcher** ("More destinations", at the rail's foot): Today, Inbox, Tasks, Life,
  Calendar, AI, Settings, and Data & backup. A disclosure, not a menu: focus moves to
  its first link, Escape closes it and returns focus to the button, a click outside or
  choosing a destination closes it.
- **Phones:** the top bar keeps five tabs (Home, Projects, Hackathons, Rhythm, More);
  SPACE joins the More page. 320 px still fits.
- **SPACE:** a placeholder route saying what SPACE is and how many pages and tables it
  already holds (from the Phase 010 data). No tree, editor or table UI yet.

## Layout system (`src/components/layout`)

- `Page` frames every route at one of three widths: `reading` (46 rem: Inbox, Data,
  Settings, More), `standard` (76 rem, centred: Today, Tasks, Hackathons, Rhythm, AI,
  SPACE) or `wide` (120 rem: Home, Projects, the Command Room, Life, Calendar). Wide
  screens now use the display: the year grid fills the width, project cards go to four
  columns at 1800 px, the command board shows all seven lanes from `xl`.
- Primitives: `PageHeader`, `ContentSection`, `SplitView`, `DataStrip`, `MetricGroup`,
  `EmptyState`, `CommandBar`, `Panel`, `Drawer` (a modal `<dialog>` side sheet).

## Surfaces: the card rule

A bordered box only when something is a separate object. Applied across the sweep:

- Flattened to hairlines and whitespace: the Pulse and every secondary grid, Needs you
  (now a two-column hairline list whose kind is written out, not just coloured), the
  Today summary (three columns divided by rules), the command board lanes (open columns
  with a thin coloured top rule), decision/note/session lists, Settings and AI
  sections, Life's areas.
- Kept, but quieter: project cards (a background step, no border), real forms (one
  panel style), the launcher and tooltips (raised, with a soft shadow).
- Empty states are one line and an action ("No active projects yet.").

## Controls

- Buttons: two sizes (28/32 px), one radius; `primary` (the single filled action),
  `quiet`, `ghost`, `danger`. Disabled buttons stay legible (subtle text, not faded).
- Fields: `fieldClass` and `compactFieldClass` on the surface colour with a clear
  focus border; native checkboxes, radios and date pickers follow the theme
  (`accent-color`, `color-scheme`).
- `segmentedClass`/`segmentClass` for radio groups shown as segments (grid ranges, work
  kind), `tabClass` for tablists (the Command Room), `badgeClass`, and status chips as a
  dot plus the word.
- Focus: a 2 px accent outline everywhere (`:focus-visible`).

## Contribution grids

Logic untouched. Visual changes only: squares size themselves to the width available
(6–12, 14 or 20 px by size, 3 px gap, 2 px when smallest), so a year fills a wide screen
at GitHub-like density and a narrow column without scrolling; dark inactive cells; the
selected day is outlined, today inset-ringed; restrained hover; a raised tooltip; the
legend and detail line sit against the grid. Keyboard behaviour is unchanged. The main
yearly grid stays green.

## Motion

Tokens: `--lt-dur-micro` 140 ms (hover, focus, presses) · `--lt-dur-state` 200 ms (tabs,
the nav bar) · `--lt-dur-panel` 260 ms (drawers, the launcher) · `--lt-dur-dormant`
700 ms (Sleep Mode); `--ease-tide` `cubic-bezier(0.2, 0, 0, 1)`. No bounce.
`prefers-reduced-motion` sets every duration to zero.

## Sleep Mode visual state

The purple banner is gone. With Sleep Mode on, the frame goes dormant: the canvas sinks
to the dormant token, content loses almost all colour and dims (`saturate(0.15)
brightness(0.72)`), the rail recedes by colour (subtle text, no current-place marker),
nonessential sections fade, animations stop. The off-time bar is a quiet near-black
strip with a violet moon and an off-white **Wake up**. Everything stays usable and
AA-readable. The full-screen Sleep experience is PHASE 015.

## Responsive and accessibility

- axe-core 4.13 (WCAG 2.0/2.1 A and AA) and horizontal-overflow checks on all 15
  routes at 320, 360, 390, 768, 1024, 1440 and 1920 px, dark and light: 0 violations
  and 0 overflow on real data (210 combinations), on an empty profile (210) and with
  Sleep Mode on (90). The sweep first found low-contrast receding nav labels and a
  greyed light-theme sleep bar in Sleep Mode, and a colour-only in-text link; all were
  fixed before these results.
- A planted low-contrast element was detected, confirming the checker ran.
- Keyboard: the rail, tooltips on focus, the launcher's focus handling, tabs, segments
  and grids; visible focus throughout.

## Screenshots

Taken outside Git (the session scratchpad): Home, Projects, Rhythm, Life, AI and
Settings on desktop; Home on a phone; Sleep Mode on desktop and phone.

## Tests

589 tests in 56 files, all passing. The navigation tests follow the rail and launcher
(including Escape and focus return). Typecheck, lint, format, build and the companion
build pass.

## Known issues

- On phones, the smallest year grids can still scroll a little; the first month label
  then shows a clipped fragment at the left edge.
- Home and the Command Room keep their composition until their redesign phases (the
  long "Next" lane, card counts).
- Heavy jsdom screens remain sensitive to machine load; runs under reduced
  concurrency are green.
