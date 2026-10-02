import { FileText, Folder, PanelLeft, PanelRight, Plus, Search, Table2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Drawer } from '../../components/layout';
import { Button } from '../../components/ui/Button';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import { PROJECT_SPACE_SLOTS, type ProjectSpaceSlot } from '../../db/repositories';
import { SLOT_TITLES } from '../../db/import/notion/types';
import { formatWhen } from '../../lib/when';
import type { Id, SpaceNode } from '../../types/domain';
import { shortcutLabel } from '../home/shortcut';
import { SpaceDataContext, useSpaceData, type SpaceData } from './context';
import { PageEditor, type SaveState } from './Editor';
import { useEntityLookup } from './entities';
import { Inspector } from './Inspector';
import {
  buildSearch,
  documentsUnder,
  indexNodes,
  pathOf,
  searchDocs,
  type SearchHit,
} from './model';
import { exportNode } from './export';
import { CLAUDE_GUIDE } from './guide';
import { DescriptionField, FolderView, HelpButton, PageMenu, TrashDrawer } from './SpaceExtras';
import { SpaceTree } from './SpaceTree';
import { TableView } from './TableView';

/*
 * SPACE (v2 PHASE 014, ADR-067): LOWTIDE's workspace for project knowledge.
 * Three panes on a desktop (the tree, the page, the context inspector), each
 * resizable or folded away; on a phone the page alone, with the tree and the
 * inspector as sheets. Everything shown is the owner's real hierarchy.
 */

const PANES = 'lowtide.space.panes';

interface Panes {
  tree: number;
  inspector: number;
  treeOpen: boolean;
  inspectorOpen: boolean;
}

const OPENED = 'lowtide.space.opened';

/** Pages opened on this device, newest first: a convenience, not a record. */
function loadOpened(): Id[] {
  try {
    const v = JSON.parse(localStorage.getItem(OPENED) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is Id => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rememberOpened(id: Id) {
  try {
    localStorage.setItem(
      OPENED,
      JSON.stringify([id, ...loadOpened().filter((x) => x !== id)].slice(0, 12)),
    );
  } catch {
    // Not remembered in a private window.
  }
}

function loadPanes(): Panes {
  const fallback: Panes = { tree: 272, inspector: 320, treeOpen: true, inspectorOpen: true };
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(PANES) ?? '{}') as Partial<Panes>) };
  } catch {
    return fallback;
  }
}

function useWide(query: string): boolean {
  const get = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(query).matches;
  const [wide, setWide] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return wide;
}

export function SpacePage() {
  const { space } = useRepositories();
  const all = useWatch(space.watchAll);
  const nodes = useMemo(() => (all.status === 'ready' ? all.data : []), [all]);
  const index = useMemo(() => indexNodes(nodes), [nodes]);
  const lookup = useEntityLookup(nodes);
  const data = useMemo<SpaceData>(() => ({ nodes, index, lookup }), [nodes, index, lookup]);
  useEffect(() => {
    if (all.status === 'ready' && !nodes.some((n) => n.key === 'projects'))
      void space.ensureRoots();
  }, [all.status, nodes, space]);
  if (all.status !== 'ready') return <h1 className="sr-only">SPACE</h1>;
  return (
    <SpaceDataContext.Provider value={data}>
      <Workspace />
    </SpaceDataContext.Provider>
  );
}

function Workspace() {
  const { nodeId, projectId } = useParams();
  const { index } = useSpaceData();
  const navigate = useNavigate();
  const node = nodeId ? index.byId.get(nodeId) : undefined;
  useDocumentTitle(node ? node.title : 'SPACE');
  useEffect(() => {
    if (node && node.kind !== 'section') rememberOpened(node.id);
  }, [node]);
  const desktop = useWide('(min-width: 1024px)');
  const roomy = useWide('(min-width: 1280px)');
  const [panes, setPanes] = useState(loadPanes);
  const [sheet, setSheet] = useState<'tree' | 'inspector' | null>(null);
  const [searching, setSearching] = useState(false);
  const [moving, setMoving] = useState<Id | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [trash, setTrash] = useState(false);
  const { space } = useRepositories();
  // LOWTIDE's own pages (Templates, the AI guide), once SPACE is in use.
  const hasPages = index.byId.size > 0;
  useEffect(() => {
    if (hasPages) void space.ensureSystemPages(CLAUDE_GUIDE).catch(() => undefined);
  }, [space, hasPages]);

  useEffect(() => {
    try {
      localStorage.setItem(PANES, JSON.stringify(panes));
    } catch {
      // Not remembered in a private window.
    }
  }, [panes]);

  // ⌘P / Ctrl P: find a page in SPACE.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const open = useCallback(
    (id: Id) => {
      setSheet(null);
      void navigate(`/space/${id}`);
    },
    [navigate],
  );

  const treeShown = desktop && panes.treeOpen;
  const inspectorShown = desktop && roomy && panes.inspectorOpen && !!node;

  const tree = (
    <SpaceTree
      activeId={node?.id}
      onOpen={open}
      onOpenProject={(id) => {
        setSheet(null);
        void navigate(`/space/project/${id}`);
      }}
      onMoveRequest={setMoving}
      onTrash={() => {
        setSheet(null);
        setTrash(true);
      }}
      onExport={(id) => {
        const n = index.byId.get(id);
        if (n) exportNode(index, n);
      }}
    />
  );

  return (
    <div className="-mx-4 -mt-5 -mb-10 flex h-[calc(100dvh-3rem)] min-w-0 sm:-mx-6 md:-mx-8 md:-mt-8 md:h-dvh xl:-mx-12">
      <h1 className="sr-only">SPACE</h1>
      {treeShown && (
        <>
          <aside
            aria-label="Pages"
            style={{ width: panes.tree }}
            className="flex shrink-0 flex-col border-r border-line bg-canvas"
          >
            {tree}
          </aside>
          <Resizer
            label="Resize pages"
            value={panes.tree}
            min={200}
            max={440}
            onChange={(tree) => setPanes((p) => ({ ...p, tree }))}
          />
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2 sm:px-3">
          <button
            type="button"
            onClick={() =>
              desktop ? setPanes((p) => ({ ...p, treeOpen: !p.treeOpen })) : setSheet('tree')
            }
            aria-label={desktop ? (panes.treeOpen ? 'Hide pages' : 'Show pages') : 'Pages'}
            aria-expanded={desktop ? panes.treeOpen : sheet === 'tree'}
            className="grid size-8 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
          >
            <PanelLeft aria-hidden className="size-4" />
          </button>
          <Breadcrumbs node={node} />
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <span aria-live="polite" className="px-2 text-xs text-fg-muted">
              {saveState === 'saving'
                ? 'Saving…'
                : saveState === 'saved'
                  ? 'Saved'
                  : saveState === 'error'
                    ? 'Not saved yet, retrying'
                    : ''}
            </span>
            <button
              type="button"
              onClick={() => setSearching(true)}
              aria-label={`Find a page (${shortcutLabel().replace('K', 'P')})`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-fg-muted hover:bg-hover hover:text-fg"
            >
              <Search aria-hidden className="size-4" />
              <kbd className="font-sans max-sm:hidden">{shortcutLabel().replace('K', 'P')}</kbd>
            </button>
            <HelpButton />
            {node && <PageMenu node={node} onMove={() => setMoving(node.id)} onOpen={open} />}
            {node && (
              <button
                type="button"
                onClick={() =>
                  desktop && roomy
                    ? setPanes((p) => ({ ...p, inspectorOpen: !p.inspectorOpen }))
                    : setSheet('inspector')
                }
                aria-label={
                  desktop && roomy
                    ? panes.inspectorOpen
                      ? 'Hide details'
                      : 'Show details'
                    : 'Details'
                }
                aria-expanded={desktop && roomy ? panes.inspectorOpen : sheet === 'inspector'}
                className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
              >
                <PanelRight aria-hidden className="size-4" />
              </button>
            )}
          </span>
        </div>
        <div id="space-canvas" className="min-h-0 flex-1 overflow-y-auto">
          {node ? (
            <NodeView key={node.id} node={node} onSaveState={setSaveState} onOpen={open} />
          ) : projectId ? (
            <ProjectPlaceholder projectId={projectId} onOpen={open} />
          ) : nodeId ? (
            <div className="mx-auto max-w-[52rem] px-6 py-16">
              <p className="text-page font-semibold">Page not found</p>
              <p className="mt-2 text-sm text-fg-muted">
                It may have been moved or never existed.{' '}
                <Link to="/space" className="text-accent-ink underline underline-offset-2">
                  Back to SPACE
                </Link>
              </p>
            </div>
          ) : (
            <SpaceHome onOpen={open} />
          )}
        </div>
      </div>

      {inspectorShown && (
        <>
          <Resizer
            label="Resize details"
            value={panes.inspector}
            min={260}
            max={480}
            invert
            onChange={(inspector) => setPanes((p) => ({ ...p, inspector }))}
          />
          <aside
            aria-label="Details"
            style={{ width: panes.inspector }}
            className="lt-pop shrink-0 overflow-y-auto border-l border-line bg-canvas"
          >
            <Inspector node={node!} />
          </aside>
        </>
      )}

      <Drawer open={sheet === 'tree'} onClose={() => setSheet(null)} title="Pages" side="left">
        <div className="-mx-5 -my-4 h-[calc(100dvh-3.5rem)]">{tree}</div>
      </Drawer>
      <Drawer open={sheet === 'inspector' && !!node} onClose={() => setSheet(null)} title="Details">
        <div className="-mx-5 -my-4">{node && <Inspector node={node} />}</div>
      </Drawer>
      <SearchDialog open={searching} onClose={() => setSearching(false)} onOpen={open} />
      <MoveDialog id={moving} onClose={() => setMoving(null)} />
      <TrashDrawer open={trash} onClose={() => setTrash(false)} onOpen={open} />
    </div>
  );
}

/** A pane edge that resizes it by drag or arrow keys. */
function Resizer({
  label,
  value,
  min,
  max,
  invert = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  invert?: boolean;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const delta = (e.key === 'ArrowRight' ? 16 : -16) * (invert ? -1 : 1);
          onChange(clamp(value + delta));
        }
      }}
      onPointerDown={(e) => {
        const start = e.clientX;
        const from = value;
        const onMove = (m: PointerEvent) =>
          onChange(clamp(from + (m.clientX - start) * (invert ? -1 : 1)));
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }}
      className="relative -mx-1 w-2 shrink-0 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-accent focus-visible:after:bg-[var(--lt-focus)]"
    />
  );
}

function Breadcrumbs({ node }: { node: SpaceNode | undefined }) {
  const { index } = useSpaceData();
  const path = node ? pathOf(index, node.id) : [];
  return (
    <nav aria-label="Breadcrumbs" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-1 text-[13px] text-fg-muted">
        <li className="shrink-0">
          <Link to="/space" className="rounded px-1 hover:bg-hover hover:text-fg">
            SPACE
          </Link>
        </li>
        {path.map((p, i) => {
          const last = i === path.length - 1;
          return (
            <li
              key={p.id}
              className={`flex min-w-0 items-center gap-1 ${i < path.length - 2 ? 'max-md:hidden' : ''}`}
            >
              <span aria-hidden className="text-fg-subtle">
                /
              </span>
              {last ? (
                <span aria-current="page" className="truncate text-fg">
                  {p.title}
                </span>
              ) : (
                <Link
                  to={`/space/${p.id}`}
                  className="truncate rounded px-1 hover:bg-hover hover:text-fg"
                >
                  {p.title}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** One node: its page (title and blocks), a table's rows, a section's pages. */
function NodeView({
  node,
  onSaveState,
  onOpen,
}: {
  node: SpaceNode;
  onSaveState: (s: SaveState) => void;
  onOpen: (id: Id) => void;
}) {
  const { index, lookup } = useSpaceData();
  const children = (index.children.get(node.id) ?? []).filter((c) => !c.archived);
  const projectFolder = /^project:([^:]+)$/.exec(node.key ?? '')?.[1];
  if (node.kind === 'section') {
    return (
      <div className="lt-fade px-5 py-8 pb-24 sm:px-10 sm:py-10">
        {node.archived && <ArchivedBanner node={node} />}
        <FolderView
          node={node}
          onOpen={onOpen}
          extra={
            projectFolder && (
              <MissingSlots projectId={projectFolder} existing={children} onOpen={onOpen} />
            )
          }
        />
      </div>
    );
  }
  return (
    <div className="lt-fade px-5 py-8 sm:px-10 sm:py-10">
      {node.archived && <ArchivedBanner node={node} />}
      <div className={node.kind === 'table' ? 'mx-auto max-w-[110rem]' : 'mx-auto max-w-[50rem]'}>
        <PageEditor
          node={node}
          lookup={lookup}
          onSaveState={onSaveState}
          compact={node.kind === 'table' || children.length > 0 || !!projectFolder}
          belowTitle={<DescriptionField node={node} />}
        />
      </div>
      {node.kind === 'table' && (
        <div className="mx-auto max-w-[110rem]">
          <TableView tableId={node.id} />
        </div>
      )}
      {(children.length > 0 || projectFolder) && (
        <section
          aria-label="Pages inside"
          className={`mx-auto max-w-[50rem] ${node.kind === 'table' ? 'mt-12' : 'mt-4'} pb-24`}
        >
          <h2 className="mb-2 text-xs font-semibold text-fg-muted">Inside</h2>
          <ul className="divide-y divide-line border-y border-line">
            {children.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className="flex w-full items-center gap-2.5 px-1 py-2 text-left text-sm hover:bg-hover/60"
                >
                  <KindIcon node={c} />
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  {c.kind === 'section' && (
                    <span className="text-xs text-fg-muted">
                      {documentsUnder(index, c.id).length}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {projectFolder && (
            <MissingSlots projectId={projectFolder} existing={children} onOpen={onOpen} />
          )}
        </section>
      )}
    </div>
  );
}

function ArchivedBanner({ node }: { node: SpaceNode }) {
  const { space } = useRepositories();
  return (
    <div
      role="status"
      className="mx-auto mb-6 flex max-w-[50rem] items-center justify-between gap-3 rounded-md bg-surface px-4 py-2.5 text-sm"
    >
      <span>This page is archived.</span>
      <Button size="sm" onClick={() => void space.restore(node.id)}>
        Restore
      </Button>
    </div>
  );
}

function KindIcon({ node }: { node: SpaceNode }) {
  const Icon = node.kind === 'table' ? Table2 : node.kind === 'section' ? Folder : FileText;
  return <Icon aria-hidden className="size-3.5 shrink-0 text-fg-muted" />;
}

/** A project's standard slots that don't exist yet: made when first used. */
function MissingSlots({
  projectId,
  existing,
  onOpen,
}: {
  projectId: Id;
  existing: SpaceNode[];
  onOpen: (id: Id) => void;
}) {
  const { space } = useRepositories();
  const have = new Set(existing.map((n) => n.key));
  const missing = PROJECT_SPACE_SLOTS.filter((s) => !have.has(`project:${projectId}:${s}`));
  if (missing.length === 0) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-fg-muted">
      <span className="mr-1">Add:</span>
      {missing.map((slot: ProjectSpaceSlot) => (
        <button
          key={slot}
          type="button"
          onClick={() => void space.ensureProjectSpace(projectId, slot).then((n) => onOpen(n.id))}
          className="rounded px-1.5 py-0.5 hover:bg-hover hover:text-fg"
        >
          {SLOT_TITLES[slot]}
        </button>
      ))}
    </p>
  );
}

/** A project with no SPACE folder yet: nothing is made until a page is added. */
function ProjectPlaceholder({ projectId, onOpen }: { projectId: Id; onOpen: (id: Id) => void }) {
  const { space, projects } = useRepositories();
  const all = useWatch(projects.watchAll);
  const project = all.status === 'ready' ? all.data.find((p) => p.id === projectId) : undefined;
  if (all.status === 'ready' && !project)
    return <p className="px-10 py-16 text-sm text-fg-muted">That project doesn’t exist.</p>;
  if (!project) return null;
  return (
    <div className="mx-auto max-w-[50rem] px-6 py-10">
      <h2 className="text-[32px] leading-tight font-semibold tracking-tight">{project.name}</h2>
      <p className="mt-2 text-sm text-fg-muted">
        No pages yet. Its standard sections appear as you use them.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {PROJECT_SPACE_SLOTS.map((slot) => (
          <Button
            key={slot}
            size="sm"
            onClick={() => void space.ensureProjectSpace(projectId, slot).then((n) => onOpen(n.id))}
          >
            <Plus aria-hidden className="size-3.5" /> {SLOT_TITLES[slot]}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** SPACE with nothing open: its sections and what changed lately. */
function SpaceHome({ onOpen }: { onOpen: (id: Id) => void }) {
  const { index, nodes } = useSpaceData();
  const { space } = useRepositories();
  const roots = index.children.get('') ?? [];
  const live = (n: SpaceNode | undefined): n is SpaceNode =>
    !!n && !n.archived && n.kind !== 'section';
  const [openedIds] = useState(loadOpened);
  const opened = openedIds
    .map((id) => index.byId.get(id))
    .filter(live)
    .slice(0, 6);
  const recent = nodes
    .filter(live)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
  const pinned = nodes
    .filter((n) => n.pinnedAt && !n.archived)
    .sort((a, b) => a.pinnedAt!.localeCompare(b.pinnedAt!));
  const projectsRoot = nodes.find((n) => n.key === 'projects');
  const projectFolders = (projectsRoot ? (index.children.get(projectsRoot.id) ?? []) : [])
    .filter((n) => !n.archived)
    .map((n) => ({ node: n, count: documentsUnder(index, n.id).length }))
    .sort((a, b) => b.count - a.count || a.node.title.localeCompare(b.node.title));
  const ideasRoot = nodes.find((n) => n.key === 'ideas');
  const ideas = ideasRoot
    ? documentsUnder(index, ideasRoot.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 6)
    : [];
  const now = new Date();

  const pageRow = (n: SpaceNode, when?: boolean) => {
    const last = n.edits?.at(-1);
    return (
      <li key={n.id}>
        <button
          type="button"
          onClick={() => onOpen(n.id)}
          className="flex w-full items-baseline gap-2.5 px-1 py-2 text-left text-sm hover:bg-hover/60"
        >
          <span className="min-w-0 flex-1 truncate">{n.title || 'Untitled'}</span>
          {when && (
            <span className="shrink-0 text-xs text-fg-muted">
              {last?.by === 'ai-client' ? `${last.client ?? 'AI'} · ` : ''}
              {formatWhen(n.updatedAt, now)}
            </span>
          )}
        </button>
      </li>
    );
  };
  const list = 'divide-y divide-line border-y border-line';
  const heading = 'mb-2 text-xs font-semibold text-fg-muted';

  return (
    <div className="mx-auto max-w-[64rem] px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-[32px] leading-tight font-semibold tracking-tight">SPACE</p>
      <nav aria-label="Sections" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {roots.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onOpen(r.id)}
            className="inline-flex items-center gap-1.5 py-1 text-fg-muted hover:text-fg"
          >
            <Folder aria-hidden className="size-3.5" />
            {r.title}
          </button>
        ))}
      </nav>
      <div className="mt-8 grid gap-x-12 gap-y-10 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-10">
          {pinned.length > 0 && (
            <section aria-label="Pinned">
              <h2 className={heading}>Pinned</h2>
              <ul className={list}>{pinned.map((n) => pageRow(n))}</ul>
            </section>
          )}
          {opened.length > 0 && (
            <section aria-label="Recently opened">
              <h2 className={heading}>Recently opened</h2>
              <ul className={list}>{opened.map((n) => pageRow(n))}</ul>
            </section>
          )}
          <section aria-label="Recently updated">
            <h2 className={heading}>Recently updated</h2>
            {recent.length === 0 ? (
              <p className="text-sm text-fg-muted">No pages yet.</p>
            ) : (
              <ul className={list}>{recent.map((n) => pageRow(n, true))}</ul>
            )}
          </section>
        </div>
        <div className="flex min-w-0 flex-col gap-10">
          {projectFolders.length > 0 && (
            <section aria-label="Projects">
              <h2 className={heading}>Projects</h2>
              <ul className={list}>
                {projectFolders.map(({ node: n, count }) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(n.id)}
                      className="flex w-full items-center gap-2.5 px-1 py-2 text-left text-sm hover:bg-hover/60"
                    >
                      <span className="min-w-0 flex-1 truncate">{n.title}</span>
                      <span className="figure shrink-0 text-xs text-fg-muted">
                        {count} {count === 1 ? 'page' : 'pages'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-label="Ideas">
            <h2 className={heading}>Ideas</h2>
            {ideas.length > 0 ? (
              <ul className={list}>{ideas.map((n) => pageRow(n, true))}</ul>
            ) : (
              <p className="text-sm text-fg-muted">No ideas yet.</p>
            )}
            <Button
              size="sm"
              className="mt-3"
              onClick={async () => {
                const page = await space.create({
                  ...(ideasRoot ? { parentId: ideasRoot.id } : {}),
                  title: 'Untitled',
                  blocks: [],
                });
                onOpen(page.id);
              }}
            >
              <Plus aria-hidden className="size-3.5" /> New page in Ideas
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Finding a page, a table or a decision by anything in it. */
function SearchDialog({
  open,
  onClose,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  onOpen: (id: Id) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { nodes, lookup } = useSpaceData();
  const { projects } = useRepositories();
  const decisions = useWatch(projects.watchAllDecisions);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputId = useId();
  const docs = useMemo(
    () =>
      open
        ? buildSearch(nodes, {
            decisions: decisions.status === 'ready' ? decisions.data : [],
            projectName: lookup.projectName,
          })
        : [],
    [open, nodes, decisions, lookup],
  );
  const hits = useMemo(() => searchDocs(docs, query), [docs, query]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => d.querySelector<HTMLInputElement>('input')?.focus());
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);
  const go = (hit: SearchHit) => {
    onClose();
    if (hit.kind === 'decision') {
      const href = lookup.href({ type: 'decision', id: hit.id });
      if (href) void navigate(href);
    } else onOpen(hit.id);
  };
  const KIND: Record<SearchHit['kind'], string> = {
    page: 'Page',
    table: 'Table',
    section: 'Section',
    decision: 'Decision',
  };
  return (
    <dialog
      ref={ref}
      aria-label="Find in SPACE"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="lt-pop m-auto mt-[12vh] w-[min(40rem,calc(100vw-2rem))] rounded-xl bg-raised p-0 text-fg shadow-[var(--lt-shadow)] backdrop:bg-scrim"
    >
      <div role="search" className="p-3">
        <label htmlFor={inputId} className="sr-only">
          Find in SPACE
        </label>
        <input
          id={inputId}
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={`${inputId}-results`}
          aria-activedescendant={hits[active] ? `${inputId}-${active}` : undefined}
          value={query}
          placeholder="Find a page, table or decision"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(hits.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && hits[active]) {
              e.preventDefault();
              go(hits[active]!);
            }
          }}
          className="h-10 w-full rounded-md border border-line bg-canvas px-3 text-sm"
        />
        <ul
          id={`${inputId}-results`}
          role="listbox"
          aria-label="Results"
          className="mt-2 max-h-[55vh] overflow-y-auto"
        >
          {query.trim() && hits.length === 0 && (
            <li className="px-2 py-3 text-sm text-fg-muted">Nothing matches.</li>
          )}
          {hits.map((h, i) => (
            <li
              key={`${h.kind}:${h.id}`}
              id={`${inputId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(h)}
              className={`cursor-pointer rounded-md px-2.5 py-2 ${i === active ? 'bg-hover' : ''}`}
            >
              <p className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {h.title}
                  {h.archived && (
                    <span className="ml-1.5 text-xs font-normal text-fg-muted">archived</span>
                  )}
                </span>
                <span className="shrink-0 text-[11px] text-fg-muted">{KIND[h.kind]}</span>
              </p>
              {h.location && <p className="truncate text-xs text-fg-muted">{h.location}</p>}
              {h.excerpt && (
                <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{h.excerpt}</p>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 px-1 text-[11px] text-fg-muted">Searches what’s on this device.</p>
      </div>
    </dialog>
  );
}

/** Moving a page under another, by keyboard or pointer. */
function MoveDialog({ id, onClose }: { id: Id | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { index, nodes } = useSpaceData();
  const { space } = useRepositories();
  const [query, setQuery] = useState('');
  const inputId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (id && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
      setQuery('');
      requestAnimationFrame(() => d.querySelector<HTMLInputElement>('input')?.focus());
    } else if (!id && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [id]);
  const moving = id ? index.byId.get(id) : undefined;
  const q = query.trim().toLowerCase();
  const targets = moving
    ? nodes
        .filter(
          (n) =>
            !n.archived &&
            n.id !== moving.id &&
            n.kind !== 'table' &&
            !pathOf(index, n.id).some((a) => a.id === moving.id) &&
            (!q || n.title.toLowerCase().includes(q)),
        )
        .slice(0, 60)
    : [];
  return (
    <dialog
      ref={ref}
      aria-label={moving ? `Move ${moving.title}` : 'Move'}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="lt-pop m-auto mt-[12vh] w-[min(32rem,calc(100vw-2rem))] rounded-xl bg-raised p-3 text-fg shadow-[var(--lt-shadow)] backdrop:bg-scrim"
    >
      <p className="mb-2 text-sm font-medium">Move “{moving?.title}” into…</p>
      <label htmlFor={inputId} className="sr-only">
        Find where to move it
      </label>
      <input
        id={inputId}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a section or page"
        className="h-9 w-full rounded-md border border-line bg-canvas px-3 text-sm"
      />
      <ul className="mt-2 max-h-[50vh] overflow-y-auto">
        {targets.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => {
                if (moving) void space.move(moving.id, t.id);
                onClose();
              }}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover"
            >
              {t.title}
              <span className="ml-2 text-xs text-fg-muted">
                {pathOf(index, t.id)
                  .slice(0, -1)
                  .map((p) => p.title)
                  .join(' / ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </dialog>
  );
}
