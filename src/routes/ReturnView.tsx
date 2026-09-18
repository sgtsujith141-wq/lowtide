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
import { nowMs, useNow } from '../lib/clock.ts'
import { href } from '../lib/router.ts'
import { Empty, PageHead, Panel, Quiet, SectionHead, Tag } from '../components/ui.tsx'
import type { Thing } from '../lib/types.ts'

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

  const totalOpen = live(store.things).filter((t) => t.status === 'open').length

  async function patch(thing: Thing, changes: Partial<Thing>) {
    try {
      await store.putThing({ ...thing, ...changes, updatedAt: nowMs() })
    } catch {
      toast.show('That could not be saved.', { tone: 'problem' })
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHead
        eyebrow="Return"
        title="Here’s where you stopped."
        lede="Only what you chose, what is close, and where your projects were left. Everything else is filed and waiting."
        actions={
          <a className="btn btn-soft" href={href('/things')}>
            See everything ({totalOpen})
          </a>
        }
      />

      <Panel className="rise">
        {handoff ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="eyebrow">Your last hand-off</h2>
              <p className="text-[0.7rem] text-muted">
                {formatStamp(handoff.closedAt)} · {relativeDay(handoff.closedAt, now)}
              </p>
            </div>
            {handoff.note ? (
              <p className="written mt-3 border-l-2 border-forest pl-4">{handoff.note}</p>
            ) : (
              <Quiet className="mt-2">You closed the day without leaving a note.</Quiet>
            )}
            {handoff.leftUnclassified > 0 ? (
              <Quiet className="mt-3 text-[0.7rem]">
                {handoff.leftUnclassified} thing{handoff.leftUnclassified === 1 ? '' : 's'} were left
                unfiled at the time.
              </Quiet>
            ) : null}
          </>
        ) : (
          <>
            <h2 className="eyebrow">No hand-off yet</h2>
            <Quiet className="mt-2">
              When you close a day, what you chose and what you wrote will be here.{' '}
              <a className="link" href={href('/ritual')}>
                Close the day
              </a>
              .
            </Quiet>
          </>
        )}
      </Panel>

      {chosen.length > 0 ? (
        <section className="mt-6">
          <SectionHead count={chosen.length}>What you chose</SectionHead>
          <Panel className="!py-1">
            {chosen.map((thing) => (
              <div
                key={thing.id}
                className="flex flex-wrap items-start gap-3 border-b border-line-soft py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className={`written ${thing.status === 'done' ? 'text-muted line-through' : ''}`}>
                    {thing.text}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Tag tone="green">{kindLabel(thing.kind)}</Tag>
                    {thing.dueAt != null ? (
                      <Tag tone={thing.dueAt < startOfDay(now) ? 'sand' : 'plain'}>
                        due {relativeDay(thing.dueAt, now)}
                      </Tag>
                    ) : null}
                  </div>
                </div>
                {thing.status === 'open' ? (
                  <button
                    type="button"
                    className="btn btn-soft"
                    onClick={() => void patch(thing, { status: 'done', completedAt: nowMs() })}
                  >
                    Done
                  </button>
                ) : (
                  <Tag>done</Tag>
                )}
              </div>
            ))}
          </Panel>
        </section>
      ) : null}

      {tickets.length > 0 ? (
        <section className="mt-6">
          <SectionHead count={tickets.length}>Back today</SectionHead>
          <Quiet className="mb-2">
            You put {tickets.length === 1 ? 'this' : 'these'} aside until now. LOWTIDE has no
            background notifications — opening it is how they come back.
          </Quiet>
          <Panel className="!py-1">
            {tickets.map((thing) => (
              <div
                key={thing.id}
                className="flex flex-wrap items-start gap-3 border-b border-line-soft py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="written">{thing.text}</p>
                  <p className="mt-0.5 text-[0.7rem] text-muted">
                    parked until {thing.returnAt ? relativeDay(thing.returnAt, now) : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => void patch(thing, { returnedAt: nowMs() })}
                >
                  Seen it
                </button>
              </div>
            ))}
          </Panel>
        </section>
      ) : null}

      <section className="mt-6">
        <SectionHead count={soon.length}>Coming up</SectionHead>
        {soon.length === 0 ? (
          <Empty>Nothing is due in the next week.</Empty>
        ) : (
          <Panel className="!py-1">
            {soon.map((thing) => {
              const past = thing.dueAt != null && thing.dueAt < startOfDay(now)
              return (
                <div
                  key={thing.id}
                  className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line-soft py-2.5 last:border-b-0"
                >
                  <p className="written min-w-0 flex-1 text-[0.9375rem]">{thing.text}</p>
                  <Tag tone={past ? 'sand' : 'plain'}>
                    {past ? 'was due' : 'due'} {thing.dueAt ? relativeDay(thing.dueAt, now) : ''}
                  </Tag>
                </div>
              )
            })}
          </Panel>
        )}
        {late.length > 0 ? (
          <Quiet className="mt-2 text-[0.7rem]">
            {late.length} of these {late.length === 1 ? 'is' : 'are'} already past. Nothing is hidden
            here.
          </Quiet>
        ) : null}
      </section>

      <section className="mt-6">
        <SectionHead
          action={
            <a className="link text-[0.75rem]" href={href('/projects')}>
              All projects →
            </a>
          }
        >
          Where projects were left
        </SectionHead>
        {projects.length === 0 ? (
          <Empty>No project has a saved place yet.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {projects.map(({ project, capsule }) => (
              <article key={project.id} className="paper p-4">
                <h3 className="display text-[1.05rem]">
                  <a className="hover:text-forest-deep" href={href(`/projects/${project.id}`)}>
                    {project.name}
                  </a>
                </h3>
                {capsule?.nextAction ? (
                  <div className="paper-2 mt-2 px-3 py-2">
                    <p className="eyebrow mb-0.5">Start here</p>
                    <p className="written text-[0.9375rem]">{capsule.nextAction}</p>
                  </div>
                ) : capsule?.status ? (
                  <Quiet className="mt-2">{capsule.status}</Quiet>
                ) : null}
                {capsule?.blocker ? (
                  <p className="mt-2 text-[0.8125rem] text-brown">In the way: {capsule.blocker}</p>
                ) : null}
                <p className="mt-2.5 text-[0.7rem] text-muted">
                  saved {capsule ? relativeDay(capsule.savedAt, now) : ''}
                </p>
                <a className="btn btn-soft mt-3" href={href(`/projects/${project.id}`)}>
                  Pick it up
                </a>
              </article>
            ))}
          </div>
        )}
      </section>

      {parked.length > 0 ? (
        <section className="mt-6">
          <SectionHead count={parked.length}>Put aside for later</SectionHead>
          <Panel className="!py-1">
            {parked.slice(0, 6).map((thing) => (
              <div
                key={thing.id}
                className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line-soft py-2 last:border-b-0"
              >
                <p className="min-w-0 flex-1 text-[0.8125rem] text-muted">{thing.text}</p>
                <Tag>back {thing.returnAt ? relativeDay(thing.returnAt, now) : ''}</Tag>
              </div>
            ))}
          </Panel>
        </section>
      ) : null}
    </div>
  )
}
