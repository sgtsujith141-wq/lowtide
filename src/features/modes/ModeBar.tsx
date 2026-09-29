import { Moon, Pause, Play, Square, Sunrise } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { useNow } from '../../hooks/useNow';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import type { OffTimeSession, WorkSession } from '../../types/domain';
import { activeMs, clock, isPaused } from '../work/duration';
import { useModes } from './useModes';
import { useWorkLabel } from './work-label';

/**
 * The global mode strip under the header: a running work session (timer,
 * pause/resume, finish, today's total) or an open off-time window (timer,
 * Wake up). Renders nothing when neither is running.
 */
export function ModeBar() {
  const { work, offTime } = useModes();
  if (offTime) return <OffTimeStrip session={offTime} />;
  if (work) return <WorkStrip session={work} />;
  return null;
}

function WorkStrip({ session }: { session: WorkSession }) {
  const { work } = useRepositories();
  const paused = isPaused(session);
  const now = useNow(!paused);
  const label = useWorkLabel(session);
  const today = useToday();
  const watchToday = useMemo(() => work.watchRange(today, today), [work, today]);
  const todays = useWatch(watchToday);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const todayMs =
    todays.status === 'ready'
      ? todays.data.reduce((sum, s) => sum + (s.id === session.id ? 0 : activeMs(s, now)), 0) +
        activeMs(session, now)
      : activeMs(session, now);

  async function run(action: () => Promise<unknown>, done: string) {
    setError(null);
    try {
      await action();
      setAnnouncement(done);
    } catch {
      setError('Couldn’t update the work session. Nothing changed.');
    }
  }

  return (
    <section
      aria-label="Work session"
      className="border-b border-line bg-work-1/40 px-4 py-2 md:px-10"
    >
      <div className="flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1.5">
        <span
          aria-hidden
          className={`size-2 rounded-full bg-work-3 ${paused ? '' : 'motion-safe:animate-pulse'}`}
        />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-medium">{paused ? 'Paused' : 'Working'}</span>
          <span className="text-ink-muted"> · {label}</span>
        </p>
        <p className="font-mono text-sm tabular-nums" aria-label="Session time">
          {clock(activeMs(session, now))}
        </p>
        <p className="text-xs text-ink-muted tabular-nums">today {clock(todayMs)}</p>
        <div className="flex gap-1.5">
          {paused ? (
            <Button onClick={() => void run(() => work.resume(session.id), 'Work resumed')}>
              <Play aria-hidden className="size-3.5" /> Resume
            </Button>
          ) : (
            <Button onClick={() => void run(() => work.pause(session.id), 'Work paused')}>
              <Pause aria-hidden className="size-3.5" /> Pause
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => void run(() => work.finish(session.id), 'Work session finished')}
          >
            <Square aria-hidden className="size-3.5" /> Finish
          </Button>
        </div>
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Announcer message={announcement} />
    </section>
  );
}

function OffTimeStrip({ session }: { session: OffTimeSession }) {
  const { offTime } = useRepositories();
  const now = useNow(true, 15_000);
  const [error, setError] = useState<string | null>(null);
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - Date.parse(session.startedAt!)) / 60_000),
  );
  const h = Math.floor(minutes / 60);

  return (
    <section
      aria-label="Off time"
      className="border-b border-sleep-2 bg-sleep-1 px-4 py-3 text-ink md:px-10"
    >
      <div className="flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2">
        <Moon aria-hidden className="size-5 text-sleep-4" />
        <p className="min-w-0 flex-1">
          <span className="font-medium">{session.kind === 'sleep' ? 'Sleep Mode' : 'Resting'}</span>
          <span className="text-ink-muted">
            {' '}
            · off for {h ? `${h} h ` : ''}
            {minutes % 60} m
          </span>
          <span className="block text-xs text-ink-muted">
            A marked window, not a sleep measurement. Everything still works.
          </span>
        </p>
        <Button
          variant="primary"
          onClick={() => {
            setError(null);
            offTime.end(session.id).catch(() => setError('Couldn’t end off time. Try again.'));
          }}
        >
          <Sunrise aria-hidden className="size-4" /> Wake up
        </Button>
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
    </section>
  );
}
