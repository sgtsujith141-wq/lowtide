import {
  ChevronRight,
  FileText,
  Folder,
  FolderKanban,
  MoreHorizontal,
  Plus,
  Table2,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { ErrorNotice } from '../../components/ui/Notice';
import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import type { Id, Project, SpaceNode } from '../../types/domain';
import { useSpaceData } from './context';
import { documentsUnder, pathOf } from './model';

/*
 * The SPACE tree (v2 PHASE 014): the real hierarchy, a WAI-ARIA tree. Arrow
 * keys move and open, Enter opens a page, F2 renames, the context key opens
 * its menu. Pages can be dragged before, after or into another. Projects
 * without pages yet appear as quiet placeholders, made only when used.
 */

interface Row {
  id: string;
  node?: SpaceNode;
  /** A live project without a SPACE folder yet. */
  project?: Project;
  level: number;
  hasChildren: boolean;
}

const STORAGE = 'lowtide.space.expanded';

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function SpaceTree({
  activeId,
  onOpen,
  onOpenProject,
  onMoveRequest,
}: {
  activeId: Id | undefined;
  onOpen: (id: Id) => void;
  onOpenProject: (projectId: Id) => void;
  onMoveRequest: (id: Id) => void;
}) {
  const { index, nodes } = useSpaceData();
  const { space, projects } = useRepositories();
  const live = useWatch(projects.watchAll);
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [filter, setFilter] = useState('');
  const [archived, setArchived] = useState(false);
  const [focused, setFocusId] = useState<string | undefined>();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    over?: string;
    zone?: 'before' | 'inside' | 'after';
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const filterId = useId();

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify([...expanded]));
    } catch {
      // A private window: expansion just isn't remembered.
    }
  }, [expanded]);

  // The open page's ancestors open once when it's opened, so the location is
  // visible; after that they fold like any other row.
  const [autoFor, setAutoFor] = useState<string | undefined>();
  if (activeId && autoFor !== activeId) {
    setAutoFor(activeId);
    const ancestors = pathOf(index, activeId)
      .slice(0, -1)
      .map((n) => n.id);
    if (ancestors.some((a) => !expanded.has(a))) setExpanded(new Set([...expanded, ...ancestors]));
  }
  const open = expanded;

  const placeholders = useMemo(() => {
    if (live.status !== 'ready') return [];
    return live.data.filter(
      (p) => p.state !== 'archived' && !nodes.some((n) => n.key === `project:${p.id}`),
    );
  }, [live, nodes]);

  const rows = useMemo<Row[]>(() => {
    const q = filter.trim().toLowerCase();
    const matches = new Set<string>();
    if (q) {
      for (const n of nodes) {
        if ((archived || !n.archived) && n.title.toLowerCase().includes(q)) {
          for (const a of pathOf(index, n.id)) matches.add(a.id);
        }
      }
    }
    const out: Row[] = [];
    const walk = (parent: string, level: number) => {
      const kids = (index.children.get(parent) ?? []).filter(
        (c) => (archived || !c.archived) && (!q || matches.has(c.id)),
      );
      for (const n of kids) {
        const childCount =
          (index.children.get(n.id) ?? []).filter((c) => archived || !c.archived).length +
          (n.key === 'projects' ? placeholders.length : 0);
        out.push({ id: n.id, node: n, level, hasChildren: childCount > 0 });
        if (q || open.has(n.id)) {
          walk(n.id, level + 1);
          if (n.key === 'projects' && !q) {
            for (const p of placeholders) {
              out.push({ id: `project:${p.id}`, project: p, level: level + 1, hasChildren: false });
            }
          }
        }
      }
    };
    walk('', 1);
    return out;
  }, [index, nodes, filter, archived, open, placeholders]);
  const focusId =
    focused && rows.some((r) => r.id === focused) ? focused : (activeId ?? rows[0]?.id);

  const focusRow = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    requestAnimationFrame(() => refs.current.get(id)?.focus());
  };

  const toggle = (id: string, open?: boolean) =>
    setExpanded((e) => {
      const next = new Set(e);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  const run = (p: Promise<unknown>, failure = 'That didn’t work. Nothing changed.') =>
    p.then(
      () => setError(null),
      () => setError(failure),
    );

  async function createInside(parent: SpaceNode) {
    const page = await space.create({ parentId: parent.id, title: 'Untitled', blocks: [] });
    toggle(parent.id, true);
    onOpen(page.id);
  }

  function activate(row: Row) {
    setFocusId(undefined);
    if (row.project) onOpenProject(row.project.id);
    else if (row.node) onOpen(row.node.id);
  }

  function onKey(row: Row, i: number, e: KeyboardEvent) {
    if (renaming) return;
    const go = (to: number) => {
      e.preventDefault();
      focusRow(rows[Math.max(0, Math.min(rows.length - 1, to))]?.id);
    };
    switch (e.key) {
      case 'ArrowDown':
        return go(i + 1);
      case 'ArrowUp':
        return go(i - 1);
      case 'Home':
        return go(0);
      case 'End':
        return go(rows.length - 1);
      case 'ArrowRight':
        e.preventDefault();
        if (row.hasChildren && !open.has(row.id)) toggle(row.id, true);
        else if (row.hasChildren) focusRow(rows[i + 1]?.id);
        return;
      case 'ArrowLeft': {
        e.preventDefault();
        if (row.hasChildren && open.has(row.id)) toggle(row.id, false);
        else {
          for (let j = i - 1; j >= 0; j--) {
            if (rows[j]!.level < row.level) return focusRow(rows[j]!.id);
          }
        }
        return;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        return activate(row);
      case 'F2':
        if (row.node && !row.node.key) {
          e.preventDefault();
          setRenaming(row.id);
        }
        return;
      case 'ContextMenu':
        e.preventDefault();
        if (row.node) setMenu(row.id);
        return;
      default:
        if (e.key === 'F10' && e.shiftKey && row.node) {
          e.preventDefault();
          setMenu(row.id);
        }
    }
  }

  function onDragOver(row: Row, e: DragEvent) {
    if (!drag || !row.node || row.id === drag.id) return;
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - box.top) / box.height;
    const zone =
      row.node.key && !row.node.parentId
        ? 'inside'
        : y < 0.25
          ? 'before'
          : y > 0.75
            ? 'after'
            : 'inside';
    if (drag.over !== row.id || drag.zone !== zone) setDrag({ ...drag, over: row.id, zone });
  }

  function onDrop(row: Row, e: DragEvent) {
    e.preventDefault();
    const target = row.node;
    const d = drag;
    setDrag(null);
    if (!d || !target || !d.zone || target.id === d.id) return;
    if (pathOf(index, target.id).some((a) => a.id === d.id)) {
      setError('A page can’t move inside itself.');
      return;
    }
    if (d.zone === 'inside') {
      toggle(target.id, true);
      void run(space.move(d.id, target.id));
    } else {
      void run(
        space.move(d.id, target.parentId ?? null, target.order + (d.zone === 'after' ? 1 : 0)),
      );
    }
  }

  return (
    <nav aria-label="SPACE pages" className="flex h-full min-h-0 flex-col">
      <div className="px-3 pt-3 pb-2">
        <label htmlFor={filterId} className="sr-only">
          Filter pages
        </label>
        <input
          id={filterId}
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter pages"
          className="h-8 w-full rounded-md border border-line bg-canvas px-2.5 text-sm placeholder:text-fg-subtle"
        />
      </div>
      {error && (
        <div className="px-3">
          <ErrorNotice>{error}</ErrorNotice>
        </div>
      )}
      <ul role="tree" aria-label="SPACE" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {rows.map((row, i) => (
          <TreeRow
            key={row.id}
            row={row}
            active={row.id === activeId}
            focusable={row.id === focusId}
            expanded={open.has(row.id)}
            renaming={renaming === row.id}
            menuOpen={menu === row.id}
            dropZone={drag?.over === row.id ? drag.zone : undefined}
            count={
              row.node?.kind === 'section' && row.level <= 2
                ? documentsUnder(index, row.node.id).length
                : undefined
            }
            setRef={(el) => {
              if (el) refs.current.set(row.id, el);
              else refs.current.delete(row.id);
            }}
            onFocus={() => setFocusId(row.id)}
            onToggle={() => toggle(row.id)}
            onActivate={() => activate(row)}
            onKeyDown={(e) => onKey(row, i, e)}
            onRename={(title) => {
              setRenaming(null);
              focusRow(row.id);
              if (row.node && title.trim() && title.trim() !== row.node.title) {
                void run(space.update(row.node.id, { title }));
              }
            }}
            onMenu={(open) => setMenu(open ? row.id : null)}
            onCreateInside={() => row.node && void run(createInside(row.node))}
            onStartRename={() => setRenaming(row.id)}
            onDuplicate={() =>
              row.node && void run(space.duplicate(row.node.id).then((c) => onOpen(c.id)))
            }
            onMove={() => row.node && onMoveRequest(row.node.id)}
            onArchive={() =>
              row.node &&
              void run(row.node.archived ? space.restore(row.node.id) : space.archive(row.node.id))
            }
            onDragStart={() => row.node && !row.node.key && setDrag({ id: row.node.id })}
            onDragOver={(e) => onDragOver(row, e)}
            onDrop={(e) => onDrop(row, e)}
            onDragEnd={() => setDrag(null)}
          />
        ))}
      </ul>
      <label className="flex items-center gap-2 border-t border-line px-3 py-2 text-xs text-fg-muted">
        <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
        Show archived
      </label>
    </nav>
  );
}

function TreeRow({
  row,
  active,
  focusable,
  expanded,
  renaming,
  menuOpen,
  dropZone,
  count,
  setRef,
  onFocus,
  onToggle,
  onActivate,
  onKeyDown,
  onRename,
  onMenu,
  onCreateInside,
  onStartRename,
  onDuplicate,
  onMove,
  onArchive,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  row: Row;
  active: boolean;
  focusable: boolean;
  expanded: boolean;
  renaming: boolean;
  menuOpen: boolean;
  dropZone: 'before' | 'inside' | 'after' | undefined;
  count: number | undefined;
  setRef: (el: HTMLElement | null) => void;
  onFocus: () => void;
  onToggle: () => void;
  onActivate: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onRename: (title: string) => void;
  onMenu: (open: boolean) => void;
  onCreateInside: () => void;
  onStartRename: () => void;
  onDuplicate: () => void;
  onMove: () => void;
  onArchive: () => void;
  onDragStart: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const node = row.node;
  const title = node?.title ?? row.project?.name ?? '';
  const Icon = row.project
    ? FolderKanban
    : node?.kind === 'table'
      ? Table2
      : node?.kind === 'section'
        ? node.key?.startsWith('project:') && !node.key.slice(8).includes(':')
          ? FolderKanban
          : Folder
        : FileText;
  return (
    <li
      ref={setRef}
      role="treeitem"
      aria-level={row.level}
      aria-selected={active}
      aria-expanded={row.hasChildren ? expanded : undefined}
      aria-label={`${title}${node?.archived ? ' (archived)' : ''}${row.project ? ' (no pages yet)' : ''}`}
      tabIndex={focusable ? 0 : -1}
      draggable={!!node && !node.key && !renaming}
      onFocus={(e) => e.target === e.currentTarget && onFocus()}
      onKeyDown={(e) => e.target === e.currentTarget && onKeyDown(e)}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className="relative outline-none focus-visible:[&>div]:ring-2 focus-visible:[&>div]:ring-[var(--lt-focus)]"
    >
      <div
        onClick={onActivate}
        style={{ paddingLeft: 6 + (row.level - 1) * 14 }}
        className={`group/row flex h-8 cursor-pointer items-center gap-1 rounded-md pr-1 text-[13px] transition-colors ${
          active ? 'bg-hover font-medium text-fg' : 'text-fg-muted hover:bg-hover/70 hover:text-fg'
        } ${node?.archived || row.project ? 'opacity-60' : ''} ${
          dropZone === 'inside' ? 'ring-1 ring-accent' : ''
        } ${dropZone === 'before' ? 'shadow-[0_-2px_0_var(--lt-accent)]' : dropZone === 'after' ? 'shadow-[0_2px_0_var(--lt-accent)]' : ''}`}
      >
        <span
          aria-hidden
          onClick={(e) => {
            e.stopPropagation();
            if (row.hasChildren) onToggle();
          }}
          className="grid size-5 shrink-0 place-items-center rounded hover:bg-hover"
        >
          {row.hasChildren && (
            <ChevronRight
              className={`size-3.5 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
            />
          )}
        </span>
        <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
        {renaming ? (
          <input
            autoFocus
            aria-label="New name"
            defaultValue={title}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') onRename(e.currentTarget.value);
              if (e.key === 'Escape') onRename(title);
            }}
            onBlur={(e) => onRename(e.currentTarget.value)}
            className="h-6 min-w-0 flex-1 rounded border border-line bg-canvas px-1 text-[13px] text-fg"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{title || 'Untitled'}</span>
        )}
        {count !== undefined && count > 0 && !renaming && (
          <span aria-hidden className="figure text-[11px] text-fg-subtle group-hover/row:hidden">
            {count}
          </span>
        )}
        {node && !renaming && (
          <span className="hidden items-center group-hover/row:flex">
            <button
              type="button"
              tabIndex={-1}
              aria-label={`New page inside ${title}`}
              title="New page inside"
              onClick={(e) => {
                e.stopPropagation();
                onCreateInside();
              }}
              className="grid size-6 place-items-center rounded hover:bg-hover"
            >
              <Plus aria-hidden className="size-3.5" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Options for ${title}`}
              title="Options"
              onClick={(e) => {
                e.stopPropagation();
                onMenu(!menuOpen);
              }}
              className="grid size-6 place-items-center rounded hover:bg-hover"
            >
              <MoreHorizontal aria-hidden className="size-3.5" />
            </button>
          </span>
        )}
      </div>
      {menuOpen && node && (
        <RowMenu
          node={node}
          onClose={() => onMenu(false)}
          actions={{ onCreateInside, onStartRename, onDuplicate, onMove, onArchive }}
        />
      )}
    </li>
  );
}

function RowMenu({
  node,
  onClose,
  actions,
}: {
  node: SpaceNode;
  onClose: () => void;
  actions: {
    onCreateInside: () => void;
    onStartRename: () => void;
    onDuplicate: () => void;
    onMove: () => void;
    onArchive: () => void;
  };
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const maintained = !!node.key;
  const items: [string, () => void, boolean][] = [
    ['New page inside', actions.onCreateInside, true],
    ['Rename', actions.onStartRename, !maintained],
    ['Duplicate', actions.onDuplicate, !maintained && node.kind !== 'section'],
    ['Move to…', actions.onMove, !maintained],
    [node.archived ? 'Restore' : 'Archive', actions.onArchive, !maintained],
  ];
  return (
    <div
      role="menu"
      aria-label={`Options for ${node.title}`}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
      className="lt-pop absolute right-1 z-30 mt-0.5 w-44 rounded-lg border border-line bg-raised p-1 text-sm shadow-[var(--lt-shadow)]"
    >
      {items
        .filter(([, , show]) => show)
        .map(([label, act], i) => (
          <button
            key={label}
            ref={i === 0 ? first : undefined}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              act();
            }}
            className="flex w-full rounded-md px-2 py-1.5 text-left hover:bg-hover focus-visible:bg-hover"
          >
            {label}
          </button>
        ))}
    </div>
  );
}
