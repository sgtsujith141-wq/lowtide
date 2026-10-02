import { useEffect, useRef } from 'react';
import { useNow } from '../../hooks/useNow';
import type { OffTimeSession } from '../../types/domain';
import { sinceClock, timeOfDay } from './clocks';

/*
 * Sleep Mode (v2 PHASE 015): LOWTIDE goes dormant with you. A full-viewport,
 * almost-black layer over the app (which stays mounted underneath, inert):
 * a large timer, the state, when it started, and Wake up. Nothing else. It
 * never scrolls, and it is not a sleep measurement: just a marked window.
 */

export function SleepScreen({
  session,
  leaving,
  onWake,
}: {
  session: OffTimeSession;
  /** Waking: the layer fades away before it goes. */
  leaving: boolean;
  onWake: () => void;
}) {
  const now = useNow(!leaving);
  const wake = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    wake.current?.focus();
    // Dormant means still: the page underneath can't scroll either.
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = before;
    };
  }, []);
  const started = session.startedAt ?? session.createdAt;
  const label = session.kind === 'rest' ? 'Resting' : 'Off time';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-leaving={leaving || undefined}
      className="lt-dormant fixed inset-0 z-[60] flex h-dvh flex-col items-center justify-center overflow-hidden bg-[#030405] px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-[#c9ced6] select-none"
    >
      <div className="flex flex-col items-center text-center">
        <p
          role="timer"
          aria-label={`${label}, since ${timeOfDay(started)}`}
          className="figure text-[clamp(3.5rem,14vw,8.5rem)] leading-none font-light tracking-tight text-[#e3e6ea]"
        >
          {sinceClock(started, now)}
        </p>
        <p className="mt-6 text-xs font-medium tracking-[0.32em] text-[#8a919b] uppercase">
          {label}
        </p>
        <p className="mt-2 text-sm text-[#8a919b]">started {timeOfDay(started)}</p>
        <p className="mt-1 text-xs text-[#6f7781]">
          {new Date(started).toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
      </div>
      <button
        ref={wake}
        type="button"
        onClick={onWake}
        disabled={leaving}
        className="mt-16 h-12 min-w-44 rounded-full border border-[#2a2f36] px-8 text-[15px] font-medium text-[#e3e6ea] transition-colors hover:border-[#4a515b] hover:bg-[#0c0e11] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#9aa3ae] max-sm:absolute max-sm:bottom-[calc(env(safe-area-inset-bottom)+2.5rem)] max-sm:mt-0 max-sm:h-14 max-sm:w-[calc(100%-3rem)]"
      >
        Wake up
      </button>
    </div>
  );
}
