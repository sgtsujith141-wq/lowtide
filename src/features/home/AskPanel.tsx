import { Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { fieldClass } from '../../components/ui/styles';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';

interface Hit {
  key: string;
  kind: string;
  title: string;
  to: string;
}

/**
 * Ask LOWTIDE, honestly: no AI is connected, so this is a local search over
 * your projects, milestones, project items, tasks and hackathons. Nothing
 * leaves the device. (Protected time and the inbox aren't searched here.)
 */
export function AskPanel({ onClose }: { onClose: () => void }) {
  const { projects, tasks, hackathons } = useRepositories();
  const [query, setQuery] = useState('');
  const inputId = useId();
  const all = useWatch(projects.watchAll);
  const milestones = useWatch(projects.watchAllMilestones);
  const items = useWatch(projects.watchAllItems);
  const open = useWatch(tasks.watchOpen);
  const closed = useWatch(tasks.watchClosed);
  const hacks = useWatch(hackathons.watchAll);

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const has = (...texts: (string | undefined)[]) =>
      texts.some((t) => t?.toLowerCase().includes(q));
    const slug = new Map(
      all.status === 'ready' ? all.data.map((p) => [p.id, p.slug] as const) : [],
    );
    const out: Hit[] = [];
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
    return out.slice(0, 20);
  }, [query, all, milestones, items, open, closed, hacks]);

  return (
    <div
      role="search"
      className="mt-3 rounded-lg border border-line bg-paper-raised p-3"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <label htmlFor={inputId} className="flex items-center gap-2 text-sm font-medium">
        <Search aria-hidden className="size-4 text-ink-muted" /> Ask LOWTIDE
      </label>
      <input
        id={inputId}
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search projects, milestones, tasks, hackathons…"
        className={`${fieldClass} mt-1.5`}
      />
      <p className="mt-1 text-[11px] text-ink-muted">
        Local search only. No AI is connected, and nothing leaves this device.
      </p>
      {query.trim().length >= 2 && (
        <ul aria-label="Results" className="mt-2 divide-y divide-line">
          {hits.length === 0 ? (
            <li className="py-2 text-sm text-ink-muted">No matches.</li>
          ) : (
            hits.map((hit) => (
              <li key={`${hit.kind}-${hit.key}`} className="py-1.5">
                <Link to={hit.to} className="flex items-baseline gap-2 text-sm hover:underline">
                  <span className="w-24 shrink-0 text-[11px] text-ink-muted">{hit.kind}</span>
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
