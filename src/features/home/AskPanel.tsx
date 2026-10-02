import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import { blocksOf, blockText } from '../../lib/space-blocks';

/** Places to go by name. */
const DESTINATIONS: [string, string][] = [
  ['Home', '/'],
  ['Today', '/today'],
  ['Projects', '/projects'],
  ['SPACE', '/space'],
  ['Tasks', '/tasks'],
  ['Hackathons', '/hackathons'],
  ['Rhythm', '/rhythm'],
  ['Inbox', '/inbox'],
  ['Calendar', '/calendar'],
  ['AI', '/ai'],
  ['Settings', '/settings'],
];

interface Hit {
  key: string;
  kind: string;
  title: string;
  to: string;
}

/**
 * The command palette (v2 PHASE 012, global since PHASE 014): a modal dialog
 * around the search, opened by ⌘K / Ctrl K anywhere or Home's ⌘K button. Escape or a click outside closes it,
 * and focus returns to what opened it.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label="Search LOWTIDE"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => event.target === event.currentTarget && onClose()}
      className="lt-pop m-auto mt-[12vh] w-[min(40rem,calc(100vw-2rem))] rounded-lg bg-raised p-0 text-fg shadow-[var(--lt-shadow)] backdrop:bg-scrim"
    >
      {open && <AskPanel onClose={onClose} />}
    </dialog>
  );
}

/**
 * Search LOWTIDE, honestly: no AI is involved; this is a local search over
 * your projects, milestones, project items, tasks and hackathons. Nothing
 * leaves the device. (Protected time and the inbox aren't searched here.)
 */
export function AskPanel({ onClose }: { onClose: () => void }) {
  const { projects, tasks, hackathons, space } = useRepositories();
  const [query, setQuery] = useState('');
  const inputId = useId();
  const all = useWatch(projects.watchAll);
  const milestones = useWatch(projects.watchAllMilestones);
  const items = useWatch(projects.watchAllItems);
  const open = useWatch(tasks.watchOpen);
  const closed = useWatch(tasks.watchClosed);
  const hacks = useWatch(hackathons.watchAll);
  const nodes = useWatch(space.watchAll);
  const decisions = useWatch(projects.watchAllDecisions);

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const has = (...texts: (string | undefined)[]) =>
      texts.some((t) => t?.toLowerCase().includes(q));
    const slug = new Map(
      all.status === 'ready' ? all.data.map((p) => [p.id, p.slug] as const) : [],
    );
    const out: Hit[] = [];
    for (const [title, to] of DESTINATIONS)
      if (title.toLowerCase().startsWith(q)) out.push({ key: to, kind: 'Go to', title, to });
    if (all.status === 'ready')
      for (const p of all.data)
        if (has(p.name, p.objective, p.nextAction, p.phase))
          out.push({ key: p.id, kind: 'Project', title: p.name, to: `/projects/${p.slug}` });
    if (milestones.status === 'ready')
      for (const m of milestones.data)
        if (has(m.title, m.notes))
          out.push({
            key: m.id,
            kind: 'Milestone',
            title: m.title,
            to: `/projects/${slug.get(m.projectId)}`,
          });
    if (items.status === 'ready')
      for (const i of items.data)
        if (has(i.title, i.body, i.waitingOn))
          out.push({
            key: i.id,
            kind: 'Project item',
            title: i.title,
            to: `/projects/${slug.get(i.projectId)}`,
          });
    for (const list of [open, closed])
      if (list.status === 'ready')
        for (const t of list.data)
          if (has(t.title, t.notes, t.project))
            out.push({ key: t.id, kind: 'Task', title: t.title, to: '/tasks' });
    if (hacks.status === 'ready')
      for (const h of hacks.data)
        if (has(h.name, h.problemStatement, h.nextAction, h.notes))
          out.push({ key: h.id, kind: 'Hackathon', title: h.name, to: '/hackathons' });
    if (decisions.status === 'ready')
      for (const d of decisions.data)
        if (has(d.title, d.decision, d.context))
          out.push({
            key: d.id,
            kind: 'Decision',
            title: d.title,
            to: `/projects/${slug.get(d.projectId)}`,
          });
    if (nodes.status === 'ready')
      for (const n of nodes.data)
        if (
          !n.archived &&
          n.kind !== 'section' &&
          (has(n.title) || has(blocksOf(n).map(blockText).join(' ')))
        )
          out.push({
            key: n.id,
            kind: n.kind === 'table' ? 'SPACE table' : 'SPACE page',
            title: n.title,
            to: `/space/${n.id}`,
          });
    return out.slice(0, 24);
  }, [query, all, milestones, items, open, closed, hacks, nodes, decisions]);

  return (
    <div role="search" className="p-3" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <label htmlFor={inputId} className="sr-only">
        Search LOWTIDE
      </label>
      <div className="flex items-center gap-2 border-b border-line px-1 pb-2">
        <Search aria-hidden className="size-4 shrink-0 text-fg-muted" />
        <input
          id={inputId}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects, tasks, hackathons, SPACE, decisions…"
          className="min-w-0 flex-1 bg-transparent py-1 text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
        />
      </div>
      <p className="mt-2 px-1 text-[11px] text-fg-muted">
        Searches what’s on this device; nothing leaves it.
      </p>
      {query.trim().length >= 2 && (
        <ul aria-label="Results" className="mt-2 max-h-[50vh] divide-y divide-line overflow-y-auto">
          {hits.length === 0 ? (
            <li className="py-2 text-sm text-fg-muted">No matches.</li>
          ) : (
            hits.map((hit) => (
              <li key={`${hit.kind}-${hit.key}`} className="py-1.5">
                <Link
                  to={hit.to}
                  onClick={onClose}
                  className="flex items-baseline gap-2 rounded-md px-1 text-sm hover:bg-hover"
                >
                  <span className="w-24 shrink-0 text-[11px] text-fg-muted">{hit.kind}</span>
                  <span className="min-w-0 truncate">{hit.title}</span>
                </Link>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
