import { Minimize2, Pause, Play, Square } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Button } from '../../components/ui/Button';
import { useNow } from '../../hooks/useNow';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import type { WorkSession } from '../../types/domain';
import { withoutProjectPrefix } from '../home/model';
import { nowNext } from '../projects/display';
import { summariseProject } from '../projects/summary';
import { activeMs, isPaused } from '../work/duration';
import { longClock, shortDuration, timeOfDay } from './clocks';
import { useModeApi, workShortcutLabel } from './mode-context';
import { useTodayTotal, useWorkContext } from './work-context';

/*
 * Work Mode (v2 PHASE 015): "I am actively working on this one thing." The
 * page underneath stays put but steps back; this surface shows what you're
 * on, a large timer, Pause or Resume and Finish, today's total, and what
 * comes next. Nothing unrelated.
 */

export function WorkFocus({ session }: { session: WorkSession }) {
  const api = useModeApi();
  const { projects } = useRepositories();
  const paused = isPaused(session);
  const now = useNow(!paused);
  const { project, title, subtitle, tasks } = useWorkContext(session);
  const todayMs = useTodayTotal(session, now);
  const milestones = useWatch(projects.watchAllMilestones);
  const items = useWatch(projects.watchAllItems);
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
  }, []);

  const next = useMemo(() => {
    if (!project || milestones.status !== 'ready' || items.status !== 'ready') return undefined;
    const s = summariseProject(project, milestones.data, items.data, tasks, [], '2000-01-01');
    const { now: current, next: after } = nowNext(s);
    // What comes next, never the thing being worked on now.
    const same = (t: string | undefined) =>
      !!t &&
      !!subtitle &&
      withoutProjectPrefix(t, project.name).toLowerCase() === subtitle.toLowerCase();
    return [after, current].find((t) => t && !same(t));
  }, [project, milestones, items, tasks, subtitle]);

  const lastPause = session.pauses.at(-1);
  return (
    <section
      aria-label="Work Mode"
      className="lt-focus fixed inset-x-0 top-12 bottom-0 z-30 overflow-y-auto bg-canvas md:top-0 md:left-[var(--lt-rail)]"
    >
      <div className="mx-auto flex min-h-full max-w-[56rem] flex-col px-5 py-6 sm:px-10 sm:py-10">
        <div className="flex items-center justify-between gap-4">
          <p className="flex items-center gap-2 text-sm font-medium" aria-hidden>
            <span className={`size-2 rounded-full bg-work-3 ${paused ? 'opacity-40' : ''}`} />
            <span className={paused ? 'text-fg-muted' : 'text-work-4'}>
              {paused ? 'Paused' : 'Working'}
            </span>
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => api.setFocusOpen(false)}
            aria-label={`Back to LOWTIDE (${workShortcutLabel()} returns here)`}
          >
            <Minimize2 aria-hidden className="size-3.5" /> Back to LOWTIDE
          </Button>
        </div>

        <div className="mt-8 sm:mt-12">
          <h2 className="text-[26px] leading-tight font-semibold tracking-tight sm:text-[32px]">
            {title}
          </h2>
          {subtitle && <p className="mt-1.5 text-lg text-fg-muted">{subtitle}</p>}
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
          <p
            role="timer"
            aria-label={`Session time ${shortDuration(activeMs(session, now))}${paused ? ', paused' : ''}`}
            className={`figure text-[clamp(3.75rem,13vw,7.5rem)] leading-none font-light tracking-tight transition-[color,opacity] duration-300 ${paused ? 'text-fg-muted' : 'text-fg'}`}
          >
            {longClock(activeMs(session, now))}
          </p>
          <p className="mt-4 text-sm text-fg-muted">
            {paused && lastPause
              ? `paused at ${timeOfDay(lastPause.at)}`
              : `working since ${timeOfDay(session.startedAt)}`}
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            {paused ? (
              <Button
                ref={primary}
                onClick={() => void api.resume()}
                className="h-11 min-w-32 px-5 text-sm"
              >
                <Play aria-hidden className="size-4" /> Resume
              </Button>
            ) : (
              <Button
                ref={primary}
                onClick={() => void api.pause()}
                className="h-11 min-w-32 px-5 text-sm"
              >
                <Pause aria-hidden className="size-4" /> Pause
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => void api.finish()}
              className="h-11 min-w-32 px-5 text-sm"
            >
              <Square aria-hidden className="size-4" /> Finish
            </Button>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-10 gap-y-4 border-t border-line pt-5 text-sm sm:flex sm:gap-16">
          <div>
            <dt className="text-xs text-fg-muted">Today</dt>
            <dd className="figure mt-0.5 text-lg font-semibold">{shortDuration(todayMs)}</dd>
          </div>
          {next && (
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <dt className="text-xs text-fg-muted">Next</dt>
              <dd className="mt-0.5 truncate text-[15px]">
                {withoutProjectPrefix(next, project?.name)}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}
