import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import type { Hackathon } from '../../types/domain';
import { HackathonForm } from './HackathonForm';
import { HackathonSheet } from './HackathonSheet';
import { STATUS_LABEL } from './labels';
import { isOpen, orderHackathons } from './schedule';

/**
 * Hackathons: every event you're considering or in, soonest meaningful date
 * first, each with its next action and where registration, PPT and build
 * stand. Finished and dropped ones stay under Past (ADR-027–029).
 */
export function HackathonsPage() {
  useDocumentTitle('Hackathons');
  const today = useToday();
  const { hackathons } = useRepositories();
  const all = useWatch(hackathons.watchAll);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const addButton = useRef<HTMLButtonElement>(null);
  const pastSummary = useRef<HTMLElement>(null);
  const focusAfterUpdate = useRef<string | null>(null);

  const list = useMemo(() => (all.status === 'ready' ? all.data : []), [all]);
  const open = useMemo(() => orderHackathons(list.filter(isOpen), today), [list, today]);
  const past = useMemo(
    () =>
      list
        .filter((h) => !isOpen(h))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)),
    [list],
  );

  // Once the list re-renders after a save, put focus where the item now is:
  // its Edit button, or the Past summary if it moved there.
  useEffect(() => {
    const target = focusAfterUpdate.current;
    if (!target) return;
    const el =
      target === 'past'
        ? pastSummary.current
        : document.querySelector<HTMLElement>(`[data-hackathon-edit="${CSS.escape(target)}"]`);
    if (!el) return;
    focusAfterUpdate.current = null;
    el.focus();
  }, [all, editingId, adding]);

  // Status selects stay enabled while saving (disabling a focused control
  // drops keyboard focus); a second change during a save is ignored instead.
  async function run(h: Hackathon, action: () => Promise<Hackathon>, message: string) {
    if (busyId === h.id) return null;
    setBusyId(h.id);
    setError(null);
    try {
      const updated = await action();
      setAnnouncement(message);
      return updated;
    } catch {
      setError('Couldn’t save that. Nothing changed.');
      return null;
    } finally {
      setBusyId(null);
    }
  }

  function renderSheet(h: Hackathon) {
    if (editingId === h.id) {
      return (
        <li key={h.id}>
          <HackathonForm
            initial={h}
            quick={false}
            formLabel={`Edit ${h.name}`}
            submitLabel="Save"
            onSave={async (changes) => {
              const updated = await hackathons.update(h.id, changes);
              setEditingId(null);
              setAnnouncement(`Saved ${updated.name}.`);
              focusAfterUpdate.current = isOpen(h) && !isOpen(updated) ? 'past' : h.id;
            }}
            onCancel={() => {
              setEditingId(null);
              focusAfterUpdate.current = h.id;
            }}
          />
        </li>
      );
    }
    return (
      <li key={h.id}>
        <HackathonSheet
          hackathon={h}
          today={today}
          busy={busyId === h.id}
          onEdit={() => setEditingId(h.id)}
          onStatus={(field, value) =>
            void run(
              h,
              () => hackathons.update(h.id, { [field]: value }),
              field === 'status'
                ? `${h.name}: ${STATUS_LABEL[value as Hackathon['status']]}`
                : `${h.name} updated`,
            ).then((updated) => {
              if (updated && isOpen(updated) !== isOpen(h)) {
                focusAfterUpdate.current = isOpen(updated) ? h.id : 'past';
              }
            })
          }
          onNextAction={async (value) =>
            (await run(
              h,
              () => hackathons.update(h.id, { nextAction: value }),
              `Next action saved for ${h.name}.`,
            )) !== null
          }
        />
      </li>
    );
  }

  if (all.status === 'loading') return null;

  return (
    <>
      <h1 className="font-serif text-xl font-semibold tracking-tight">Hackathons</h1>
      <p className="mt-1 text-sm text-ink-muted">What’s coming up, and the next step for each.</p>

      {all.status === 'error' && (
        <ErrorNotice>Couldn’t read your hackathons. Try reloading.</ErrorNotice>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}

      <section aria-labelledby="coming-up-heading" className="mt-5">
        <div className="flex min-h-8 items-end justify-between gap-3 border-b border-line pb-1">
          <h2 id="coming-up-heading" className="text-sm font-medium text-ink-muted">
            Coming up{open.length > 0 ? ` · ${open.length}` : ''}
          </h2>
          {!adding && (
            <Button
              ref={addButton}
              variant="ghost"
              onClick={() => setAdding(true)}
              className="-mr-2.5 h-7"
            >
              <Plus aria-hidden className="size-4" />
              Add hackathon
            </Button>
          )}
        </div>

        {adding && (
          <HackathonForm
            initial={{}}
            quick
            formLabel="Add hackathon"
            submitLabel="Add"
            onSave={async (draft) => {
              const created = await hackathons.create({
                name: draft.name,
                ...(draft.eventStart ? { eventStart: draft.eventStart } : {}),
                ...(draft.eventEnd ? { eventEnd: draft.eventEnd } : {}),
              });
              setAdding(false);
              setAnnouncement(`Added ${created.name}.`);
              focusAfterUpdate.current = created.id;
            }}
            onCancel={() => {
              setAdding(false);
              requestAnimationFrame(() => addButton.current?.focus());
            }}
          />
        )}

        {open.length === 0 && !adding && (
          <p className="py-3 text-sm text-ink-muted">
            Nothing on the radar. When a hackathon comes up, add it here; a name and a date are
            enough to start.
          </p>
        )}
        <ul>{open.map(renderSheet)}</ul>
      </section>

      {past.length > 0 && (
        <details className="mt-6">
          <summary
            ref={pastSummary}
            className="cursor-pointer text-sm font-medium text-ink-muted select-none hover:text-ink"
          >
            Past · {past.length}
          </summary>
          <ul className="mt-1">{past.map(renderSheet)}</ul>
        </details>
      )}
      <Announcer message={announcement} />
    </>
  );
}
