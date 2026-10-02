import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, Plus, RotateCcw } from 'lucide-react';
import { useWatch } from '../../hooks/useWatch';
import { Button, IconButton } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import { useRepositories } from '../../hooks/useRepositories';
import type { Task } from '../../types/domain';
import { draftFromTask, draftToChanges } from './draft';
import { TaskFields } from './TaskFields';

/** Inline editor that replaces a task row. Escape cancels. */
export function TaskEditor({
  task,
  projects,
  onClose,
}: {
  task: Task;
  projects: readonly string[];
  onClose: (saved: boolean) => void;
}) {
  const { tasks } = useRepositories();
  const [draft, setDraft] = useState(() => draftFromTask(task));
  const [error, setError] = useState<'empty' | 'failed' | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) return setError('empty');
    setSaving(true);
    try {
      await tasks.update(task.id, draftToChanges(draft));
      onClose(true);
    } catch {
      setError('failed');
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose(false);
    }
  }

  return (
    <div className="-mx-2 my-1 rounded-md bg-surface p-2">
      <form
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        noValidate
        aria-label={`Edit task: ${task.title}`}
      >
        <label htmlFor={`${id}-title`} className={labelClass}>
          Title
        </label>
        <input
          id={`${id}-title`}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          autoFocus
          autoComplete="off"
          aria-invalid={error === 'empty' || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${fieldClass} mb-3`}
        />
        <TaskFields idPrefix={id} draft={draft} onChange={setDraft} projects={projects} />
        {error === 'empty' && <ErrorNotice id={`${id}-error`}>A task needs a title.</ErrorNotice>}
        {error === 'failed' && (
          <ErrorNotice id={`${id}-error`}>
            Couldn’t save your changes. They’re still here.
          </ErrorNotice>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            Save
          </Button>
        </div>
      </form>
      {!task.parentId && <Subtasks parent={task} />}
    </div>
  );
}

/** A task's subtasks (v2.1): tick them off, reopen them, add more. One level deep. */
function Subtasks({ parent }: { parent: Task }) {
  const { tasks } = useRepositories();
  const all = useWatch(tasks.watchAll);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const list = all.status === 'ready' ? all.data.filter((t) => t.parentId === parent.id) : [];
  const run = (p: Promise<unknown>) =>
    p.then(
      () => setError(null),
      () => setError('Couldn’t change that subtask. Nothing changed.'),
    );
  return (
    <section aria-label={`Subtasks of ${parent.title}`} className="mt-4 border-t border-line pt-3">
      <h3 className="text-xs font-semibold text-fg-muted">
        Subtasks
        {list.length
          ? ` · ${list.filter((t) => t.status === 'done').length} of ${list.length} done`
          : ''}
      </h3>
      {list.length > 0 && (
        <ul className="mt-1.5">
          {list.map((t) => {
            const done = t.status === 'done' || t.status === 'dropped';
            return (
              <li key={t.id} className="flex items-center gap-2 py-1 text-sm">
                <IconButton
                  label={done ? `Reopen: ${t.title}` : `Complete: ${t.title}`}
                  icon={
                    done ? (
                      <RotateCcw aria-hidden className="size-3.5" />
                    ) : (
                      <Check aria-hidden className="size-3.5" />
                    )
                  }
                  onClick={() => void run(done ? tasks.reopen(t.id) : tasks.complete(t.id))}
                />
                <span className={done ? 'text-fg-muted line-through' : ''}>{t.title}</span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <label htmlFor={id} className="sr-only">
          Add a subtask
        </label>
        <input
          id={id}
          value={title}
          placeholder="Add a subtask"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              if (!title.trim()) return;
              void run(tasks.create({ title, parentId: parent.id })).then(() => setTitle(''));
            }
          }}
          className={fieldClass}
        />
        <Button
          size="sm"
          onClick={() => {
            if (!title.trim()) return;
            void run(tasks.create({ title, parentId: parent.id })).then(() => setTitle(''));
          }}
        >
          <Plus aria-hidden className="size-3.5" /> Add
        </Button>
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
    </section>
  );
}
