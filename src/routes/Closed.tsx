import { useStore } from '../lib/store-context.ts'
import { latestHandoff } from '../lib/model.ts'
import { formatDayLong, formatStamp } from '../lib/dates.ts'
import { href } from '../lib/router.ts'
import type { Thing } from '../lib/types.ts'

/**
 * The quiet screen after a day is closed. It renders outside the app shell:
 * no navigation, no counts, nothing asking for attention.
 */
export function Closed() {
  const store = useStore()
  const handoff = latestHandoff(store.handoffs)

  if (!handoff) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-6 px-6 text-center">
        <p className="lt-display text-2xl">No day has been closed yet.</p>
        <a className="lt-btn lt-btn-secondary" href={href('/close')}>
          Close the day
        </a>
      </div>
    )
  }

  const picked = handoff.nextActionIds
    .map((id) => store.things.find((t) => t.id === id))
    .filter((t): t is Thing => t != null && t.deletedAt == null)

  return (
    <div className="flex min-h-[100dvh] flex-col px-5 py-10 sm:px-8">
      <a
        href={href('/')}
        className="lt-display self-start text-[0.8rem] tracking-[0.34em] text-muted transition-colors hover:text-accent"
      >
        LOWTIDE
      </a>

      <div className="lt-fade mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-12 text-center">
        <p className="lt-eyebrow mb-5">{formatDayLong(handoff.closedAt)}</p>
        <h1 className="lt-display text-[2.6rem] leading-[1.06] sm:text-[3.4rem]">
          The day is down.
        </h1>
        <p className="mt-5 text-sm text-muted">
          Saved on this device at {formatStamp(handoff.closedAt)}.
        </p>

        {handoff.note ? (
          <p className="lt-prose mx-auto mt-10 max-w-md border-t border-rule pt-10 text-left text-muted">
            {handoff.note}
          </p>
        ) : null}

        {picked.length > 0 ? (
          <div className="mx-auto mt-10 w-full max-w-md text-left">
            <p className="lt-eyebrow mb-3 text-center">Waiting for you next time</p>
            <ul className="grid gap-2">
              {picked.map((thing) => (
                <li key={thing.id} className="lt-card px-4 py-3">
                  <p className="lt-prose text-[0.9375rem]">{thing.text}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {handoff.leftUnclassified > 0 ? (
          <p className="mt-10 text-sm text-muted">
            {handoff.leftUnclassified} thing{handoff.leftUnclassified === 1 ? '' : 's'} left
            unfiled. They will be here.
          </p>
        ) : null}
      </div>

      <div className="mx-auto flex w-full max-w-xl flex-wrap items-center justify-center gap-4 border-t border-rule pt-6 text-xs text-muted">
        <a className="lt-link" href={href('/return')}>
          See the hand-off
        </a>
        <a className="lt-link" href={href('/')}>
          Home
        </a>
        <span>You can close this tab now.</span>
      </div>
    </div>
  )
}
