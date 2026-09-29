import {
  AudioWaveform,
  Ellipsis,
  FolderKanban,
  HeartPulse,
  House,
  Inbox,
  ListTodo,
  Sun,
  Trophy,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';
import { ModeBar } from '../features/modes/ModeBar';
import { useModes } from '../features/modes/useModes';

/**
 * Navigation (ADR-043). Phones show five tabs: Home, Projects, Hackathons,
 * Rhythm, More. Desktop shows every destination directly (and no More).
 * One list, so the markup never changes between breakpoints.
 */
const NAV: {
  to: string;
  label: string;
  icon: LucideIcon;
  only?: 'desktop' | 'phone';
  end?: boolean;
}[] = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/today', label: 'Today', icon: Sun, only: 'desktop' },
  { to: '/inbox', label: 'Inbox', icon: Inbox, only: 'desktop' },
  { to: '/tasks', label: 'Tasks', icon: ListTodo, only: 'desktop' },
  { to: '/hackathons', label: 'Hackathons', icon: Trophy },
  { to: '/rhythm', label: 'Rhythm', icon: AudioWaveform },
  { to: '/life', label: 'Life', icon: HeartPulse, only: 'desktop' },
  { to: '/more', label: 'More', icon: Ellipsis, only: 'phone' },
];

/**
 * App frame. Desktop: a narrow sidebar. Mobile: one compact top bar with
 * five tabs. Below the header, the mode bar shows a running work session or
 * Sleep Mode. In Sleep Mode (ADR-042) the page dims and desaturates but stays
 * fully usable; the mode bar itself stays bright.
 */
export function Shell() {
  const { offTime } = useModes();
  return (
    <div className="min-h-dvh md:flex" data-mode={offTime ? 'sleep' : undefined}>
      <a
        href="#main"
        onClick={(event) => {
          // Move focus without touching the URL.
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-20 focus:rounded-md focus:bg-paper-raised focus:px-3 focus:py-1.5 focus:text-sm"
      >
        Skip to content
      </a>

      <header
        data-dimmable
        className="sticky top-0 z-[2] flex h-12 items-center gap-3 border-b border-line bg-paper-sunken px-3 md:h-dvh md:w-44 md:shrink-0 md:flex-col md:items-stretch md:gap-5 md:border-r md:border-b-0 md:px-3 md:py-5"
      >
        <p className="flex items-center gap-1.5 font-serif text-base font-semibold tracking-tight md:px-2">
          <Waves aria-hidden className="size-5 text-accent" strokeWidth={1.75} />
          <span className="max-[439px]:sr-only">LOWTIDE</span>
        </p>
        <nav aria-label="Main" className="ml-auto md:ml-0">
          <ul className="flex gap-px md:flex-col md:gap-0.5">
            {NAV.map(({ to, label, icon: Icon, only, end }) => (
              <li
                key={to}
                className={
                  only === 'desktop' ? 'max-md:hidden' : only === 'phone' ? 'md:hidden' : ''
                }
              >
                <NavLink
                  to={to}
                  end={end ?? false}
                  className={({ isActive }) =>
                    // Below md: icon over a small label, so five items fit at 320 px.
                    `flex h-11 flex-col items-center justify-center gap-1 rounded-md px-1.5 text-[10px] leading-none md:h-8 md:flex-row md:justify-start md:gap-2 md:px-2 md:text-sm ${
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
        <p
          data-nonessential
          className="mt-auto hidden px-2 text-xs leading-snug text-ink-muted md:block"
        >
          Everything here stays on this device.{' '}
          <Link to="/data" className="text-accent-ink underline underline-offset-2">
            Data &amp; backup
          </Link>
        </p>
      </header>

      <div className="min-w-0 flex-1">
        <div className="sticky top-12 z-[1] md:top-0">
          <ModeBar />
        </div>
        <main
          id="main"
          tabIndex={-1}
          data-dimmable
          className="min-w-0 px-4 py-5 outline-none md:px-10 md:py-8"
        >
          <div className="min-w-0 max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Phones: backup lives here rather than as a tab. */}
      <footer
        data-dimmable
        data-nonessential
        className="border-t border-line px-4 py-4 text-xs text-ink-muted md:hidden"
      >
        Everything here stays on this device.{' '}
        <Link to="/data" className="text-accent-ink underline underline-offset-2">
          Data &amp; backup
        </Link>
      </footer>
    </div>
  );
}
