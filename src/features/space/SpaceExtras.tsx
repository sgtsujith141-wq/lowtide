import {
  ArchiveRestore,
  CircleHelp,
  Download,
  FileText,
  Folder,
  FolderInput,
  MoreHorizontal,
  Plus,
  Table2,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Drawer, Modal } from '../../components/layout';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import { useRepositories } from '../../hooks/useRepositories';
import { parseBody } from '../../lib/space-blocks';
import { parseCsv } from '../../lib/space-database';
import { exportNode } from './export';
import { formatWhen } from '../../lib/when';
import type { Id, SpaceNode } from '../../types/domain';
import { useCreate, type CreateKind } from '../create/create-context';
import { useSpaceData } from './context';
import { documentsUnder } from './model';

/*
 * SPACE, made obvious (v2.1): the folder view, page options, Trash, import
 * and export, and a short guide. Everything here works the same with a
 * mouse, a keyboard or a finger; shortcuts only speed things up.
 */

/* --------------------------------- Trash -------------------------------- */

/** Archived pages, folders and databases: restore them, or delete them for good. */
export function TrashDrawer({
  open,
  onClose,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  onOpen: (id: Id) => void;
}) {
  const { index, nodes } = useSpaceData();
  const { space } = useRepositories();
  const [confirm, setConfirm] = useState<Id | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only the top of each archived branch (its contents go with it).
  const archived = nodes
    .filter((n) => n.archived && !index.byId.get(n.parentId ?? '')?.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <Drawer open={open} onClose={onClose} title="Trash">
      <p className="text-sm text-fg-muted">
        Archived pages stay here until you restore them. Deleting for good can’t be undone.
      </p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {archived.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">The Trash is empty.</p>
      ) : (
        <ul aria-label="Archived" className="mt-4 divide-y divide-line border-y border-line">
          {archived.map((n) => {
            const inside = documentsUnder(index, n.id, true).length;
            return (
              <li key={n.id} className="py-2.5">
                <div className="flex items-start gap-2">
                  <KindIcon node={n} />
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpen(n.id);
                    }}
                    className="min-w-0 flex-1 text-left text-sm hover:underline"
                  >
                    {n.title}
                    <span className="block text-xs text-fg-muted">
                      Archived {formatWhen(n.updatedAt, new Date())}
                      {inside ? ` · ${inside} inside` : ''}
                    </span>
                  </button>
                </div>
                {confirm === n.id ? (
                  <div role="alert" className="mt-2 rounded-md bg-danger/10 px-3 py-2 text-sm">
                    <p>
                      Delete “{n.title}”{inside ? ` and the ${inside} pages inside` : ''} for good?
                      This can’t be undone.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() =>
                          void space.deletePermanently(n.id).then(
                            () => setConfirm(null),
                            (e: unknown) =>
                              setError(e instanceof Error ? e.message : 'Couldn’t delete that.'),
                          )
                        }
                      >
                        Delete forever
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                        Keep it
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1.5 flex gap-1 pl-6">
                    <Button size="sm" variant="ghost" onClick={() => void space.restore(n.id)}>
                      <ArchiveRestore aria-hidden className="size-3.5" /> Restore {n.title}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(n.id)}>
                      <Trash2 aria-hidden className="size-3.5" /> Delete forever…
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}

export function KindIcon({ node }: { node: SpaceNode }) {
  const Icon = node.kind === 'table' ? Table2 : node.kind === 'section' ? Folder : FileText;
  return <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-muted" />;
}

/* ------------------------------ page options ----------------------------- */

/** The open page's “…” menu: pin, duplicate, move, template, export, archive. */
export function PageMenu({
  node,
  onMove,
  onOpen,
}: {
  node: SpaceNode;
  onMove: () => void;
  onOpen: (id: Id) => void;
}) {
  const { index, nodes } = useSpaceData();
  const { space } = useRepositories();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);
  const maintained = !!node.key;
  const templates = nodes.find((n) => n.key === 'lowtide:templates');
  const items: [string, () => void, boolean][] = [
    [node.pinnedAt ? 'Unpin' : 'Pin', () => void space.setPinned(node.id, !node.pinnedAt), true],
    [
      node.kind === 'section' ? 'Duplicate with contents' : 'Duplicate',
      () =>
        void space
          .duplicateTree(node.id, { deep: node.kind === 'section' })
          .then((c) => onOpen(c.id)),
      !maintained,
    ],
    ['Move to…', onMove, !maintained],
    [
      'Save as template',
      () =>
        templates &&
        void space
          .duplicateTree(node.id, { parentId: templates.id })
          .then((c) => space.update(c.id, { title: node.title }).then(() => onOpen(c.id))),
      !!templates && node.kind !== 'section',
    ],
    ['Export', () => exportNode(index, node), true],
    [
      node.archived ? 'Restore' : 'Archive',
      () => void (node.archived ? space.restore(node.id) : space.archive(node.id)),
      !maintained,
    ],
  ];
  return (
    <span className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Page options"
        title="Page options"
        onClick={() => setOpen((o) => !o)}
        className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={`Options for ${node.title}`}
          onKeyDown={(e) => {
            const list = [
              ...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]'),
            ];
            const at = list.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === 'Escape') {
              setOpen(false);
              button.current?.focus();
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              list[(at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
            }
          }}
          className="lt-pop absolute top-full right-0 z-40 mt-1 w-52 rounded-lg border border-line bg-raised p-1 text-sm shadow-[var(--lt-shadow)]"
        >
          {items
            .filter(([, , show]) => show)
            .map(([label, act]) => (
              <button
                key={label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  act();
                }}
                className="flex w-full rounded-md px-2 py-1.5 text-left hover:bg-hover focus-visible:bg-hover"
              >
                {label}
              </button>
            ))}
        </div>
      )}
    </span>
  );
}

/* --------------------------------- guide -------------------------------- */

export function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="How SPACE works"
        title="How SPACE works"
        className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
      >
        <CircleHelp aria-hidden className="size-4" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="How SPACE works">
        <dl className="space-y-3 text-sm">
          {[
            ['Create', 'Use + New (or the + beside a folder) for a page, a folder or a database.'],
            [
              'Write',
              'Open a page and type. Press / for headings, lists, tables and links; [[ links another page.',
            ],
            [
              'Organise',
              'Drag pages and folders in the tree, or use Move to… in a page’s options.',
            ],
            ['Find', '⌘P (Ctrl P) finds any page; ⌘K searches everything in LOWTIDE.'],
            [
              'Ask Claude',
              'Claude can create, write and reorganise SPACE for you. Every change is shown under AI, and you can undo it.',
            ],
          ].map(([term, text]) => (
            <div key={term}>
              <dt className="font-medium">{term}</dt>
              <dd className="text-fg-muted">{text}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </>
  );
}

/* --------------------------------- import -------------------------------- */

/** A Markdown or text file becomes a page; a CSV file a database. */
export function ImportDialog({
  parentId,
  open,
  onClose,
  onOpen,
}: {
  parentId: Id | undefined;
  open: boolean;
  onClose: () => void;
  onOpen: (id: Id) => void;
}) {
  const { space } = useRepositories();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <Modal open={open} onClose={onClose} title="Import into SPACE">
      <p className="text-sm text-fg-muted">
        A Markdown or text file becomes a page. A CSV file becomes a database (the first row names
        its properties).
      </p>
      <label htmlFor={id} className={`${labelClass} mt-4`}>
        Choose a file
      </label>
      <input
        id={id}
        type="file"
        accept=".md,.markdown,.txt,.csv,text/markdown,text/plain,text/csv"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file || !parentId) return;
          setBusy(true);
          setError(null);
          try {
            const text = await file.text();
            const title = file.name.replace(/\.(md|markdown|txt|csv)$/i, '') || 'Imported';
            let node: SpaceNode;
            if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
              const [head, ...rows] = parseCsv(text);
              if (!head?.length) throw new Error('That CSV has no header row.');
              const columns = head.map((name, i) => ({
                id: `c${i + 1}`,
                name: name.trim() || `Column ${i + 1}`,
                type: 'text' as const,
              }));
              node = await space.create({
                parentId,
                title,
                table: {
                  columns,
                  rows: rows.map((r, i) => ({
                    id: `r${i + 1}`,
                    cells: Object.fromEntries(
                      columns.flatMap((c, j) => (r[j]?.trim() ? [[c.id, r[j]!]] : [])),
                    ),
                  })),
                },
              });
            } else {
              const body = text.replace(/^#\s+(.+)\n/, '');
              node = await space.create({ parentId, title, blocks: parseBody(body) });
            }
            onClose();
            onOpen(node.id);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Couldn’t import that file.');
          } finally {
            setBusy(false);
          }
        }}
        className={`${fieldClass} file:mr-3 file:rounded-md file:border file:border-line file:bg-raised file:px-2 file:py-1 file:text-sm`}
      />
      {error && <ErrorNotice>{error}</ErrorNotice>}
    </Modal>
  );
}

/* ------------------------------ folder view ------------------------------ */

/** A folder: what's in it, grouped, what changed in it lately, and + New. */
export function FolderView({
  node,
  onOpen,
  extra,
}: {
  node: SpaceNode;
  onOpen: (id: Id) => void;
  /** More below the lists (a project folder's missing sections). */
  extra?: ReactNode;
}) {
  const { index } = useSpaceData();
  const { space } = useRepositories();
  const { openCreate } = useCreate();
  const [importing, setImporting] = useState(false);
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description ?? '');
  const ids = { title: useId(), description: useId() };
  const children = (index.children.get(node.id) ?? []).filter((c) => !c.archived);
  const groups: [string, SpaceNode[]][] = [
    ['Folders', children.filter((c) => c.kind === 'section')],
    ['Pages', children.filter((c) => c.kind === 'page')],
    ['Databases', children.filter((c) => c.kind === 'table')],
  ];
  const recent = documentsUnder(index, node.id)
    .filter((n) => n.parentId !== node.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  const maintained = !!node.key;
  const make = (kind: CreateKind) => openCreate(kind, { parentId: node.id });
  return (
    <div className="mx-auto max-w-[50rem]">
      <div className="flex items-start gap-3">
        <Folder aria-hidden className="mt-2.5 size-6 shrink-0 text-fg-muted" strokeWidth={1.5} />
        <div className="min-w-0 flex-1">
          {maintained ? (
            <h1 className="text-[32px] leading-tight font-semibold tracking-tight">{node.title}</h1>
          ) : (
            <>
              <label htmlFor={ids.title} className="sr-only">
                Folder name
              </label>
              <input
                id={ids.title}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() =>
                  title.trim() &&
                  title.trim() !== node.title &&
                  void space.update(node.id, { title })
                }
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                className="w-full bg-transparent text-[32px] leading-tight font-semibold tracking-tight outline-none"
              />
            </>
          )}
          <label htmlFor={ids.description} className="sr-only">
            Description
          </label>
          <input
            id={ids.description}
            value={description}
            placeholder="Add a short description"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() =>
              description.trim() !== (node.description ?? '') &&
              void space.update(node.id, { description: description.trim() || null })
            }
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="mt-1 w-full bg-transparent text-sm text-fg-muted outline-none placeholder:text-fg-subtle focus:text-fg"
          />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => make('page')}>
          <Plus aria-hidden className="size-3.5" /> Page
        </Button>
        <Button size="sm" onClick={() => make('folder')}>
          <Plus aria-hidden className="size-3.5" /> Folder
        </Button>
        <Button size="sm" onClick={() => make('database')}>
          <Plus aria-hidden className="size-3.5" /> Database
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setImporting(true)}>
          <Upload aria-hidden className="size-3.5" /> Import
        </Button>
        <Button size="sm" variant="ghost" onClick={() => exportNode(index, node)}>
          <Download aria-hidden className="size-3.5" /> Export
        </Button>
      </div>
      {children.length === 0 ? (
        <p className="mt-8 text-sm text-fg-muted">
          This folder is empty. Add a page, a folder or a database above, or drag one here.
        </p>
      ) : (
        <div className="mt-8 space-y-8">
          {groups
            .filter(([, list]) => list.length > 0)
            .map(([label, list]) => (
              <section key={label} aria-label={label}>
                <h2 className="mb-2 text-xs font-semibold text-fg-muted">
                  {label} · {list.length}
                </h2>
                <ul className="divide-y divide-line border-y border-line">
                  {list.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(c.id)}
                        className="flex w-full items-center gap-2.5 px-1 py-2 text-left text-sm hover:bg-hover/60"
                      >
                        <KindIcon node={c} />
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        <span className="shrink-0 text-xs text-fg-muted">
                          {c.kind === 'section'
                            ? `${documentsUnder(index, c.id).length} inside`
                            : formatWhen(c.updatedAt, new Date())}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
      {recent.length > 0 && (
        <section aria-label="Recently updated inside" className="mt-8">
          <h2 className="mb-2 text-xs font-semibold text-fg-muted">Recently updated inside</h2>
          <ul className="divide-y divide-line border-y border-line">
            {recent.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className="flex w-full items-center gap-2.5 px-1 py-2 text-left text-sm hover:bg-hover/60"
                >
                  <FolderInput aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 text-xs text-fg-muted">
                    {formatWhen(c.updatedAt, new Date())}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {extra}
      <ImportDialog
        parentId={node.id}
        open={importing}
        onClose={() => setImporting(false)}
        onOpen={onOpen}
      />
    </div>
  );
}

/** A page's short description: one quiet line under the title. */
export function DescriptionField({ node }: { node: SpaceNode }) {
  const { space } = useRepositories();
  const [value, setValue] = useState(node.description ?? '');
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Description
      </label>
      <input
        id={id}
        value={value}
        placeholder="Add a short description"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() =>
          value.trim() !== (node.description ?? '') &&
          void space.update(node.id, { description: value.trim() || null })
        }
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="mt-1 w-full bg-transparent text-sm text-fg-muted outline-none placeholder:text-transparent hover:placeholder:text-fg-subtle focus:text-fg focus:placeholder:text-fg-subtle"
      />
    </>
  );
}
