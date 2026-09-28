import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '../../components/ui/Button';
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
    <form
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      noValidate
      aria-label={`Edit task: ${task.title}`}
      className="-mx-2 my-1 rounded-md bg-paper-sunken p-2"
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
  );
}
