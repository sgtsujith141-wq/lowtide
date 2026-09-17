import { useMemo, useState } from 'react'
import { useStore } from '../lib/store-context.ts'
import { useToast } from '../lib/toast-context.ts'
import {
  NEXT_ACTION_LIMIT,
  approaching,
  dueTickets,
  latestCapsule,
  live,
  thingsForProject,
  unrouted,
} from '../lib/model.ts'
import { KINDS, kindLabel } from '../lib/taxonomy.ts'
import { DAY_MS, formatDayLong, formatStamp, relativeDay, startOfDay } from '../lib/dates.ts'
import { href, navigate } from '../lib/router.ts'
import { EmptyNote, Quiet, Tag } from '../components/ui.tsx'
import { CapsuleForm } from '../components/CapsuleForm.tsx'
import type { Project, Thing, ThingKind } from '../lib/types.ts'
import { nowMs, useNow } from '../lib/clock.ts'

const STEPS = [
  { id: 'file', title: 'Loose ends', blurb: 'Anything captured today that has not been filed.' },
  { id: 'due', title: 'What is owed', blurb: 'Commitments that are close or already past.' },
  { id: 'next', title: 'Tomorrow', blurb: 'A few things to pick up first. Not a plan for the day.' },
  { id: 'places', title: 'Places', blurb: 'Projects you may want to save your place in.' },
  { id: 'close', title: 'Close', blurb: 'Write a line to the person who comes back.' },
] as const

export function Closure() {
  const store = useStore()
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [chosen, setChosen] = useState<string[]>([])
  const [savedProjects, setSavedProjects] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [closing, setClosing] = useState(false)
  const now = useNow()

  const queue = unrouted(store.things)
  const due = approaching(store.things, 3, now)
  const tickets = dueTickets(store.things, now)

  const candidates = useMemo(() => {
    const open = live(store.things).filter((t) => t.status === 'open')
    const ranked = open.filter((t) => t.kind === 'action' || t.kind === 'commitment')
    return [...ranked].sort((a, b) => {
      const ad = a.dueAt ?? Number.POSITIVE_INFINITY
      const bd = b.dueAt ?? Number.POSITIVE_INFINITY
      if (ad !== bd) return ad - bd
      return b.updatedAt - a.updatedAt
    })
  }, [store.things])

  const projects = useMemo(
    () =>
      store.projects
        .filter((p) => p.deletedAt == null && p.archivedAt == null)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [store.projects],
  )

  async function closeDay() {
    if (closing) return
    setClosing(true)
    try {
      await store.closeDay({
        nextActionIds: chosen,
        note,
        leftUnclassified: unrouted(store.things).length,
        savedProjectIds: savedProjects,
        dueSoonIds: due.map((t) => t.id),
      })
      navigate('/closed')
    } catch {
      toast.show('The day could not be closed — nothing was written. Try again in a moment.', {
        tone: 'problem',
      })
    } finally {
      setClosing(false)
    }
  }

  const current = STEPS[step]

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-8">
        <p className="lt-eyebrow mb-2.5">Closing · {formatDayLong(now)}</p>
        <h1 className="lt-display text-[2rem] leading-[1.1] sm:text-[2.6rem]">Put the day down.</h1>
        <Quiet className="mt-3">
          Five short passes. You can leave anything unfinished — closing the day does not mean the
          work is finished, only that you have stopped carrying it.
        </Quiet>
      </header>

      <nav aria-label="Closing steps" className="mb-8 border-y border-rule py-3">
        <ol className="flex flex-wrap gap-x-1 gap-y-2">
          {STEPS.map((s, index) => (
            <li key={s.id}>
              <button
                type="button"
                aria-current={index === step ? 'step' : undefined}
                onClick={() => setStep(index)}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${
                  index === step
                    ? 'bg-accent-wash text-accent-deep'
                    : index < step
                      ? 'text-muted hover:text-ink'
                      : 'text-muted/70 hover:text-ink'
                }`}
              >
                <span className="font-mono text-[0.65rem] opacity-70">{index + 1}</span> {s.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section aria-labelledby="step-heading" className="lt-rise" key={current.id}>
        <h2 id="step-heading" className="lt-display text-2xl">
          {current.title}
        </h2>
        <Quiet className="mt-2 mb-6">{current.blurb}</Quiet>

        {current.id === 'file' ? (
          <FileStep queue={queue} />
        ) : current.id === 'due' ? (
          <DueStep due={due} tickets={tickets} />
        ) : current.id === 'next' ? (
          <NextStep candidates={candidates} chosen={chosen} setChosen={setChosen} />
        ) : current.id === 'places' ? (
          <PlacesStep
            projects={projects}
            saved={savedProjects}
            onSaved={(id) => setSavedProjects((list) => (list.includes(id) ? list : [...list, id]))}
          />
        ) : (
          <CloseStep
            note={note}
            setNote={setNote}
            chosen={chosen}
            leftUnfiled={queue.length}
            savedProjects={savedProjects}
            closing={closing}
            onClose={() => void closeDay()}
          />
        )}
      </section>

      <div className="mt-10 flex items-center justify-between gap-3 border-t border-rule pt-5">
        <button
          type="button"
          className="lt-btn lt-btn-quiet"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          ← Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            className="lt-btn lt-btn-secondary"
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          >
            {queue.length && current.id === 'file' ? 'Leave them and go on' : 'Next'} →
          </button>
        ) : (
          <a className="lt-btn lt-btn-quiet" href={href('/')}>
            Stop here without closing
          </a>
        )}
      </div>
    </div>
  )
}

/* ---------------------------- step 1 ---------------------------- */

function FileStep({ queue }: { queue: Thing[] }) {
  const store = useStore()
  const toast = useToast()

  if (queue.length === 0) {
    return <EmptyNote>Nothing is waiting to be filed.</EmptyNote>
  }

  async function file(thing: Thing, kind: ThingKind) {
    try {
      await store.putThing({
        ...thing,
        kind,
        classifiedAt: thing.classifiedAt ?? nowMs(),
        updatedAt: nowMs(),
      })
    } catch {
      toast.show('That could not be filed — it is still waiting.', { tone: 'problem' })
    }
  }

  return (
    <div>
      <Quiet className="mb-4">
        {queue.length} thing{queue.length === 1 ? '' : 's'} still unfiled. Filing them now is
        optional — they will keep.
      </Quiet>
      <ul className="grid gap-3">
        {queue.map((thing) => (
          <li key={thing.id} className="lt-card p-4">
            <p className="lt-prose">{thing.text}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {KINDS.map((meta) => (
                <button
                  key={meta.kind}
                  type="button"
                  className="lt-btn lt-btn-secondary px-2.5 py-1 text-xs"
                  onClick={() => void file(thing, meta.kind)}
                >
                  {meta.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------------------------- step 2 ---------------------------- */

function DueStep({ due, tickets }: { due: Thing[]; tickets: Thing[] }) {
  const store = useStore()
  const toast = useToast()
  const today = startOfDay(useNow())

  const patch = async (thing: Thing, changes: Partial<Thing>) => {
    try {
      await store.putThing({ ...thing, ...changes, updatedAt: nowMs() })
    } catch {
      toast.show('That could not be changed — nothing has moved.', { tone: 'problem' })
    }
  }

  if (due.length === 0 && tickets.length === 0) {
    return <EmptyNote>Nothing is due in the next three days, and nothing has come back.</EmptyNote>
  }

  return (
    <div className="grid gap-8">
      {due.length > 0 ? (
        <div>
          <ul className="grid gap-3">
            {due.map((thing) => {
              const past = thing.dueAt != null && thing.dueAt < today
              return (
                <li key={thing.id} className="lt-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="lt-prose flex-1">{thing.text}</p>
                    <Tag tone={past ? 'attention' : 'calm'}>
                      {past ? 'Was due' : 'Due'} {thing.dueAt ? relativeDay(thing.dueAt) : ''}
                    </Tag>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="lt-btn lt-btn-secondary px-2.5 py-1 text-xs"
                      onClick={() => void patch(thing, { status: 'done', completedAt: nowMs() })}
                    >
                      Done
                    </button>
                    <button
                      type="button"
                      className="lt-btn lt-btn-secondary px-2.5 py-1 text-xs"
                      onClick={() => void patch(thing, { dueAt: today + DAY_MS })}
                    >
                      Move to tomorrow
                    </button>
                    <button
                      type="button"
                      className="lt-btn lt-btn-secondary px-2.5 py-1 text-xs"
                      onClick={() => void patch(thing, { dueAt: today + 7 * DAY_MS })}
                    >
                      Move a week
                    </button>
                    <span className="self-center pl-1 text-xs text-muted">or leave it</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {tickets.length > 0 ? (
        <div>
          <h3 className="lt-eyebrow mb-3">Came back today</h3>
          <ul className="grid gap-3">
            {tickets.map((thing) => (
              <li key={thing.id} className="lt-card p-4">
                <p className="lt-prose">{thing.text}</p>
                <p className="mt-1.5 text-xs text-muted">
                  Parked until {thing.returnAt ? relativeDay(thing.returnAt) : ''}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="lt-btn lt-btn-secondary px-2.5 py-1 text-xs"
                    onClick={() => void patch(thing, { returnedAt: nowMs() })}
                  >
                    Seen it
                  </button>
                  <button
                    type="button"
                    className="lt-btn lt-btn-secondary px-2.5 py-1 text-xs"
                    onClick={() =>
                      void patch(thing, { returnAt: today + 7 * DAY_MS, returnedAt: null })
                    }
                  >
                    Park another week
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/* ---------------------------- step 3 ---------------------------- */

function NextStep({
  candidates,
  chosen,
  setChosen,
}: {
  candidates: Thing[]
  chosen: string[]
  setChosen: (next: string[]) => void
}) {
  if (candidates.length === 0) {
    return (
      <EmptyNote>
        Nothing is filed as an action or a commitment yet, so there is nothing to choose from.
      </EmptyNote>
    )
  }

  const full = chosen.length >= NEXT_ACTION_LIMIT

  return (
    <div>
      <Quiet className="mb-4">
        Choose up to {NEXT_ACTION_LIMIT}. They are what you will see first when you come back —
        everything else stays where it is.
      </Quiet>
      <ul className="grid gap-2">
        {candidates.map((thing) => {
          const picked = chosen.includes(thing.id)
          const disabled = !picked && full
          return (
            <li key={thing.id}>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3.5 transition-colors ${
                  picked
                    ? 'border-accent bg-accent-wash'
                    : disabled
                      ? 'border-rule bg-surface opacity-50'
                      : 'border-rule bg-surface hover:border-[color-mix(in_srgb,var(--color-accent)_40%,var(--color-rule))]'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
                  checked={picked}
                  disabled={disabled}
                  onChange={() =>
                    setChosen(picked ? chosen.filter((id) => id !== thing.id) : [...chosen, thing.id])
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="lt-prose block text-[0.9375rem]">{thing.text}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Tag>{kindLabel(thing.kind)}</Tag>
                    {thing.dueAt != null ? <Tag>Due {relativeDay(thing.dueAt)}</Tag> : null}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      {full ? (
        <Quiet className="mt-4">
          That is {NEXT_ACTION_LIMIT}. Deselect one if something else matters more.
        </Quiet>
      ) : null}
    </div>
  )
}

/* ---------------------------- step 4 ---------------------------- */

function PlacesStep({
  projects,
  saved,
  onSaved,
}: {
  projects: Project[]
  saved: string[]
  onSaved: (id: string) => void
}) {
  const store = useStore()
  const [openId, setOpenId] = useState<string | null>(null)

  if (projects.length === 0) {
    return (
      <EmptyNote>
        No projects yet. When one needs a memory,{' '}
        <a className="lt-link" href={href('/projects')}>
          start it here
        </a>
        .
      </EmptyNote>
    )
  }

  return (
    <ul className="grid gap-3">
      {projects.map((project) => {
        const capsule = latestCapsule(store.capsules, project.id)
        const open = openId === project.id
        const savedNow = saved.includes(project.id)
        const openThings = thingsForProject(store.things, project.id).filter(
          (t) => t.status === 'open',
        ).length
        return (
          <li key={project.id} className="lt-card p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="lt-display text-lg">{project.name}</h3>
              <p className="text-xs text-muted">
                {capsule ? `Place saved ${formatStamp(capsule.savedAt)}` : 'No place saved yet'}
              </p>
            </div>

            {capsule?.nextAction ? (
              <p className="lt-inset mt-3 px-3 py-2 text-sm">
                <span className="lt-eyebrow mr-2">Next</span>
                {capsule.nextAction}
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {savedNow ? <Tag tone="accent">Saved just now</Tag> : null}
              {openThings > 0 ? <Tag>{openThings} open</Tag> : null}
              <button
                type="button"
                className="lt-btn lt-btn-secondary ml-auto text-xs"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : project.id)}
              >
                {open ? 'Close' : capsule ? 'Update my place' : 'Save my place'}
              </button>
            </div>

            {open ? (
              <div className="mt-5 border-t border-rule pt-5">
                <CapsuleForm
                  projectId={project.id}
                  previous={capsule}
                  onSaved={() => {
                    onSaved(project.id)
                    setOpenId(null)
                  }}
                />
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/* ---------------------------- step 5 ---------------------------- */

function CloseStep({
  note,
  setNote,
  chosen,
  leftUnfiled,
  savedProjects,
  closing,
  onClose,
}: {
  note: string
  setNote: (value: string) => void
  chosen: string[]
  leftUnfiled: number
  savedProjects: string[]
  closing: boolean
  onClose: () => void
}) {
  const store = useStore()
  const picked = chosen
    .map((id) => store.things.find((t) => t.id === id))
    .filter((t): t is Thing => t != null)

  return (
    <div className="grid gap-6">
      <div>
        <label className="lt-label" htmlFor="handoff-note">
          A line to the person who comes back
        </label>
        <textarea
          id="handoff-note"
          className="lt-field lt-prose min-h-28"
          placeholder="Where you actually got to, and anything the list does not say."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="lt-inset p-4">
        <p className="lt-eyebrow mb-3">What will be written down</p>
        <ul className="grid gap-1.5 text-sm text-muted">
          <li>
            {picked.length === 0
              ? 'No next actions chosen.'
              : `${picked.length} next action${picked.length === 1 ? '' : 's'}: ${picked
                  .map((t) => t.text)
                  .join(' · ')}`}
          </li>
          <li>
            {savedProjects.length === 0
              ? 'No project places saved during this closing.'
              : `${savedProjects.length} project place${savedProjects.length === 1 ? '' : 's'} saved just now.`}
          </li>
          <li>
            {leftUnfiled === 0
              ? 'Nothing left unfiled.'
              : `${leftUnfiled} thing${leftUnfiled === 1 ? '' : 's'} left unfiled, on purpose.`}
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted">
          Everything you filed or saved during this closing was written to this device as you did
          it. Closing the day only records this hand-off.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="lt-btn lt-btn-primary" disabled={closing} onClick={onClose}>
          {closing ? 'Closing…' : 'Close the day'}
        </button>
        <Quiet className="text-xs">Unfinished work stays exactly as it is.</Quiet>
      </div>
    </div>
  )
}
