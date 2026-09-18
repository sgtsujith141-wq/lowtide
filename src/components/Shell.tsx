import { useEffect, useState, type ReactNode } from 'react'
import { href, usePath } from '../lib/router.ts'
import { useStore } from '../lib/store-context.ts'
import { dueTickets, overdue, unrouted } from '../lib/model.ts'
import { useNow } from '../lib/clock.ts'
import { Dialog } from './ui.tsx'
import { Icon } from './Icon.tsx'

const NAV = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/things', label: 'My Things', icon: 'things' },
  { to: '/projects', label: 'Projects', icon: 'projects' },
  { to: '/return', label: 'Return', icon: 'return' },
]

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}

/**
 * The workspace frame: a quiet rail on the left, the notebook in the middle.
 * On small screens the rail becomes a reachable bar at the bottom of the glass.
 */
export function Shell({ children }: { children: ReactNode }) {
  const path = usePath()
  const store = useStore()
  const now = useNow()
  const [helpOpen, setHelpOpen] = useState(false)

  const waiting = unrouted(store.things).length
  const needsEye = dueTickets(store.things, now).length + overdue(store.things, now).length
  const isActive = (to: string) => (to === '/' ? path === '/' : path.startsWith(to))

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditable(event.target)) return
      if (event.key === '?') {
        event.preventDefault()
        setHelpOpen(true)
      }
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault()
        const composer = document.getElementById('composer')
        if (composer) composer.focus()
        else window.location.hash = '/'
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [path])

  return (
    <div className="relative z-1 flex min-h-[100dvh] flex-col md:flex-row">
      <a className="skip" href="#main">
        Skip to content
      </a>

      {/* Mobile top bar --------------------------------------------- */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-line bg-[color-mix(in_srgb,var(--color-canvas)_92%,transparent)] px-4 backdrop-blur-sm md:hidden">
        <a href={href('/')} className="display text-[0.8rem] tracking-[0.3em]">
          LOWTIDE
        </a>
        <a href={href('/ritual')} className="btn btn-soft ml-auto px-2.5 py-1">
          <Icon name="moon" className="size-4" />
          Tonight
        </a>
      </header>

      {/* Desktop rail ------------------------------------------------ */}
      <aside className="sticky top-0 hidden h-[100dvh] w-[196px] shrink-0 flex-col border-r border-line bg-[color-mix(in_srgb,var(--color-canvas)_60%,var(--color-paper-2))] px-3 py-5 md:flex">
        <a
          href={href('/')}
          className="display mb-6 px-2 text-[0.8rem] tracking-[0.3em] text-ink transition-colors hover:text-forest"
        >
          LOWTIDE
        </a>

        <nav aria-label="Primary" className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = isActive(item.to)
            return (
              <a
                key={item.to}
                href={href(item.to)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] transition-colors ${
                  active
                    ? 'bg-paper text-forest-deep shadow-[var(--shadow-rest)]'
                    : 'text-muted hover:bg-[color-mix(in_srgb,var(--color-sage)_60%,transparent)] hover:text-ink'
                }`}
              >
                <Icon name={item.icon} className="size-[17px] shrink-0" />
                <span className="truncate">{item.label}</span>
                {item.to === '/things' && waiting > 0 ? (
                  <span className="ml-auto text-[0.7rem] tabular-nums text-muted" aria-hidden="true">
                    {waiting}
                  </span>
                ) : null}
                {item.to === '/things' && waiting > 0 ? (
                  <span className="sr-only">, {waiting} to file</span>
                ) : null}
                {item.to === '/return' && needsEye > 0 ? (
                  <>
                    <span className="ml-auto size-1.5 rounded-full bg-brown-soft" aria-hidden="true" />
                    <span className="sr-only">, {needsEye} need a look</span>
                  </>
                ) : null}
              </a>
            )
          })}
        </nav>

        <div className="my-4 divider" />

        <a
          href={href('/ritual')}
          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] transition-colors ${
            isActive('/ritual')
              ? 'bg-paper text-forest-deep shadow-[var(--shadow-rest)]'
              : 'text-muted hover:bg-[color-mix(in_srgb,var(--color-sage)_60%,transparent)] hover:text-ink'
          }`}
        >
          <Icon name="moon" className="size-[17px] shrink-0" />
          Close the day
        </a>

        <div className="mt-auto flex flex-col gap-0.5 pt-4">
          <button
            type="button"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[0.75rem] text-muted transition-colors hover:text-ink"
            onClick={() => setHelpOpen(true)}
          >
            <Icon name="clock" className="size-4 shrink-0" />
            Keyboard
          </button>
          <a
            href={href('/data')}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[0.75rem] text-muted transition-colors hover:text-ink"
          >
            <Icon name="archive" className="size-4 shrink-0" />
            Backups
          </a>
          <p className="px-2.5 pt-2 text-[0.65rem] leading-snug text-muted-soft">
            Everything stays on this device.
          </p>
        </div>
      </aside>

      {/* Main -------------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {store.storageError ? (
          <div role="alert" className="border-b border-line bg-sand">
            <div className="mx-auto flex w-full max-w-[1040px] items-start gap-3 px-4 py-2.5 sm:px-6">
              <p className="flex-1 text-[0.8125rem] leading-relaxed text-ink">
                <strong className="font-semibold">Nothing was saved.</strong> {store.storageError}
              </p>
              <button type="button" className="btn btn-ghost shrink-0" onClick={store.dismissStorageError}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        <main
          id="main"
          className="mx-auto w-full max-w-[1040px] flex-1 px-4 pt-5 pb-24 sm:px-6 sm:pt-7 md:pb-10"
        >
          {children}
        </main>
      </div>

      {/* Mobile bar -------------------------------------------------- */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[color-mix(in_srgb,var(--color-canvas)_95%,transparent)] pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-sm md:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch">
          {NAV.map((item) => {
            const active = isActive(item.to)
            return (
              <li key={item.to} className="flex-1">
                <a
                  href={href(item.to)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-14 flex-col items-center justify-center gap-1 text-[0.65rem] transition-colors ${
                    active ? 'text-forest-deep' : 'text-muted'
                  }`}
                >
                  <Icon name={item.icon} className="size-[19px]" />
                  {item.label}
                </a>
              </li>
            )
          })}
        </ul>
      </nav>

      <Dialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Keyboard"
        description="LOWTIDE works without the mouse."
        footer={
          <button type="button" className="btn btn-soft" onClick={() => setHelpOpen(false)}>
            Close
          </button>
        }
      >
        <dl className="divide-y divide-line text-[0.8125rem]">
          {[
            ['Enter', 'Save what is in the notebook'],
            ['Shift + Enter', 'New line inside one thought'],
            ['⌘ / Ctrl + Enter', 'Also saves'],
            ['N', 'Jump to the notebook'],
            ['1 – 7', 'File the thought you are on'],
            ['J / K or ↓ / ↑', 'Move between thoughts'],
            ['Esc', 'Close a menu or dialog'],
            ['?', 'This list'],
          ].map(([key, what]) => (
            <div key={key} className="flex items-baseline gap-4 py-2">
              <dt className="w-32 shrink-0 font-mono text-[0.7rem] text-forest-deep">{key}</dt>
              <dd className="flex-1 text-muted">{what}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </div>
  )
}
