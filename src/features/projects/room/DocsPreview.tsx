import { FileText, Table2 } from 'lucide-react';
import { useState } from 'react';
import { Drawer } from '../../../components/layout';
import { useRepositories } from '../../../hooks/useRepositories';
import { useWatch } from '../../../hooks/useWatch';
import { formatFull, formatWhen } from '../../../lib/when';
import type { Project, SpaceNode } from '../../../types/domain';

/*
 * The project's documents from SPACE (v2 PHASE 013): its planning,
 * architecture, research, decisions, build plans and notes, with counts and
 * the latest pages. A read-only preview; browsing and editing come with
 * SPACE's own screen.
 */

const SLOTS = [
  ['planning', 'Planning'],
  ['architecture', 'Architecture'],
  ['research', 'Research'],
  ['decisions', 'Decisions'],
  ['build-plans', 'Build Plans'],
  ['notes', 'Notes'],
  ['overview', 'Overview'],
  ['tables', 'Tables'],
] as const;

const RECENT = 3;

/** Notion's enhanced Markdown, read as text: tags dropped, structure kept. */
function readable(body: string): string {
  return body
    .replace(
      /<\/?(?:callout|columns?|details|summary|table|tr|td|th|span|page|database|mention-[a-z]+|empty-block)[^>]*>/gi,
      '',
    )
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\t+/gm, '')
    .trim();
}

export function DocsPreview({ project }: { project: Project }) {
  const { space } = useRepositories();
  const nodes = useWatch(space.watchAll);
  const [open, setOpen] = useState<SpaceNode | null>(null);
  if (nodes.status !== 'ready') return null;

  const children = new Map<string, SpaceNode[]>();
  for (const n of nodes.data) {
    if (!n.parentId || n.archived) continue;
    children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  }
  const below = (id: string): SpaceNode[] =>
    (children.get(id) ?? []).flatMap((c) => [...(c.kind === 'section' ? [] : [c]), ...below(c.id)]);
  const byKey = new Map(nodes.data.filter((n) => n.key).map((n) => [n.key!, n]));
  const slots = SLOTS.map(([slot, label]) => {
    const node = byKey.get(`project:${project.id}:${slot}`);
    const docs = node ? below(node.id) : [];
    return {
      slot,
      label,
      docs: docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }).filter((s) => s.docs.length > 0);

  if (slots.length === 0)
    return <p className="text-sm text-fg-muted">No documents for {project.name} in SPACE yet.</p>;

  const now = new Date();
  return (
    <>
      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2 2xl:grid-cols-3">
        {slots.map((s) => (
          <section key={s.slot} aria-label={s.label} className="min-w-0 border-t border-line pt-3">
            <h4 className="flex items-baseline justify-between text-sm font-semibold">
              {s.label}
              <span className="figure text-xs font-normal text-fg-muted">
                {s.docs.length} {s.docs.length === 1 ? 'item' : 'items'}
              </span>
            </h4>
            <ul className="mt-2 space-y-1">
              {s.docs.slice(0, RECENT).map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(d)}
                    className="flex w-full min-w-0 items-baseline gap-2 text-left text-sm hover:underline"
                  >
                    {d.kind === 'table' ? (
                      <Table2
                        aria-hidden
                        className="size-3.5 shrink-0 translate-y-0.5 text-fg-muted"
                      />
                    ) : (
                      <FileText
                        aria-hidden
                        className="size-3.5 shrink-0 translate-y-0.5 text-fg-muted"
                      />
                    )}
                    <span className="min-w-0 truncate">{d.title}</span>
                  </button>
                </li>
              ))}
              {s.docs.length > RECENT && (
                <li className="text-xs text-fg-muted">and {s.docs.length - RECENT} more</li>
              )}
            </ul>
          </section>
        ))}
      </div>
      <Drawer open={open !== null} onClose={() => setOpen(null)} title={open?.title ?? 'Document'}>
        {open && (
          <article className="space-y-3 text-sm">
            <p className="text-xs text-fg-muted">
              Read-only preview · updated{' '}
              <time dateTime={open.updatedAt} title={formatFull(open.updatedAt)}>
                {formatWhen(open.updatedAt, now)}
              </time>
            </p>
            {open.kind === 'table' && open.table ? (
              <p>
                A table with {open.table.rows.length} rows:{' '}
                {open.table.columns.map((c) => c.name).join(', ')}.
              </p>
            ) : open.body ? (
              <div className="leading-relaxed whitespace-pre-wrap">
                {open.bodyFormat === 'notion' ? readable(open.body) : open.body}
              </div>
            ) : (
              <p className="text-fg-muted">This page has no text.</p>
            )}
          </article>
        )}
      </Drawer>
    </>
  );
}
