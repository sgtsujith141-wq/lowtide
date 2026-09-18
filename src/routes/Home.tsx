import { useMemo, useState } from 'react'
import { useStore } from '../lib/store-context.ts'
import { useToast } from '../lib/toast-context.ts'
import {
  approaching,
  dueTickets,
  latestCapsule,
  latestHandoff,
  live,
  overdue,
  unrouted,
} from '../lib/model.ts'
import { formatDayLong, partOfDay, relativeDay, startOfDay } from '../lib/dates.ts'
import { useNow } from '../lib/clock.ts'
import { href } from '../lib/router.ts'
import { Composer } from '../components/Composer.tsx'
import { ThoughtRow } from '../components/ThoughtRow.tsx'
import { Empty, Panel, Quiet, SectionHead, Tag } from '../components/ui.tsx'
import { Icon } from '../components/Icon.tsx'
import type { Thing } from '../lib/types.ts'

const OPENING: Record<ReturnType<typeof partOfDay>, string> = {
  morning: 'Whatever is already stacking up, put it down here.',
  afternoon: 'You can put everything down here.',
  evening: 'Put the day down. It keeps until tomorrow.',
  night: 'Late. Leave it here and go to bed.',
}

export function Home() {
  const store = useStore()
  const toast = useToast()
  const now = useNow()
  const [justCaptured, setJustCaptured] = useState<string[]>([])

  const today = startOfDay(now)
  const handoff = latestHandoff(store.handoffs)
  const tickets = dueTickets(store.things, now)
  const soon = approaching(store.things, 7, now)
  const late = overdue(store.things, now)
  const queue = unrouted(store.things)
  const openCount = live(store.things).filter((t) => t.status === 'open').length

  // The companion column earns its place only when it has something contextual
  // to say. On a quiet day it would otherwise be one short card standing above a
  // tall empty column — exactly the hollow feeling this workspace exists to
  // avoid — so the evening entry point moves inline and the desk takes the room.
  const hasCompanion = handoff != null || tickets.length > 0 || soon.length > 0

  // The page you are writing on now: today's captures, newest first, plus
  // anything captured in this sitting even if the clock has rolled over.
  const page = useMemo(() => {
    const seen = new Set<string>()
    const rows: Thing[] = []
    for (const id of justCaptured) {
      const found = store.things.find((t) => t.id === id && t.deletedAt == null)
      if (found && !seen.has(found.id)) {
        seen.add(found.id)
        rows.push(found)
      }
    }
    for (const thing of live(store.things)
      .filter((t) => t.createdAt >= today)
      .sort((a, b) => b.createdAt - a.createdAt)) {
      if (!seen.has(thing.id)) {
        seen.add(thing.id)
        rows.push(thing)
      }
    }
    return rows.slice(0, 8)
  }, [justCaptured, store.things, today])

  const resume = useMemo(() => {
    const candidates = store.projects
      .filter((p) => p.deletedAt == null && p.archivedAt == null)
      .map((project) => ({ project, capsule: latestCapsule(store.capsules, project.id) }))
      .filter((entry) => entry.capsule != null)
      .sort((a, b) => (b.capsule?.savedAt ?? 0) - (a.capsule?.savedAt ?? 0))
    return candidates[0] ?? null
  }, [store.capsules, store.projects])

  const chosen = (handoff?.nextActionIds ?? [])
    .map((id) => store.things.find((t) => t.id === id))
    .filter((t): t is Thing => t != null && t.deletedAt == null && t.status === 'open')

  async function remove(thing: Thing) {
    try {
      await store.softDeleteThing(thing.id)
      toast.show('Put in the bin.', {
        action: { label: 'Undo', run: () => store.restoreThing(thing.id) },
      })
    } catch {
      toast.show('That could not be deleted — nothing has changed.', { tone: 'problem' })
    }
  }

  return (
    <div
      className={
        hasCompanion ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_248px] lg:gap-7' : 'grid gap-6'
      }
    >
      {/* ---------------- the desk ---------------- */}
      <div className={hasCompanion ? 'min-w-0' : 'mx-auto w-full min-w-0 max-w-[764px]'}>
        <header className="rise mb-4">
          <p className="eyebrow mb-1.5">{formatDayLong(now)}</p>
          <h1 className="display text-[1.75rem] sm:text-[2rem]">Come on in.</h1>
          <p className="aside-hand mt-1 text-[1rem]">{OPENING[partOfDay(now)]}</p>
        </header>

        {/* The notebook ------------------------------------------- */}
        <Panel className="rise !p-3 sm:!p-4">
          <Composer
            autoFocus
            onCaptured={(created) => setJustCaptured((ids) => [...created.map((c) => c.id), ...ids])}
          />
        </Panel>

        {/* Today's page -------------------------------------------- */}
        <section className="mt-6">
          <SectionHead
            count={page.length || undefined}
            action={
              <a className="link text-[0.75rem]" href={href('/things')}>
                Everything ({openCount})
              </a>
            }
          >
            Today’s page
          </SectionHead>

          {page.length === 0 ? (
            <Empty>Nothing written down yet today. The notebook is right there.</Empty>
          ) : (
            <Panel className="!py-1">
              {page.map((thing) => (
                <ThoughtRow key={thing.id} thing={thing} onDelete={remove} />
              ))}
            </Panel>
          )}

          {queue.length > 0 ? (
            <Quiet className="mt-2.5">
              {queue.length} thing{queue.length === 1 ? '' : 's'} still unfiled — file{' '}
              {queue.length === 1 ? 'it' : 'them'} from any page, or{' '}
              <a className="link" href={href('/things')}>
                do it in one pass
              </a>
              . There is no hurry.
            </Quiet>
          ) : null}
        </section>

        {/* Where you stopped --------------------------------------- */}
        {resume?.capsule ? (
          <section className="mt-6">
            <SectionHead
              action={
                <a className="link text-[0.75rem]" href={href('/projects')}>
                  All projects
                </a>
              }
            >
              Where you stopped
            </SectionHead>
            <Panel>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="display text-[1.15rem]">
                  <a className="hover:text-forest-deep" href={href(`/projects/${resume.project.id}`)}>
                    {resume.project.name}
                  </a>
                </h3>
                <p className="text-[0.7rem] text-muted">
                  saved {relativeDay(resume.capsule.savedAt, now)}
                </p>
              </div>

              {resume.capsule.nextAction ? (
                <div className="mt-2.5 border-l-2 border-forest pl-3">
                  <p className="eyebrow mb-0.5">Next</p>
                  <p className="written text-[1.0625rem]">{resume.capsule.nextAction}</p>
                </div>
              ) : resume.capsule.status ? (
                <Quiet className="mt-2">{resume.capsule.status}</Quiet>
              ) : null}

              {resume.capsule.blocker ? (
                <p className="mt-2 text-[0.8125rem] text-brown">
                  In the way: {resume.capsule.blocker}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <a className="btn btn-soft" href={href(`/projects/${resume.project.id}`)}>
                  Pick it up
                </a>
              </div>
            </Panel>
          </section>
        ) : null}
        {/* Tonight, inline — the column is not there to hold it -- */}
        {!hasCompanion ? (
          <Panel className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-64">
              <SectionHead>Tonight</SectionHead>
              <Quiet>
                When you are done for the day, close it properly. It takes a minute and leaves you
                somewhere to come back to.
              </Quiet>
            </div>
            <a className="btn btn-solid shrink-0" href={href('/ritual')}>
              <Icon name="moon" className="size-4" />
              Close the day
            </a>
          </Panel>
        ) : null}
      </div>

      {/* ---------------- companion ---------------- */}
      {hasCompanion ? (
      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        {/* Gentle return */}
        {handoff ? (
          <Panel tone="paper-2" className="rise">
            <SectionHead>Last hand-off</SectionHead>
            <Quiet>
              You put the day down {relativeDay(handoff.closedAt, now)}.
            </Quiet>
            {handoff.note ? (
              <p className="written mt-2 border-l-2 border-line pl-2.5 text-[0.875rem] text-muted">
                {handoff.note}
              </p>
            ) : null}
            {chosen.length > 0 ? (
              <ul className="mt-2.5 grid gap-1.5">
                {chosen.slice(0, 3).map((thing) => (
                  <li key={thing.id} className="written text-[0.875rem] leading-snug">
                    · {thing.text}
                  </li>
                ))}
              </ul>
            ) : null}
            <a className="link mt-2.5 inline-block text-[0.75rem]" href={href('/return')}>
              Open the hand-off →
            </a>
          </Panel>
        ) : null}

        {/* Tonight */}
        <Panel className="rise">
          <SectionHead>Tonight</SectionHead>
          <Quiet>
            When you are done for the day, close it properly. It takes a minute and leaves you
            somewhere to come back to.
          </Quiet>
          <a className="btn btn-solid mt-3 w-full" href={href('/ritual')}>
            <Icon name="moon" className="size-4" />
            Close the day
          </a>
        </Panel>

        {/* What is close */}
        {tickets.length > 0 || soon.length > 0 ? (
          <Panel tone="paper-2">
            <SectionHead>Close by</SectionHead>
            <ul className="grid gap-2">
              {tickets.slice(0, 3).map((thing) => (
                <li key={thing.id} className="text-[0.8125rem] leading-snug">
                  <span className="written">{thing.text}</span>
                  <span className="mt-0.5 block">
                    <Tag tone="sand">back today</Tag>
                  </span>
                </li>
              ))}
              {soon.slice(0, 4).map((thing) => {
                const past = thing.dueAt != null && thing.dueAt < today
                return (
                  <li key={thing.id} className="text-[0.8125rem] leading-snug">
                    <span className="written">{thing.text}</span>
                    <span className="mt-0.5 block">
                      <Tag tone={past ? 'sand' : 'plain'}>
                        {past ? 'was due' : 'due'} {thing.dueAt ? relativeDay(thing.dueAt, now) : ''}
                      </Tag>
                    </span>
                  </li>
                )
              })}
            </ul>
            {late.length > 0 ? (
              <Quiet className="mt-2.5 text-[0.7rem]">
                Nothing is hidden from you — past dates stay on this list.
              </Quiet>
            ) : null}
          </Panel>
        ) : null}
      </aside>
      ) : null}
    </div>
  )
}
