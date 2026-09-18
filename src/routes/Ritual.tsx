import { useMemo, useState } from 'react'
import { useStore } from '../lib/store-context.ts'
import { useToast } from '../lib/toast-context.ts'
import {
  NEXT_ACTION_LIMIT,
  approaching,
  dueTickets,
  latestCapsule,
  live,
  unrouted,
} from '../lib/model.ts'
import { kindLabel } from '../lib/taxonomy.ts'
import { DAY_MS, formatDayLong, formatStamp, relativeDay, startOfDay } from '../lib/dates.ts'
import { nowMs, useNow } from '../lib/clock.ts'
import { href, navigate } from '../lib/router.ts'
import { Empty, Panel, Quiet, SectionHead, Tag } from '../components/ui.tsx'
import { ThoughtRow } from '../components/ThoughtRow.tsx'
import { CapsuleForm } from '../components/CapsuleForm.tsx'
import { Icon } from '../components/Icon.tsx'
import type { Thing } from '../lib/types.ts'

/**
 * The evening ritual. One quiet page, not a wizard: look at what is close,
 * glance at what is still loose, put your projects down, pick a starting point,
 * leave a note. Every part of it is optional except pressing the last button.
 */
export function Ritual() {
  const store = useStore()
  const toast = useToast()
  const now = useNow()
  const today = startOfDay(now)

  const [chosen, setChosen] = useState<string[]>([])
  const [savedProjects, setSavedProjects] = useState<string[]>([])
  const [openProject, setOpenProject] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [closing, setClosing] = useState(false)

  const queue = unrouted(store.things)
  const due = approaching(store.things, 3, now)
  const tickets = dueTickets(store.things, now)

  const candidates = useMemo(
    () =>
      live(store.things)
        .filter((t) => t.status === 'open' && (t.kind === 'action' || t.kind === 'commitment'))
        .sort((a, b) => {
          const ad = a.dueAt ?? Number.POSITIVE_INFINITY
          const bd = b.dueAt ?? Number.POSITIVE_INFINITY
          return ad !== bd ? ad - bd : b.updatedAt - a.updatedAt
        }),
    [store.things],
  )

  const projects = useMemo(
    () =>
      store.projects
        .filter((p) => p.deletedAt == null && p.archivedAt == null)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [store.projects],
  )

  const todayCount = live(store.things).filter((t) => t.createdAt >= today).length
  const full = chosen.length >= NEXT_ACTION_LIMIT

  async function patch(thing: Thing, changes: Partial<Thing>) {
    try {
      await store.putThing({ ...thing, ...changes, updatedAt: nowMs() })
    } catch {
      toast.show('That could not be changed — nothing has moved.', { tone: 'problem' })
    }
  }

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

  return (
    <div className="mx-auto max-w-2xl pb-6">
      <header className="rise mb-6">
        <p className="eyebrow mb-1.5">{formatDayLong(now)}</p>
        <h1 className="display text-[1.9rem]">Let’s put the day down.</h1>
        <p className="aside-hand mt-1 text-[1rem]">
          Nothing here has to be finished. This is just where you set it all down.
        </p>
      </header>

      {/* 1 — what is close ------------------------------------------- */}
      <section className="mb-7">
        <SectionHead count={due.length + tickets.length || undefined}>What’s close</SectionHead>
        {due.length === 0 && tickets.length === 0 ? (
          <Empty>Nothing is due in the next few days, and nothing has come back.</Empty>
        ) : (
          <Panel className="!py-1">
            {tickets.map((thing) => (
              <div key={thing.id} className="border-b border-line-soft py-2.5 last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="written min-w-0 flex-1">{thing.text}</p>
                  <Tag tone="sand">you parked this until today</Tag>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="chip"
                    onClick={() => void patch(thing, { returnedAt: nowMs() })}
                  >
                    seen it
                  </button>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => void patch(thing, { returnAt: today + 7 * DAY_MS, returnedAt: null })}
                  >
                    another week
                  </button>
                </div>
              </div>
            ))}
            {due.map((thing) => {
              const past = thing.dueAt != null && thing.dueAt < today
              return (
                <div key={thing.id} className="border-b border-line-soft py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="written min-w-0 flex-1">{thing.text}</p>
                    <Tag tone={past ? 'sand' : 'plain'}>
                      {past ? 'was due' : 'due'} {thing.dueAt ? relativeDay(thing.dueAt, now) : ''}
                    </Tag>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className="chip"
                      onClick={() => void patch(thing, { status: 'done', completedAt: nowMs() })}
                    >
                      done
                    </button>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => void patch(thing, { dueAt: today + DAY_MS })}
                    >
                      tomorrow
                    </button>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => void patch(thing, { dueAt: today + 7 * DAY_MS })}
                    >
                      next week
                    </button>
                    <span className="text-[0.7rem] text-muted">or leave it</span>
                  </div>
                </div>
              )
            })}
          </Panel>
        )}
      </section>

      {/* 2 — still loose ---------------------------------------------- */}
      <section className="mb-7">
        <SectionHead count={queue.length || undefined}>Still loose</SectionHead>
        {queue.length === 0 ? (
          <Empty>Everything you wrote down has been filed.</Empty>
        ) : (
          <>
            <Quiet className="mb-2">
              File any of these if you feel like it. Leaving them is a perfectly good answer — they
              will be here tomorrow.
            </Quiet>
            <Panel className="!py-1">
              {queue.slice(0, 6).map((thing) => (
                <ThoughtRow key={thing.id} thing={thing} />
              ))}
            </Panel>
            {queue.length > 6 ? (
              <Quiet className="mt-2">
                …and {queue.length - 6} more, waiting in{' '}
                <a className="link" href={href('/things')}>
                  My Things
                </a>
                .
              </Quiet>
            ) : null}
          </>
        )}
      </section>

      {/* 3 — projects -------------------------------------------------- */}
      <section className="mb-7">
        <SectionHead count={projects.length || undefined}>Where your projects stand</SectionHead>
        {projects.length === 0 ? (
          <Empty>No projects yet — nothing to put down.</Empty>
        ) : (
          <div className="grid gap-2">
            {projects.map((project) => {
              const capsule = latestCapsule(store.capsules, project.id)
              const isOpen = openProject === project.id
              const savedNow = savedProjects.includes(project.id)
              return (
                <Panel key={project.id} className="!p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="display text-[1.05rem]">{project.name}</h3>
                    <p className="text-[0.7rem] text-muted">
                      {capsule
                        ? `saved ${relativeDay(capsule.savedAt, now)}`
                        : 'no place saved yet'}
                    </p>
                  </div>
                  {capsule?.nextAction ? (
                    <p className="paper-2 mt-2 px-2.5 py-1.5 text-[0.8125rem]">
                      <span className="eyebrow mr-1.5">next</span>
                      {capsule.nextAction}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {savedNow ? <Tag tone="green">saved just now</Tag> : null}
                    <button
                      type="button"
                      className="btn btn-soft ml-auto"
                      aria-expanded={isOpen}
                      onClick={() => setOpenProject(isOpen ? null : project.id)}
                    >
                      {isOpen ? 'Close' : capsule ? 'Update my place' : 'Save my place'}
                    </button>
                  </div>
                  {isOpen ? (
                    <div className="mt-4 border-t border-line pt-4">
                      <CapsuleForm
                        projectId={project.id}
                        previous={capsule}
                        onSaved={() => {
                          setSavedProjects((list) =>
                            list.includes(project.id) ? list : [...list, project.id],
                          )
                          setOpenProject(null)
                        }}
                      />
                    </div>
                  ) : null}
                </Panel>
              )
            })}
          </div>
        )}
      </section>

      {/* 4 — tomorrow --------------------------------------------------- */}
      <section className="mb-7">
        <SectionHead>Tomorrow’s starting point</SectionHead>
        {candidates.length === 0 ? (
          <Empty>Nothing is filed as an action or a commitment, so there is nothing to pick.</Empty>
        ) : (
          <>
            <Quiet className="mb-2">
              Pick up to {NEXT_ACTION_LIMIT}. This is where you will land when you come back —
              everything else stays exactly where it is.
            </Quiet>
            <ul className="grid gap-1.5">
              {candidates.slice(0, 12).map((thing) => {
                const picked = chosen.includes(thing.id)
                const disabled = !picked && full
                return (
                  <li key={thing.id}>
                    <label
                      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                        picked
                          ? 'border-forest bg-sage'
                          : disabled
                            ? 'border-line bg-paper opacity-45'
                            : 'border-line bg-paper hover:border-[color-mix(in_srgb,var(--color-forest)_40%,var(--color-line))]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-3.5 shrink-0 accent-[var(--color-forest)]"
                        checked={picked}
                        disabled={disabled}
                        onChange={() =>
                          setChosen(
                            picked ? chosen.filter((id) => id !== thing.id) : [...chosen, thing.id],
                          )
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="written block text-[0.9375rem]">{thing.text}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Tag>{kindLabel(thing.kind)}</Tag>
                          {thing.dueAt != null ? (
                            <Tag>due {relativeDay(thing.dueAt, now)}</Tag>
                          ) : null}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            {full ? (
              <Quiet className="mt-2">That is {NEXT_ACTION_LIMIT}. Three is the point.</Quiet>
            ) : null}
          </>
        )}
      </section>

      {/* 5 — close ------------------------------------------------------ */}
      <section>
        <SectionHead>Before you go</SectionHead>
        <Panel>
          <label className="label" htmlFor="handoff-note">
            A line to the person who comes back
          </label>
          <textarea
            id="handoff-note"
            className="field written min-h-20"
            placeholder="Where you actually got to, and anything the list does not say."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div className="paper-2 mt-3 px-3 py-2.5">
            <p className="eyebrow mb-1.5">What is already saved</p>
            <ul className="grid gap-1 text-[0.8125rem] text-muted">
              <li>
                {todayCount === 0
                  ? 'Nothing new was written down today.'
                  : `${todayCount} thing${todayCount === 1 ? '' : 's'} written down today, saved to this device as you typed.`}
              </li>
              <li>
                {savedProjects.length === 0
                  ? 'No project places saved during this ritual.'
                  : `${savedProjects.length} project place${savedProjects.length === 1 ? '' : 's'} saved just now.`}
              </li>
              <li>
                {queue.length === 0
                  ? 'Nothing left unfiled.'
                  : `${queue.length} thing${queue.length === 1 ? '' : 's'} left unfiled, on purpose.`}
              </li>
            </ul>
            <p className="mt-2 text-[0.7rem] text-muted">
              Closing the day records this hand-off. It does not schedule anything: LOWTIDE has no
              background notifications, so nothing will buzz you tomorrow.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-solid" disabled={closing} onClick={() => void closeDay()}>
              <Icon name="moon" className="size-4" />
              {closing ? 'Closing…' : 'Close the day'}
            </button>
            <a className="btn btn-ghost" href={href('/')}>
              Not yet
            </a>
          </div>
        </Panel>
        <Quiet className="mt-2 text-[0.7rem]">
          Last closed:{' '}
          {store.handoffs.length
            ? formatStamp(Math.max(...store.handoffs.map((h) => h.closedAt)))
            : 'never'}
        </Quiet>
      </section>
    </div>
  )
}
