import { Inbox, ListTodo, Sun, Waves, type LucideIcon } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Today', icon: Sun },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
];

/**
 * App frame. Desktop: a narrow sidebar with room below for future sections.
 * Mobile: one compact top bar. Same markup, rearranged at `md`, so nothing
 * jumps between breakpoints.
 */
export function Shell() {
  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#main"
        onClick={(event) => {
          // Move focus without touching the URL.
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-10 focus:rounded-md focus:bg-paper-raised focus:px-3 focus:py-1.5 focus:text-sm"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-[1] flex h-12 items-center gap-3 border-b border-line bg-paper-sunken px-3 md:h-dvh md:w-44 md:shrink-0 md:flex-col md:items-stretch md:gap-5 md:border-r md:border-b-0 md:px-3 md:py-5">
        <p className="flex items-center gap-1.5 font-serif text-base font-semibold tracking-tight md:px-2">
          <Waves aria-hidden className="size-5 text-accent" strokeWidth={1.75} />
          <span className="max-[359px]:sr-only">LOWTIDE</span>
        </p>
        <nav aria-label="Main" className="ml-auto md:ml-0">
          <ul className="flex gap-0.5 md:flex-col">
            {NAV.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end
                  className={({ isActive }) =>
                    `flex h-8 items-center gap-2 rounded-md px-2 text-sm ${
                      isActive
                        ? 'bg-paper-raised font-semibold text-ink shadow-[inset_0_-2px_0_var(--lt-accent)] md:shadow-[inset_2px_0_0_var(--lt-accent)]'
                        : 'text-ink-muted hover:bg-paper hover:text-ink'
                    }`
                  }
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <p className="mt-auto hidden px-2 text-xs leading-snug text-ink-muted md:block">
          Everything here stays on this device.
        </p>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 flex-1 px-4 py-5 outline-none md:px-10 md:py-8"
      >
        <div className="max-w-2xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
