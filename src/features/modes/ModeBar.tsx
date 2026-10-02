import { Maximize2, Pause, Play, Square } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useNow } from '../../hooks/useNow';
import type { WorkSession } from '../../types/domain';
import { activeMs, isPaused } from '../work/duration';
import { longClock, shortDuration } from './clocks';
import { useModeApi, workShortcutLabel } from './mode-context';
import { useTodayTotal, useWorkContext } from './work-context';

/**
 * The compact Work bar (v2 PHASE 015): shown while a session runs and Work
 * Mode's surface is folded away, so the rest of LOWTIDE stays usable. One
 * line: what, the timer, today, Pause or Resume, Finish, and back to focus.
 * (Sleep Mode has no bar: it covers the screen.)
 */
export function ModeBar() {
  const { work, focusOpen, offTime } = useModeApi();
  if (!work || focusOpen || offTime) return null;
  return <WorkBar session={work} />;
}

function WorkBar({ session }: { session: WorkSession }) {
  const api = useModeApi();
  const paused = isPaused(session);
  const now = useNow(!paused);
  const { title, subtitle } = useWorkContext(session);
  const today = useTodayTotal(session, now);
  return (
    <section
      aria-label="Work session"
      className="border-b border-line bg-canvas/95 px-4 py-1.5 shadow-[inset_0_-1px_0_var(--lt-work-2)] backdrop-blur sm:px-6 md:px-8 xl:px-12"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={() => api.setFocusOpen(true)}
          aria-label={`Open Work Mode (${workShortcutLabel()})`}
          className="group flex min-w-[9rem] flex-1 items-center gap-2.5 rounded-md py-1 text-left text-sm"
        >
          <span
            aria-hidden
            className={`size-2 shrink-0 rounded-full bg-work-3 ${paused ? 'opacity-40' : ''}`}
          />
          <span className={`shrink-0 font-medium ${paused ? 'text-fg-muted' : ''}`}>
            {paused ? 'Paused' : 'Working'}
          </span>
          <span className="min-w-0 truncate text-fg-muted group-hover:text-fg">
            {title}
            {subtitle ? ` · ${subtitle}` : ''}
          </span>
          <Maximize2 aria-hidden className="size-3.5 shrink-0 text-fg-subtle group-hover:text-fg" />
        </button>
        <p
          role="timer"
          aria-label={`Session time ${shortDuration(activeMs(session, now))}`}
          className={`figure text-base font-semibold ${paused ? 'text-fg-muted' : 'text-work-4'}`}
        >
          {longClock(activeMs(session, now))}
        </p>
        <p className="figure text-xs text-fg-muted">today {shortDuration(today)}</p>
        <div className="flex gap-1.5">
          {paused ? (
            <Button size="sm" onClick={() => void api.resume()}>
              <Play aria-hidden className="size-3.5" /> Resume
            </Button>
          ) : (
            <Button size="sm" onClick={() => void api.pause()}>
              <Pause aria-hidden className="size-3.5" /> Pause
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => void api.finish()}>
            <Square aria-hidden className="size-3.5" /> Finish
          </Button>
        </div>
      </div>
    </section>
  );
}
