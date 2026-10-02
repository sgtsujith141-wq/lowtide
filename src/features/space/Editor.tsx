import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  CheckSquare,
  Folder,
  Grid3x3,
  Code2,
  Copy,
  FileText,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Link2,
  List,
  ListOrdered,
  Minus,
  Pencil,
  Plus,
  Paperclip,
  Quote,
  Table2,
  Trash2,
  Type,
  type LucideIcon,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/ui/Button';
import { ErrorNotice } from '../../components/ui/Notice';
import { fieldClass, labelClass } from '../../components/ui/styles';
import { useRepositories } from '../../hooks/useRepositories';
import { blocksOf, parseBody } from '../../lib/space-blocks';
import { formatWhen } from '../../lib/when';
import type {
  LinkableType,
  SpaceAttachmentKind,
  SpaceBlock,
  SpaceBlockType,
  SpaceNode,
} from '../../types/domain';
import { LINK_WORD, type EntityLookup } from './entities';
import {
  caretOffset,
  hrefOf,
  htmlToInline,
  inlineToHtml,
  placeCaret,
  splitAtCaret,
} from './inline';
import { TableView } from './TableView';

/*
 * The SPACE editor (v2 PHASE 014). One block per paragraph, heading, list
 * item, quote, callout, code or reference. Quiet until used: no toolbar;
 * Markdown shortcuts and the `/` menu do the work. Autosaves against the
 * page's revision; a change from elsewhere (an AI client, another window)
 * never silently overwrites unsaved text.
 */

const TEXT_TYPES = new Set<SpaceBlockType>([
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bullet',
  'numbered',
  'check',
  'quote',
  'callout',
  'code',
]);
const LIST_TYPES = new Set<SpaceBlockType>(['bullet', 'numbered', 'check']);
const isText = (b: SpaceBlock) => TEXT_TYPES.has(b.type);

const TYPE_LABEL: Record<SpaceBlockType, string> = {
  paragraph: 'Text',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  bullet: 'Bullet list',
  numbered: 'Numbered list',
  check: 'Checklist',
  quote: 'Quote',
  callout: 'Callout',
  code: 'Code',
  divider: 'Divider',
  file: 'File reference',
  link: 'Link',
  table: 'Table',
  grid: 'Imported table',
  fallback: 'Imported content',
  bookmark: 'Bookmark',
};

type Command =
  | { kind: 'type'; type: SpaceBlockType }
  | { kind: 'link'; type: LinkableType }
  | { kind: 'table' }
  | { kind: 'file' }
  | { kind: 'subpage' }
  | { kind: 'folder' }
  | { kind: 'grid' }
  | { kind: 'bookmark' }
  /** `[[` typed in a block: link (or make) a page inline. */
  | { kind: 'inline'; query: string };

interface SlashItem {
  label: string;
  hint: string;
  icon: LucideIcon;
  command: Command;
  aliases?: string;
}

const SLASH: SlashItem[] = [
  {
    label: 'Text',
    hint: 'Plain paragraph',
    icon: Type,
    command: { kind: 'type', type: 'paragraph' },
    aliases: 'paragraph',
  },
  {
    label: 'Heading',
    hint: '# ',
    icon: Heading1,
    command: { kind: 'type', type: 'heading1' },
    aliases: 'h1 title',
  },
  {
    label: 'Subheading',
    hint: '## ',
    icon: Heading2,
    command: { kind: 'type', type: 'heading2' },
    aliases: 'h2',
  },
  {
    label: 'Checklist',
    hint: '[] ',
    icon: CheckSquare,
    command: { kind: 'type', type: 'check' },
    aliases: 'todo task',
  },
  { label: 'Bullet list', hint: '- ', icon: List, command: { kind: 'type', type: 'bullet' } },
  {
    label: 'Numbered list',
    hint: '1. ',
    icon: ListOrdered,
    command: { kind: 'type', type: 'numbered' },
  },
  { label: 'Quote', hint: '> ', icon: Quote, command: { kind: 'type', type: 'quote' } },
  {
    label: 'Callout',
    hint: 'Highlighted note',
    icon: FileText,
    command: { kind: 'type', type: 'callout' },
    aliases: 'note',
  },
  { label: 'Code', hint: '```', icon: Code2, command: { kind: 'type', type: 'code' } },
  {
    label: 'Divider',
    hint: '---',
    icon: Minus,
    command: { kind: 'type', type: 'divider' },
    aliases: 'rule line',
  },
  {
    label: 'Page',
    hint: 'A page inside this one',
    icon: FileText,
    command: { kind: 'subpage' },
    aliases: 'subpage new page',
  },
  {
    label: 'Folder',
    hint: 'A folder inside this page',
    icon: Folder,
    command: { kind: 'folder' },
    aliases: 'section',
  },
  {
    label: 'Simple table',
    hint: 'Rows and columns of text',
    icon: Grid3x3,
    command: { kind: 'grid' },
    aliases: 'table grid',
  },
  {
    label: 'Database',
    hint: 'A table with properties and views',
    icon: Table2,
    command: { kind: 'table' },
    aliases: 'table board',
  },
  {
    label: 'Bookmark',
    hint: 'A saved link with a note',
    icon: Bookmark,
    command: { kind: 'bookmark' },
    aliases: 'url link web',
  },
  {
    label: 'Link page',
    hint: 'A SPACE page',
    icon: Link2,
    command: { kind: 'link', type: 'spaceNode' },
  },
  {
    label: 'Link project',
    hint: 'A project',
    icon: Link2,
    command: { kind: 'link', type: 'project' },
  },
  { label: 'Link task', hint: 'A task', icon: Link2, command: { kind: 'link', type: 'task' } },
  {
    label: 'Link milestone',
    hint: 'A milestone',
    icon: Link2,
    command: { kind: 'link', type: 'milestone' },
  },
  {
    label: 'Link decision',
    hint: 'A decision',
    icon: Link2,
    command: { kind: 'link', type: 'decision' },
  },
  {
    label: 'Link hackathon',
    hint: 'A hackathon',
    icon: Link2,
    command: { kind: 'link', type: 'hackathon' },
  },
  {
    label: 'File reference',
    hint: 'A link to a file',
    icon: Paperclip,
    command: { kind: 'file' },
    aliases: 'upload attachment image',
  },
  {
    label: 'Small heading',
    hint: '### ',
    icon: Heading3,
    command: { kind: 'type', type: 'heading3' },
    aliases: 'h3',
  },
];

/** At most this many commands show at once; typing finds the rest. */
const SLASH_SHOWN = 12;

const SHORTCUTS: [RegExp, SpaceBlockType][] = [
  [/^###\s/, 'heading3'],
  [/^##\s/, 'heading2'],
  [/^#\s/, 'heading1'],
  [/^[-*]\s\[ ?\]\s/, 'check'],
  [/^\[ ?\]\s/, 'check'],
  [/^[-*]\s/, 'bullet'],
  [/^1[.)]\s/, 'numbered'],
  [/^>\s/, 'quote'],
];

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Snapshot {
  blocks: SpaceBlock[];
  title: string;
  focus?: string;
}

interface Conflict {
  /** Who changed it, when known. */
  by?: string;
  revision: number;
}

/** Milliseconds now (undo batching). */
const clockMs = () => Date.now();

/** A block as the owner leaves it: no longer attributed to an AI client. */
function withoutAuthor(block: SpaceBlock): SpaceBlock {
  const copy = { ...block };
  delete copy.by;
  return copy;
}

const newBlockId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `b-${Math.random().toString(36).slice(2)}`;

/** The editable page: its title and blocks. Keyed by page id by the caller. */
export function PageEditor({
  node,
  lookup,
  onSaveState,
  compact = false,
  belowTitle,
}: {
  node: SpaceNode;
  lookup: EntityLookup;
  onSaveState?: (state: SaveState) => void;
  /** Less room below the last block (more content follows the page). */
  compact?: boolean;
  /** Shown right under the title (the page's description). */
  belowTitle?: React.ReactNode;
}) {
  const lockedTitle = !!node.key;
  const { space } = useRepositories();
  const navigate = useNavigate();
  const initial = useMemo(() => {
    const b = blocksOf(node);
    return b.length ? b : [{ id: newBlockId(), type: 'paragraph' as const, text: '' }];
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once per page (keyed)
  const [blocks, setBlocks] = useState<SpaceBlock[]>(initial);
  // A page just made: its title starts empty (showing “Untitled”) and focused.
  const fresh =
    node.kind === 'page' &&
    !lockedTitle &&
    !node.source &&
    (node.revision ?? 0) === 0 &&
    node.title === 'Untitled' &&
    initial.every((b) => !b.text);
  const [title, setTitle] = useState(fresh ? '' : node.title);
  const [epochs, setEpochs] = useState<Record<string, number>>({});
  const [focus, setFocus] = useState<{ id: string; at: number | 'end' } | null>(null);
  const [slash, setSlash] = useState<{ id: string; query: string; index: number } | null>(null);
  const [picker, setPicker] = useState<{ id: string; command: Command } | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saveState, setSaveStateRaw] = useState<SaveState>('idle');
  const [drag, setDrag] = useState<{ id: string; over?: string; after?: boolean } | null>(null);
  const base = useRef(node.revision ?? 0);
  const changes = useRef(0);
  const saved = useRef(0);
  const undo = useRef<Snapshot[]>([]);
  const redo = useRef<Snapshot[]>([]);
  const lastPush = useRef(0);
  const refs = useRef(new Map<string, HTMLElement>());
  const latest = useRef({ blocks, title });
  useLayoutEffect(() => {
    latest.current = { blocks, title };
  });
  const titleRef = useRef<HTMLHeadingElement>(null);
  const editorId = useId();
  useEffect(() => {
    if (fresh) titleRef.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on a new page

  const setSaveState = useCallback(
    (s: SaveState) => {
      setSaveStateRaw(s);
      onSaveState?.(s);
    },
    [onSaveState],
  );

  /* ------------------------------ saving ------------------------------ */

  const save = useCallback(
    async (force = false) => {
      if (changes.current === saved.current && !force) return;
      const upTo = changes.current;
      const { blocks: b, title: t } = latest.current;
      setSaveState('saving');
      try {
        const result = await space.saveContent(
          node.id,
          { title: t.trim() || 'Untitled', blocks: b },
          base.current,
        );
        base.current = result.revision ?? 0;
        saved.current = Math.max(saved.current, upTo);
        setSaveState(changes.current === saved.current ? 'saved' : 'saving');
      } catch (error) {
        if (error instanceof Error && error.name === 'SpaceConflictError') {
          setConflict({ revision: (error as { revision?: number }).revision ?? base.current + 1 });
          setSaveState('idle');
        } else setSaveState('error');
      }
    },
    [space, node.id, setSaveState],
  );

  useEffect(() => {
    if (changes.current === saved.current || conflict) return;
    const timer = setTimeout(() => void save(), 700);
    return () => clearTimeout(timer);
  }, [blocks, title, save, conflict]);

  // Nothing typed is lost when leaving the page.
  useEffect(
    () => () => {
      if (changes.current !== saved.current) void save();
    },
    [save],
  );

  useEffect(() => {
    if (saveState !== 'saved') return;
    const t = setTimeout(() => setSaveState('idle'), 1800);
    return () => clearTimeout(t);
  }, [saveState, setSaveState]);

  /* --------------------- changes from elsewhere ----------------------- */

  useEffect(() => {
    const revision = node.revision ?? 0;
    if (revision <= base.current) return;
    if (changes.current === saved.current) {
      // Nothing unsaved here: take the new version, remounting only what changed.
      const next = blocksOf(node);
      const prev = new Map(latest.current.blocks.map((b) => [b.id, b]));
      setEpochs((e) => {
        const out = { ...e };
        for (const b of next) {
          const old = prev.get(b.id);
          if (!old || old.text !== b.text || old.type !== b.type) out[b.id] = (out[b.id] ?? 0) + 1;
        }
        return out;
      });
      setBlocks(next.length ? next : [{ id: newBlockId(), type: 'paragraph', text: '' }]);
      setTitle(node.title);
      base.current = revision;
    } else {
      const last = node.edits?.at(-1);
      setConflict({
        revision,
        ...(last?.by === 'ai-client' ? { by: last.client ?? 'An AI client' } : {}),
      });
    }
  }, [node]);

  function keepMine() {
    base.current = node.revision ?? base.current;
    setConflict(null);
    changes.current += 1;
    void save(true);
  }

  function takeTheirs() {
    const next = blocksOf(node);
    setBlocks(next.length ? next : [{ id: newBlockId(), type: 'paragraph', text: '' }]);
    setTitle(node.title);
    setEpochs((e) => Object.fromEntries([...next.map((b) => [b.id, (e[b.id] ?? 0) + 1])]));
    base.current = node.revision ?? 0;
    saved.current = changes.current;
    setConflict(null);
  }

  async function copyMine() {
    const { blocks: b, title: t } = latest.current;
    const copy = await space.create({
      ...(node.parentId ? { parentId: node.parentId } : {}),
      title: `${t} (your version)`,
      blocks: b.map((x) => ({ ...x, id: newBlockId() })),
    });
    takeTheirs();
    void navigate(`/space/${copy.id}`);
  }

  /* ------------------------------ edits ------------------------------- */

  function snapshot(focusId?: string): Snapshot {
    return {
      blocks: latest.current.blocks,
      title: latest.current.title,
      ...(focusId ? { focus: focusId } : {}),
    };
  }

  function remember(structural: boolean, focusId?: string) {
    const now = clockMs();
    if (structural || now - lastPush.current > 1000) {
      undo.current.push(snapshot(focusId));
      if (undo.current.length > 200) undo.current.shift();
      redo.current = [];
    }
    lastPush.current = structural ? 0 : now;
  }

  function apply(
    next: SpaceBlock[],
    opts: {
      structural?: boolean;
      focus?: { id: string; at: number | 'end' };
      remount?: string[];
    } = {},
  ) {
    remember(opts.structural ?? true, opts.focus?.id);
    changes.current += 1;
    latest.current = { ...latest.current, blocks: next };
    setBlocks(next);
    if (opts.remount?.length) {
      setEpochs((e) => {
        const out = { ...e };
        for (const id of opts.remount!) out[id] = (out[id] ?? 0) + 1;
        return out;
      });
    }
    if (opts.focus) setFocus(opts.focus);
  }

  function restore(from: Snapshot[], to: Snapshot[]) {
    const snap = from.pop();
    if (!snap) return;
    to.push(snapshot());
    changes.current += 1;
    setBlocks(snap.blocks);
    setTitle(snap.title);
    setEpochs((e) => Object.fromEntries(snap.blocks.map((b) => [b.id, (e[b.id] ?? 0) + 1])));
    const target = snap.focus ?? snap.blocks[0]?.id;
    if (target) setFocus({ id: target, at: 'end' });
  }

  const updateText = (id: string, text: string) => {
    const at = latest.current.blocks.findIndex((b) => b.id === id);
    if (at < 0) return;
    const cur = latest.current.blocks[at]!;
    if (cur.text === text) return;
    const next = [...latest.current.blocks];
    next[at] = { ...withoutAuthor(cur), text };
    apply(next, { structural: false });
  };

  const insertAfter = (id: string, block: SpaceBlock, focusAt: number | 'end' = 0) => {
    const at = latest.current.blocks.findIndex((b) => b.id === id);
    const next = [...latest.current.blocks];
    next.splice(at + 1, 0, block);
    apply(next, { focus: { id: block.id, at: focusAt } });
  };

  const replaceBlock = (id: string, block: SpaceBlock, focusAt: number | 'end' = 'end') => {
    const next = latest.current.blocks.map((b) => (b.id === id ? block : b));
    if (!next.some((b) => isText(b)) || (next.at(-1)!.id === block.id && !isText(block))) {
      next.push({ id: newBlockId(), type: 'paragraph', text: '' });
    }
    apply(next, {
      remount: [block.id],
      focus: {
        id: isText(block) ? block.id : next[next.findIndex((b) => b.id === block.id) + 1]!.id,
        at: focusAt,
      },
    });
  };

  const removeBlock = (id: string, focusPrev = true) => {
    const list = latest.current.blocks;
    const at = list.findIndex((b) => b.id === id);
    const next = list.filter((b) => b.id !== id);
    if (next.length === 0) next.push({ id: newBlockId(), type: 'paragraph', text: '' });
    const target = focusPrev ? (next[at - 1] ?? next[0]) : (next[at] ?? next.at(-1));
    apply(next, { focus: { id: target!.id, at: focusPrev ? 'end' : 0 } });
  };

  const move = (id: string, delta: number) => {
    const list = [...latest.current.blocks];
    const at = list.findIndex((b) => b.id === id);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= list.length) return;
    const [b] = list.splice(at, 1);
    list.splice(to, 0, b!);
    apply(list, { remount: [id], focus: { id, at: 'end' } });
  };

  const turnInto = (id: string, type: SpaceBlockType) => {
    const cur = latest.current.blocks.find((b) => b.id === id);
    if (!cur) return;
    const rest: SpaceBlock = { ...cur };
    const indent = rest.indent;
    delete rest.checked;
    delete rest.indent;
    const block: SpaceBlock = {
      ...rest,
      type,
      ...(type === 'check' ? { checked: false } : {}),
      ...(LIST_TYPES.has(type) && indent ? { indent } : {}),
    };
    if (type === 'divider') delete block.text;
    replaceBlock(id, block);
  };

  /** Replaces a trailing `[[query` in a block with a link to a page. */
  const linkInline = (id: string, label: string, pageId: string) => {
    const cur = latest.current.blocks.find((b) => b.id === id);
    if (!cur) return;
    const text = (cur.text ?? '').replace(
      /\[\[([^\]\n]{0,80})$/,
      `[${label.replace(/[[\]]/g, '')}](space:${pageId}) `,
    );
    apply(
      latest.current.blocks.map((b) => (b.id === id ? { ...withoutAuthor(b), text } : b)),
      { remount: [id], focus: { id, at: 'end' } },
    );
  };

  /* ----------------------------- commands ----------------------------- */

  async function runCommand(id: string, command: Command) {
    setSlash(null);
    if (command.kind === 'type') {
      const block: SpaceBlock =
        command.type === 'divider'
          ? { id, type: 'divider' }
          : {
              id,
              type: command.type,
              text: '',
              ...(command.type === 'check' ? { checked: false } : {}),
            };
      replaceBlock(id, block, 0);
      return;
    }
    if (command.kind === 'grid') {
      replaceBlock(id, {
        id,
        type: 'grid',
        rows: [
          ['', ''],
          ['', ''],
        ],
      });
      return;
    }
    if (command.kind === 'subpage' || command.kind === 'folder') {
      const child = await space.create({
        parentId: node.id,
        title: command.kind === 'folder' ? 'New folder' : 'Untitled',
        ...(command.kind === 'folder' ? { kind: 'section' as const } : { blocks: [] }),
      });
      replaceBlock(id, {
        id,
        type: 'link',
        link: { type: 'spaceNode', id: child.id, label: child.title },
      });
      return;
    }
    if (command.kind === 'table') {
      const table = await space.create({
        parentId: node.id,
        title: 'Untitled database',
        table: {
          columns: [
            { id: 'name', name: 'Name', type: 'text' },
            {
              id: 'status',
              name: 'Status',
              type: 'status',
              options: [{ name: 'Not started' }, { name: 'In progress' }, { name: 'Done' }],
            },
          ],
          rows: [],
        },
      });
      replaceBlock(id, {
        id,
        type: 'table',
        link: { type: 'spaceNode', id: table.id, label: table.title },
      });
      return;
    }
    setPicker({ id, command });
  }

  /* ---------------------------- keyboard ------------------------------ */

  const slashItems = useMemo(() => {
    if (!slash) return [];
    const q = slash.query.toLowerCase();
    return SLASH.filter(
      (s) => !q || `${s.label} ${s.aliases ?? ''}`.toLowerCase().includes(q),
    ).slice(0, SLASH_SHOWN);
  }, [slash]);

  function onInput(block: SpaceBlock, el: HTMLElement) {
    if (block.type === 'code') {
      updateText(block.id, el.innerText.replace(/\n$/, ''));
      return;
    }
    const plain = el.textContent ?? '';
    if (block.type === 'paragraph') {
      for (const [pattern, type] of SHORTCUTS) {
        if (pattern.test(plain)) {
          const strip = plain.replace(pattern, '');
          remember(true, block.id);
          replaceBlock(
            block.id,
            { id: block.id, type, text: strip, ...(type === 'check' ? { checked: false } : {}) },
            0,
          );
          return;
        }
      }
      if (plain.startsWith('/')) setSlash({ id: block.id, query: plain.slice(1), index: 0 });
      else if (slash?.id === block.id) setSlash(null);
    }
    const pageLink = /\[\[([^\]\n]{0,80})$/.exec(plain);
    if (pageLink) setPicker({ id: block.id, command: { kind: 'inline', query: pageLink[1]! } });
    else if (picker?.id === block.id && picker.command.kind === 'inline') setPicker(null);
    updateText(block.id, htmlToInline(el));
  }

  function onKeyDown(block: SpaceBlock, el: HTMLElement, e: KeyboardEvent) {
    const list = latest.current.blocks;
    const at = list.findIndex((b) => b.id === block.id);
    const mod = e.metaKey || e.ctrlKey;

    if (picker?.id === block.id && picker.command.kind === 'inline') {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPicker(null);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = picker.command.query.trim().toLowerCase();
        const pages = lookup.options('spaceNode').filter((o) => o.id !== node.id);
        const exact = pages.find((o) => o.label.toLowerCase() === q);
        setPicker(null);
        if (exact) linkInline(block.id, exact.label, exact.id);
        else if (q) {
          void space
            .create({ parentId: node.id, title: picker.command.query.trim(), blocks: [] })
            .then((page) => linkInline(block.id, page.title, page.id));
        } else if (pages[0]) linkInline(block.id, pages[0].label, pages[0].id);
        return;
      }
    }
    if (slash && slash.id === block.id) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = slashItems.length || 1;
        setSlash({ ...slash, index: (slash.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
        return;
      }
      if (e.key === 'Enter' && slashItems[slash.index]) {
        e.preventDefault();
        void runCommand(block.id, slashItems[slash.index]!.command);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlash(null);
        return;
      }
    }

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) restore(redo.current, undo.current);
      else restore(undo.current, redo.current);
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      restore(redo.current, undo.current);
      return;
    }
    if (mod && !e.shiftKey && ['b', 'i'].includes(e.key.toLowerCase()) && block.type !== 'code') {
      e.preventDefault();
      if (typeof document.execCommand === 'function') {
        document.execCommand(e.key.toLowerCase() === 'b' ? 'bold' : 'italic');
        updateText(block.id, htmlToInline(el));
      }
      return;
    }
    if (mod && e.key.toLowerCase() === 'e' && block.type !== 'code') {
      e.preventDefault();
      const sel = document.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed && el.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        const code = document.createElement('code');
        code.textContent = range.toString();
        range.deleteContents();
        range.insertNode(code);
        updateText(block.id, htmlToInline(el));
      }
      return;
    }
    if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      move(block.id, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (block.type === 'code' && !mod) return; // a newline inside code
      e.preventDefault();
      const plain = el.textContent ?? '';
      if (block.type === 'paragraph' && /^-{3,}$/.test(plain.trim())) {
        replaceBlock(block.id, { id: block.id, type: 'divider' });
        return;
      }
      if (block.type === 'paragraph' && /^```/.test(plain.trim())) {
        replaceBlock(
          block.id,
          {
            id: block.id,
            type: 'code',
            text: '',
            ...(plain.trim().slice(3) ? { language: plain.trim().slice(3) } : {}),
          },
          0,
        );
        return;
      }
      if (LIST_TYPES.has(block.type) && !plain.trim()) {
        if (block.indent) {
          replaceBlock(block.id, { ...block, indent: block.indent - 1 }, 0);
        } else replaceBlock(block.id, { id: block.id, type: 'paragraph', text: '' }, 0);
        return;
      }
      const [before, after] = block.type === 'code' ? [block.text ?? '', ''] : splitAtCaret(el);
      const type: SpaceBlockType =
        LIST_TYPES.has(block.type) || block.type === 'quote' ? block.type : 'paragraph';
      const fresh: SpaceBlock = {
        id: newBlockId(),
        type,
        text: after,
        ...(type === 'check' ? { checked: false } : {}),
        ...(LIST_TYPES.has(type) && block.indent ? { indent: block.indent } : {}),
      };
      const next = [...list];
      next[at] = { ...withoutAuthor(block), text: before };
      next.splice(at + 1, 0, fresh);
      apply(next, { remount: [block.id], focus: { id: fresh.id, at: 0 } });
      return;
    }

    if (e.key === 'Tab' && LIST_TYPES.has(block.type)) {
      e.preventDefault();
      const indent = Math.max(0, Math.min(3, (block.indent ?? 0) + (e.shiftKey ? -1 : 1)));
      const next = list.map((b) =>
        b.id === block.id ? { ...b, text: htmlToInline(el), indent } : b,
      );
      apply(next, { remount: [block.id], focus: { id: block.id, at: caretOffset(el) } });
      return;
    }

    const sel = document.getSelection();
    const collapsed = !sel || sel.isCollapsed;
    const offset = caretOffset(el);
    if (e.key === 'Backspace' && collapsed && offset === 0) {
      e.preventDefault();
      if (block.indent) {
        replaceBlock(block.id, { ...block, text: htmlToInline(el), indent: block.indent - 1 }, 0);
        return;
      }
      if (block.type !== 'paragraph') {
        replaceBlock(block.id, { id: block.id, type: 'paragraph', text: htmlToInline(el) }, 0);
        return;
      }
      const prev = list[at - 1];
      if (!prev) return;
      if (!isText(prev)) {
        // The block before is a reference or divider: remove it.
        apply(
          list.filter((b) => b.id !== prev.id),
          { focus: { id: block.id, at: 0 } },
        );
        return;
      }
      const prevPlainLength =
        refs.current.get(prev.id)?.textContent?.length ?? (prev.text ?? '').length;
      const merged: SpaceBlock = { ...prev, text: `${prev.text ?? ''}${htmlToInline(el)}` };
      delete merged.by;
      apply(
        list.filter((b) => b.id !== block.id).map((b) => (b.id === prev.id ? merged : b)),
        { remount: [prev.id], focus: { id: prev.id, at: prevPlainLength } },
      );
      return;
    }
    if (e.key === 'ArrowUp' && collapsed && offset === 0 && at > 0) {
      e.preventDefault();
      setFocus({ id: list[at - 1]!.id, at: 'end' });
      return;
    }
    if (
      e.key === 'ArrowDown' &&
      collapsed &&
      offset === (el.textContent ?? '').length &&
      at < list.length - 1
    ) {
      e.preventDefault();
      setFocus({ id: list[at + 1]!.id, at: 0 });
      return;
    }
    if (e.key === 'ArrowUp' && collapsed && offset === 0 && at === 0) {
      e.preventDefault();
      titleRef.current?.focus();
      if (titleRef.current) placeCaret(titleRef.current, 'end');
    }
  }

  function onStaticKey(block: SpaceBlock, e: KeyboardEvent) {
    const list = latest.current.blocks;
    const at = list.findIndex((b) => b.id === block.id);
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      removeBlock(block.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      insertAfter(block.id, { id: newBlockId(), type: 'paragraph', text: '' });
    } else if (e.key === 'ArrowUp' && at > 0) {
      e.preventDefault();
      setFocus({ id: list[at - 1]!.id, at: 'end' });
    } else if (e.key === 'ArrowDown' && at < list.length - 1) {
      e.preventDefault();
      setFocus({ id: list[at + 1]!.id, at: 0 });
    } else if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      move(block.id, e.key === 'ArrowUp' ? -1 : 1);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) restore(redo.current, undo.current);
      else restore(undo.current, redo.current);
    }
  }

  function onPaste(block: SpaceBlock, el: HTMLElement, e: ClipboardEvent) {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    if (block.type === 'code' || !text.includes('\n')) {
      document.execCommand?.('insertText', false, text);
      if (typeof document.execCommand !== 'function')
        el.textContent = (el.textContent ?? '') + text;
      onInput(block, el);
      return;
    }
    // Several lines: they become blocks, read as Markdown.
    const pasted = parseBody(text).map((b) => ({ ...b, id: newBlockId() }));
    const list = latest.current.blocks;
    const at = list.findIndex((b) => b.id === block.id);
    const empty = !(el.textContent ?? '').trim() && block.type === 'paragraph';
    const next = [...list];
    next.splice(empty ? at : at + 1, empty ? 1 : 0, ...pasted);
    apply(next, { focus: { id: pasted.at(-1)!.id, at: 'end' } });
  }

  /* ----------------------------- focusing ----------------------------- */

  useLayoutEffect(() => {
    if (!focus) return;
    const el = refs.current.get(focus.id);
    if (!el) return;
    el.focus();
    if (el.isContentEditable) placeCaret(el, focus.at);
    setFocus(null);
  }, [focus, blocks, epochs]);

  /* ------------------------------ drag -------------------------------- */

  function onDragOver(id: string, e: DragEvent) {
    if (!drag) return;
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    setDrag({ ...drag, over: id, after: e.clientY > box.top + box.height / 2 });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (!drag?.over || drag.over === drag.id) return setDrag(null);
    const list = latest.current.blocks.filter((b) => b.id !== drag.id);
    const moving = latest.current.blocks.find((b) => b.id === drag.id)!;
    const at = list.findIndex((b) => b.id === drag.over) + (drag.after ? 1 : 0);
    list.splice(at, 0, moving);
    setDrag(null);
    apply(list, { remount: [drag.id] });
  }

  /* ------------------------------ render ------------------------------ */

  const numbers = useMemo(() => {
    const out = new Map<string, number>();
    const counters: number[] = [];
    for (const b of blocks) {
      if (b.type !== 'numbered') {
        counters.length = 0;
        continue;
      }
      const level = b.indent ?? 0;
      counters.length = level + 1;
      counters[level] = (counters[level] ?? 0) + 1;
      out.set(b.id, counters[level]!);
    }
    return out;
  }, [blocks]);

  const lastEdit = node.edits?.at(-1);
  const now = new Date();

  return (
    <article aria-label={title.trim() || 'Untitled'} className="relative">
      {conflict && (
        <div
          role="alert"
          className="mb-6 rounded-md border border-warn/50 bg-warn/10 px-4 py-3 text-sm"
        >
          <p className="font-medium">
            {conflict.by ? `${conflict.by} changed this page` : 'This page changed elsewhere'} while
            you were editing.
          </p>
          <p className="mt-0.5 text-fg-muted">Nothing has been overwritten. Choose what to keep.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={takeTheirs}>
              Use the new version
            </Button>
            <Button size="sm" onClick={() => void copyMine()}>
              Save mine as a copy
            </Button>
            <Button size="sm" variant="ghost" onClick={keepMine}>
              Keep mine, replacing it
            </Button>
          </div>
        </div>
      )}

      <h1
        id={`${editorId}-title`}
        ref={titleRef}
        contentEditable={!lockedTitle}
        suppressContentEditableWarning
        role={lockedTitle ? undefined : 'textbox'}
        aria-label={lockedTitle ? undefined : 'Page title'}
        aria-multiline={lockedTitle ? undefined : false}
        spellCheck
        data-placeholder="Untitled"
        onInput={(e) => {
          remember(false);
          changes.current += 1;
          latest.current = { ...latest.current, title: e.currentTarget.textContent ?? '' };
          setTitle(e.currentTarget.textContent ?? '');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const first = latest.current.blocks[0];
            if (first) setFocus({ id: first.id, at: 0 });
          }
          if (e.key === 'ArrowDown') {
            const first = latest.current.blocks[0];
            if (first) {
              e.preventDefault();
              setFocus({ id: first.id, at: 0 });
            }
          }
        }}
        className="text-[32px] leading-tight font-semibold tracking-tight outline-none empty:before:text-fg-subtle empty:before:content-[attr(data-placeholder)]"
      >
        {fresh ? '' : node.title}
      </h1>
      {belowTitle}
      <p className="mt-2 text-xs text-fg-muted">
        {lastEdit?.by === 'ai-client' ? (
          <>
            Updated by {lastEdit.client ?? 'an AI client'} ·{' '}
            <time dateTime={lastEdit.at}>{formatWhen(lastEdit.at, now)}</time>
          </>
        ) : node.source ? (
          node.blocks ? (
            'Imported from Notion · edited in LOWTIDE'
          ) : (
            'Imported from Notion'
          )
        ) : (
          <>
            Updated <time dateTime={node.updatedAt}>{formatWhen(node.updatedAt, now)}</time>
          </>
        )}
      </p>

      <div
        className={`mt-6 space-y-0.5 ${compact ? 'pb-6' : 'pb-40'}`}
        onDragOver={(e) => drag && e.preventDefault()}
        onDrop={onDrop}
      >
        {blocks.map((block) => (
          <BlockRow
            key={`${block.id}:${epochs[block.id] ?? 0}`}
            block={block}
            number={numbers.get(block.id)}
            lookup={lookup}
            dropHint={drag?.over === block.id ? (drag.after ? 'after' : 'before') : undefined}
            setRef={(el) => {
              if (el) refs.current.set(block.id, el);
              else refs.current.delete(block.id);
            }}
            onInput={onInput}
            onKeyDown={onKeyDown}
            onStaticKey={onStaticKey}
            onPaste={onPaste}
            onToggle={(checked) =>
              apply(
                latest.current.blocks.map((b) => (b.id === block.id ? { ...b, checked } : b)),
                {
                  remount: [],
                },
              )
            }
            onMove={(d) => move(block.id, d)}
            onTurnInto={(t) => turnInto(block.id, t)}
            onDelete={() => removeBlock(block.id)}
            onDragStart={() => setDrag({ id: block.id })}
            onDragOver={(e) => onDragOver(block.id, e)}
            onDragEnd={() => setDrag(null)}
            onOpen={(href) => void navigate(href)}
            onChange={(b) =>
              apply(
                latest.current.blocks.map((x) => (x.id === b.id ? withoutAuthor(b) : x)),
                { structural: false },
              )
            }
            hint={blocks.length === 1 && block.type === 'paragraph' && !block.text && !lockedTitle}
          >
            {slash?.id === block.id && slashItems.length > 0 && (
              <SlashMenu
                items={slashItems}
                active={slash.index}
                onPick={(item) => void runCommand(block.id, item.command)}
              />
            )}
            {picker?.id === block.id && (
              <Picker
                command={picker.command}
                lookup={lookup}
                selfId={node.id}
                onCancel={() => {
                  setPicker(null);
                  setFocus({ id: block.id, at: 'end' });
                }}
                onPick={(b) => {
                  setPicker(null);
                  if (picker.command.kind === 'inline' && b.link) {
                    linkInline(block.id, b.link.label ?? 'Page', b.link.id);
                  } else replaceBlock(block.id, { ...b, id: block.id });
                }}
                onCreatePage={async (title) => {
                  setPicker(null);
                  const page = await space.create({ parentId: node.id, title, blocks: [] });
                  linkInline(block.id, page.title, page.id);
                }}
              />
            )}
          </BlockRow>
        ))}
        {/* Clicking below the content puts the cursor at the end, ready to type. */}
        <div
          aria-hidden
          data-testid="page-canvas-end"
          onClick={() => {
            const list = latest.current.blocks;
            const last = list.at(-1);
            if (last && isText(last) && !last.text) setFocus({ id: last.id, at: 'end' });
            else if (last && isText(last) && last.type === 'paragraph')
              setFocus({ id: last.id, at: 'end' });
            else insertAfter(last?.id ?? '', { id: newBlockId(), type: 'paragraph', text: '' });
          }}
          className="min-h-24 cursor-text"
        />
      </div>
    </article>
  );
}

/* ------------------------------- one block ------------------------------- */

const TEXT_CLASS: Partial<Record<SpaceBlockType, string>> = {
  paragraph: 'text-[15px] leading-7',
  heading1: 'mt-6 text-[24px] leading-tight font-semibold tracking-tight',
  heading2: 'mt-5 text-[19px] leading-snug font-semibold',
  heading3: 'mt-4 text-[15px] leading-snug font-semibold',
  bullet: 'text-[15px] leading-7',
  numbered: 'text-[15px] leading-7',
  check: 'text-[15px] leading-7',
  quote: 'border-l-2 border-line-strong pl-4 text-[15px] leading-7 text-fg-muted',
  callout: 'text-[15px] leading-7',
  code: 'font-mono text-[13px] leading-6 whitespace-pre overflow-x-auto',
};

interface RowProps {
  block: SpaceBlock;
  number: number | undefined;
  lookup: EntityLookup;
  dropHint: 'before' | 'after' | undefined;
  setRef: (el: HTMLElement | null) => void;
  onInput: (block: SpaceBlock, el: HTMLElement) => void;
  onKeyDown: (block: SpaceBlock, el: HTMLElement, e: KeyboardEvent) => void;
  onStaticKey: (block: SpaceBlock, e: KeyboardEvent) => void;
  onPaste: (block: SpaceBlock, el: HTMLElement, e: ClipboardEvent) => void;
  onToggle: (checked: boolean) => void;
  onMove: (delta: number) => void;
  onTurnInto: (type: SpaceBlockType) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragEnd: () => void;
  onOpen: (href: string) => void;
  /** Replaces this block (simple tables, bookmarks). */
  onChange: (block: SpaceBlock) => void;
  /** The page is empty: show how to start, even before it's focused. */
  hint?: boolean;
  children?: React.ReactNode;
}

const BlockRow = memo(function BlockRow(p: RowProps) {
  const { block } = p;
  const [menu, setMenu] = useState(false);
  const [armed, setArmed] = useState(false);
  const indent = (block.indent ?? 0) * 24;
  const text = isText(block);
  return (
    <div
      data-block-id={block.id}
      draggable={armed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', block.id);
        p.onDragStart();
      }}
      onDragOver={p.onDragOver}
      onDragEnd={() => {
        setArmed(false);
        p.onDragEnd();
      }}
      className={`group/block relative flex items-start gap-1 rounded-sm ${
        p.dropHint === 'before'
          ? 'shadow-[0_-2px_0_var(--lt-accent)]'
          : p.dropHint === 'after'
            ? 'shadow-[0_2px_0_var(--lt-accent)]'
            : ''
      }`}
    >
      <div className="relative -ml-12 flex w-11 shrink-0 items-center justify-end gap-0.5 pt-1 opacity-0 transition-opacity group-focus-within/block:opacity-100 group-hover/block:opacity-100 max-md:hidden">
        {block.by && (
          <span
            aria-hidden
            title={`Written by ${block.by.client} · ${formatWhen(block.by.at, new Date())}`}
            className="mr-1 size-1.5 rounded-full bg-accent"
          />
        )}
        <button
          type="button"
          aria-label={`${TYPE_LABEL[block.type]} block options`}
          aria-expanded={menu}
          onPointerDown={() => setArmed(true)}
          onPointerUp={() => setArmed(false)}
          onClick={() => setMenu((m) => !m)}
          className="grid size-6 cursor-grab place-items-center rounded text-fg-subtle hover:bg-hover hover:text-fg"
        >
          <GripVertical aria-hidden className="size-3.5" />
        </button>
        {menu && (
          <BlockMenu
            block={block}
            onClose={() => setMenu(false)}
            onMove={p.onMove}
            onTurnInto={p.onTurnInto}
            onDelete={p.onDelete}
          />
        )}
      </div>
      {block.by && <span className="sr-only">Written by {block.by.client}.</span>}
      <div className="relative min-w-0 flex-1" style={indent ? { paddingLeft: indent } : undefined}>
        {text ? <TextBlock {...p} /> : <StaticBlock {...p} />}
        {p.children}
      </div>
    </div>
  );
});

function TextBlock(p: RowProps) {
  const { block } = p;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (block.type === 'code') el.textContent = block.text ?? '';
    else el.innerHTML = inlineToHtml(block.text ?? '');
    // Set once per mount: typing owns the content afterwards.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = (
    <div
      ref={(el) => {
        ref.current = el;
        p.setRef(el);
      }}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline
      aria-label={TYPE_LABEL[block.type]}
      data-placeholder={
        block.type === 'paragraph'
          ? p.hint
            ? 'Start writing, or press / for blocks'
            : 'Type / for blocks'
          : TYPE_LABEL[block.type]
      }
      spellCheck={block.type !== 'code'}
      onInput={(e) => p.onInput(block, e.currentTarget)}
      onKeyDown={(e) => p.onKeyDown(block, e.currentTarget, e)}
      onPaste={(e) => p.onPaste(block, e.currentTarget, e)}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (a && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          const href = hrefOf(a.getAttribute('href') ?? '');
          if (href.startsWith('/')) p.onOpen(href);
          else window.open(href, '_blank', 'noopener');
        }
      }}
      className={`min-h-7 py-0.5 outline-none [&_a]:text-accent-ink [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-surface [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.88em] empty:before:pointer-events-none empty:before:text-fg-subtle focus:empty:before:content-[attr(data-placeholder)] ${p.hint ? 'empty:before:content-[attr(data-placeholder)]' : ''} ${TEXT_CLASS[block.type] ?? ''} ${
        block.type === 'check' && block.checked
          ? 'text-fg-muted line-through decoration-fg-subtle'
          : ''
      }`}
    />
  );
  if (block.type === 'bullet' || block.type === 'numbered')
    return (
      <div className="flex gap-2">
        <span
          aria-hidden
          className="w-5 shrink-0 pt-0.5 text-right text-[15px] leading-7 text-fg-muted"
        >
          {block.type === 'bullet' ? ['•', '◦', '▪', '•'][block.indent ?? 0] : `${p.number ?? 1}.`}
        </span>
        <div className="min-w-0 flex-1">{editable}</div>
      </div>
    );
  if (block.type === 'check')
    return (
      <div className="flex gap-2.5">
        <input
          type="checkbox"
          checked={block.checked === true}
          onChange={(e) => p.onToggle(e.target.checked)}
          aria-label={`Done: ${(block.text ?? '').slice(0, 60) || 'checklist item'}`}
          className="mt-[7px] size-4 shrink-0"
        />
        <div className="min-w-0 flex-1">{editable}</div>
      </div>
    );
  if (block.type === 'callout')
    return (
      <div className="my-1 flex gap-3 rounded-md bg-surface px-4 py-2.5">
        <span aria-hidden className="pt-0.5 text-[15px] leading-7">
          {block.icon ?? '💡'}
        </span>
        <div className="min-w-0 flex-1">{editable}</div>
      </div>
    );
  if (block.type === 'code')
    return (
      <div className="my-1 rounded-md bg-surface px-4 pt-1.5 pb-3">
        <CodeHeader language={block.language} text={block.text ?? ''} />
        {editable}
      </div>
    );
  return editable;
}

/**
 * A code block's label and copy action. Mermaid stays as its source,
 * labelled as a diagram: imported content is shown exactly, never redrawn.
 */
function CodeHeader({ language, text }: { language: string | undefined; text: string }) {
  const [copied, setCopied] = useState(false);
  const mermaid = language?.toLowerCase() === 'mermaid';
  return (
    <div className="mb-1 flex min-h-7 items-center justify-between gap-2" contentEditable={false}>
      <span className="text-[11px] text-fg-muted">
        {mermaid ? 'Mermaid diagram source' : language || 'Code'}
      </span>
      <button
        type="button"
        onClick={() =>
          void navigator.clipboard?.writeText(text).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => setCopied(false),
          )
        }
        className="inline-flex h-7 items-center gap-1 rounded px-1.5 text-[11px] text-fg-muted hover:bg-hover hover:text-fg"
      >
        <Copy aria-hidden className="size-3" />
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

const KIND_WORD: Record<SpaceAttachmentKind, string> = {
  file: 'File',
  image: 'Image',
  pdf: 'PDF',
  video: 'Video',
  audio: 'Audio',
};

const sizeText = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

function StaticBlock(p: RowProps) {
  const { block, lookup } = p;
  const common = {
    ref: p.setRef as (el: HTMLDivElement | null) => void,
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent) => p.onStaticKey(block, e),
    className: 'my-1 rounded-sm outline-offset-2',
  };
  switch (block.type) {
    case 'divider':
      return (
        <div {...common} role="separator" aria-label="Divider" className="py-3 outline-offset-2">
          <hr className="border-line" />
        </div>
      );
    case 'link': {
      const link = block.link!;
      const href = lookup.href(link);
      const gone = !lookup.exists(link);
      return (
        <div {...common} role="group" aria-label={`Link to ${LINK_WORD[link.type].toLowerCase()}`}>
          <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm hover:bg-hover/60">
            <Link2 aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
            {href && !gone ? (
              <Link to={href} className="font-medium hover:underline">
                {lookup.label(link)}
              </Link>
            ) : (
              <span className="text-fg-muted">{lookup.label(link)} (no longer exists)</span>
            )}
            <span className="ml-auto text-xs text-fg-muted">{LINK_WORD[link.type]}</span>
          </div>
        </div>
      );
    }
    case 'file': {
      const f = block.file!;
      return (
        <div {...common} role="group" aria-label={`File reference: ${f.name}`}>
          <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm">
            <Paperclip aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
            {f.url ? (
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline"
              >
                {f.name}
              </a>
            ) : (
              <span className="font-medium">{f.name}</span>
            )}
            <span className="ml-auto text-xs text-fg-muted">
              {[KIND_WORD[f.kind], f.mime, f.size !== undefined ? sizeText(f.size) : '']
                .filter(Boolean)
                .join(' · ')}{' '}
              · {f.attachmentId ? 'External reference (not downloaded)' : 'Reference only'}
            </span>
          </div>
        </div>
      );
    }
    case 'table':
      return (
        <div
          {...common}
          role="group"
          aria-label={`Table: ${block.link ? lookup.label(block.link) : ''}`}
        >
          {block.link && <TableView tableId={block.link.id} compact />}
        </div>
      );
    case 'grid':
      return (
        <div {...common} role="group" aria-label="Simple table">
          <GridEditor block={block} onChange={p.onChange} />
        </div>
      );
    case 'bookmark':
      return (
        <div {...common} role="group" aria-label={`Bookmark: ${block.title || block.url || ''}`}>
          <BookmarkCard block={block} onChange={p.onChange} />
        </div>
      );
    default: {
      const toc = /^<table_of_contents\s*\/>$/.test((block.text ?? '').trim());
      return (
        <div {...common} role="group" aria-label="Imported content kept as it was">
          {toc ? (
            <p className="text-xs text-fg-muted">Notion’s table of contents (the headings below)</p>
          ) : (
            <div className="rounded-md border border-dashed border-line px-3 py-2">
              <p className="text-[11px] text-fg-muted">Kept from the import as it was</p>
              <pre className="mt-1 overflow-x-auto font-mono text-xs whitespace-pre-wrap text-fg-muted">
                {block.text}
              </pre>
            </div>
          )}
        </div>
      );
    }
  }
}

/* ------------------------------ menus ------------------------------ */

function SlashMenu({
  items,
  active,
  onPick,
}: {
  items: SlashItem[];
  active: number;
  onPick: (i: SlashItem) => void;
}) {
  const listId = useId();
  return (
    <ul
      id={listId}
      role="listbox"
      aria-label="Insert a block"
      className="lt-pop absolute left-0 z-30 mt-1 w-72 rounded-lg border border-line bg-raised p-1 shadow-[var(--lt-shadow)]"
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <li
            key={item.label}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(item);
            }}
            className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${i === active ? 'bg-hover' : ''}`}
          >
            <Icon aria-hidden className="size-4 text-fg-muted" />
            <span className="flex-1">{item.label}</span>
            <span className="text-xs text-fg-muted">{item.hint}</span>
          </li>
        );
      })}
      {items.length === SLASH_SHOWN && (
        <li role="presentation" className="px-2 pt-1.5 pb-1 text-[11px] text-fg-muted">
          Type to find more: links, files
        </li>
      )}
    </ul>
  );
}

const TURN_INTO: SpaceBlockType[] = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bullet',
  'numbered',
  'check',
  'quote',
  'callout',
  'code',
];

function BlockMenu({
  block,
  onClose,
  onMove,
  onTurnInto,
  onDelete,
}: {
  block: SpaceBlock;
  onClose: () => void;
  onMove: (d: number) => void;
  onTurnInto: (t: SpaceBlockType) => void;
  onDelete: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const act = (f: () => void) => () => {
    onClose();
    f();
  };
  return (
    <div
      role="menu"
      aria-label="Block options"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      className="lt-pop absolute top-7 left-0 z-30 w-52 rounded-lg border border-line bg-raised p-1 text-sm shadow-[var(--lt-shadow)]"
    >
      <MenuItem ref={first} icon={ArrowUp} label="Move up" onClick={act(() => onMove(-1))} />
      <MenuItem icon={ArrowDown} label="Move down" onClick={act(() => onMove(1))} />
      {isText(block) && (
        <>
          <p className="px-2 pt-2 pb-1 text-[11px] text-fg-muted">Turn into</p>
          {TURN_INTO.filter((t) => t !== block.type).map((t) => (
            <MenuItem key={t} label={TYPE_LABEL[t]} onClick={act(() => onTurnInto(t))} />
          ))}
        </>
      )}
      <MenuItem icon={Trash2} label="Delete block" onClick={act(onDelete)} />
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  ref,
}: {
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover focus-visible:bg-hover"
    >
      {Icon ? <Icon aria-hidden className="size-3.5 text-fg-muted" /> : <span className="w-3.5" />}
      {label}
    </button>
  );
}

/** Choosing what a link or file block points at. */
function Picker({
  command,
  lookup,
  selfId,
  onPick,
  onCancel,
  onCreatePage,
}: {
  command: Command;
  lookup: EntityLookup;
  selfId: string;
  onPick: (block: Omit<SpaceBlock, 'id'>) => void;
  onCancel: () => void;
  /** `[[`: make a new page with this title and link it. */
  onCreatePage?: (title: string) => void;
}) {
  const [typed, setQuery] = useState('');
  const query = command.kind === 'inline' ? command.query : typed;
  const [active, setActive] = useState(0);
  const ids = { q: useId(), name: useId(), url: useId(), file: useId() };
  const [file, setFile] = useState({
    name: '',
    url: '',
    mime: '',
    size: undefined as number | undefined,
  });

  if (command.kind === 'bookmark')
    return <BookmarkForm onSave={(b) => onPick({ type: 'bookmark', ...b })} onCancel={onCancel} />;

  if (command.kind === 'file')
    return (
      <form
        aria-label="Reference a file"
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!file.name.trim()) return;
          const kind: SpaceAttachmentKind = file.mime.startsWith('image/')
            ? 'image'
            : file.mime === 'application/pdf' || /\.pdf$/i.test(file.name)
              ? 'pdf'
              : file.mime.startsWith('video/')
                ? 'video'
                : file.mime.startsWith('audio/')
                  ? 'audio'
                  : 'file';
          onPick({
            type: 'file',
            file: {
              name: file.name.trim(),
              kind,
              ...(file.url.trim() ? { url: file.url.trim() } : {}),
              ...(file.mime ? { mime: file.mime } : {}),
              ...(file.size !== undefined ? { size: file.size } : {}),
            },
          });
        }}
        className="lt-pop absolute left-0 z-30 mt-1 w-80 space-y-3 rounded-lg border border-line bg-raised p-3 shadow-[var(--lt-shadow)]"
      >
        <p className="text-xs text-fg-muted">
          LOWTIDE keeps a reference; the file stays where it is.
        </p>
        <div>
          <label htmlFor={ids.file} className={labelClass}>
            Choose a file (its name, type and size)
          </label>
          <input
            id={ids.file}
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFile((s) => ({ ...s, name: f.name, mime: f.type, size: f.size }));
            }}
            className="text-xs"
          />
        </div>
        <div>
          <label htmlFor={ids.name} className={labelClass}>
            Name
          </label>
          <input
            id={ids.name}
            autoFocus
            value={file.name}
            onChange={(e) => setFile({ ...file, name: e.target.value })}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={ids.url} className={labelClass}>
            Where it lives (URL, optional)
          </label>
          <input
            id={ids.url}
            value={file.url}
            onChange={(e) => setFile({ ...file, url: e.target.value })}
            className={fieldClass}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="sm">
            Add reference
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    );

  const type = command.kind === 'link' ? command.type : 'spaceNode';
  const q = query.trim().toLowerCase();
  const options = lookup
    .options(type)
    .filter(
      (o) => o.id !== selfId && (!q || `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(q)),
    )
    .slice(0, 40);
  return (
    <div
      role="dialog"
      aria-label={`Link ${LINK_WORD[type].toLowerCase()}`}
      className="lt-pop absolute left-0 z-30 mt-1 w-80 rounded-lg border border-line bg-raised p-2 shadow-[var(--lt-shadow)]"
    >
      {command.kind === 'inline' && (
        <p className="px-2 pb-1 text-[11px] text-fg-muted">
          Link a page: keep typing, then Enter (Escape to stop)
        </p>
      )}
      <label htmlFor={ids.q} className="sr-only">
        Find a {LINK_WORD[type].toLowerCase()}
      </label>
      <input
        id={ids.q}
        hidden={command.kind === 'inline'}
        autoFocus={command.kind !== 'inline'}
        role="combobox"
        aria-expanded
        aria-controls={`${ids.q}-list`}
        value={query}
        placeholder={`Find a ${LINK_WORD[type].toLowerCase()}`}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(options.length - 1, a + 1));
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          }
          if (e.key === 'Enter' && options[active]) {
            e.preventDefault();
            const o = options[active]!;
            onPick({ type: 'link', link: { type: o.type, id: o.id, label: o.label } });
          }
        }}
        className={fieldClass}
      />
      <ul id={`${ids.q}-list`} role="listbox" className="mt-1 max-h-64 overflow-y-auto">
        {options.length === 0 && !(command.kind === 'inline' && q) && (
          <li className="px-2 py-1.5 text-sm text-fg-muted">Nothing found.</li>
        )}
        {command.kind === 'inline' && q && onCreatePage && (
          <li
            role="option"
            aria-selected={false}
            onMouseDown={(e) => {
              e.preventDefault();
              onCreatePage(query.trim());
            }}
            className="cursor-pointer rounded-md px-2 py-1.5 text-sm hover:bg-hover"
          >
            <Plus aria-hidden className="mr-1 inline size-3.5" />
            Create “{query.trim()}”
          </li>
        )}
        {options.map((o, i) => (
          <li
            key={o.id}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick({ type: 'link', link: { type: o.type, id: o.id, label: o.label } });
            }}
            className={`cursor-pointer rounded-md px-2 py-1.5 text-sm ${i === active ? 'bg-hover' : ''}`}
          >
            {o.label}
            {o.detail && <span className="ml-2 text-xs text-fg-muted">{o.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------- simple tables ---------------------------- */

/**
 * A simple table (v2.1): rows and columns of text, edited in place. The
 * first row is the header. For typed properties and views, use a database.
 */
function GridEditor({
  block,
  onChange,
}: {
  block: SpaceBlock;
  onChange: (block: SpaceBlock) => void;
}) {
  const rows = block.rows?.length ? block.rows : [['']];
  const width = Math.max(1, ...rows.map((r) => r.length));
  const grid = rows.map((r) => [...r, ...Array<string>(width - r.length).fill('')]);
  const set = (next: string[][]) => onChange({ ...block, rows: next });
  const cell = (i: number, j: number, value: string) =>
    set(grid.map((r, ri) => (ri === i ? r.map((c, cj) => (cj === j ? value : c)) : r)));
  return (
    <div>
      <div
        tabIndex={0}
        role="region"
        aria-label="Simple table, scrolls sideways"
        className="relative overflow-x-auto rounded-md border border-line"
      >
        <table className="w-full border-collapse text-left text-sm">
          <tbody>
            {grid.map((r, i) => (
              <tr key={i} className={i === 0 ? 'bg-surface' : 'border-t border-line'}>
                {r.map((c, j) => (
                  <td key={j} className="min-w-[8rem] border-l border-line p-0 first:border-l-0">
                    <input
                      value={c}
                      aria-label={`${i === 0 ? 'Header' : `Row ${i}`}, column ${j + 1}`}
                      onChange={(e) => cell(i, j, e.target.value)}
                      className={`w-full bg-transparent px-3 py-1.5 outline-none focus:bg-raised ${i === 0 ? 'font-medium' : ''}`}
                    />
                  </td>
                ))}
                <td className="w-8 p-0">
                  {grid.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove ${i === 0 ? 'header row' : `row ${i}`}`}
                      onClick={() => set(grid.filter((_, ri) => ri !== i))}
                      className="grid size-7 place-items-center text-fg-subtle hover:text-fg"
                    >
                      <Trash2 aria-hidden className="size-3" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => set([...grid, Array<string>(width).fill('')])}
        >
          <Plus aria-hidden className="size-3" /> Row
        </Button>
        <Button size="sm" variant="ghost" onClick={() => set(grid.map((r) => [...r, '']))}>
          <Plus aria-hidden className="size-3" /> Column
        </Button>
        {width > 1 && (
          <Button size="sm" variant="ghost" onClick={() => set(grid.map((r) => r.slice(0, -1)))}>
            <Minus aria-hidden className="size-3" /> Last column
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ bookmarks ----------------------------- */

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function BookmarkCard({
  block,
  onChange,
}: {
  block: SpaceBlock;
  onChange: (block: SpaceBlock) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <div className="relative">
        <BookmarkForm
          initial={block}
          onSave={(b) => {
            setEditing(false);
            onChange({ ...block, ...b });
          }}
          onCancel={() => setEditing(false)}
          inline
        />
      </div>
    );
  const safe = block.url && /^(https?:|mailto:)/i.test(block.url) ? block.url : undefined;
  return (
    <div className="flex items-start gap-3 rounded-md border border-line px-3 py-2.5 text-sm">
      <Bookmark aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
      <div className="min-w-0 flex-1">
        {safe ? (
          <a href={safe} target="_blank" rel="noreferrer" className="font-medium hover:underline">
            {block.title || hostOf(safe)}
          </a>
        ) : (
          <span className="font-medium">{block.title || block.url}</span>
        )}
        {block.url && <p className="truncate text-xs text-fg-muted">{block.url}</p>}
        {block.text && <p className="mt-1 text-[13px] text-fg-muted">{block.text}</p>}
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit bookmark ${block.title || block.url || ''}`}
        className="grid size-7 shrink-0 place-items-center rounded text-fg-muted hover:bg-hover hover:text-fg"
      >
        <Pencil aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}

function BookmarkForm({
  initial,
  onSave,
  onCancel,
  inline = false,
}: {
  initial?: Partial<SpaceBlock>;
  onSave: (b: { url: string; title?: string; text?: string }) => void;
  onCancel: () => void;
  inline?: boolean;
}) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [note, setNote] = useState(initial?.text ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const ids = { url: useId(), title: useId(), note: useId() };
  return (
    <form
      aria-label="Bookmark"
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      onSubmit={(e) => {
        e.preventDefault();
        const clean = url.trim();
        if (!clean) {
          setProblem('Give the link.');
          return;
        }
        onSave({
          url: /^[a-z][a-z0-9+.-]*:/i.test(clean) ? clean : `https://${clean}`,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(note.trim() ? { text: note.trim() } : {}),
        });
      }}
      className={`${inline ? '' : 'lt-pop absolute left-0 z-30 mt-1 w-80 shadow-[var(--lt-shadow)]'} space-y-3 rounded-lg border border-line bg-raised p-3`}
    >
      <div>
        <label htmlFor={ids.url} className={labelClass}>
          Link
        </label>
        <input
          id={ids.url}
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className={fieldClass}
          placeholder="https://"
        />
      </div>
      <div>
        <label htmlFor={ids.title} className={labelClass}>
          Title (optional)
        </label>
        <input
          id={ids.title}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor={ids.note} className={labelClass}>
          Note (optional)
        </label>
        <input
          id={ids.note}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={fieldClass}
        />
      </div>
      {problem && <ErrorNotice>{problem}</ErrorNotice>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm">
          Save bookmark
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
