import {
  AudioWaveform,
  Bot,
  CalendarDays,
  Database,
  Ellipsis,
  FolderKanban,
  HeartPulse,
  House,
  Inbox,
  LayoutGrid,
  Library,
  ListTodo,
  Settings,
  Sun,
  Trophy,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useCompanion, useCompanionConnection } from '../hooks/useCompanion';
import { ModeBar } from '../features/modes/ModeBar';
import { useModes } from '../features/modes/useModes';

/*
 * Navigation (ADR-043, v2 PHASE 011).
 *
 * Desktop: a compact icon rail with the five primary destinations (labels as
 * tooltips on hover and focus, and as each link's accessible name), and a
 * launcher for everything else. Phones: a top bar with five tabs (Home,
 * Projects, Hackathons, Rhythm, More); SPACE and the rest live on More.
 */
type Destination = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Where it appears in the Main list: both, the desktop rail only, or phones only. */
  only?: 'desktop' | 'phone';
};

const PRIMARY: Destination[] = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/space', label: 'SPACE', icon: Library, only: 'desktop' },
  { to: '/hackathons', label: 'Hackathons', icon: Trophy },
  { to: '/rhythm', label: 'Rhythm', icon: AudioWaveform },
  { to: '/more', label: 'More', icon: Ellipsis, only: 'phone' },
];

const SECONDARY: Destination[] = [
  { to: '/today', label: 'Today', icon: Sun },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
  { to: '/life', label: 'Life', icon: HeartPulse },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/ai', label: 'AI', icon: Bot },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/**
 * App frame. In Sleep Mode (ADR-042) the whole frame goes dormant: it sinks
 * toward black, loses colour, the rail recedes and motion stops; the mode bar
 * (with Wake up) stays as it is.
 */
export function Shell() {
  const { offTime } = useModes();
  return (
    <div
      className="min-h-dvh bg-canvas md:grid md:grid-cols-[var(--lt-rail)_minmax(0,1fr)]"
      data-mode={offTime ? 'sleep' : undefined}
    >
      <a
        href="#main"
        onClick={(event) => {
          // Move focus without touching the URL.
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-30 focus:rounded-md focus:bg-raised focus:px-3 focus:py-1.5 focus:text-sm"
      >
        Skip to content
      </a>

      <header
        data-recede
        className="sticky top-0 z-20 flex h-12 transition-[background-color,border-color] duration-700 items-center gap-2 border-b border-line bg-canvas/95 px-3 backdrop-blur md:h-dvh md:flex-col md:items-center md:gap-3 md:border-r md:border-b-0 md:px-0 md:py-3 md:backdrop-blur-none"
      >
        <Link
          to="/"
          aria-label="LOWTIDE"
          className="grid size-9 shrink-0 place-items-center rounded-md text-fg"
        >
          <Waves aria-hidden className="size-5" strokeWidth={1.75} />
        </Link>
        <nav aria-label="Main" className="ml-auto md:ml-0 md:w-full">
          <ul className="flex gap-px md:flex-col md:items-center md:gap-1">
            {PRIMARY.map((d) => (
              <li
                key={d.to}
                className={
                  d.only === 'desktop' ? 'max-md:hidden' : d.only === 'phone' ? 'md:hidden' : ''
                }
              >
                <RailLink {...d} />
              </li>
            ))}
          </ul>
        </nav>
        <Launcher />
      </header>

      <div className="min-w-0">
        <div className="sticky top-12 z-10 md:top-0">
          <ModeBar />
          <CompanionBanner />
        </div>
        <main
          id="main"
          tabIndex={-1}
          data-dimmable
          className="min-h-[calc(100dvh-3rem)] min-w-0 bg-canvas px-4 pt-5 pb-10 outline-none sm:px-6 md:min-h-dvh md:px-8 md:pt-8 xl:px-12"
        >
          <Outlet />
        </main>
      </div>

      {/* Phones: backup lives here rather than as a tab. */}
      <footer
        data-dimmable
        data-nonessential
        className="border-t border-line px-4 py-4 text-xs text-fg-muted md:hidden"
      >
        Everything here stays on this device.{' '}
        <Link to="/data" className="text-accent-ink underline underline-offset-2">
          Data &amp; backup
        </Link>
      </footer>
    </div>
  );
}

/** One destination: a tab on phones, an icon with a tooltip on the desktop rail. */
function RailLink({ to, label, icon: Icon, end }: Destination) {
  return (
    <NavLink
      to={to}
      end={end ?? false}
      className={({ isActive }) =>
        `group relative flex h-11 min-w-12 flex-col items-center justify-center gap-1 rounded-md px-1.5 text-[10px] leading-none transition-colors md:size-10 md:min-w-0 md:px-0 ${
          isActive ? 'text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {/* The current place: a short bar that slides in (on the left on the rail). */}
          <span
            aria-hidden
            data-marker
            className={`absolute bg-accent transition-[opacity,transform] duration-200 ease-[var(--ease-tide)] max-md:inset-x-2 max-md:bottom-0 max-md:h-0.5 max-md:origin-center md:top-2 md:bottom-2 md:-left-2 md:w-0.5 md:origin-center md:rounded-r ${
              isActive ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
            }`}
          />
          <Icon aria-hidden className="size-[18px] shrink-0" strokeWidth={isActive ? 2 : 1.75} />
          <span className="md:sr-only">{label}</span>
          {/* Tooltip (desktop rail): drawn from data-label, so the name exists once. */}
          <span
            aria-hidden
            data-label={label}
            className="pointer-events-none absolute top-1/2 left-full z-30 ml-3 hidden -translate-y-1/2 translate-x-[-4px] rounded-md bg-raised px-2 py-1 text-xs whitespace-nowrap text-fg opacity-0 shadow-[var(--lt-shadow)] transition-[opacity,transform] duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 after:content-[attr(data-label)] md:block"
          />
        </>
      )}
    </NavLink>
  );
}

/**
 * Desktop launcher for the secondary destinations (a disclosure, not a
 * menu): it moves focus to its first destination; Escape closes it and
 * returns focus to the button; a click outside or choosing a destination
 * closes it too.
 */
function Launcher() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const here = SECONDARY.some((d) => pathname.startsWith(d.to)) || pathname.startsWith('/data');

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector('a')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div className="relative max-md:hidden md:mt-auto">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={`group relative grid size-10 place-items-center rounded-md transition-colors ${
          open || here ? 'text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
        } ${open ? 'bg-hover' : ''}`}
      >
        <LayoutGrid aria-hidden className="size-[18px]" strokeWidth={1.75} />
        <span className="sr-only">More destinations</span>
        {here && (
          <span
            aria-hidden
            data-marker
            className="absolute top-2 bottom-2 -left-2 w-0.5 rounded-r bg-accent"
          />
        )}
      </button>
      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        className="lt-pop absolute bottom-0 left-full z-30 ml-3 w-60 rounded-lg bg-raised p-1.5 shadow-[var(--lt-shadow)]"
      >
        <nav aria-label="More destinations">
          <ul>
            {SECONDARY.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors ${
                      isActive ? 'bg-hover text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
                    }`
                  }
                >
                  <Icon aria-hidden className="size-4" strokeWidth={1.75} />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <p
          data-nonessential
          className="mt-1.5 border-t border-line px-2 pt-2 pb-1 text-xs leading-snug text-fg-muted"
        >
          Everything here stays on this device.{' '}
          <Link
            to="/data"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1 text-accent-ink underline underline-offset-2"
          >
            <Database aria-hidden className="size-3" />
            Data &amp; backup
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * Companion mode only (ADR-058): says plainly when the companion can't be
 * reached. There is no silent fallback to browser storage, so nothing can
 * be read or saved until it's back; LOWTIDE reconnects by itself.
 */
function CompanionBanner() {
  const { backend } = useCompanion();
  const state = useCompanionConnection();
  if (backend.kind !== 'companion' || state !== 'retrying') return null;
  return (
    <p
      role="status"
      className="border-b border-line bg-surface px-4 py-2 text-sm text-fg-muted md:px-8 xl:px-12"
    >
      <span className="text-warn">Can’t reach the LOWTIDE companion</span> at{' '}
      {backend.url.replace('http://', '')}, so nothing can be read or saved right now. Start it with{' '}
      <code className="text-fg">npm run companion</code>; LOWTIDE reconnects by itself.{' '}
      <Link to="/settings" className="text-accent-ink underline underline-offset-2">
        Settings
      </Link>
    </p>
  );
}
