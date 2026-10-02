import { AlertOctagon, Check, Hand, Hourglass, ParkingSquare } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Drawer } from '../../../components/layout';
import { Button } from '../../../components/ui/Button';
import { ErrorNotice } from '../../../components/ui/Notice';
import { useRepositories } from '../../../hooks/useRepositories';
import { useWatch } from '../../../hooks/useWatch';
import { formatFull, formatWhen } from '../../../lib/when';
import type { Project, ProjectItem } from '../../../types/domain';
import { byRoadmap, concise, needsOf, type NeedEntry } from '../display';
import type { LaneEntry, ProjectSummary } from '../summary';

/*
 * The work plane (v2 PHASE 013): what's happening now, what's next and what
 * needs you, read first; what waits, what's blocked and what's parked,
 * second; what's done, folded away. Columns and type, not boxes. Moving
 * things between lanes happens on the Work tab.
 */

const NEXT_SHOWN = 5;

export function WorkPlane({
  summary: s,
  items,
  onOpenWork,
}: {
  summary: ProjectSummary;
  items: readonly ProjectItem[];
  onOpenWork: () => void;
}) {
  const name = s.project.name;
  const byId = new Map(items.map((i) => [i.id, i]));
  const needs = needsOf(s, items);
  const blockedOther = s.lanes.blocked.filter(
    (e) => !(e.kind === 'item' && byId.get(e.id)?.kind === 'blocker'),
  );
  const [open, setOpen] = useState<NeedEntry | null>(null);
  const title = (e: LaneEntry) => concise(e.title, name);

  return (
    <div>
      <div className="grid gap-x-10 gap-y-8 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.15fr]">
        <Lane label="Now" count={s.lanes.working_now.length}>
          <EntryList
            entries={byRoadmap(s.lanes.working_now, s.milestones, name)}
            render={title}
            empty="Nothing in progress"
            strong
          />
        </Lane>
        <Lane label="Next" count={s.lanes.next.length}>
          <EntryList
            entries={byRoadmap(s.lanes.next, s.milestones, name).slice(0, NEXT_SHOWN)}
            render={title}
            empty="No next step recorded"
          />
          {s.lanes.next.length > NEXT_SHOWN && (
            <button
              type="button"
              onClick={onOpenWork}
              className="mt-2 text-xs text-fg-muted hover:text-fg hover:underline"
            >
              {s.lanes.next.length - NEXT_SHOWN} more on the Work tab
            </button>
          )}
        </Lane>
        <section
          aria-label="Needs you"
          className={`min-w-0 md:col-span-2 xl:col-span-1 ${needs.length ? 'border-l-2 border-warn/70 pl-5' : ''}`}
        >
          <h3 className="flex items-baseline gap-2 text-xs font-semibold text-fg">
            Needs you
            {needs.length > 0 && (
              <span className="figure font-normal text-warn">{needs.length}</span>
            )}
          </h3>
          {needs.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">Nothing is waiting on you.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {needs.map((n) => (
                <NeedRow key={n.entry.id} need={n} name={name} onDetails={() => setOpen(n)} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-8 grid gap-x-10 gap-y-5 border-t border-line pt-5 sm:grid-cols-3">
        <Lane label="Waiting" count={s.lanes.waiting.length} quiet icon={Hourglass}>
          <EntryList
            entries={s.lanes.waiting}
            render={(e) => {
              const c = title(e);
              return e.detail ? { ...c, text: `${c.text} · on ${e.detail}` } : c;
            }}
            empty="None"
          />
        </Lane>
        <Lane label="Blocked" count={blockedOther.length} quiet icon={AlertOctagon}>
          <EntryList entries={blockedOther} render={title} empty="None" />
        </Lane>
        <Lane label="Parked" count={s.lanes.parked.length} quiet icon={ParkingSquare}>
          {s.lanes.parked.length === 0 ? (
            <p className="mt-1 text-sm text-fg-muted">None</p>
          ) : (
            <p className="mt-1 text-sm text-fg-muted">
              {s.lanes.parked.map((e) => title(e).text).join(' · ')}
            </p>
          )}
        </Lane>
      </div>

      {s.lanes.done.length > 0 && (
        <details className="mt-5 text-sm">
          <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg">
            Done ({s.lanes.done.length})
          </summary>
          <ul className="mt-2 columns-1 gap-10 sm:columns-2 xl:columns-3">
            {[...s.lanes.done].reverse().map((e) => (
              <li
                key={`${e.kind}-${e.id}`}
                className="flex items-start gap-1.5 py-0.5 text-fg-muted"
              >
                <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-projects-4" />
                {title(e).text}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ItemDrawer need={open} project={s.project} onClose={() => setOpen(null)} />
    </div>
  );
}

function Lane({
  label,
  count,
  quiet = false,
  icon: Icon,
  children,
}: {
  label: string;
  count: number;
  quiet?: boolean;
  icon?: typeof Hourglass;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="min-w-0">
      <h3
        className={`flex items-center gap-1.5 text-xs font-semibold ${quiet ? 'text-fg-muted' : 'text-fg'}`}
      >
        {Icon && <Icon aria-hidden className="size-3.5" />}
        {label}
        {count > 0 && <span className="figure font-normal text-fg-muted">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function EntryList({
  entries,
  render,
  empty,
  strong = false,
}: {
  entries: readonly LaneEntry[];
  render: (e: LaneEntry) => { text: string; full: string; shortened: boolean };
  empty: string;
  strong?: boolean;
}) {
  if (entries.length === 0) return <p className="mt-2 text-sm text-fg-muted">{empty}</p>;
  return (
    <ul className="mt-2 space-y-1.5">
      {entries.map((e) => {
        const c = render(e);
        return (
          <li
            key={`${e.kind}-${e.id}`}
            className={`text-sm leading-snug ${strong ? 'font-medium' : ''}`}
            title={c.shortened ? c.full : undefined}
          >
            {c.text}
          </li>
        );
      })}
    </ul>
  );
}

function NeedRow({
  need,
  name,
  onDetails,
}: {
  need: NeedEntry;
  name: string;
  onDetails: () => void;
}) {
  const { projects } = useRepositories();
  const [error, setError] = useState(false);
  const c = concise(need.entry.title, name);
  const reason = need.item?.body ? concise(need.item.body).text : undefined;
  const Icon = need.kind === 'approval' ? Hand : AlertOctagon;
  const verb = need.kind === 'approval' ? 'Approve' : 'Resolve';
  return (
    <li className="min-w-0">
      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <Icon
          aria-hidden
          className={`size-3.5 ${need.kind === 'approval' ? 'text-warn' : 'text-danger'}`}
        />
        {need.kind === 'approval' ? 'Approval' : 'Blocker'}
      </p>
      <p className="mt-0.5 text-[15px] leading-snug font-medium">{c.text}</p>
      {reason && <p className="mt-0.5 line-clamp-1 text-sm text-fg-muted">{reason}</p>}
      <div className="mt-1.5 flex items-center gap-1">
        {need.item && (
          <Button
            size="sm"
            onClick={() => {
              setError(false);
              projects.resolveItem(need.item!.id).catch(() => setError(true));
            }}
          >
            <Check aria-hidden className="size-3.5" /> {verb}
            <span className="sr-only">: {c.text}</span>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDetails}>
          Details<span className="sr-only">: {c.text}</span>
        </Button>
      </div>
      {error && <ErrorNotice>Couldn’t do that. Nothing changed.</ErrorNotice>}
    </li>
  );
}

/** An item in full: its own wording, its notes, and where it came from. */
function ItemDrawer({
  need,
  project,
  onClose,
}: {
  need: NeedEntry | null;
  project: Project;
  onClose: () => void;
}) {
  const c = need ? concise(need.entry.title, project.name) : null;
  return (
    <Drawer open={need !== null} onClose={onClose} title={c?.text ?? 'Item'}>
      {need && <ItemDetail need={need} />}
    </Drawer>
  );
}

function ItemDetail({ need }: { need: NeedEntry }) {
  const { space } = useRepositories();
  const watch = useMemo(
    () => space.watchSources(need.entry.kind === 'item' ? 'projectItem' : 'task', need.entry.id),
    [space, need.entry.kind, need.entry.id],
  );
  const sources = useWatch(watch);
  const now = new Date();
  const item = need.item;
  return (
    <div className="space-y-5 text-sm">
      <section aria-label="Original wording">
        <h3 className="text-xs font-semibold text-fg-muted">As recorded</h3>
        <p className="mt-1">{need.entry.title}</p>
        {item?.body && <p className="mt-2 whitespace-pre-wrap text-fg-muted">{item.body}</p>}
      </section>
      {item && (
        <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-fg-muted">Kind</dt>
          <dd>{need.kind === 'approval' ? 'Approval' : 'Blocker'}</dd>
          <dt className="text-fg-muted">Since</dt>
          <dd>
            <time dateTime={item.laneChangedAt} title={formatFull(item.laneChangedAt)}>
              {formatWhen(item.laneChangedAt, now)}
            </time>
          </dd>
        </dl>
      )}
      {sources.status === 'ready' && sources.data.length > 0 && (
        <section aria-label="Source">
          <h3 className="text-xs font-semibold text-fg-muted">Source</h3>
          <ul className="mt-1 space-y-1.5">
            {sources.data.map((src) => (
              <li key={src.id}>
                <span className="text-fg-muted">
                  {src.system === 'notion' ? 'Notion' : src.system}
                  {src.role !== 'canonical' ? ` (${src.role})` : ''}:{' '}
                </span>
                {src.originalTitle}
                {src.path && src.path.length > 0 && (
                  <span className="block text-xs text-fg-muted">{src.path.join(' / ')}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
