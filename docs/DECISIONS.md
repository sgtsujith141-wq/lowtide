# Architecture decisions

Lightweight ADRs. Status is Accepted unless noted. Newest decisions are appended.

## ADR-001 — React + Vite SPA, not a server-oriented framework

**Status (2026-09-30):** in force. ADR-040 plans a later, explicit supersession when the local companion ships.

**Context.** LOWTIDE is a single-user app whose data lives on the device. There is no
server-side data to render.
**Decision.** React 19 + TypeScript built by Vite into static files. No Next.js/SSR.
**Consequences.** Hosting is any static file server; no server to secure or pay for.
No SSR/SEO, which a personal tool does not need.

## ADR-002 — IndexedDB via Dexie for persistence

**Context.** Needs durable, structured, queryable local storage with transactions and
indexes; `localStorage` is synchronous, string-only and small.
**Decision.** IndexedDB through Dexie 4 (typed tables, versioned schema, transactions).
**Consequences.** Data lives in the browser profile and can be cleared by the user or
browser (see SECURITY.md). Dexie is ~95 KB of source in the bundle.

## ADR-003 — Repository abstraction between UI and database

**Context.** A future sync or cloud backend must not require rewriting components.
**Decision.** Components access data only through repository interfaces
(`src/db/repositories/types.ts`) obtained from `useRepositories()`. Dexie
implementations live in `src/db`. ESLint forbids UI/feature code from importing
`dexie`, the concrete database, Dexie repository implementations, and (in features,
components and hooks) persistence schemas. Only `src/db`, the composition root
`src/main.tsx` and tests are exempt. A test proves the rule fires. See ARCHITECTURE.md
for the exact scope and limits.
**Consequences.** Slight indirection; storage can be swapped at the composition root.
Reactive live queries (Dexie `liveQuery`) will need to be exposed through the
repository layer when needed rather than used directly in components.

## ADR-004 — No cloud, backend or authentication in v0.1

**Status (2026-09-30):** in force. ADR-040/041 plan a local (not cloud) companion in a later phase, which will supersede this explicitly.

**Decision.** No server, database service, accounts or auth.
**Consequences.** No cross-device sync yet; backup is the user's responsibility until
export exists (planned). Nothing to breach server-side.

## ADR-005 — No analytics or telemetry

**Status (2026-09-30):** in force. Network use is superseded per capability only by the phase that adds it (ADR-041); analytics and telemetry stay out.

**Decision.** No analytics, telemetry, error reporting services or third-party scripts.
The app makes no network requests at runtime beyond loading its own static files
(verified in PHASE 000 with a headless browser).
**Consequences.** Bugs are learned about by using the app, not from dashboards.

## ADR-006 — Local-first

**Status (2026-09-30):** in force. Canonical storage moves to a local SQLite companion only in a later dedicated phase (ADR-040); still local-first.

**Decision.** The device's database is the source of truth. All features must work
offline. Any future sync is an optional layer on top, not a requirement.
**Consequences.** IDs and timestamps chosen to be merge-friendly (ADR-007, ADR-008).

## ADR-007 — Timestamp and date representation

**Decision.** Instants are ISO 8601 UTC strings from `toISOString()`; calendar days are
local `YYYY-MM-DD` strings. See DATA-MODEL.md.
**Why strings, not `Date` or epoch numbers.** Readable in devtools and exports, sort
correctly as IndexedDB keys, survive JSON round-trips unchanged, and the distinction
between an instant and a calendar day is explicit in the type.
**Consequences.** Code must convert at the edges (`toTimestamp`, `toLocalDate`).

## ADR-008 — ID generation: UUID v4

**Decision.** `crypto.randomUUID()` for every record id.
**Why.** Offline creation on multiple devices without coordination; no auto-increment
collisions if data is later merged or imported. No new dependency.
**Consequences.** Ids are not ordered; ordering uses timestamps. Requires a secure
context (HTTPS/localhost).

## ADR-009 — Zod (`zod/mini`) validates persisted records

**Decision.** Every record is parsed with its Zod schema before being written; the same
schemas will gate imports. Use the tree-shakeable `zod/mini` entry.
**Why mini.** The classic API added ~66 KB minified (~18 KB gzip) to a one-screen app and
triggered Vite's 500 KB chunk warning; `zod/mini` removed both with identical checks.
**Consequences.** Functional API (`z.exactOptional(x)`, `.check(z.minLength(1))`) instead
of chained methods.

## ADR-010 — Domain error names must not collide with DOMException names

**Context.** A repository threw `NotFoundError` inside a Dexie transaction; callers
received a `DexieError` instead. Dexie maps errors whose `name` matches IndexedDB
DOMException names (`NotFoundError`, `InvalidStateError`, `ConstraintError`, …) to its
own classes.
**Decision.** Domain errors are named `RecordNotFoundError` and `RecordStateError`.
**Consequences.** `instanceof` checks work across transaction boundaries (tested).

## ADR-011 — TypeScript pinned to 6.0.x

**Context.** TypeScript 7.0 is the npm `latest`, but `typescript-eslint` 8.70 supports
`typescript <6.1.0`.
**Decision.** Pin `typescript@~6.0.3`. Revisit when typescript-eslint supports 7.x.

## ADR-012 — ESLint + Prettier, system fonts, browser-history routing

- ESLint (flat config) with typescript-eslint, react-hooks, react-refresh; Prettier owns
  formatting (`eslint-config-prettier` disables conflicting rules).
- System font stacks, so no font CDN requests (privacy + offline).
- `createBrowserRouter` for clean URLs; static hosts must fall back to `index.html`.

## ADR-013 — Relationships are protected time, never habits

**Context.** PHASE 000 shipped a `relationships` habit category. Review flagged that
it contradicts a core product principle: relationships and quality time must not be
turned into productivity tasks, streaks, scores or contribution-grid performance.
**Decision.** Remove `relationships` from `HABIT_CATEGORIES` and add no replacement
relationship-type category. Time with partner, family and friends (and rest) is
modelled only by `ProtectedTime` (`relationship | family | friends | rest | personal`).
**Consequences.** Habit validation rejects `category: "relationships"` (tested). No data
migration was needed: PHASE 000 has no habit repository or UI, so no code path could
have written a habit with that category.
Future features (activity squares, stats) must not score protected time.

## ADR-014 — Missing-record semantics for repositories

**Decision.** `get`-style lookups resolve to `undefined` for a missing id; operations
that require an existing record reject with `RecordNotFoundError`; operations invalid
for the record's current state reject with `RecordStateError`.
**Why.** "Is it there?" is a normal question for lookups and shouldn't need
`try/catch`; for a mutation, a missing target is a genuine error the caller must see.

## ADR-015 — Reactive data through storage-agnostic repository watches

**Context.** PHASE 001 screens must update whenever data changes (capture on Home
shows up below; converting in Inbox makes a task appear in Tasks), without components
importing Dexie or reloading by hand after each mutation.
**Decision.** Repository interfaces gain `watch…` members of type
`Watch<T> = (onChange, onError?) => Unsubscribe`. The Dexie implementation wraps
`liveQuery` in `src/db`; components use `useWatch(watch)`. Only watches the screens need
exist: `tasks.watchOpen`, `tasks.watchClosed`, `inbox.watchUnprocessed`.
**Alternatives rejected.** `dexie-react-hooks`' `useLiveQuery` in components (breaks the
storage boundary, adds a dependency); returning Dexie/Observable types from repositories
(leaks the engine); manual refetch after each mutation (misses other tabs, easy to forget);
a state-management library (unnecessary).
**Consequences.** A future sync implementation must provide the same push-style
`Watch` semantics. Screens are non-optimistic: lists change only when storage changes.
Liveness across repositories (convert in Inbox → Tasks updates) comes free from
`liveQuery`'s cross-table change tracking; this is tested.

## ADR-016 — Date-only deadlines encoded as UTC noon of the chosen date

**Context.** The UI needs date-level deadlines; `Task.dueAt` is a UTC `Timestamp`.
Converting a local date to a local instant and back shifts the day for zones far enough
apart.
**Decision.** Store a chosen day `D` as `D T12:00:00.000Z` and read the day back from the
UTC date part (`dueAt.slice(0, 10)`), only through `deadlineFromLocalDate` /
`localDateOfDeadline` in `src/lib/time.ts`. Overdue/today status compares that day with
today's local calendar day, never instants. No schema change.
**Alternatives.** _Local noon as an instant_ was implemented first and **failed the new
tests**: a deadline entered in Asia/Kolkata showed a day early in America/Los_Angeles
(12.5 h apart), and Auckland↔New York was off by a day too. _A new `dueDate: LocalDate`
field_ would match the `LocalDate` convention best but needs a schema v2 migration and
changes the specified `dueAt` model; not justified while every deadline is date-only.
**Consequences.** `dueAt` currently means "due on this calendar day". Time-of-day
deadlines, if ever needed, get an explicit field in a new schema version.

## ADR-017 — Capture clears immediately and saves in order; failures put the text back

**Context.** Brain dump must let you type, press Enter, and keep typing. The first
implementation cleared the box only after the write finished and read the draft
from React state. The PHASE 001 browser run showed that fast typing could merge the
next thought into the one being saved.
**Decision.** On Enter the composer reads the textarea's live value, clears
immediately, and appends the write to a per-composer promise queue, so writes happen
in order. If a write fails, its text is put back in the box ahead of anything typed
since, with a visible error. Success is announced only after the write.
**Consequences.** Enter is never lost and thoughts never merge. The text sits in memory
(not on screen) for the few milliseconds of a local write. Regression tests slow the
write down to reproduce the race.

## ADR-018 — Processing keeps history

**Decision.** Nothing in PHASE 001 deletes records. Clearing an inbox item sets
`processedAt`; converting also links `convertedToTaskId`. Dropping a task sets status
`dropped`; completed and dropped tasks stay listed under "Finished" and can be reopened.
**Why.** Honest history, recoverable mistakes (there is no undo yet), and future export,
all with no schema change. Permanent deletion, if added, will be an explicit action.

## ADR-019 — Intentional planning is `Task.plannedFor: LocalDate`, separate from `dueAt`

**Context.** Today needs "what I chose to work on today". A deadline and an intention
aren't the same: an essay due Friday may be worked on Tuesday.
**Decision.** Add optional `Task.plannedFor?: LocalDate` (schema V2, indexed). It is a
real local calendar day, not a UTC-noon timestamp. `planFor` (open tasks only) and
`removeFromPlan` never touch `dueAt`; `update` never touches `plannedFor`. Completing
or dropping **keeps** `plannedFor` as a record of what day it was meant for; Today
queries exclude closed tasks, so this is invisible in active views. `reopen` doesn't
invent a plan; it keeps whatever was stored, so a task planned for today and reopened
today returns to today's plan.
**No carry-over.** A plan for an earlier day isn't moved forward or flagged. Unfinished
plans simply don't show on Today (the task is still in Tasks and in the picker), and
the Tasks screen doesn't mention past plans. This is deliberate: no guilt pile.
**Consequences.** One optional field and one index. Migration is non-destructive (see
DATA-MODEL § V1 → V2).

## ADR-020 — Today's composition and de-duplication

**Status (2026-09-30):** composition in force; the route moves to `/today` when Home ships (ADR-043).

**Decision.** Today shows two task sections, from `tasks.watchForDay(today)` through the
pure `composeToday()`:

- **Needs attention**: open tasks due today or overdue (by deadline day, ADR-016);
- **My plan**: open tasks with `plannedFor === today` that are _not_ in Needs attention.

A task is shown at most once, and a deadline outranks a plan. Future deadlines don't
appear automatically; plans for other days don't appear. Order in each section is the
open-task order: deadline, then priority, then age. Taking a due task out of the plan
clears `plannedFor` but leaves it under Needs attention. The empty states say so
plainly ("Nothing pressing today.", "Nothing else planned.") rather than hiding the
section, because "nothing pressing" is itself the answer to "what needs me today?".
**Why no dedicated query per section.** One watch returns the union
(`plannedFor = day` ∪ `dueAt ≤ end of day`), and composition is pure and unit-tested.
That keeps the repository API small and the rules in one testable place.

## ADR-021 — Protected time is a plan for people and rest, never a task

**Decision.** `ProtectedTimeRepository` offers create, update, remove and
`watchForDate`. Entries have a title, a kind (relationship, family, friends, rest,
personal), an optional note, and a local date. There is **no** status, completion,
checkbox, count, history, streak, target or "missed" state. The UI never uses words
like goal, completed or streak for them. On Today they're shown as margin notes (a left
rule and a kind icon) rather than as task rows. Remove deletes the entry: it's your own
plan, and there is no history of protected time to keep honest.
**Why.** Relationships and rest must never become productivity metrics (ADR-013 removed
the relationship habit category for the same reason).
**Consequences.** Entries are ordered by title within a day; there's no time of day
yet. Entries may be sensitive and are stored unencrypted, like everything else
(SECURITY.md).

## ADR-022 — One chunk per screen via React Router `lazy`, plus idle prefetch

**Context.** The PHASE 001 build was a single 497 kB chunk, near Vite's warning, and
every new screen would have made it bigger.
**Decision.** Screens are `lazy` routes (React Router's own API, no new dependency). A
`prefetchScreens()` call on idle warms the other screen chunks. Separately, `lib/time`
dropped date-fns (`format`/`parse` for plain `YYYY-MM-DD`), so the data layer no longer
drags a date library into the entry; date-fns now loads only with the screens.
**Result.** The entry is 440.6 kB (140.8 kB gzip); screens are 3–14 kB each, and shared
display formatting is 21 kB. What remains in the entry is framework baseline (React,
React Router, Zod, Dexie). Splitting that further wouldn't reduce first-load work, so
it wasn't pursued.
**Consequences.** Tests render through `renderApp`, which awaits the lazy screen. The
very first paint waits for one small local chunk (`HydrateFallback` renders nothing).

## ADR-023 — Habit entries: one per habit per local day, upserted, cleared by deletion

**Context.** Rhythm logs habits by day. The V1 schema already has a unique
`[habitId+date]` index on `habitEntries`, and `HabitEntry.date` is a `LocalDate`.
**Decision.**

- **Upsert.** `setEntry(habitId, date, value, note?)` looks up the day's entry through
  the compound index. It then either creates one or updates `value`, `note` and
  `updatedAt`, keeping the same `id` and `createdAt`. The unique index is the final
  integrity guard.
- **No entry means no recorded activity.** `clearEntry` deletes the row rather than
  storing a zero. A zero would be an entry that means nothing.
- **Unit rules** (enforced in the repository, as `InvalidInputError`):
  - `check`: value is exactly 1.
  - `count`: a positive whole number.
  - `minutes`: positive, up to 1440 (a whole day; more is a typo).
  - Targets: optional, and only for `count` and `minutes`. They must be positive, a
    whole number for `count`, and at most 1440 for `minutes`.
- **The unit can't be edited.** It defines what every existing entry means. Name,
  category and target can change.
- **Archived habits** can't be logged (`RecordStateError`) and keep every entry.
  There is no delete.
- **Only explicit actions create entries**: a tap, Enter, or leaving an amount field
  after typing. Nothing is inferred from visits, tasks or anything else.

**Consequences.** No schema change (`SCHEMA_VERSION` stays 2). An entry's day is its
`LocalDate`; its timestamps never decide which day it belongs to.

## ADR-024 — Per-habit activity level (0–4), for display only

**Decision.** The level is computed at render time and never stored:

- no entry → 0;
- a logged `check` habit → 4;
- `count` or `minutes` **with a target**, by share of the target:
  - under 25% → 1;
  - 25% to under 50% → 2;
  - 50% to under 100% → 3;
  - 100% or more → 4;
- `count` or `minutes` **without a target** → 2 ("recorded"). Without a target there's
  nothing to be partial of, so the square doesn't pretend to know how full the day was.

**Why.** The level is transparent, deterministic and unit-tested. The same 5 levels
map to 5 colour tokens, and every square also carries a text label.

## ADR-025 — Overall grid: banded sum of per-habit levels, no denominator

**Status (2026-09-30):** in force for Rhythm's overall, group and habit views. The v2 master grid is a separate Daily Pulse (ADR-037).

**Decision.** For each day, add up the levels of every habit with an entry that day,
archived habits included, then band the sum:

| Sum        | Overall level |
| ---------- | ------------- |
| 0          | 0             |
| 1–3        | 1             |
| 4–7        | 2             |
| 8–11       | 3             |
| 12 or more | 4             |

So one fully done habit reads "moderate", two "strong", and three or more "high".
**Why not a percentage of active habits.** A denominator would make history change
when you add or archive a habit, and would turn quiet days into visible shortfalls.
With a plain sum, past squares never change meaning. Each habit contributes at most
4, so one extreme entry can't max out a day.
**What never enters.** Only habit entries: never tasks, inbox activity, protected time
(ADR-013, ADR-021), money or app usage. `buildGrid` takes habits and habit entries
only, and ignores entries whose `habitId` isn't a known habit (tested).

## ADR-026 — Activity grid: ARIA grid, roving tabindex, text for every square

**Decision.** The grid is `role="grid"`:

- **Structure:** 7 rows (Monday to Sunday) and one column per week. It covers 26
  weeks (about six months) ending today. Future days in the current week aren't drawn.
- **Keyboard:** it's a single Tab stop, using a roving `tabindex` that starts on today.
  - ↑ and ↓ move by one day, ← and → by one week;
  - Home jumps to the first day, End to today;
  - moves past the ends are ignored.
- **Text for every square:** each cell's `aria-label` reads like "Monday 28 September
  2026: Coding 45 of 60 min, Gym done (moderate activity across 2 habits)". A visible
  line under the grid shows the focused or hovered day, so information never depends
  on colour or on hovering. Today's cell has `aria-current="date"` and a ring.
- **Sizing:** squares are 11 px on phones and 15 px from `sm` up (`--cell`). On narrow
  screens the grid scrolls horizontally inside its own box and starts scrolled to the
  most recent weeks; the page itself never overflows.
- **No chart library.** It's plain React and CSS.

## ADR-027 — Hackathon dates are LocalDate (schema V3)

**Context.** PHASE 000 typed `registrationDeadline`, `eventStart` and `eventEnd` as UTC
timestamps. For hackathons they mean calendar days ("registration closes on the 1st",
"the event runs 4–5 Oct"). ADR-016's UTC-noon trick was a workaround for tasks, where
changing the field wasn't justified at the time.
**Decision.** The three fields become `LocalDate` (`YYYY-MM-DD`), validated with
`z.iso.date()`.

- **Date rules** (repository, `InvalidInputError`): `eventEnd` needs `eventStart` and
  can't be earlier. The registration deadline is independent; no ordering rule is
  imposed on it.
- **Clock times** don't exist in the model. Users can write "closes 11:59 pm" in notes.
- **Schema V3** keeps the same `hackathons` indexes (`status`, `registrationDeadline`,
  `eventStart`). The version exists to run a data upgrade:
  - absent → absent;
  - a real `YYYY-MM-DD` → kept;
  - an ISO timestamp → its UTC date component;
  - anything else, including impossible dates and an end that's missing its start or
    precedes it → removed from the field and appended to `notes` as
    `[Moved by LOWTIDE upgrade] field: raw`. Never silently discarded.

**Consequences.** `LocalDate` string comparison works for index range queries. Real
databases were expected to hold no hackathons (there was no UI before), but the
upgrade is tested against a genuine V2 database with legacy timestamp, missing, already
local and malformed values.

## ADR-028 — Hackathon ordering and date wording

**Decision.** Open hackathons (considering or active) are ordered by `orderHackathons`
(pure):

1. **Upcoming**, keyed by the earliest of:
   - the registration deadline, if registration is still `not_registered` and the
     deadline is today or later;
   - the event start, if the event hasn't ended (ongoing events key on their start and
     so come first).
2. **No dates at all.**
3. **Only past dates**, most recent first.

Ties are broken by `createdAt`, then name, then id. A registered, waitlisted or rejected
hackathon's deadline never drives urgency. Past events stay where the user left them:
status is never changed automatically.

**Wording** is calm and factual, from calendar-day arithmetic:

- "Registration due today / tomorrow / in N days / 12 Oct", "Registration closed N days
  ago";
- "Starts tomorrow / in N days / 5 Oct", "Happening today" (one-day event), "Happening
  now" (multi-day), "Ended N days ago / 9 Sep";
- ranges like "28–29 Sep" or "30 Sep – 2 Oct", with the year only when it isn't the
  current one.

Tone adds weight ("today" and "now" in accent, past in muted) but the words always say
it.

## ADR-029 — Which hackathons appear on Today

**Decision.** `hackathonsForToday(list, today)` shows a hackathon when it is open (not
finished or dropped), registration isn't `rejected`, and at least one of these holds:

- registration is still `not_registered` and the deadline is overdue or within the next
  7 calendar days;
- the event starts within the next 7 days (0–7), or is happening now.

Each hackathon is **one row**, even with two reasons ("Registration due tomorrow ·
Starts in 4 days"), plus "Next: …" when set.

- **Order:** by the earliest relevant date, then the usual tie-breaks.
- **Limit:** at most 3, then "See all hackathons (N more coming up)".
- **Placement:** between My plan and Protected time, and absent entirely when nothing
  qualifies.
- **No controls:** the name links to `/hackathons`.
- **No side effects:** hackathons never create tasks or habit entries, and Rhythm never
  sees them.

## ADR-030 — Don't disable a focused control while its save runs

**Context.** Several controls were `disabled` while their write was in flight:

- the Rhythm toggle and amount field;
- the clear button, which disables itself once the entry is gone;
- the hackathon status selects, during development.

Chromium drops keyboard focus from an element that becomes disabled, so keyboard users
lost their place after each action.
**Decision.** Controls that trigger a save stay enabled. Double submits are ignored in
the handler (`if (busy) return`). When the control itself goes away (e.g. the clear
button), focus moves to the nearest sensible control (the amount field).
**Consequences.** Rows can still show `aria-busy`. Tests assert focus after these
actions; the browser run confirmed it for the Rhythm toggle and the hackathon PPT
select.

## ADR-031 — Backup envelope, versioned separately from the database schema

**Decision.** A backup is one JSON document:

```json
{
  "format": "lowtide-backup",
  "formatVersion": 1,
  "schemaVersion": 3,
  "exportedAt": "2026-09-28T11:33:51.758Z",
  "data": {
    "tasks": [],
    "inbox": [],
    "habits": [],
    "habitEntries": [],
    "hackathons": [],
    "protectedTime": []
  }
}
```

- **`formatVersion`** (`BACKUP_FORMAT_VERSION = 1`) versions the envelope: the
  wrapper's shape and meaning.
- **`schemaVersion`** records which database schema the records were written under.
- They change independently. A new store or field bumps the schema, and the envelope
  can stay at 1. A different envelope (say, adding encryption) bumps the format.
- **Newer versions are rejected.** A newer `formatVersion` or `schemaVersion` than this
  build knows is refused, never guessed at.
- **Older schemas are migrated.** Data from schema 1 or 2 is upgraded in memory by
  `migrateSnapshot`, which calls the same functions as the database's own upgrade
  steps (`migrateHackathonToV3`).
- **Export** reads every store in one read-only transaction and sorts each store
  deterministically, so identical data gives an identical file. The file is named
  `lowtide-backup-YYYY-MM-DD-HHmm.json` (local time).

## ADR-032 — Import replaces; it never merges

**Decision.** Restoring a backup replaces all LOWTIDE data in the browser with the
backup's snapshot.
**Why not merge.** Merging raises questions with no calm answer:

- the same id with different content;
- two habits both called "Gym";
- two entries for one habit and day;
- a task completed in one copy and dropped in the other;
- whose timestamps win.

A restore should recreate a known state.
**UX consequences.**

- The file is fully validated before anything is shown.
- The preview gives per-store counts for the backup against the browser now, and
  states "Importing this backup will replace the LOWTIDE data currently stored in this
  browser."
- Restore stays disabled until an explicit checkbox is ticked.
- Selecting a file never writes anything.

**Strict validation.** The import checks the current Zod schemas, the repositories'
own domain rules (shared via `src/db/rules.ts`), unique ids per store, entries whose
habit is in the backup, one entry per habit per day, and converted inbox items whose
task is in the backup. A corrupt file is rejected whole, never repaired or partially
imported. A dangling relationship means the file isn't a faithful snapshot.

## ADR-033 — Restore is one atomic transaction

**Decision.** `restore(validatedBackup)` runs one Dexie read-write transaction over all
six stores:

- it clears every store;
- then it bulk-inserts in parent-before-child order: habits, tasks, hackathons,
  protected time, inbox, habit entries;
- any failure (a constraint violation, a quota error, a rejected write) aborts the
  transaction, and IndexedDB rolls every store back to its state before the
  transaction.

**Proof.** Tests make a validated backup fail during the transaction:

- one tampers it after validation, so the last insert violates the unique
  `[habitId+date]` index;
- another makes a middle insert reject.

In both, the original data is intact afterwards, record for record. Both tests fail if
the clearing is moved outside the transaction.
**Other consequences.** `restore` accepts only a `ValidatedBackup`, a branded type that
only `inspect` produces. Live watches update after the commit, so no page reload is
needed.

## ADR-034 — Persistent storage: read quietly, ask only on request, never oversell

**Decision.**

- The Data page reads `navigator.storage.persisted()` on load, which never prompts.
- `navigator.storage.persist()` is called only when the user presses "Ask browser to
  keep LOWTIDE data".
- Every outcome is shown in plain words:
  - persistent;
  - granted;
  - not granted ("Keep backup files somewhere safe.");
  - not supported.
- The page and SECURITY.md both state the limit: persistence lowers the chance the
  browser evicts LOWTIDE under storage pressure. It does not survive clearing site data,
  deleting the browser profile or losing the device. Backups still matter.

## ADR-035 — Protected time for the week ahead lives on Today

**Context.** Protected time only covered today, so there was no way to keep Friday
evening free for dinner with friends.
**Decision.** Today's Protected time section covers **today and the next six local
days** (seven rows: "Today", "Tomorrow", then weekday names), rather than getting a
new route or tab.

- **Actions:** add on any of the seven days, edit, move an entry to another day
  (the form gains a labelled **Day** select), and remove.
- **Data:** `ProtectedTimeRepository.watchRange(start, end)` does one inclusive
  indexed `between` query on `date`, ordered by date, then title, then id.
  `watchForDate` is now a one-day range.
- **Days are calendar days.** The seven days come from `addDays` on `LocalDate`s,
  never from instants.

**Kept from ADR-021:** no checkbox, no "done", no counts, streaks, targets or
"missed". Empty days say "Nothing planned here yet." There's no calendar grid, no
hours and no drag-and-drop.
**Accessibility:**

- each day is an `h3`;
- button names include the day ("Add protected time for Friday", "Edit Dinner
  (tomorrow)"), so repeated titles never produce duplicate names;
- after add or edit, focus goes to the entry's Edit button once the data shows it on
  its (possibly new) day;
- after remove, focus goes to that day's Add button.

**Consequences.** No schema change and no backup change: future entries are ordinary
`ProtectedTime` records.

## ADR-036 — Rhythm category groups change the history grid only

**Decision.** The Rhythm "Show" selector gains a Groups section:

- **Coding & learning:** categories `coding` and `learning`;
- **Fitness & health:** categories `fitness` and `health`.

It sits between "All rhythms" and the individual rhythms (then Archived). A group view
counts only entries of habits in those categories, archived habits included, using the
existing overall rule (ADR-025) unchanged. Per-habit levels (ADR-024) are unchanged too.
The grid's name says which view it is ("Coding & learning, last six months").

**Today's logging is not filtered.** It always lists every active rhythm, so changing
the history view never makes habits seem to disappear.

**Not added:** a Money & personal group (not needed), new routes, or any body metrics.
Relationship-type categories still don't exist (ADR-013), so no group can include them.

## ADR-037 — Daily Pulse: a fixed-band master grid from real daily signals (v2)

**Context.** LOWTIDE v2 needs one master grid for the whole day, not only habits.
ADR-025's habit-only overall grid stays valid for Rhythm's per-habit and group views;
this ADR adds a separate **master** grid and doesn't change ADR-025.
**Decision.** `dailyPulse(signals)` in `src/features/pulse/daily-pulse.ts` (algorithm
version 1) is a pure, deterministic function of one day's signals. It isn't AI, isn't
stored, and is re-derived at read time. Records are never rewritten to change a score.

**Signals** (all from real records; derivation lands with schema V4):

| Signal             | Source                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `workMinutes`      | active minutes (pauses excluded) of finished work sessions of kind project, task or general |
| `workRoutines`     | work-preset routines (coding) at level ≥ 1 (ADR-045)                                        |
| `progressMoves`    | tasks completed, milestones completed, decisions recorded, blocker/approval items resolved  |
| `collegeMinutes`   | active minutes of finished college work sessions                                            |
| `collegeRoutines`  | college-preset routines (learning) at level ≥ 1                                             |
| `personalRoutines` | personal-preset routines (personal, health) at level ≥ 1                                    |
| `movementRoutines` | gym-preset routines (fitness) at level ≥ 1                                                  |
| `offTimeCompleted` | a manually started sleep or rest window that ended on that day                              |
| `dayOff`           | the owner declared the day a day off (an off-time record of kind `day_off`)                 |

**Points, each capped:**

- work: 2 at 90+ minutes; 1 at 25+ minutes or a work routine; else 0;
- progress: 1 for any progress move;
- college: 1 for 25+ minutes or a college routine;
- personal: 1 per personal routine, at most 2;
- movement: 1 for a gym routine;
- recovery: 1 for a completed off-time window.

**Bands** (total 0–8): 0 → 0 · 1 → 1 · 2–3 → 2 · 4–5 → 3 · 6+ → 4.

**Day off.** On a declared day off the level is the higher of the banded level and a
rest level: 1, plus 2 for a completed off-time window, plus 1 for any personal or
movement routine (so up to 4). Working on a day off never lowers the day.

**Guarantees** (tested in `src/test/v2-rules.test.ts`):

- more hours, tasks or routines past each cap add nothing, so 12 hours of work equals 90 minutes;
- the gym is never required: level 4 is reachable without movement;
- a declared day off can be strong (3) or high (4) on rest alone;
- negative, non-finite or nonsense amounts count as nothing;
- there is **no** protected-time, inbox or money signal. The signal list is pinned by
  a test. Protected time never contributes (ADR-013, ADR-021) and isn't the source of
  `dayOff`.
- no history is fabricated. Days before V4 score only from the records they already
  have (`habitEntries`, `tasks.completedAt`).

**Replaceable.** A new algorithm gets a new `PULSE_ALGORITHM_VERSION` and a new ADR.
Because the pulse is derived, past days re-render under it without data changes.

## ADR-038 — Project completion is weighted milestones only (v2)

**Context.** v0.1 kept percentages out deliberately (PRODUCT.md, for hackathons; ADR-025
for habits). v2's technical Projects need a completion measure.
**Decision.** A Project may show `Σ weight(completed milestones) ÷ Σ weight(all
milestones)` as a whole percent, rounded down (`projectCompletion` in
`src/features/projects/completion.ts`):

- default milestone weight is 1; a weight must be finite and above 0;
- no milestones means **no percentage is shown** (the function returns `null`);
- 100 means every milestone is done (rounding can never reach it early);
- time worked, task counts and AI estimates **never** determine completion;
- adding a milestone may lower the percentage, which is accepted and shown honestly;
- progress snapshots (schema V4) preserve past values, so history isn't rewritten.

**Scope.** Projects only. Hackathons (ADR-039) and habits keep no percentages.

## ADR-039 — Hackathons stay their own domain; progress from their own stages (v2)

**Decision.**

- Hackathons remain the `hackathons` store and sheet (ADR-027 to ADR-029 unchanged).
- They may show **visual stage progress** derived only from their status fields
  (`hackathonStages` in `src/features/hackathons/progress.ts`): Registered (done when
  registered, active when waitlisted), PPT (omitted when not needed; done when
  submitted, active when in progress), Build (active in progress, done from demo ready),
  Demo (done from demo ready), Submitted. No percentage, no time, no task counts.
- An optional `hackathon.projectId` (schema V4) links a technical Project **only when
  the owner explicitly chooses** to track the build as a Project.
- Existing hackathons are **never** converted into Projects automatically, by a
  migration or otherwise.

## ADR-040 — Source of truth: a staged move to a local companion (v2)

**Context.** Claude, Claude Code, ChatGPT and future AI clients need persistent shared
context, which browser IndexedDB can't provide to anything outside the browser.
**Decision.** The long-term v2 architecture is: a LOWTIDE **local companion** process,
a **SQLite canonical database**, a human-readable **technical workspace**, a **context
service**, and **MCP/API** access. It's reached in stages:

1. **Now and through the early v2 phases:** IndexedDB (Dexie) stays canonical. Schema V4
   is an IndexedDB schema. ADR-001, ADR-002, ADR-004 and ADR-006 stay in force.
2. **A dedicated later phase** introduces the companion and migrates IndexedDB →
   SQLite through the existing backup envelope (ADR-031), with a verified backup
   first and no data loss.
3. Only then do workspace sync, the context service and MCP/API read from SQLite.

**Repository interfaces are the migration seam** (ADR-003, ADR-015): UI code keeps
depending on them, and only their implementation moves. No storage migration happens
before its own phase.
**Consequences.** When stage 2 lands, it will supersede ADR-001/002/004/006 explicitly.
Until then they stand.

## ADR-041 — Network and AI access: opt-in, local, authenticated, scoped (v2)

**Decision.** Every AI and network integration is **opt-in** and off by default. The
future companion:

- binds only to `127.0.0.1` by default;
- authenticates every request (a per-install secret);
- never uses wildcard CORS (an explicit origin allow-list);
- keeps secrets out of the frontend bundle;
- keeps the GitHub token in the companion or OS secure storage. GitHub access starts
  read-only and scoped to repositories the owner lists.

**AI access is scope-based:**

- **PROJECT** (the default for coding agents): one project's technical context only;
- **WORKSPACE:** the technical workspace across projects;
- **GLOBAL:** broader LOWTIDE context, only when the owner explicitly authorizes a
  specific assistant. It still honours the exclusions below.

**Always excluded:** protected time, from every scope. Sensitive personal records
(sleep, routines, health-type records, habit logs, inbox) are available only through
the context service under an explicit grant, and are never written into the workspace
or Git to give AI context (ADR-044).
**Consequences.** ADR-005's "no runtime network" stays true for the app as shipped;
it's superseded per capability only in the phase that adds that capability, together
with a SECURITY.md update.

## ADR-042 — Visual system stays theme-adaptive; grid palettes and Sleep Mode (v2)

**Decision.**

- LOWTIDE keeps its warm-paper identity, the light and dark themes, and semantic CSS
  tokens. The app does **not** become dark-first.
- Future grid palettes, as token sets with light and dark variants:
  - Daily Pulse: green
  - Work: amber
  - Sleep: violet
  - Personal: teal
  - Gym: warm red
  - College: blue
  - Projects: gold
- Inactive cells follow the theme.
- Levels stay readable without colour (ADR-026 text per cell).
- **Sleep Mode** dims the UI, lowers saturation and reduces motion and visual noise,
  while the normal structure and navigation stay visible. It is not a black
  replacement screen.

## ADR-043 — Home at `/`, Today at `/today`, and v2 navigation (v2)

**Decision** (implemented in a later phase; ADR-020's Today composition is reused, not
discarded):

- `/` becomes **Home**, and the existing Today experience moves to `/today`.
- **Primary mobile navigation:** Home, Projects, Hackathons, Rhythm, More.
- **More** holds Today, Inbox, Tasks, Life/Routines, Calendar, AI, Data & backup and
  other secondary areas.
- Desktop navigation may show more destinations directly.
- **Home and Projects** are the two most important surfaces.
- The gym is never a primary Home card.

**Consequences.** Until that phase ships, `/` stays Today, and ADR-020 and ADR-022
stand. The 320 px phone bar must be re-measured when the tabs change.

## ADR-044 — Workspace privacy: technical knowledge only (v2)

**Decision.** The future filesystem workspace holds technical project knowledge:

```
projects/<project>/
  PROJECT.md  CONTEXT.md
  planning/  decisions/  research/  docs/  files/  assets/
  ai/sessions/  ai/handoffs/  ai/summaries/
  archive/
```

These are **never** written into the workspace or Git by default: raw sleep logs,
routines, personal health-type records, personal habit logs, inbox contents, and
protected time (never, with no option). Technical knowledge may later be Git-versioned.
Sensitive life state stays in private LOWTIDE storage, and AI gets permitted context
from the context service (ADR-041) instead of files.

## ADR-045 — Routine grid presets map existing categories; no data change (v2)

**Decision.** `CATEGORY_PRESET` (`src/features/rhythm/presets.ts`) is a presentation
and context mapping:

- coding → Work / Projects
- learning → College / Learning
- fitness → Gym
- health → Personal
- personal → Personal
- money → unmapped (out of the master Daily Pulse unless configured later)

Habit records keep their categories and are never rewritten. ADR-036's Rhythm group
views are unchanged. The presets drive the v2 themed grids and the Daily Pulse
routine signals (ADR-037).

## ADR-046 — Schema V4 design locked (v2)

**Decision.** Phase 002 implements exactly the V4 design in
`docs/LOWTIDE-V2-ARCHITECTURE.md` §3–§9. Its key choices:

- **Additive only.** Nine new stores: `projects`, `milestones`, `projectItems`,
  `decisions`, `workSessions`, `offTimeSessions`, `events`, `progressSnapshots` and
  `aiSessions`. Optional links: `tasks.projectId`, `tasks.milestoneId`,
  `hackathons.projectId`. The upgrade writes **nothing** to existing records: no
  projects are derived from task labels, and no hackathons are converted.
- **Project items** are command/status/context items placed in visual lanes
  (`working_now`, `next`, `waiting`, `needs_approval`, `blocked`, `parked`, `done`),
  not copies of Tasks. Tasks appear in lanes by their own status; an item may
  reference a task instead of duplicating it.
- **Decisions get their own store.** They're immutable records with supersession, not
  lane-moving status items, and they back `decision.recorded` and the workspace's
  `decisions/`.
- **Work sessions:** `projectId` is optional. The kinds are project, task, college and
  general. A session whose task belongs to a project must carry that project.
- **One event naming system:**
  - `work.started`, `work.paused`, `work.resumed`, `work.finished`
  - `offtime.started`, `offtime.ended`
  - `habit.logged`, `task.completed`, `milestone.completed`
  - `project.updated`, `project.approval_requested`, `project.item_parked`
  - `decision.recorded`, `ai.session.completed`

  There are no protected-time event types. Events reference records and never replace
  domain truth.

- **Backup:** envelope `formatVersion` stays 1, and `schemaVersion` becomes 4.

**Amendment (v2 PHASE 002, implementation):** `Project` gains an optional `phase` text
field ("current phase" in the Command Room). Additive, unindexed, and in the backup
schema. Nothing else in the locked design changed.
