# Running a whole life plan in LOWTIDE (v2.2)

A large, messy plan (learning, projects, hackathons and CTFs, products, content, money
goals, deadlines) becomes structured and trackable in LOWTIDE without new screens. This
page describes the shape; the plan itself lives only in the owner's database (ADR-070),
never in this repository.

## Where each kind of thing goes

| It is…                                                      | It becomes                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Work with milestones and deadlines                          | a **project** with weighted milestones (progress comes only from them)                  |
| An ongoing track that isn't a project (a subject, a career) | a folder in **SPACE / Areas** (ADR-071)                                                 |
| Something repeated and logged (problems, labs, builds)      | a **SPACE database** in its Area, with saved views                                      |
| A hackathon or CTF                                          | a **hackathon record**, with `kind` and `selection` (ADR-072)                           |
| A choice and its reason                                     | a **decision** on the project it governs (immutable; superseded, never edited)          |
| The overview that ties it together                          | one **plan page** in Areas, pinned, that links to the records instead of restating them |

Imported content is extended, never edited: new properties, options, rows and views may
be added to an imported database, while its imported cells and pages stay as they were.

## Priority tiers, on existing fields

| Tier        | In LOWTIDE                                                                    |
| ----------- | ----------------------------------------------------------------------------- |
| CRITICAL    | a task with priority high and a deadline (high is kept for real consequences) |
| NOW         | project focus primary                                                         |
| NEXT        | project focus secondary                                                       |
| ACTIVE      | project focus supporting                                                      |
| MAINTENANCE | project focus background                                                      |
| PARKED      | project state parked, or a parked board item                                  |
| SOMEDAY     | a parked idea (board or SPACE / Ideas), or a database row marked Someday      |
| DROPPED     | a dropped hackathon or task, or an archived project with a decision why       |
| ARCHIVED    | archived                                                                      |

## From a brain dump to a trackable record

Raw dump → extraction → classification → home → priority → deadline → next action →
record. A Brain Dump database holds each thought with `Area`, `Class`, `Priority`,
`Deadline`, `Next action`, `State` and `Became` (a relation to the record it turned into).
Classification is done by the owner or by an AI client over MCP; LOWTIDE runs no AI.

| Class                     | Lands as                                                                 |
| ------------------------- | ------------------------------------------------------------------------ |
| Urgent deadline           | a task, priority high, with its due day                                  |
| Task                      | a task in its project (steps as subtasks)                                |
| Project                   | a project with milestones                                                |
| Learning objective        | a milestone of a learning project                                        |
| Subject, skill            | a row in a learning database (stage and confidence)                      |
| Habit                     | a Rhythm habit (never for time with people, ADR-013)                     |
| Recurring work            | a task for now; recurrence belongs to the task redesign                  |
| Application, hackathon    | a hackathon record (`selection` for the answer)                          |
| Interview                 | a task with subtasks, due on the day                                     |
| Content / channel         | a row in a channel blueprint database                                    |
| Product / business, money | a row in the business pipeline database; a project once it's being built |
| Portfolio item            | a milestone of a portfolio project                                       |
| Someday / later           | a parked idea                                                            |
| Blocked, waiting          | a blocker or waiting item on the project                                 |

## Learning tracks: Learn → Practice → Build → Prove

A learning database row per subject or topic: a `Stage` status (Not started, Learn,
Practice, Build, Prove, Later), a `Confidence` select, a `Used for` multi-select (what
the subject feeds, so one subject serves several goals without being copied), `Next
step`, `Weak areas` and a `Revisit` date. A practice log records each attempt
(difficulty, topic, first result, hints, understood, solved without AI, can explain
aloud, time, revisit date) with a formula such as
`prop("Understood") and prop("Without AI") and prop("Can explain")` to count only what
was genuinely understood. Boards group by a select or status; calendars use a date.

## Hackathons and CTFs (ADR-072)

| Pipeline word         | Field                            |
| --------------------- | -------------------------------- |
| interested            | status considering               |
| registered            | registration registered          |
| application submitted | selection applied                |
| PPT required          | PPT not started or in progress   |
| project required      | build not started or in progress |
| preparing             | status active                    |
| shortlisted           | selection shortlisted            |
| rejected              | selection rejected               |
| selected              | selection selected               |
| completed             | status finished                  |
| dropped               | status dropped                   |
| archived              | archived                         |

A CTF (`kind: ctf`) has its own rail: Registration → Preparation → Competition, and no
PPT, build or "Track the build as a project".

## What this deliberately doesn't do

- No new screens or redesign; the next phase redesigns the UI and tasks on top of this.
- No AI inside LOWTIDE; no new priority field; no seed data or fixtures with real entries.
- Nothing scores or gamifies time with people.
