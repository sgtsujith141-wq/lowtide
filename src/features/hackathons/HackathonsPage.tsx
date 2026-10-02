import { ArrowRight, Plus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Drawer } from '../../components/layout';
import { Button } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { useCreateRequest } from '../../hooks/useCreateRequest';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import type { Hackathon, LocalDate } from '../../types/domain';
import { HackathonForm } from './HackathonForm';
import { HackathonSheet } from './HackathonSheet';
import { STATUS_LABEL } from './labels';
import { isOpen, orderHackathons, primaryMoment } from './schedule';
import { StageRail } from './StageRail';

/**
 * Hackathons (v2 PHASE 016): a scannable progress view. Each hackathon is one
 * row: name, how soon, its stage rail, the next action and its status. Open
 * one to edit it in a side sheet; nothing else shows its controls until then.
 * Finished and dropped ones stay under Past (ADR-027–029).
 */
export function HackathonsPage() {
  useDocumentTitle('Hackathons');
  const today = useToday();
  const { hackathons, projects } = useRepositories();
  const allProjects = useWatch(projects.watchAll);
  const projectsById = useMemo(
    () =>
      new Map(
        allProjects.status === 'ready'
          ? allProjects.data.map((p) => [p.id, { name: p.name, slug: p.slug }] as const)
          : [],
      ),
    [allProjects],
  );
  const all = useWatch(hackathons.watchAll);
  const [adding, setAdding] = useState(false);
  useCreateRequest(() => setAdding(true));
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const addButton = useRef<HTMLButtonElement>(null);

  const list = useMemo(() => (all.status === 'ready' ? all.data : []), [all]);
  const open = useMemo(() => orderHackathons(list.filter(isOpen), today), [list, today]);
  const past = useMemo(
    () =>
      list
        .filter((h) => !isOpen(h))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)),
    [list],
  );
  const current = openId ? list.find((h) => h.id === openId) : undefined;

  async function run(action: () => Promise<unknown>, message: string) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await action();
      setAnnouncement(message);
      return true;
    } catch {
      setError('Couldn’t save that. Nothing changed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    setOpenId(null);
    setEditing(false);
  };

  if (all.status === 'loading') return null;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-page font-semibold">Hackathons</h1>
        {!adding && (
          <Button ref={addButton} variant="primary" onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" /> Add hackathon
          </Button>
        )}
      </div>

      {all.status === 'error' && (
        <ErrorNotice>Couldn’t read your hackathons. Try reloading.</ErrorNotice>
      )}
      {error && !current && <ErrorNotice>{error}</ErrorNotice>}

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
          }}
          onCancel={() => {
            setAdding(false);
            requestAnimationFrame(() => addButton.current?.focus());
          }}
        />
      )}

      <section aria-labelledby="coming-up-heading" className="mt-6">
        <h2 id="coming-up-heading" className="text-section font-semibold">
          Coming up{open.length > 0 ? ` · ${open.length}` : ''}
        </h2>
        {open.length === 0 && !adding ? (
          <p className="mt-2 text-sm text-fg-muted">No hackathons yet.</p>
        ) : (
          <ul className="mt-2 border-t border-line">
            {open.map((h) => (
              <HackathonRow key={h.id} hackathon={h} today={today} onOpen={() => setOpenId(h.id)} />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-medium text-fg-muted select-none hover:text-fg">
            Past · {past.length}
          </summary>
          <ul className="mt-2 border-t border-line">
            {past.map((h) => (
              <HackathonRow key={h.id} hackathon={h} today={today} onOpen={() => setOpenId(h.id)} />
            ))}
          </ul>
        </details>
      )}

      <Drawer open={!!current} onClose={close} title={current?.name ?? 'Hackathon'}>
        {current &&
          (editing ? (
            <HackathonForm
              initial={current}
              quick={false}
              formLabel={`Edit ${current.name}`}
              submitLabel="Save"
              onSave={async (changes) => {
                const updated = await hackathons.update(current.id, changes);
                setEditing(false);
                setAnnouncement(`Saved ${updated.name}.`);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              {error && <ErrorNotice>{error}</ErrorNotice>}
              <HackathonSheet
                embedded
                hackathon={current}
                today={today}
                busy={busy}
                project={current.projectId ? projectsById.get(current.projectId) : undefined}
                onTrackProject={() =>
                  void run(
                    () => projects.createFromHackathon(current.id),
                    `${current.name}: the build is now a project.`,
                  )
                }
                onUnlinkProject={() =>
                  void run(
                    () => hackathons.update(current.id, { projectId: null }),
                    `${current.name}: unlinked from its project.`,
                  )
                }
                onEdit={() => setEditing(true)}
                onStatus={(field, value) =>
                  void run(
                    () => hackathons.update(current.id, { [field]: value }),
                    field === 'status'
                      ? `${current.name}: ${STATUS_LABEL[value as Hackathon['status']]}`
                      : `${current.name} updated`,
                  )
                }
                onNextAction={(value) =>
                  run(
                    () => hackathons.update(current.id, { nextAction: value }),
                    `Next action saved for ${current.name}.`,
                  )
                }
              />
            </>
          ))}
      </Drawer>
      <Announcer message={announcement} />
    </>
  );
}

/** One hackathon at a glance; Open shows and edits the rest. */
function HackathonRow({
  hackathon: h,
  today,
  onOpen,
}: {
  hackathon: Hackathon;
  today: LocalDate;
  onOpen: () => void;
}) {
  const moment = primaryMoment(h, today);
  return (
    <li className="border-b border-line py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="min-w-0 text-[15px] font-medium break-words">{h.name}</h3>
        {moment && (
          <span
            className={`text-sm ${moment.tone === 'today' || moment.tone === 'now' ? 'font-medium text-accent-ink' : moment.tone === 'soon' ? 'text-fg' : 'text-fg-muted'}`}
          >
            {moment.text}
          </span>
        )}
      </div>
      <StageRail hackathon={h} />
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <p className="min-w-0 flex-1 text-sm">
          <span className="mr-2 text-xs text-fg-muted">Next</span>
          {h.nextAction ? (
            <span className="break-words">{h.nextAction}</span>
          ) : (
            <span className="text-fg-muted">Not set</span>
          )}
        </p>
        <span className="flex items-center gap-4">
          <span className="text-xs text-fg-muted">{STATUS_LABEL[h.status]}</span>
          <Button size="sm" variant="ghost" onClick={onOpen} aria-label={`Open ${h.name}`}>
            Open <ArrowRight aria-hidden className="size-3.5" />
          </Button>
        </span>
      </div>
    </li>
  );
}
