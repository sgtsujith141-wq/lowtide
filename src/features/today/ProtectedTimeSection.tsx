import { Pencil, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import { addDays } from '../../lib/calendar';
import type { LocalDate, ProtectedTime } from '../../types/domain';
import { ProtectedTimeForm } from './ProtectedTimeForm';
import { KIND_ICON, KIND_LABEL } from './protected-time-kinds';
import { SectionHeading } from './SectionHeading';
import { groupByDay, weekAhead, WEEK_LENGTH, type WeekDay } from './week';

/** Where focus goes after an update; `date` = wait until the entry is shown on that day. */
type Focus = { entry: string; date?: LocalDate } | { add: LocalDate };

/**
 * Protected time for today and the next six days (ADR-021, ADR-035): what
 * time do I want to keep for people and rest this week? Entries are plans,
 * not tasks: no checkbox, no "done", no counts. Add on any of the seven
 * days, edit (including moving to another day), remove.
 */
export function ProtectedTimeSection({ date: today }: { date: LocalDate }) {
  const { protectedTime } = useRepositories();
  const days = useMemo(() => weekAhead(today), [today]);
  const watch = useMemo(
    () => protectedTime.watchRange(today, addDays(today, WEEK_LENGTH - 1)),
    [protectedTime, today],
  );
  const entries = useWatch(watch);
  const [addingOn, setAddingOn] = useState<LocalDate | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const focusAfterUpdate = useRef<Focus | null>(null);

  const groups = useMemo(
    () => groupByDay(days, entries.status === 'ready' ? entries.data : []),
    [days, entries],
  );
  const dayOf = (date: LocalDate) => days.find((d) => d.date === date);

  const find = (target: Focus) =>
    document.querySelector<HTMLButtonElement>(
      'entry' in target
        ? `[data-pt-edit="${CSS.escape(target.entry)}"]`
        : `[data-pt-add="${CSS.escape(target.add)}"]`,
    );

  // After a save or removal, move focus once the list shows the result: the
  // entry's Edit button, or that day's Add button.
  useEffect(() => {
    const target = focusAfterUpdate.current;
    if (!target) return;
    // After a move, the entry's old row may still be on screen; wait for the data
    // to show it on its new day, or focus would land on a row about to unmount.
    if ('entry' in target && target.date) {
      const moved =
        entries.status === 'ready' &&
        entries.data.some((e) => e.id === target.entry && e.date === target.date);
      if (!moved) return;
    }
    const el = find(target);
    if (!el) return;
    focusAfterUpdate.current = null;
    el.focus();
  }, [entries, editingId, addingOn]);

  function focusSoon(target: Focus) {
    focusAfterUpdate.current = target;
    requestAnimationFrame(() => {
      const el = find(target);
      if (el && focusAfterUpdate.current === target) {
        focusAfterUpdate.current = null;
        el.focus();
      }
    });
  }

  async function remove(entry: ProtectedTime) {
    setError(null);
    try {
      await protectedTime.remove(entry.id);
      setAnnouncement(`Removed: ${entry.title}`);
      // The day's Add button always exists, so focus it now; waiting for the
      // list update could miss it (the update may arrive before this line).
      find({ add: entry.date })?.focus();
    } catch {
      setError('Couldn’t remove that. Nothing changed.');
    }
  }

  function renderEntry(entry: ProtectedTime, day: WeekDay) {
    if (editingId === entry.id) {
      return (
        <li key={entry.id} className="basis-full">
          <ProtectedTimeForm
            initial={{
              title: entry.title,
              date: entry.date,
              kind: entry.kind,
              notes: entry.notes ?? '',
            }}
            days={days}
            formLabel={`Edit protected time: ${entry.title}`}
            submitLabel="Save"
            onSave={async (draft) => {
              await protectedTime.update(entry.id, draft);
              setEditingId(null);
              const moved = draft.date !== entry.date ? ` (now ${dayOf(draft.date)?.word})` : '';
              setAnnouncement(`Saved: ${draft.title.trim()}${moved}`);
              focusAfterUpdate.current = { entry: entry.id, date: draft.date };
            }}
            onCancel={() => {
              setEditingId(null);
              focusSoon({ entry: entry.id });
            }}
          />
        </li>
      );
    }
    const Icon = KIND_ICON[entry.kind];
    return (
      <li key={entry.id} className="flex items-start gap-2.5 py-1">
        <Icon aria-hidden className="mt-1 size-4 shrink-0 text-accent-ink" />
        <div className="min-w-0 flex-1">
          <p className="break-words">{entry.title}</p>
          <p className="mt-0.5 text-xs break-words text-fg-muted">
            {KIND_LABEL[entry.kind]}
            {entry.notes && <span> · {entry.notes}</span>}
          </p>
        </div>
        <div className="-my-1 flex shrink-0">
          <IconButton
            label={`Edit ${entry.title} (${day.word})`}
            icon={<Pencil aria-hidden className="size-4" />}
            data-pt-edit={entry.id}
            onClick={() => setEditingId(entry.id)}
          />
          <IconButton
            label={`Remove ${entry.title} (${day.word})`}
            icon={<X aria-hidden className="size-4" />}
            onClick={() => void remove(entry)}
          />
        </div>
      </li>
    );
  }

  return (
    <section aria-labelledby="protected-heading" className="mt-7">
      <SectionHeading id="protected-heading">Protected time</SectionHeading>
      <p className="mt-1 text-xs text-fg-muted">This week: today and the next six days.</p>

      {error && <ErrorNotice>{error}</ErrorNotice>}
      {entries.status === 'error' && (
        <ErrorNotice>Couldn’t read protected time. Try reloading.</ErrorNotice>
      )}

      {entries.status === 'ready' && (
        <ol aria-label="Protected time this week" className="mt-1">
          {groups.map(({ day, entries: dayEntries }) => {
            const headingId = `pt-day-${day.date}`;
            return (
              <li
                key={day.date}
                aria-labelledby={headingId}
                className="flex flex-wrap items-start gap-x-3 border-b border-line py-1.5"
              >
                <h3 id={headingId} className="w-20 shrink-0 pt-0.5 text-sm sm:w-28">
                  <span className={day.heading === 'Today' ? 'font-medium' : ''}>
                    {day.heading}
                  </span>{' '}
                  <span className="block text-xs text-fg-muted">{day.short}</span>
                </h3>
                <div className="min-w-0 flex-1">
                  {dayEntries.length === 0 ? (
                    <p className="pt-0.5 text-sm text-fg-muted">Nothing planned here yet.</p>
                  ) : (
                    <ul className="border-l-2 border-accent-soft pl-3">
                      {dayEntries.map((entry) => renderEntry(entry, day))}
                    </ul>
                  )}
                </div>
                <IconButton
                  label={`Add protected time for ${day.word}`}
                  icon={<Plus aria-hidden className="size-4" />}
                  data-pt-add={day.date}
                  onClick={() => {
                    setEditingId(null);
                    setAddingOn(day.date);
                  }}
                  className="-my-0.5"
                />
                {addingOn === day.date && (
                  <div className="basis-full">
                    <ProtectedTimeForm
                      initial={{ title: '', date: day.date, kind: 'relationship', notes: '' }}
                      days={days}
                      formLabel={`Protect time on ${day.word}`}
                      submitLabel="Add"
                      onSave={async (draft) => {
                        const entry = await protectedTime.create(draft);
                        setAddingOn(null);
                        setAnnouncement(`Protected: ${entry.title} (${dayOf(entry.date)?.word})`);
                        focusAfterUpdate.current = { entry: entry.id, date: entry.date };
                      }}
                      onCancel={() => {
                        setAddingOn(null);
                        focusSoon({ add: day.date });
                      }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <Announcer message={announcement} />
    </section>
  );
}
