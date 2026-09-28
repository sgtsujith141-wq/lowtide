import { Plus, SlidersHorizontal } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass } from '../../components/ui/styles';
import { useRepositories } from '../../hooks/useRepositories';
import { draftToNewTask, emptyDraft } from './draft';
import { TaskFields } from './TaskFields';

/** Title-first task entry; details are one click away and never required. */
export function NewTaskForm({
  projects,
  onCreated,
}: {
  projects: readonly string[];
  onCreated: (title: string) => void;
}) {
  const { tasks } = useRepositories();
  const [draft, setDraft] = useState(emptyDraft);
  const [showDetails, setShowDetails] = useState(false);
  const [error, setError] = useState<'empty' | 'failed' | null>(null);
  const [saving, setSaving] = useState(false);
  const title = useRef<HTMLInputElement>(null);
  const id = useId();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) {
      setError('empty');
      title.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const task = await tasks.create(draftToNewTask(draft));
      setDraft(emptyDraft);
      setError(null);
      onCreated(task.title);
    } catch {
      setError('failed');
    } finally {
      setSaving(false);
      title.current?.focus();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4" aria-label="New task">
      <div className="flex gap-2">
        <label htmlFor={`${id}-title`} className="sr-only">
          New task
        </label>
        <input
          ref={title}
          id={`${id}-title`}
          value={draft.title}
          onChange={(e) => {
            setDraft({ ...draft, title: e.target.value });
            if (error === 'empty') setError(null);
          }}
          placeholder="Add a task"
          autoComplete="off"
          aria-invalid={error === 'empty' || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={fieldClass}
        />
        <Button
          variant="ghost"
          aria-expanded={showDetails}
          aria-controls={`${id}-details`}
          onClick={() => setShowDetails((v) => !v)}
          className="px-2"
        >
          <SlidersHorizontal aria-hidden className="size-4" />
          <span className="sr-only sm:not-sr-only">Details</span>
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          <Plus aria-hidden className="size-4" />
          Add
        </Button>
      </div>
      <div id={`${id}-details`} hidden={!showDetails} className="mt-3">
        <TaskFields idPrefix={id} draft={draft} onChange={setDraft} projects={projects} />
      </div>
      {error === 'empty' && (
        <ErrorNotice id={`${id}-error`}>Give the task a title first.</ErrorNotice>
      )}
      {error === 'failed' && (
        <ErrorNotice id={`${id}-error`}>
          Couldn’t save the task. What you typed is still here — try again.
        </ErrorNotice>
      )}
    </form>
  );
}
