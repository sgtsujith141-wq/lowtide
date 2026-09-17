import { useStore } from '../lib/store-context.ts'
import { approaching, dueTickets, latestHandoff, overdue, unrouted } from '../lib/model.ts'
import { formatStamp, partOfDay, relativeDay } from '../lib/dates.ts'
import { href } from '../lib/router.ts'
import { Quiet } from '../components/ui.tsx'
import { useNow } from '../lib/clock.ts'

const GREETING: Record<ReturnType<typeof partOfDay>, string> = {
  morning: 'Morning.',
  afternoon: 'Afternoon.',
  evening: 'Evening.',
  night: 'Late.',
}

export function Landing() {
  const store = useStore()
  const now = useNow()

  const waiting = unrouted(store.things).length
  const tickets = dueTickets(store.things, now).length
  const soon = approaching(store.things, 3, now).length
  const late = overdue(store.things, now).length
  const handoff = latestHandoff(store.handoffs)

  const notes: { text: string; to: string; tone: 'calm' | 'attention' }[] = []
  if (late > 0)
    notes.push({
      text: `${late} commitment${late === 1 ? '' : 's'} past its date`,
      to: '/return',
      tone: 'attention',
    })
  if (soon - late > 0)
    notes.push({
      text: `${soon - late} due in the next three days`,
      to: '/return',
      tone: 'calm',
    })
  if (tickets > 0)
    notes.push({
      text: `${tickets} came back today`,
      to: '/return',
      tone: 'calm',
    })
  if (waiting > 0)
    notes.push({
      text: `${waiting} still to file`,
      to: '/things',
      tone: 'calm',
    })

  return (
    <div className="mx-auto flex min-h-[62dvh] max-w-2xl flex-col justify-center py-6 sm:py-10">
      <p className="lt-eyebrow lt-fade mb-6">{GREETING[partOfDay(now)]}</p>

      <h1 className="lt-display lt-rise text-[2.6rem] leading-[1.05] sm:text-[4rem]">
        Put the day down.
      </h1>

      <p className="lt-rise mt-6 max-w-lg text-[1.0625rem] leading-relaxed text-muted">
        Somewhere to unload what you are carrying, keep the thread of unfinished work, and come back
        without having to work out where you were.
      </p>

      <div className="lt-rise mt-9 flex flex-wrap gap-2.5">
        <a className="lt-btn lt-btn-primary px-5 py-2.5" href={href('/dump')}>
          Empty your head
        </a>
        <a className="lt-btn lt-btn-secondary px-5 py-2.5" href={href('/return')}>
          Pick up where I stopped
        </a>
        <a className="lt-btn lt-btn-secondary px-5 py-2.5" href={href('/close')}>
          Close the day
        </a>
      </div>

      {notes.length > 0 ? (
        <ul className="lt-fade mt-12 grid gap-2 border-t border-rule pt-6">
          {notes.map((note) => (
            <li key={note.text}>
              <a
                href={href(note.to)}
                className={`group flex items-baseline gap-3 text-sm transition-colors ${
                  note.tone === 'attention' ? 'text-attention' : 'text-muted hover:text-ink'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-2 h-px w-5 shrink-0 transition-all group-hover:w-8 ${
                    note.tone === 'attention' ? 'bg-attention' : 'bg-rule'
                  }`}
                />
                {note.text}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <Quiet className="mt-12 border-t border-rule pt-6">
          Nothing is waiting, nothing is overdue.
        </Quiet>
      )}

      {handoff ? (
        <Quiet className="mt-8 text-xs">
          You last put the day down {relativeDay(handoff.closedAt, now)} ·{' '}
          {formatStamp(handoff.closedAt)}.{' '}
          <a className="lt-link" href={href('/return')}>
            Read the hand-off
          </a>
          .
        </Quiet>
      ) : (
        <Quiet className="mt-8 text-xs">
          Everything stays on this device.{' '}
          <a className="lt-link" href={href('/data')}>
            Back it up
          </a>{' '}
          whenever you like.
        </Quiet>
      )}
    </div>
  )
}
