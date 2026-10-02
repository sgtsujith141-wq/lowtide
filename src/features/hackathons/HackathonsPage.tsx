import { Archive, ArchiveRestore, ArrowRight, Pin, PinOff, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { Drawer } from '../../components/layout';
import { Button } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import type { Hackathon, LocalDate } from '../../types/domain';
import { useCreate } from '../create/create-context';
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
  const { openCreate } = useCreate();
  const location = useLocation();
  // A hackathon just made from the New menu opens in its sheet.
  const wanted = (location.state as { open?: unknown } | null)?.open;
  const [openId, setOpenId] = useState<string | null>(
    typeof wanted === 'string' ? wanted : null,
  );
  const [seen, setSeen] = useState(location.key);
  if (seen !== location.key) {
    setSeen(location.key);
    if (typeof wanted === 'string') setOpenId(wanted);
  }
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const everything = useMemo(() => (all.status === 'ready' ? all.data : []), [all]);
  const list = useMemo(() => everything.filter((h) => !h.archivedAt), [everything]);
  const archived = useMemo(() => everything.filter((h) => h.archivedAt), [everything]);
  // Pinned first; otherwise by what's coming.
  const open = useMemo(() => {
    const ordered = orderHackathons(list.filter(isOpen), today);
    return [...ordered.filter((h) => h.pinnedAt), ...ordered.filter((h) => !h.pinnedAt)];
  }, [list, today]);
  const past = useMemo(
    () =>
      list
        .filter((h) => !isOpen(h))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)),
    [list],
  );
  const current = openId ? everything.find((h) => h.id === openId) : undefined;

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
        <Button variant="primary" onClick={() => openCreate('hackathon')}>
          <Plus aria-hidden className="size-4" /> New hackathon
        </Button>
      </div>

      {all.status === 'error' && (
        <ErrorNotice>Couldn’t read your hackathons. Try reloading.</ErrorNotice>
      )}
      {error && !current && <ErrorNotice>{error}</ErrorNotice>}

      <section aria-labelledby="coming-up-heading" className="mt-6">
        <h2 id="coming-up-heading" className="text-section font-semibold">
          Coming up{open.length > 0 ? ` · ${open.length}` : ''}
        </h2>
        {open.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">
            No hackathons yet.{' '}
            <button
              type="button"
              onClick={() => openCreate('hackathon')}
              className="text-accent-ink underline underline-offset-2"
            >
              Add one
            </button>
          </p>
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

      {archived.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-fg-muted select-none hover:text-fg">
            Archived · {archived.length}
          </summary>
          <ul className="mt-2 border-t border-line">
            {archived.map((h) => (
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
              <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => hackathons.setPinned(current.id, !current.pinnedAt),
                      current.pinnedAt ? `Unpinned ${current.name}.` : `Pinned ${current.name}.`,
                    )
                  }
                >
                  {current.pinnedAt ? (
                    <PinOff aria-hidden className="size-3.5" />
                  ) : (
                    <Pin aria-hidden className="size-3.5" />
                  )}
                  {current.pinnedAt ? 'Unpin' : 'Pin'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        current.archivedAt
                          ? hackathons.restore(current.id)
                          : hackathons.archive(current.id),
                      current.archivedAt
                        ? `Restored ${current.name}.`
                        : `Archived ${current.name}; it’s under Archived.`,
                    )
                  }
                >
                  {current.archivedAt ? (
                    <ArchiveRestore aria-hidden className="size-3.5" />
                  ) : (
                    <Archive aria-hidden className="size-3.5" />
                  )}
                  {current.archivedAt ? 'Restore' : 'Archive'}
                </Button>
              </div>
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
