import { ArrowRight, ExternalLink, Link2, Lock, Play, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { formatFull, formatWhen } from '../../lib/when';
import { useRepositories } from '../../hooks/useRepositories';
import { useToday } from '../../hooks/useToday';
import { useWatch } from '../../hooks/useWatch';
import { linksOf } from '../../lib/space-blocks';
import {
  LINKABLE_TYPES,
  type EntityLink,
  type LinkableType,
  type SpaceEditKind,
  type SpaceNode,
} from '../../types/domain';
import { milestoneCount, nowNext } from '../projects/display';
import { FOCUS_LABEL, STATE_LABEL } from '../projects/summary';
import { useProjectSummaries } from '../projects/useProjectSummaries';
import { shortDuration } from '../modes/clocks';
import { useModeApi } from '../modes/mode-context';
import { activeMs } from '../work/duration';
import { useNow } from '../../hooks/useNow';
import { useSpaceData } from './context';
import { LINK_WORD } from './entities';
import { backlinksOf, documentsUnder, isPersonal, pathOf, projectIdOf } from './model';

/*
 * The context inspector (v2 PHASE 014): where a page lives, the live state of
 * the project it belongs to, what it links to and what links to it, where it
 * came from, and who changed it. Compact; it never repeats long prose.
 */

const EDIT_WORD: Record<SpaceEditKind, string> = {
  created: 'Created',
  edited: 'Edited',
  renamed: 'Renamed',
  moved: 'Moved',
  archived: 'Archived',
  restored: 'Restored',
  table: 'Changed the table',
  linked: 'Changed links',
};

const PICKABLE: LinkableType[] = [
  'project',
  'task',
  'milestone',
  'decision',
  'hackathon',
  'spaceNode',
];

export function Inspector({ node }: { node: SpaceNode }) {
  const { index, nodes, lookup } = useSpaceData();
  const { space } = useRepositories();
  const projectId = projectIdOf(index, node.id);
  const links = linksOf(node).filter(
    (l) => !(l.type === 'project' && l.id === projectId && node.key),
  );
  const backlinks = useMemo(() => backlinksOf(nodes, node.id), [nodes, node.id]);
  const personal = isPersonal(index, node.id);
  const path = pathOf(index, node.id);
  const now = new Date();
  const [linking, setLinking] = useState(false);
  const aiEdits = (node.edits ?? []).filter((e) => e.by === 'ai-client');

  return (
    <div className="space-y-6 px-4 py-4 text-sm">
      {personal && (
        <p className="flex items-start gap-2 rounded-md bg-surface px-3 py-2 text-xs text-fg-muted">
          <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Personal: AI clients can’t see it unless you allow Personal SPACE for a connection.
        </p>
      )}

      {projectId && <ProjectContext projectId={projectId} />}

      <Section title="Location">
        <p className="leading-relaxed">
          {path.slice(0, -1).map((p, i) => (
            <span key={p.id}>
              {i > 0 && <span className="text-fg-subtle"> / </span>}
              <Link to={`/space/${p.id}`} className="hover:underline">
                {p.title}
              </Link>
            </span>
          ))}
          {path.length <= 1 && <span className="text-fg-muted">Top level</span>}
        </p>
      </Section>

      <Section
        title={`Links${links.length ? ` · ${links.length}` : ''}`}
        action={
          <button
            type="button"
            onClick={() => setLinking((v) => !v)}
            aria-expanded={linking}
            className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
          >
            <Plus aria-hidden className="size-3" /> Link
          </button>
        }
      >
        {linking && (
          <LinkPicker
            onPick={(link) => {
              setLinking(false);
              void space.addLink(node.id, link);
            }}
            selfId={node.id}
          />
        )}
        {links.length === 0 ? (
          <p className="text-fg-muted">None yet.</p>
        ) : (
          <ul className="space-y-1">
            {links.map((l) => (
              <LinkRow
                key={`${l.type}:${l.id}:${l.rowId ?? ''}`}
                link={l}
                removable={node.links.some((x) => x.type === l.type && x.id === l.id)}
                onRemove={() => void space.removeLink(node.id, l)}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Referenced by">
        {backlinks.length === 0 ? (
          <p className="text-fg-muted">No page links here yet.</p>
        ) : (
          <>
            <p className="mb-1 text-xs text-fg-muted">
              {backlinks.length} {backlinks.length === 1 ? 'page' : 'pages'}
            </p>
            <ul className="space-y-1">
              {backlinks.slice(0, 12).map((b) => (
                <li key={b.id}>
                  <Link to={`/space/${b.id}`} className="hover:underline">
                    {b.title}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {node.source && (
        <Section title="Source">
          <p>Imported from Notion</p>
          <details className="mt-1 text-xs text-fg-muted">
            <summary className="cursor-pointer select-none hover:text-fg">
              Where it came from
            </summary>
            <p className="mt-1">“{node.source.originalTitle}”</p>
            {node.source.path && node.source.path.length > 0 && (
              <p>{node.source.path.join(' / ')}</p>
            )}
            <p className="mt-1">
              Brought in {formatWhen(node.source.importedAt, now)}
              {node.blocks ? '; edited in LOWTIDE since (the original is kept)' : ''}.
            </p>
          </details>
          {node.source.url && (
            <a
              href={node.source.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
            >
              Original in Notion <ExternalLink aria-hidden className="size-3" />
            </a>
          )}
        </Section>
      )}

      {node.attachments.length > 0 && (
        <Section title="Files">
          <ul className="space-y-1">
            {node.attachments.map((a) => (
              <li key={a.id}>
                {a.name}
                <span className="block text-xs text-fg-muted">
                  {a.status === 'external' ? 'External reference, not downloaded' : 'Stored'}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <details className="group">
        <summary className="cursor-pointer text-xs font-semibold text-fg-muted select-none hover:text-fg">
          History{aiEdits.length > 0 ? ' and AI activity' : ''}
        </summary>
        <div className="mt-2">
          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-fg-muted">Created</dt>
            <dd title={formatFull(node.createdAt)}>{formatWhen(node.createdAt, now)}</dd>
            <dt className="text-fg-muted">Updated</dt>
            <dd title={formatFull(node.updatedAt)}>{formatWhen(node.updatedAt, now)}</dd>
            {aiEdits.length > 0 && (
              <>
                <dt className="text-fg-muted">AI activity</dt>
                <dd>
                  {aiEdits.length} {aiEdits.length === 1 ? 'change' : 'changes'} by{' '}
                  {[...new Set(aiEdits.map((e) => e.client ?? 'an AI client'))].join(', ')}
                </dd>
              </>
            )}
          </dl>
          {(node.edits?.length ?? 0) > 0 && (
            <ol className="mt-3 space-y-1.5 border-l border-line pl-3 text-xs">
              {[...(node.edits ?? [])]
                .reverse()
                .slice(0, 12)
                .map((e, i) => (
                  <li key={i}>
                    <span className="font-medium">
                      {e.by === 'ai-client' ? (e.client ?? 'AI client') : 'You'}
                    </span>{' '}
                    <span className="text-fg-muted">
                      {EDIT_WORD[e.kind].toLowerCase()}
                      {e.count > 1 ? ` (${e.count} saves)` : ''} ·{' '}
                      <time dateTime={e.at} title={formatFull(e.at)}>
                        {formatWhen(e.at, now)}
                      </time>
                    </span>
                  </li>
                ))}
            </ol>
          )}
        </div>
      </details>

      <details>
        <summary className="cursor-pointer text-xs font-semibold text-fg-muted select-none hover:text-fg">
          Technical details
        </summary>
        <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-xs break-all">
          <dt className="text-fg-muted">Id</dt>
          <dd>{node.id}</dd>
          <dt className="text-fg-muted">Revision</dt>
          <dd>{node.revision ?? 0}</dd>
          {node.key && (
            <>
              <dt className="text-fg-muted">Kept by</dt>
              <dd>LOWTIDE ({node.key})</dd>
            </>
          )}
        </dl>
      </details>
    </div>
  );

  function LinkRow({
    link,
    removable,
    onRemove,
  }: {
    link: EntityLink;
    removable: boolean;
    onRemove: () => void;
  }) {
    const href = lookup.href(link);
    return (
      <li className="group/link flex items-center gap-2">
        <Link2 aria-hidden className="size-3 shrink-0 text-fg-subtle" />
        {href ? (
          <Link to={href} className="min-w-0 truncate hover:underline">
            {lookup.label(link)}
          </Link>
        ) : (
          <span className="min-w-0 truncate text-fg-muted">{lookup.label(link)}</span>
        )}
        <span className="ml-auto shrink-0 text-[11px] text-fg-muted">{LINK_WORD[link.type]}</span>
        {removable && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove link to ${lookup.label(link)}`}
            className="grid size-5 place-items-center rounded text-fg-subtle opacity-0 group-hover/link:opacity-100 hover:text-fg focus-visible:opacity-100"
          >
            <X aria-hidden className="size-3" />
          </button>
        )}
      </li>
    );
  }
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title.replace(/ · \d+$/, '')}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The live state of the page's project, linking into its Command Room. */
function ProjectContext({ projectId }: { projectId: string }) {
  const today = useToday();
  const data = useProjectSummaries(today);
  const { projects } = useRepositories();
  const decisions = useWatch(projects.watchAllDecisions);
  const { index, nodes } = useSpaceData();
  const s = data?.summaries.find((x) => x.project.id === projectId);
  if (!s) return null;
  const { now, next } = nowNext(s);
  const folder = nodes.find((n) => n.key === `project:${projectId}`);
  const pages = folder ? documentsUnder(index, folder.id).length : 0;
  const taskCount = [...s.lanes.working_now, ...s.lanes.next, ...s.lanes.done].filter(
    (e) => e.kind === 'task',
  ).length;
  const decisionCount =
    decisions.status === 'ready'
      ? decisions.data.filter((d) => d.projectId === projectId).length
      : 0;
  return (
    <section aria-label="Project" className="border-b border-line pb-5">
      <h3 className="text-[15px] font-semibold">
        <Link to={`/projects/${s.project.slug}`} className="hover:underline">
          {s.project.name}
        </Link>
      </h3>
      <p className="mt-0.5 text-xs text-fg-muted">
        {STATE_LABEL[s.project.state]}
        {s.project.focus ? ` · ${FOCUS_LABEL[s.project.focus]}` : ''}
      </p>
      {s.completion && (
        <p className="mt-3">
          <span className="figure text-2xl font-semibold text-projects-4">
            {s.completion.percent}%
          </span>
          <span className="ml-2 text-xs text-fg-muted">{milestoneCount(s.milestones)}</span>
        </p>
      )}
      <dl className="mt-3 space-y-2">
        {now && (
          <div>
            <dt className="text-[11px] text-fg-muted">Current</dt>
            <dd>{now}</dd>
          </div>
        )}
        {next && (
          <div>
            <dt className="text-[11px] text-fg-muted">Next</dt>
            <dd>{next}</dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-xs text-fg-muted">
        {taskCount} {taskCount === 1 ? 'task' : 'tasks'} · {decisionCount}{' '}
        {decisionCount === 1 ? 'decision' : 'decisions'} · {s.milestones.length}{' '}
        {s.milestones.length === 1 ? 'milestone' : 'milestones'} · {pages} SPACE{' '}
        {pages === 1 ? 'page' : 'pages'}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link
          to={`/projects/${s.project.slug}`}
          className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          Open Command Room <ArrowRight aria-hidden className="size-3" />
        </Link>
        <WorkHere projectId={projectId} />
      </div>
    </section>
  );
}

/** Working on this project now, or a way to start. */
function WorkHere({ projectId }: { projectId: string }) {
  const modes = useModeApi();
  const now = useNow(!!modes.work, 30_000);
  if (modes.work?.projectId === projectId)
    return (
      <button
        type="button"
        onClick={() => modes.setFocusOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs text-work-4 hover:underline"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-work-3" />
        Working now · {shortDuration(activeMs(modes.work, now))}
      </button>
    );
  if (modes.work || modes.offTime) return null;
  return (
    <button
      type="button"
      onClick={() => modes.openStartWork({ projectId })}
      className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
    >
      <Play aria-hidden className="size-3" /> Start work
    </button>
  );
}

function LinkPicker({ onPick, selfId }: { onPick: (link: EntityLink) => void; selfId: string }) {
  const { lookup } = useSpaceData();
  const [type, setType] = useState<LinkableType>('project');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const options = lookup
    .options(type)
    .filter((o) => o.id !== selfId && (!q || o.label.toLowerCase().includes(q)))
    .slice(0, 20);
  return (
    <div className="mb-3 space-y-2 rounded-md border border-line p-2">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="link-type">
          Kind
        </label>
        <select
          id="link-type"
          value={type}
          onChange={(e) => setType(e.target.value as LinkableType)}
          className="h-8 rounded-md border border-line bg-raised px-1.5 text-xs"
        >
          {LINKABLE_TYPES.filter((t) => PICKABLE.includes(t)).map((t) => (
            <option key={t} value={t}>
              {LINK_WORD[t]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="link-query">
          Find
        </label>
        <input
          id="link-query"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find"
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-xs"
        />
      </div>
      <ul className="max-h-48 overflow-y-auto">
        {options.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onPick({ type: o.type, id: o.id, label: o.label })}
              className="w-full truncate rounded px-1.5 py-1 text-left text-xs hover:bg-hover"
            >
              {o.label}
              {o.detail && <span className="ml-1 text-fg-muted">· {o.detail}</span>}
            </button>
          </li>
        ))}
        {options.length === 0 && (
          <li className="px-1.5 py-1 text-xs text-fg-muted">Nothing found.</li>
        )}
      </ul>
    </div>
  );
}
