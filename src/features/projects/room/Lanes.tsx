import { Check, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Button, IconButton } from '../../../components/ui/Button';
import { ErrorNotice } from '../../../components/ui/Notice';
import { fieldClass, labelClass } from '../../../components/ui/styles';
import { useRepositories } from '../../../hooks/useRepositories';
import {
  PROJECT_ITEM_KINDS,
  PROJECT_LANES,
  type ProjectItem,
  type ProjectItemKind,
  type ProjectLane,
  type Task,
} from '../../../types/domain';
import { LANE_LABEL, type LaneEntry } from '../summary';

const KIND_LABEL: Record<ProjectItemKind, string> = {
  focus: 'Focus',
  step: 'Next step',
  dependency: 'Waiting on',
  approval: 'Approval',
  blocker: 'Blocker',
  idea: 'Idea (park it)',
  note: 'Note',
};

const LANE_STYLE: Record<ProjectLane, string> = {
  working_now: 'border-t-accent',
  next: 'border-t-line-strong',
  waiting: 'border-t-sleep-3',
  needs_approval: 'border-t-work-3',
  blocked: 'border-t-danger',
  parked: 'border-t-line',
  done: 'border-t-pulse-3',
};

const MOVABLE: Exclude<ProjectLane, 'done'>[] = PROJECT_LANES.filter(
  (l): l is Exclude<ProjectLane, 'done'> => l !== 'done',
);

/**
 * The command lanes: Working now, Next, Waiting, Needs approval, Blocked,
 * Parked, Done. Items can move between lanes (open approvals and blockers
 * only leave by being resolved); tasks show by their own status.
 */
export function Lanes({
  projectId,
  lanes,
  items,
  tasks,
}: {
  projectId: string;
  lanes: Record<ProjectLane, LaneEntry[]>;
  items: readonly ProjectItem[];
  tasks: readonly Task[];
}) {
  const { projects } = useRepositories();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const byId = new Map(items.map((i) => [i.id, i]));

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch {
      setError(
        'That move isn’t possible. Open approvals and blockers leave only by being resolved.',
      );
    }
  }

  return (
    <div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {PROJECT_LANES.map((lane) => {
          const entries = lane === 'done' ? lanes.done.slice(-6).reverse() : lanes[lane];
          return (
            <section
              key={lane}
              aria-label={LANE_LABEL[lane]}
              className={`rounded-lg border border-t-4 border-line bg-paper-raised p-2.5 ${LANE_STYLE[lane]} ${
                entries.length === 0 ? 'border-dashed' : ''
              }`}
            >
              <h3 className="flex items-baseline justify-between text-xs font-semibold tracking-wide text-ink-muted uppercase">
                {LANE_LABEL[lane]}
                <span className="font-normal tabular-nums">{lanes[lane].length}</span>
              </h3>
              {entries.length === 0 ? (
                <p className="mt-1 text-xs text-ink-muted">Empty</p>
              ) : (
                <ul className="mt-1.5 space-y-1.5">
                  {entries.map((entry) => {
                    const item = entry.kind === 'item' ? byId.get(entry.id) : undefined;
                    return (
                      <li
                        key={`${entry.kind}-${entry.id}`}
                        className="rounded-md bg-paper px-2 py-1.5 text-sm leading-snug"
                      >
                        <p
                          className={
                            lane === 'done'
                              ? 'text-ink-muted line-through decoration-ink-faint'
                              : ''
                          }
                        >
                          {entry.title}
                        </p>
                        {entry.detail && (
                          <p className="text-xs text-ink-muted">on {entry.detail}</p>
                        )}
                        {entry.kind === 'task' && (
                          <p className="text-[10px] text-ink-muted uppercase">task</p>
                        )}
                        {item && (
                          <ItemControls
                            item={item}
                            onMove={(to) => void run(() => projects.moveItem(item.id, to))}
                            onResolve={() => void run(() => projects.resolveItem(item.id))}
                            onReopen={() => void run(() => projects.reopenItem(item.id))}
                            onRemove={() => void run(() => projects.removeItem(item.id))}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="mt-3">
        {adding ? (
          <NewItemForm projectId={projectId} tasks={tasks} onDone={() => setAdding(false)} />
        ) : (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" /> Add to the board
          </Button>
        )}
      </div>
    </div>
  );
}

function ItemControls({
  item,
  onMove,
  onResolve,
  onReopen,
  onRemove,
}: {
  item: ProjectItem;
  onMove: (lane: Exclude<ProjectLane, 'done'>) => void;
  onResolve: () => void;
  onReopen: () => void;
  onRemove: () => void;
}) {
  const locked = item.kind === 'approval' || item.kind === 'blocker';
  if (item.lane === 'done') {
    return (
      <div className="mt-1 flex gap-0.5">
        <IconButton
          label={`Reopen: ${item.title}`}
          icon={<RotateCcw aria-hidden className="size-3.5" />}
          onClick={onReopen}
          className="size-7"
        />
        <IconButton
          label={`Remove: ${item.title}`}
          icon={<Trash2 aria-hidden className="size-3.5" />}
          onClick={onRemove}
          className="size-7"
        />
      </div>
    );
  }
  return (
    <div className="mt-1 flex items-center gap-0.5">
      {!locked && (
        <select
          aria-label={`Move ${item.title} to`}
          value=""
          onChange={(e) => e.target.value && onMove(e.target.value as Exclude<ProjectLane, 'done'>)}
          className="h-7 max-w-28 rounded border border-line bg-paper-raised px-1 text-xs text-ink-muted"
        >
          <option value="">Move…</option>
          {MOVABLE.filter((l) => l !== item.lane).map((l) => (
            <option key={l} value={l}>
              {LANE_LABEL[l]}
            </option>
          ))}
        </select>
      )}
      <IconButton
        label={`${item.kind === 'approval' ? 'Approve' : 'Resolve'}: ${item.title}`}
        icon={<Check aria-hidden className="size-3.5" />}
        onClick={onResolve}
        className="size-7"
      />
      <IconButton
        label={`Remove: ${item.title}`}
        icon={<Trash2 aria-hidden className="size-3.5" />}
        onClick={onRemove}
        className="size-7"
      />
    </div>
  );
}

function NewItemForm({
  projectId,
  tasks,
  onDone,
}: {
  projectId: string;
  tasks: readonly Task[];
  onDone: () => void;
}) {
  const { projects } = useRepositories();
  const [kind, setKind] = useState<ProjectItemKind>('step');
  const [title, setTitle] = useState('');
  const [waitingOn, setWaitingOn] = useState('');
  const [taskId, setTaskId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ids = { kind: useId(), title: useId(), waiting: useId(), task: useId() };
  const openTasks = tasks.filter((t) => t.status === 'todo' || t.status === 'doing');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return setError('Give it a title.');
    try {
      await projects.addItem(projectId, {
        kind,
        title,
        ...(kind === 'dependency' && waitingOn.trim() ? { waitingOn } : {}),
        ...(taskId ? { taskId } : {}),
      });
      setTitle('');
      setWaitingOn('');
      setTaskId('');
      onDone();
    } catch {
      setError('Couldn’t add that. Nothing changed.');
    }
  }

  return (
    <form
      aria-label="Add to the board"
      onSubmit={(e) => void submit(e)}
      className="grid max-w-2xl gap-3 rounded-lg border border-line bg-paper-raised p-3 sm:grid-cols-[10rem_1fr]"
    >
      <div>
        <label htmlFor={ids.kind} className={labelClass}>
          Kind
        </label>
        <select
          id={ids.kind}
          value={kind}
          onChange={(e) => setKind(e.target.value as ProjectItemKind)}
          className={fieldClass}
        >
          {PROJECT_ITEM_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
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
      {kind === 'dependency' && (
        <div className="sm:col-span-2">
          <label htmlFor={ids.waiting} className={labelClass}>
            Waiting on (who or what)
          </label>
          <input
            id={ids.waiting}
            value={waitingOn}
            onChange={(e) => setWaitingOn(e.target.value)}
            className={fieldClass}
          />
        </div>
      )}
      {(kind === 'blocker' || kind === 'dependency' || kind === 'approval') &&
        openTasks.length > 0 && (
          <div className="sm:col-span-2">
            <label htmlFor={ids.task} className={labelClass}>
              About a task (optional)
            </label>
            <select
              id={ids.task}
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className={fieldClass}
            >
              <option value="">None</option>
              {openTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
        )}
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
