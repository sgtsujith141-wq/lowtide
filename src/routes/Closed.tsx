import { useStore } from '../lib/store-context.ts'
import { latestHandoff } from '../lib/model.ts'
import { formatDayLong, formatStamp } from '../lib/dates.ts'
import { href } from '../lib/router.ts'
import type { Thing } from '../lib/types.ts'

/**
 * The state after the ritual. It renders outside the workspace frame — no rail,
 * no counts, nothing asking for attention. The wording only claims what is on
 * disk: this screen is reached by reading the hand-off back out of storage.
 */
export function Closed() {
  const store = useStore()
  const handoff = latestHandoff(store.handoffs)

  if (!handoff) {
    return (
      <div className="relative z-1 flex min-h-[100dvh] flex-col items-center justify-center gap-5 px-6 text-center">
        <p className="display text-xl">No day has been closed yet.</p>
        <a className="btn btn-soft" href={href('/ritual')}>
          Close the day
        </a>
      </div>
    )
  }

  const picked = handoff.nextActionIds
    .map((id) => store.things.find((t) => t.id === id))
    .filter((t): t is Thing => t != null && t.deletedAt == null)

  return (
    <div className="relative z-1 flex min-h-[100dvh] flex-col px-5 py-8 sm:px-8">
      <a
        href={href('/')}
        className="display self-start text-[0.75rem] tracking-[0.3em] text-muted transition-colors hover:text-forest"
      >
        LOWTIDE
      </a>

      <div className="fade mx-auto flex w-full max-w-lg flex-1 flex-col justify-center py-10 text-center">
        <p className="eyebrow mb-4">{formatDayLong(handoff.closedAt)}</p>
        <h1 className="display text-[2.2rem] leading-[1.08] sm:text-[2.8rem]">Your day is saved.</h1>
        <p className="aside-hand mt-3 text-[1.0625rem]">Go enjoy the rest of it.</p>
        <p className="mt-5 text-[0.75rem] text-muted">
          Written to this device at {formatStamp(handoff.closedAt)}.
        </p>

        {handoff.note ? (
          <p className="written mx-auto mt-9 max-w-sm border-t border-line pt-9 text-left text-muted">
            {handoff.note}
          </p>
        ) : null}

        {picked.length > 0 ? (
          <div className="mx-auto mt-9 w-full max-w-sm text-left">
            <p className="eyebrow mb-2 text-center">Waiting for you tomorrow</p>
            <ul className="grid gap-1.5">
              {picked.map((thing) => (
                <li key={thing.id} className="paper px-3 py-2">
                  <p className="written text-[0.9375rem]">{thing.text}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {handoff.leftUnclassified > 0 ? (
          <p className="mt-9 text-[0.8125rem] text-muted">
            {handoff.leftUnclassified} thing{handoff.leftUnclassified === 1 ? '' : 's'} left unfiled.
            They will keep.
          </p>
        ) : null}
      </div>

      <div className="mx-auto flex w-full max-w-lg flex-wrap items-center justify-center gap-4 border-t border-line pt-5 text-[0.75rem] text-muted">
        <a className="link" href={href('/return')}>
          See the hand-off
        </a>
        <a className="link" href={href('/')}>
          Back to the notebook
        </a>
        <span>You can close this tab.</span>
      </div>
    </div>
  )
}
