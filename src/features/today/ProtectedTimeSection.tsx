import { Pencil, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import type { LocalDate, ProtectedTime } from '../../types/domain';
import { ProtectedTimeForm } from './ProtectedTimeForm';
import { KIND_ICON, KIND_LABEL } from './protected-time-kinds';
import { SectionHeading } from './SectionHeading';

/**
 * Time kept for people and rest on `date`. Entries are plans, not tasks: no
 * checkbox, no "done", no count. Add, edit, remove (ADR-021).
 */
export function ProtectedTimeSection({ date }: { date: LocalDate }) {
  const { protectedTime } = useRepositories();
  const watch = useMemo(() => protectedTime.watchForDate(date), [protectedTime, date]);
  const entries = useWatch(watch);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const addButton = useRef<HTMLButtonElement>(null);
  const focusAfterUpdate = useRef<string | null>(null);

  const editButton = (id: string) =>
    document.querySelector<HTMLButtonElement>(`[data-pt-edit="${CSS.escape(id)}"]`);

  // After a save, focus the entry's Edit button once the list shows it.
  useEffect(() => {
    const id = focusAfterUpdate.current;
    const button = id && editButton(id);
    if (!button) return;
    focusAfterUpdate.current = null;
    button.focus();
  }, [entries, editingId, adding]);

  /** Focus an entry that is already rendered (e.g. after Cancel). */
  function focusEdit(id: string) {
    requestAnimationFrame(() => editButton(id)?.focus());
  }

  async function remove(entry: ProtectedTime) {
    setError(null);
    try {
      await protectedTime.remove(entry.id);
      setAnnouncement(`Removed: ${entry.title}`);
      addButton.current?.focus();
    } catch {
      setError('Couldn’t remove that. Nothing changed.');
    }
  }

  return (
    <section aria-labelledby="protected-heading" className="mt-7">
      <SectionHeading
        id="protected-heading"
        action={
          !adding && (
            <Button
              ref={addButton}
              variant="ghost"
              onClick={() => setAdding(true)}
              className="-mr-2.5 h-7"
            >
              <Plus aria-hidden className="size-4" />
              Protect time
            </Button>
          )
        }
      >
        Protected time
      </SectionHeading>

      {adding && (
        <ProtectedTimeForm
          initial={{ title: '', kind: 'relationship', notes: '' }}
          submitLabel="Add"
          onSave={async (draft) => {
            const entry = await protectedTime.create({ ...draft, date });
            setAdding(false);
            setAnnouncement(`Protected: ${entry.title}`);
            focusAfterUpdate.current = entry.id;
          }}
          onCancel={() => {
            setAdding(false);
            requestAnimationFrame(() => addButton.current?.focus());
          }}
        />
      )}

      {error && <ErrorNotice>{error}</ErrorNotice>}
      {entries.status === 'error' && (
        <ErrorNotice>Couldn’t read protected time. Try reloading.</ErrorNotice>
      )}

      {entries.status === 'ready' && entries.data.length === 0 && !adding && (
        <p className="py-2 text-sm text-ink-muted">Nothing protected yet.</p>
      )}

      {entries.status === 'ready' && entries.data.length > 0 && (
        <ul aria-label="Protected time today" className="mt-2 border-l-2 border-accent-soft pl-3">
          {entries.data.map((entry) => {
            if (editingId === entry.id) {
              return (
                <li key={entry.id}>
                  <ProtectedTimeForm
                    initial={{ title: entry.title, kind: entry.kind, notes: entry.notes ?? '' }}
                    submitLabel="Save"
                    onSave={async (draft) => {
                      await protectedTime.update(entry.id, draft);
                      setEditingId(null);
                      setAnnouncement(`Saved: ${draft.title.trim()}`);
                      focusAfterUpdate.current = entry.id;
                    }}
                    onCancel={() => {
                      setEditingId(null);
                      focusEdit(entry.id);
                    }}
                  />
                </li>
              );
            }
            const Icon = KIND_ICON[entry.kind];
            return (
              <li key={entry.id} className="flex items-start gap-2.5 py-1.5">
                <Icon aria-hidden className="mt-1 size-4 shrink-0 text-accent-ink" />
                <div className="min-w-0 flex-1">
                  <p className="break-words">{entry.title}</p>
                  <p className="mt-0.5 text-xs break-words text-ink-muted">
                    {KIND_LABEL[entry.kind]}
                    {entry.notes && <span> · {entry.notes}</span>}
                  </p>
                </div>
                <div className="-my-1 flex shrink-0">
                  <IconButton
                    label={`Edit: ${entry.title}`}
                    icon={<Pencil aria-hidden className="size-4" />}
                    data-pt-edit={entry.id}
                    onClick={() => setEditingId(entry.id)}
                  />
                  <IconButton
                    label={`Remove: ${entry.title}`}
                    icon={<X aria-hidden className="size-4" />}
                    onClick={() => void remove(entry)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Announcer message={announcement} />
    </section>
  );
}
