import { useStore } from '../lib/store-context.ts'
import { useToast } from '../lib/toast-context.ts'
import {
  approaching,
  dueTickets,
  latestCapsule,
  latestHandoff,
  live,
  overdue,
  parkedTickets,
} from '../lib/model.ts'
import { kindLabel } from '../lib/taxonomy.ts'
import { formatStamp, relativeDay, startOfDay } from '../lib/dates.ts'
import { href } from '../lib/router.ts'
import { EmptyNote, PageHeader, Panel, Quiet, SectionTitle, Tag } from '../components/ui.tsx'
import type { Thing } from '../lib/types.ts'
import { nowMs, useNow } from '../lib/clock.ts'

export function ReturnView() {
  const store = useStore()
  const toast = useToast()
  const now = useNow()

  const handoff = latestHandoff(store.handoffs)
  const tickets = dueTickets(store.things, now)
  const parked = parkedTickets(store.things, now)
  const soon = approaching(store.things, 7, now)
  const late = overdue(store.things, now)
  const projects = store.projects
    .filter((p) => p.deletedAt == null && p.archivedAt == null)
    .map((p) => ({ project: p, capsule: latestCapsule(store.capsules, p.id) }))
    .filter((entry) => entry.capsule != null)
    .sort((a, b) => (b.capsule?.savedAt ?? 0) - (a.capsule?.savedAt ?? 0))
    .slice(0, 4)

  const chosen = (handoff?.nextActionIds ?? [])
    .map((id) => store.things.find((t) => t.id === id))
    .filter((t): t is Thing => t != null && t.deletedAt == null)

  async function markDone(thing: Thing) {
    try {
      await store.putThing({
        ...thing,
        status: 'done',
        completedAt: nowMs(),
        updatedAt: nowMs(),
      })
    } catch {
      toast.show('That could not be saved — it is still open.', { tone: 'problem' })
    }
  }

  async function clearTicket(thing: Thing) {
    try {
      await store.putThing({ ...thing, returnedAt: nowMs(), updatedAt: nowMs() })
    } catch {
      toast.show('That could not be saved.', { tone: 'problem' })
    }
  }

  const totalOpen = live(store.things).filter((t) => t.status === 'open').length

  return (
    <div>
      <PageHeader
        eyebrow="Return"
        title="Here is where you stopped."
        lede="Only what you chose, what is close, and where your projects were left. Everything else is still filed and waiting."
        actions={
          <a className="lt-btn lt-btn-secondary" href={href('/things')}>
            See everything ({totalOpen})
          </a>
        }
      />

      {/* Hand-off ---------------------------------------------------- */}
      <Panel className="lt-rise">
        {handoff ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="lt-eyebrow">Your last hand-off</h2>
              <p className="text-xs text-muted">
                {formatStamp(handoff.closedAt)} · {relativeDay(handoff.closedAt, now)}
              </p>
            </div>
            {handoff.note ? (
              <p className="lt-prose mt-4 border-l-2 border-accent pl-4 sm:pl-5">{handoff.note}</p>
            ) : (
              <Quiet className="mt-3">You closed the day without leaving a note.</Quiet>
            )}
            {handoff.leftUnclassified > 0 ? (
              <Quiet className="mt-4 text-xs">
                {handoff.leftUnclassified} thing{handoff.leftUnclassified === 1 ? '' : 's'} were
                left unfiled at the time.
              </Quiet>
            ) : null}
          </>
        ) : (
          <>
            <h2 className="lt-eyebrow">No hand-off yet</h2>
            <Quiet className="mt-3">
              When you close a day, what you chose and what you wrote will appear here.{' '}
              <a className="lt-link" href={href('/close')}>
                Close the day
              </a>
              .
            </Quiet>
          </>
        )}
      </Panel>

      {/* Chosen next actions ---------------------------------------- */}
      {chosen.length > 0 ? (
        <section className="mt-10">
          <SectionTitle count={chosen.length}>What you chose</SectionTitle>
          <ul className="grid gap-3">
            {chosen.map((thing) => (
              <li key={thing.id} className="lt-card flex flex-wrap items-start gap-3 p-4 sm:p-5">
                <div className="min-w-0 flex-1">
                  <p className={`lt-prose ${thing.status === 'done' ? 'text-muted line-through' : ''}`}>
                    {thing.text}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Tag tone="accent">{kindLabel(thing.kind)}</Tag>
                    {thing.dueAt != null ? (
                      <Tag tone={thing.dueAt < startOfDay(now) ? 'attention' : 'calm'}>
                        Due {relativeDay(thing.dueAt, now)}
                      </Tag>
                    ) : null}
                  </div>
                </div>
                {thing.status === 'open' ? (
                  <button
                    type="button"
                    className="lt-btn lt-btn-secondary text-xs"
                    onClick={() => void markDone(thing)}
                  >
                    Done
                  </button>
                ) : (
                  <Tag>Done</Tag>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Return tickets --------------------------------------------- */}
      {tickets.length > 0 ? (
        <section className="mt-10">
          <SectionTitle count={tickets.length}>Back today</SectionTitle>
          <Quiet className="mb-4">
            You parked {tickets.length === 1 ? 'this' : 'these'} until now. LOWTIDE has no
            background notifications — this is the moment it can tell you.
          </Quiet>
          <ul className="grid gap-3">
            {tickets.map((thing) => (
              <li key={thing.id} className="lt-card flex flex-wrap items-start gap-3 p-4 sm:p-5">
                <div className="min-w-0 flex-1">
                  <p className="lt-prose">{thing.text}</p>
                  <p className="mt-1.5 text-xs text-muted">
                    Parked until {thing.returnAt ? relativeDay(thing.returnAt) : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="lt-btn lt-btn-secondary text-xs"
                  onClick={() => void clearTicket(thing)}
                >
                  Seen it
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Commitments ------------------------------------------------- */}
      <section className="mt-10">
        <SectionTitle count={soon.length}>Coming up</SectionTitle>
        {soon.length === 0 ? (
          <EmptyNote>Nothing is due in the next week.</EmptyNote>
        ) : (
          <ul className="grid gap-2">
            {soon.map((thing) => {
              const past = thing.dueAt != null && thing.dueAt < startOfDay(now)
              return (
                <li
                  key={thing.id}
                  className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule py-3 last:border-b-0"
                >
                  <p className="lt-prose min-w-0 flex-1 text-[0.9375rem]">{thing.text}</p>
                  <Tag tone={past ? 'attention' : 'calm'}>
                    {past ? 'Was due' : 'Due'} {thing.dueAt ? relativeDay(thing.dueAt) : ''}
                  </Tag>
                </li>
              )
            })}
          </ul>
        )}
        {late.length > 0 ? (
          <Quiet className="mt-3 text-xs">
            {late.length} of these {late.length === 1 ? 'is' : 'are'} already past. Nothing is
            hidden from you here.
          </Quiet>
        ) : null}
      </section>

      {/* Project context --------------------------------------------- */}
      <section className="mt-10">
        <SectionTitle
          action={
            <a className="lt-link text-xs" href={href('/projects')}>
              All projects →
            </a>
          }
        >
          Where projects were left
        </SectionTitle>
        {projects.length === 0 ? (
          <EmptyNote>No project has a saved place yet.</EmptyNote>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map(({ project, capsule }) => (
              <article key={project.id} className="lt-card p-5">
                <h3 className="lt-display text-lg">
                  <a className="hover:text-accent-deep" href={href(`/projects/${project.id}`)}>
                    {project.name}
                  </a>
                </h3>
                {capsule?.nextAction ? (
                  <div className="lt-inset mt-3 px-3 py-2.5">
                    <p className="lt-eyebrow mb-1">Start here</p>
                    <p className="lt-prose text-[0.9375rem]">{capsule.nextAction}</p>
                  </div>
                ) : capsule?.status ? (
                  <p className="mt-3 text-sm text-muted">{capsule.status}</p>
                ) : null}
                {capsule?.blocker ? (
                  <p className="mt-3 text-sm text-attention">In the way: {capsule.blocker}</p>
                ) : null}
                <p className="mt-4 text-[0.7rem] text-muted">
                  Saved {capsule ? formatStamp(capsule.savedAt) : ''}
                </p>
                <a
                  className="lt-btn lt-btn-secondary mt-4 text-xs"
                  href={href(`/projects/${project.id}`)}
                >
                  Pick it up
                </a>
              </article>
            ))}
          </div>
        )}
      </section>

      {parked.length > 0 ? (
        <section className="mt-10">
          <SectionTitle count={parked.length}>Parked for later</SectionTitle>
          <ul className="grid gap-2">
            {parked.slice(0, 6).map((thing) => (
              <li
                key={thing.id}
                className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule py-2.5 last:border-b-0"
              >
                <p className="min-w-0 flex-1 text-sm text-muted">{thing.text}</p>
                <Tag>Back {thing.returnAt ? relativeDay(thing.returnAt) : ''}</Tag>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
