import { format } from 'date-fns';
import { BookOpen, Check, Plus, Trash2, X } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import { addDays, startOfWeek } from '../../lib/calendar';
import { formatDuration } from '../../lib/duration';
import { fromLocalDate } from '../../lib/time';
import {
  COLLEGE_KINDS,
  type CollegeItem,
  type CollegeKind,
  type CollegeStatus,
  type LocalDate,
} from '../../types/domain';
import { useModeApi } from '../modes/mode-context';
import { useModes } from '../modes/useModes';
import { activeMinutes } from '../work/duration';

const KIND_LABEL: Record<CollegeKind, string> = {
  class: 'Class',
  lab: 'Lab',
  assignment: 'Assignment',
  exam: 'Exam',
  event: 'Event',
};

const STATUS_LABEL: Record<CollegeStatus, string> = {
  planned: 'planned',
  attended: 'attended',
  missed: 'missed',
  done: 'done',
  cancelled: 'cancelled',
};

const attendable = (item: CollegeItem) => item.kind === 'class' || item.kind === 'lab';

/**
 * College: today's classes and labs (attended or missed, recorded plainly),
 * coursework and events coming up (done when done), study time this week
 * (college work sessions), and a quick Start study.
 */
export function CollegeArea({ today }: { today: LocalDate }) {
  const { college, work } = useRepositories();
  const modeApi = useModeApi();
  const modes = useModes();
  const watchItems = useMemo(
    () => college.watchRange(addDays(today, -7), addDays(today, 30)),
    [college, today],
  );
  const items = useWatch(watchItems);
  const weekStart = startOfWeek(today);
  const watchStudy = useMemo(() => work.watchRange(weekStart, today), [work, weekStart, today]);
  const study = useWatch(watchStudy);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = items.status === 'ready' ? items.data : [];
  const todays = list.filter((i) => i.date === today);
  const upcoming = list.filter((i) => i.date > today && i.status === 'planned');
  const overdue = list.filter((i) => i.date < today && !attendable(i) && i.status === 'planned');
  const studyMinutes =
    study.status === 'ready'
      ? study.data
          .filter((s) => s.kind === 'college' && s.endedAt)
          .reduce((sum, s) => sum + activeMinutes(s), 0)
      : 0;

  async function setStatus(item: CollegeItem, status: CollegeStatus) {
    setError(null);
    try {
      await college.update(item.id, { status });
    } catch {
      setError('Couldn’t update that. Nothing changed.');
    }
  }

  async function startStudy() {
    setError(null);
    try {
      await modeApi.startWork({ kind: 'college', intent: 'Study' });
    } catch {
      setError('Couldn’t start a study session. Is something else running?');
    }
  }

  const row = (item: CollegeItem) => (
    <li key={item.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
      <span className="w-20 shrink-0 text-[11px] text-fg-muted">{KIND_LABEL[item.kind]}</span>
      <span className="min-w-0 flex-1">
        <span className={item.status === 'cancelled' ? 'text-fg-muted line-through' : ''}>
          {item.title}
        </span>
        {item.course && <span className="ml-1 text-xs text-fg-muted">· {item.course}</span>}
        {item.date !== today && (
          <span className="ml-1 text-xs text-fg-muted">
            · {format(fromLocalDate(item.date), 'EEE d MMM')}
          </span>
        )}
        {item.status !== 'planned' && (
          <span className="ml-2 text-xs text-fg-muted">({STATUS_LABEL[item.status]})</span>
        )}
      </span>
      {attendable(item) ? (
        <>
          <IconButton
            label={`Attended: ${item.title}`}
            icon={<Check aria-hidden className="size-4" />}
            aria-pressed={item.status === 'attended'}
            onClick={() => void setStatus(item, 'attended')}
          />
          <IconButton
            label={`Missed: ${item.title}`}
            icon={<X aria-hidden className="size-4" />}
            aria-pressed={item.status === 'missed'}
            onClick={() => void setStatus(item, 'missed')}
          />
        </>
      ) : (
        <IconButton
          label={`${item.status === 'done' ? 'Not done' : 'Done'}: ${item.title}`}
          icon={<Check aria-hidden className="size-4" />}
          aria-pressed={item.status === 'done'}
          onClick={() => void setStatus(item, item.status === 'done' ? 'planned' : 'done')}
        />
      )}
      <IconButton
        label={`Remove: ${item.title}`}
        icon={<Trash2 aria-hidden className="size-4" />}
        onClick={() => void college.remove(item.id)}
      />
    </li>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <p className="text-sm">
          <span className="figure text-2xl font-semibold">{formatDuration(studyMinutes)}</span>
          <span className="ml-2 text-xs text-fg-muted">studied this week</span>
        </p>
        {!modes.work && !modes.offTime && (
          <Button onClick={() => void startStudy()}>
            <BookOpen aria-hidden className="size-4" /> Start study
          </Button>
        )}
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}

      <section aria-label="College today">
        <h3 className="text-xs font-semibold text-fg-muted">Today</h3>
        {todays.length === 0 ? (
          <p className="py-2 text-sm text-fg-muted">Nothing scheduled today.</p>
        ) : (
          <ul className="divide-y divide-line">{todays.map(row)}</ul>
        )}
      </section>

      {(overdue.length > 0 || upcoming.length > 0) && (
        <section aria-label="College coming up">
          <h3 className="text-xs font-semibold text-fg-muted">Coming up</h3>
          <ul className="divide-y divide-line">
            {overdue.map(row)}
            {upcoming.map(row)}
          </ul>
        </section>
      )}

      {adding ? (
        <NewCollegeItem today={today} onDone={() => setAdding(false)} />
      ) : (
        <Button variant="ghost" onClick={() => setAdding(true)}>
          <Plus aria-hidden className="size-4" /> Add class, lab, assignment or event
        </Button>
      )}
    </div>
  );
}

function NewCollegeItem({ today, onDone }: { today: LocalDate; onDone: () => void }) {
  const { college } = useRepositories();
  const [kind, setKind] = useState<CollegeKind>('class');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [course, setCourse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ids = { kind: useId(), title: useId(), date: useId(), course: useId() };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return setError('Give it a title.');
    try {
      await college.create({ kind, title, date, course });
      onDone();
    } catch {
      setError('Couldn’t add that. Nothing changed.');
    }
  }

  return (
    <form
      aria-label="Add to college"
      onSubmit={(e) => void submit(e)}
      className="grid max-w-2xl gap-3 rounded-lg border border-line bg-raised p-4 sm:grid-cols-2"
    >
      <div>
        <label htmlFor={ids.kind} className={labelClass}>
          Kind
        </label>
        <select
          id={ids.kind}
          value={kind}
          onChange={(e) => setKind(e.target.value as CollegeKind)}
          className={fieldClass}
        >
          {COLLEGE_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={ids.date} className={labelClass}>
          Date
        </label>
        <input
          id={ids.date}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor={ids.title} className={labelClass}>
          Title
        </label>
        <input
          id={ids.title}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor={ids.course} className={labelClass}>
          Course (optional)
        </label>
        <input
          id={ids.course}
          value={course}
          onChange={(e) => setCourse(e.target.value)}
          className={fieldClass}
        />
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="primary">
          Add
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
