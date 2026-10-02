import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { fieldClass } from '../../components/ui/styles';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import type { Habit } from '../../types/domain';
import { RangeGrid } from '../../components/shared/RangeGrid';
import { gridStart, YEAR_WEEKS } from '../../components/shared/contribution-grid';
import { segmentClass, segmentedClass } from '../../components/ui/styles';
import { describeDay, gridDays, type ThemedGrid } from '../pulse/days';
import { useDaySummaries } from '../pulse/useDaySummaries';
import { buildGrid, RHYTHM_GROUPS, type GridView } from './grid';
import { gridDaysOf, viewPalette } from './palette';
import { HabitForm } from './HabitForm';
import { HabitLogRow } from './HabitLogRow';
import { CATEGORY_LABEL } from './labels';

function describeHabit(habit: Habit): string {
  const unit =
    habit.unit === 'check'
      ? 'done or not'
      : habit.target
        ? `${habit.target}${habit.unit === 'minutes' ? ' min' : ''} a day`
        : habit.unit === 'minutes'
          ? 'minutes'
          : 'count';
  return `${CATEGORY_LABEL[habit.category]} · ${unit}`;
}

type Category = ThemedGrid | 'routines';

const CATEGORIES: { id: Category; label: string; name: string }[] = [
  { id: 'pulse', label: 'Overall', name: 'Daily Pulse' },
  { id: 'work', label: 'Work', name: 'Work' },
  { id: 'sleep', label: 'Sleep', name: 'Sleep' },
  { id: 'projects', label: 'Projects', name: 'Projects' },
  { id: 'college', label: 'College', name: 'College' },
  { id: 'personal', label: 'Personal', name: 'Personal' },
  { id: 'gym', label: 'Gym', name: 'Gym' },
  { id: 'routines', label: 'Routines', name: 'Routines' },
];

/**
 * Rhythm: where you've been showing up. A contribution-style grid (overall or
 * one habit), today's quick log, and a short list to manage habits. No scores,
 * streaks or "missed" states (ADR-023–026).
 */
export function RhythmPage() {
  useDocumentTitle('Rhythm');
  const today = useToday();
  const { habits } = useRepositories();
  const all = useWatch(habits.watchAll);
  // A year of entries: the grid's range switch goes up to 12 months.
  const range = useMemo(() => ({ start: gridStart(today, YEAR_WEEKS), end: today }), [today]);
  const watchEntries = useMemo(
    () => habits.watchEntries(range.start, range.end),
    [habits, range.start, range.end],
  );
  const entries = useWatch(watchEntries);
  const [viewId, setViewId] = useState('overall');
  const [category, setCategory] = useState<Category>('pulse');
  const [selected, setSelected] = useState<string | null>(null);
  const { days: summaries } = useDaySummaries(range.start, range.end);
  const categoryGroup = useId();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const newButton = useRef<HTMLButtonElement>(null);
  const focusAfterUpdate = useRef<string | null>(null);
  const selectId = useId();

  const habitList = useMemo(() => (all.status === 'ready' ? all.data : []), [all]);
  const active = habitList.filter((h) => !h.archived);
  const archived = habitList.filter((h) => h.archived);
  const entryList = useMemo(() => (entries.status === 'ready' ? entries.data : []), [entries]);
  // The selector only changes the history grid; today's logging always lists
  // every active rhythm (ADR-036).
  const view = useMemo<GridView>(() => {
    const group = RHYTHM_GROUPS.find((g) => `group:${g.id}` === viewId);
    if (group) return { kind: 'group', groupId: group.id };
    if (habitList.some((h) => h.id === viewId)) return { kind: 'habit', habitId: viewId };
    return { kind: 'overall' };
  }, [viewId, habitList]);
  const days = useMemo(
    () =>
      category === 'routines'
        ? gridDaysOf(buildGrid(today, habitList, entryList, view, YEAR_WEEKS + 1))
        : gridDays(summaries, category),
    [today, habitList, entryList, view, category, summaries],
  );
  const selectedDetail =
    selected && category !== 'routines'
      ? (() => {
          const d = summaries.get(selected);
          return d ? describeDay(d) : [];
        })()
      : null;
  const todayEntries = new Map(
    entryList.filter((e) => e.date === today).map((e) => [e.habitId, e]),
  );
  const viewLabel =
    view.kind === 'habit'
      ? (habitList.find((h) => h.id === view.habitId)?.name ?? 'All rhythms')
      : view.kind === 'group'
        ? RHYTHM_GROUPS.find((g) => g.id === view.groupId)!.label
        : 'All rhythms';

  // After a save, focus the habit's Edit button once the list shows it.
  useEffect(() => {
    const id = focusAfterUpdate.current;
    const button =
      id && document.querySelector<HTMLButtonElement>(`[data-habit-edit="${CSS.escape(id)}"]`);
    if (!button) return;
    focusAfterUpdate.current = null;
    button.focus();
  }, [all, editingId, adding]);

  async function setArchived(habit: Habit, archive: boolean) {
    setError(null);
    try {
      await (archive ? habits.archive(habit.id) : habits.restore(habit.id));
      setAnnouncement(
        archive ? `Archived ${habit.name}. Its history stays.` : `Restored ${habit.name}.`,
      );
      newButton.current?.focus();
    } catch {
      setError('Couldn’t change that. Nothing changed.');
    }
  }

  if (all.status === 'loading') return null;

  return (
    <>
      <h1 className="text-page font-semibold">Rhythm</h1>

      {all.status === 'error' && (
        <ErrorNotice>Couldn’t read your rhythms. Try reloading.</ErrorNotice>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}

      <section aria-labelledby="grid-heading" className="mt-6">
        <h2 id="grid-heading" className="sr-only">
          History
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <span id={categoryGroup} className="sr-only">
            History of
          </span>
          <div
            role="radiogroup"
            aria-labelledby={categoryGroup}
            className={`${segmentedClass} max-w-full overflow-x-auto`}
          >
            {CATEGORIES.map((c) => (
              <label key={c.id} className={segmentClass(c.id === category)}>
                <input
                  type="radio"
                  name={categoryGroup}
                  value={c.id}
                  checked={c.id === category}
                  onChange={() => {
                    setCategory(c.id);
                    setSelected(null);
                  }}
                  className="sr-only"
                />
                {c.label}
              </label>
            ))}
          </div>
          {category === 'routines' && habitList.length > 0 && (
            <label htmlFor={selectId} className="flex items-center gap-2 text-xs text-fg-muted">
              Show
              <select
                id={selectId}
                value={
                  view.kind === 'overall'
                    ? 'overall'
                    : view.kind === 'group'
                      ? `group:${view.groupId}`
                      : view.habitId
                }
                onChange={(e) => setViewId(e.target.value)}
                className={`${fieldClass} w-auto py-1 text-sm`}
              >
                <option value="overall">All rhythms</option>
                <optgroup label="Groups">
                  {RHYTHM_GROUPS.map((g) => (
                    <option key={g.id} value={`group:${g.id}`}>
                      {g.label}
                    </option>
                  ))}
                </optgroup>
                {active.length > 0 && (
                  <optgroup label="Rhythms">
                    {active.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {archived.length > 0 && (
                  <optgroup label="Archived">
                    {archived.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          )}
        </div>
        <div className="mt-4">
          {category === 'routines' && habitList.length === 0 ? (
            <p className="text-sm text-fg-muted">No routines yet.</p>
          ) : (
            <RangeGrid
              key={category}
              name={
                category === 'routines'
                  ? viewLabel
                  : CATEGORIES.find((c) => c.id === category)!.name
              }
              today={today}
              days={days}
              palette={category === 'routines' ? viewPalette(view, habitList) : category}
              initial={category === 'routines' ? '182' : '365'}
              size="lg"
              selected={selected}
              onSelect={(d) => setSelected((s) => (s === d ? null : d))}
              showDetail
              surface="canvas"
            />
          )}
        </div>
        {selectedDetail && (
          <div
            role="region"
            aria-label="Selected day"
            className="mt-4 max-w-[40rem] border-l-2 border-line pl-4 text-sm"
          >
            <p className="font-medium">
              {new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </p>
            {selectedDetail.length === 0 ? (
              <p className="text-fg-muted">Nothing recorded.</p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-fg-muted">
                {selectedDetail.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {active.length > 0 && (
        <section aria-labelledby="today-log-heading" className="mt-7">
          <h2
            id="today-log-heading"
            className="border-b border-line pb-2 text-section font-semibold"
          >
            Today
          </h2>
          <ul>
            {active.map((habit) => (
              <HabitLogRow
                key={habit.id}
                habit={habit}
                entry={todayEntries.get(habit.id)}
                today={today}
                onChange={setAnnouncement}
              />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="rhythms-heading" className="mt-7">
        <div className="flex min-h-8 items-end justify-between gap-3 border-b border-line pb-1">
          <h2 id="rhythms-heading" className="text-section font-semibold">
            Your rhythms
          </h2>
          {!adding && (
            <Button
              ref={newButton}
              variant="ghost"
              onClick={() => setAdding(true)}
              className="-mr-2.5 h-7"
            >
              <Plus aria-hidden className="size-4" />
              New rhythm
            </Button>
          )}
        </div>

        {adding && (
          <HabitForm
            initial={{ name: '', category: 'coding', unit: 'check', target: '' }}
            unitLocked={false}
            submitLabel="Add"
            formLabel="New rhythm"
            onSave={async ({ name, category, unit, target }) => {
              const habit = await habits.create({
                name,
                category,
                unit,
                ...(target === null ? {} : { target }),
              });
              setAdding(false);
              setAnnouncement(`Added ${habit.name}.`);
              focusAfterUpdate.current = habit.id;
            }}
            onCancel={() => {
              setAdding(false);
              requestAnimationFrame(() => newButton.current?.focus());
            }}
          />
        )}

        <ul>
          {active.map((habit) =>
            editingId === habit.id ? (
              <li key={habit.id}>
                <HabitForm
                  initial={{
                    name: habit.name,
                    category: habit.category,
                    unit: habit.unit,
                    target: habit.target ? String(habit.target) : '',
                  }}
                  unitLocked
                  submitLabel="Save"
                  formLabel={`Edit ${habit.name}`}
                  onSave={async ({ name, category, target }) => {
                    await habits.update(habit.id, {
                      name,
                      category,
                      ...(habit.unit === 'check' ? {} : { target }),
                    });
                    setEditingId(null);
                    setAnnouncement(`Saved ${name.trim()}.`);
                    focusAfterUpdate.current = habit.id;
                  }}
                  onCancel={() => {
                    setEditingId(null);
                    focusAfterUpdate.current = habit.id;
                  }}
                />
              </li>
            ) : (
              <li key={habit.id} className="flex items-center gap-2 border-b border-line py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="break-words">{habit.name}</span>
                  <span className="ml-1 text-xs text-fg-muted"> {describeHabit(habit)}</span>
                </span>
                <IconButton
                  label={`Edit ${habit.name}`}
                  icon={<Pencil aria-hidden className="size-4" />}
                  data-habit-edit={habit.id}
                  onClick={() => setEditingId(habit.id)}
                />
                <IconButton
                  label={`Archive ${habit.name}`}
                  icon={<Archive aria-hidden className="size-4" />}
                  onClick={() => void setArchived(habit, true)}
                />
              </li>
            ),
          )}
        </ul>

        {archived.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-fg-muted select-none hover:text-fg">
              Archived · {archived.length}
            </summary>
            <p className="mt-1 text-xs text-fg-muted">
              Archived rhythms keep their history; pick one under “Show” to see it.
            </p>
            <ul className="mt-1">
              {archived.map((habit) => (
                <li key={habit.id} className="flex items-center gap-2 border-b border-line py-1.5">
                  <span className="min-w-0 flex-1 text-fg-muted">
                    <span className="break-words">{habit.name}</span>
                    <span className="ml-1 text-xs"> {describeHabit(habit)}</span>
                  </span>
                  <Button
                    variant="ghost"
                    aria-label={`Restore ${habit.name}`}
                    onClick={() => void setArchived(habit, false)}
                  >
                    <ArchiveRestore aria-hidden className="size-4" />
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <Announcer message={announcement} />
    </>
  );
}
