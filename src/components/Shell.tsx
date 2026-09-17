import { useEffect, useState, type ReactNode } from 'react'
import { href, usePath } from '../lib/router.ts'
import { useStore } from '../lib/store-context.ts'
import { unrouted, dueTickets, overdue } from '../lib/model.ts'
import { Dialog } from './ui.tsx'
import { useNow } from '../lib/clock.ts'

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/things', label: 'My Things' },
  { to: '/projects', label: 'Projects' },
  { to: '/return', label: 'Return' },
]

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePath()
  const store = useStore()
  const [helpOpen, setHelpOpen] = useState(false)
  const now = useNow()

  const waiting = unrouted(store.things).length
  const needsEye = dueTickets(store.things, now).length + overdue(store.things, now).length

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
        window.location.hash = '/dump'
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A route change should read as a new page for keyboard and screen-reader users.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [path])

  const isActive = (to: string) => (to === '/' ? path === '/' : path.startsWith(to))

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a className="lt-skip" href="#main">
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-rule bg-[color-mix(in_srgb,var(--color-paper)_88%,transparent)] backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 sm:h-16 sm:px-6">
          <a
            href={href('/')}
            className="lt-display text-[0.95rem] tracking-[0.34em] text-ink transition-colors hover:text-accent"
            aria-label="LOWTIDE, home"
          >
            LOWTIDE
          </a>

          <nav aria-label="Primary" className="ml-4 hidden flex-1 items-center gap-1 md:flex">
            {NAV.map((item) => (
              <a
                key={item.to}
                href={href(item.to)}
                aria-current={isActive(item.to) ? 'page' : undefined}
                className={`rounded px-2.5 py-1.5 text-sm transition-colors ${
                  isActive(item.to)
                    ? 'text-accent-deep underline decoration-accent/50 underline-offset-[6px]'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {item.label}
                {item.to === '/things' && waiting > 0 ? (
                  <span className="ml-1.5 text-xs tabular-nums text-muted">{waiting}</span>
                ) : null}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {needsEye > 0 ? (
              <a
                href={href('/return')}
                className="hidden text-xs text-attention underline decoration-attention/40 underline-offset-4 sm:inline"
              >
                {needsEye} need{needsEye === 1 ? 's' : ''} a look
              </a>
            ) : null}
            <a href={href('/dump')} className="lt-btn lt-btn-primary">
              Dump
            </a>
          </div>
        </div>
      </header>

      {store.storageError ? (
        <div role="alert" className="border-b border-attention/30 bg-attention-wash">
          <div className="mx-auto flex w-full max-w-5xl items-start gap-3 px-4 py-3 sm:px-6">
            <p className="flex-1 text-sm leading-relaxed text-ink">
              <strong className="font-semibold">Nothing was saved.</strong> {store.storageError}
            </p>
            <button type="button" className="lt-btn lt-btn-quiet shrink-0" onClick={store.dismissStorageError}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pt-8 pb-28 sm:px-6 sm:pt-12 md:pb-16">
        {children}
      </main>

      <footer className="hidden border-t border-rule px-4 py-5 sm:px-6 md:block">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <p>Everything here is stored on this device only.</p>
          <div className="flex items-center gap-4">
            <button type="button" className="lt-link" onClick={() => setHelpOpen(true)}>
              Keyboard shortcuts
            </button>
            <a className="lt-link" href={href('/data')}>
              Data &amp; backups
            </a>
          </div>
        </div>
      </footer>

      {/* Mobile navigation */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-[color-mix(in_srgb,var(--color-paper)_94%,transparent)] backdrop-blur-sm pb-[env(safe-area-inset-bottom,0px)] md:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch justify-between px-2">
          {NAV.map((item) => (
            <li key={item.to} className="flex-1">
              <a
                href={href(item.to)}
                aria-current={isActive(item.to) ? 'page' : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[0.7rem] transition-colors ${
                  isActive(item.to) ? 'text-accent-deep' : 'text-muted'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-[2px] w-5 rounded-full transition-colors ${
                    isActive(item.to) ? 'bg-accent' : 'bg-transparent'
                  }`}
                />
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Dialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Keyboard"
        description="LOWTIDE is built to be used without the mouse."
        footer={
          <button type="button" className="lt-btn lt-btn-secondary" onClick={() => setHelpOpen(false)}>
            Close
          </button>
        }
      >
        <dl className="divide-y divide-rule text-sm">
          {[
            ['N', 'Open the dump from anywhere'],
            ['Enter', 'In the dump: save what you have written'],
            ['Shift + Enter', 'In the dump: start a new line inside one thought'],
            ['⌘ / Ctrl + Enter', 'In the dump: save each line as its own thing'],
            ['1 – 7', 'While routing: file the thought in front of you'],
            ['J / K or ↓ / ↑', 'While routing: move between thoughts'],
            ['Esc', 'Close a dialog, or leave a field'],
            ['?', 'Show this list'],
          ].map(([key, what]) => (
            <div key={key} className="flex items-baseline gap-4 py-2.5">
              <dt className="w-36 shrink-0 font-mono text-xs text-accent-deep">{key}</dt>
              <dd className="flex-1 text-muted">{what}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </div>
  )
}
