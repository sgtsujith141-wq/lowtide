import { format } from 'date-fns';
import { Moon, Sofa, Trash2 } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import { RecordStateError } from '../../db/repositories';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import { addDays } from '../../lib/calendar';
import { formatDuration } from '../../lib/duration';
import { fromLocalDate } from '../../lib/time';
import type { LocalDate } from '../../types/domain';
import { useModes } from '../modes/useModes';

const time = (at: string) => format(new Date(at), 'HH:mm');

/**
 * Sleep and off time: start a sleep or rest window yourself (never while
 * work runs), see recent windows as marked lengths (not measurements), and
 * declare days off ahead of time. Days off let the Daily Pulse judge a day on
 * rest (ADR-037). Protected time is separate and never scored (ADR-021).
 */
export function OffTimeArea({ today }: { today: LocalDate }) {
  const { offTime } = useRepositories();
  const modes = useModes();
  const watch = useMemo(
    () => offTime.watchRange(addDays(today, -14), addDays(today, 90)),
    [offTime, today],
  );
  const sessions = useWatch(watch);
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const dateId = useId();

  const list = sessions.status === 'ready' ? sessions.data : [];
  const windows = list
    .filter((s) => s.kind !== 'day_off' && s.endedAt && s.startedAt)
    .slice(-7)
    .reverse();
  const daysOff = list.filter((s) => s.kind === 'day_off' && s.localDate >= today);

  async function start(kind: 'sleep' | 'rest') {
    setError(null);
    try {
      await offTime.start(kind);
    } catch (e) {
      setError(
        e instanceof RecordStateError && modes.work
          ? 'Finish the work session first.'
          : 'Couldn’t start off time. Try again.',
      );
    }
  }

  async function declare(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await offTime.declareDayOff(date);
    } catch {
      setError('Couldn’t save that day off.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void start('sleep')} disabled={modes.offTime !== undefined}>
          <Moon aria-hidden className="size-4" /> Start sleep window
        </Button>
        <Button onClick={() => void start('rest')} disabled={modes.offTime !== undefined}>
          <Sofa aria-hidden className="size-4" /> Start rest
        </Button>
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}

      <div>
        <h3 className="text-xs font-semibold text-fg-muted">Recent windows</h3>
        {windows.length === 0 ? (
          <p className="py-2 text-sm text-fg-muted">No off time marked in the last two weeks.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {windows.map((w) => {
              const minutes = Math.round(
                (Date.parse(w.endedAt!) - Date.parse(w.startedAt!)) / 60_000,
              );
              return (
                <li key={w.id} className="flex items-baseline gap-3 py-1.5 text-sm">
                  <span className="w-24 shrink-0 text-fg-muted">
                    {format(fromLocalDate(w.localDate), 'EEE d MMM')}
                  </span>
                  <span className="min-w-0 flex-1">
                    {w.kind === 'sleep' ? 'Sleep window' : 'Rest'} {time(w.startedAt!)}–
                    {time(w.endedAt!)}
                  </span>
                  <span className="tabular-nums">{formatDuration(minutes)} marked</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-1 text-[11px] text-fg-muted">
          Lengths are the windows you marked, not how long you slept.
        </p>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-fg-muted">Days off</h3>
        <form onSubmit={(e) => void declare(e)} className="mt-1 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={dateId} className={labelClass}>
              Day
            </label>
            <input
              id={dateId}
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value)}
              className={`${fieldClass} w-auto`}
            />
          </div>
          <Button type="submit">Declare a day off</Button>
        </form>
        {daysOff.length > 0 && (
          <ul aria-label="Upcoming days off" className="mt-2 divide-y divide-line">
            {daysOff.map((d) => (
              <li key={d.id} className="flex items-center gap-2 py-1 text-sm">
                <span className="flex-1">
                  {format(fromLocalDate(d.localDate), 'EEEE d MMMM')}
                  {d.localDate === today && <span className="ml-1 text-fg-muted">(today)</span>}
                </span>
                <IconButton
                  label={`Remove day off ${format(fromLocalDate(d.localDate), 'EEEE d MMMM')}`}
                  icon={<Trash2 aria-hidden className="size-4" />}
                  onClick={() => void offTime.removeDayOff(d.localDate)}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[11px] text-fg-muted">
          A declared day off can still have a strong Daily Pulse: rest counts.
        </p>
      </div>
    </div>
  );
}
