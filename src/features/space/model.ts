import { blocksOf, blockText, linksOf } from '../../lib/space-blocks';
import { SPACE_ROOTS, type Decision, type Id, type SpaceNode } from '../../types/domain';

/*
 * SPACE's workspace model (v2 PHASE 014): the tree, locations, project
 * ownership, backlinks and the local search index. Pure.
 */

export interface SpaceIndex {
  byId: Map<Id, SpaceNode>;
  /** Children by parent id ('' for the top level), in order. */
  children: Map<string, SpaceNode[]>;
}

const ROOT_ORDER = new Map<string, number>(SPACE_ROOTS.map((r, i) => [r.key, i]));

export function indexNodes(nodes: readonly SpaceNode[]): SpaceIndex {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, SpaceNode[]>();
  for (const n of nodes) {
    const parent = n.parentId && byId.has(n.parentId) ? n.parentId : '';
    const list = children.get(parent) ?? [];
    list.push(n);
    children.set(parent, list);
  }
  for (const [parent, list] of children) {
    list.sort((a, b) =>
      parent === ''
        ? (ROOT_ORDER.get(a.key ?? '') ?? 99) - (ROOT_ORDER.get(b.key ?? '') ?? 99) ||
          a.order - b.order
        : a.order - b.order || a.title.localeCompare(b.title),
    );
  }
  return { byId, children };
}

/** The node's ancestors from the top down, the node last. */
export function pathOf(index: SpaceIndex, id: Id): SpaceNode[] {
  const out: SpaceNode[] = [];
  const seen = new Set<Id>();
  for (
    let at = index.byId.get(id);
    at && !seen.has(at.id);
    at = index.byId.get(at.parentId ?? '')
  ) {
    seen.add(at.id);
    out.unshift(at);
  }
  return out;
}

/** The LOWTIDE project a node belongs to (through its `project:<id>` folder), if any. */
export function projectIdOf(index: SpaceIndex, id: Id): Id | undefined {
  for (const n of pathOf(index, id).reverse()) {
    const m = /^project:([^:]+)$/.exec(n.key ?? '');
    if (m) return m[1];
  }
  return undefined;
}

/** True under Personal: private, never shown to an AI client without permission. */
export function isPersonal(index: SpaceIndex, id: Id): boolean {
  return pathOf(index, id).some((n) => n.key === 'personal');
}

/** Documents (pages and tables) under a node. */
export function documentsUnder(index: SpaceIndex, id: Id, includeArchived = false): SpaceNode[] {
  const out: SpaceNode[] = [];
  const walk = (parent: Id) => {
    for (const c of index.children.get(parent) ?? []) {
      if (c.archived && !includeArchived) continue;
      if (c.kind !== 'section') out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

/** Pages that link to `id`: in their links, their content or a table's link cells. */
export function backlinksOf(nodes: readonly SpaceNode[], id: Id): SpaceNode[] {
  return nodes.filter((n) => {
    if (n.id === id) return false;
    if (linksOf(n).some((l) => l.type === 'spaceNode' && l.id === id)) return true;
    return (n.table?.rows ?? []).some(
      (r) =>
        r.pageId === id ||
        Object.values(r.cells).some(
          (v) =>
            Array.isArray(v) &&
            v.some((x) => typeof x === 'object' && x.type === 'spaceNode' && x.id === id),
        ),
    );
  });
}

/* --------------------------------- search -------------------------------- */

export type SearchKind = 'page' | 'table' | 'section' | 'decision';

export interface SearchDoc {
  id: Id;
  kind: SearchKind;
  title: string;
  location: string;
  /** Lower-cased text searched (title first). */
  haystack: string;
  /** Readable text for excerpts. */
  text: string;
  archived: boolean;
  /** Where it opens. */
  href: string;
}

export interface SearchHit extends SearchDoc {
  excerpt: string;
  score: number;
}

/**
 * The local search index: page titles and content, table names and cell
 * text, import provenance (original titles and paths), linked project names,
 * and decisions. Built once per change; queries are plain substring matches.
 */
export function buildSearch(
  nodes: readonly SpaceNode[],
  extras: {
    decisions?: readonly Decision[];
    projectName?: (id: Id) => string | undefined;
    /** Which nodes to index (all by default); locations still use the whole tree. */
    include?: (node: SpaceNode) => boolean;
  } = {},
): SearchDoc[] {
  const index = indexNodes(nodes);
  const docs: SearchDoc[] = [];
  for (const n of nodes) {
    if (extras.include && !extras.include(n)) continue;
    const location = pathOf(index, n.id)
      .slice(0, -1)
      .map((p) => p.title)
      .join(' / ');
    const parts: string[] = [];
    for (const b of blocksOf(n)) parts.push(blockText(b));
    if (n.table) {
      parts.push(n.table.columns.map((c) => c.name).join(' '));
      for (const r of n.table.rows) {
        for (const v of Object.values(r.cells)) {
          parts.push(
            Array.isArray(v)
              ? v.map((x) => (typeof x === 'string' ? x : (x.label ?? ''))).join(' ')
              : String(v),
          );
        }
      }
    }
    const projects = linksOf(n)
      .filter((l) => l.type === 'project')
      .map((l) => extras.projectName?.(l.id) ?? '')
      .filter(Boolean);
    const provenance = n.source ? [n.source.originalTitle, ...(n.source.path ?? [])] : [];
    const text = parts.filter(Boolean).join('\n');
    docs.push({
      id: n.id,
      kind: n.kind,
      title: n.title,
      location,
      haystack: [n.title, text, ...projects, ...provenance].join('\n').toLowerCase(),
      text,
      archived: n.archived,
      href: `/space/${n.id}`,
    });
  }
  for (const d of extras.decisions ?? []) {
    const text = [d.decision, d.context, d.consequences].filter(Boolean).join('\n');
    docs.push({
      id: d.id,
      kind: 'decision',
      title: d.title,
      location: `Decision · ${extras.projectName?.(d.projectId) ?? 'Project'}`,
      haystack: [d.title, text, extras.projectName?.(d.projectId) ?? ''].join('\n').toLowerCase(),
      text,
      archived: false,
      href: '',
    });
  }
  return docs;
}

function excerpt(text: string, term: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(term);
  if (at < 0) return flat.slice(0, 120);
  const start = Math.max(0, at - 50);
  return `${start > 0 ? '…' : ''}${flat.slice(start, at + term.length + 70)}${at + term.length + 70 < flat.length ? '…' : ''}`;
}

/** Documents matching every word of `query`, titles first. */
export function searchDocs(docs: readonly SearchDoc[], query: string, limit = 30): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const d of docs) {
    if (!terms.every((t) => d.haystack.includes(t))) continue;
    const title = d.title.toLowerCase();
    const score =
      (title === terms.join(' ') ? 100 : 0) +
      terms.filter((t) => title.includes(t)).length * 10 -
      (d.archived ? 20 : 0) -
      (d.kind === 'section' ? 2 : 0);
    hits.push({
      ...d,
      score,
      excerpt: title.includes(terms[0]!)
        ? excerpt(d.text, terms.at(-1)!)
        : excerpt(d.text, terms[0]!),
    });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
