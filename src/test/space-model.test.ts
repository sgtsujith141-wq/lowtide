import { describe, expect, it } from 'vitest';
import {
  backlinksOf,
  buildSearch,
  documentsUnder,
  indexNodes,
  isPersonal,
  pathOf,
  projectIdOf,
  searchDocs,
} from '../features/space/model';
import type { SpaceNode } from '../types/domain';

const at = '2026-01-01T00:00:00.000Z';
const node = (id: string, over: Partial<SpaceNode> = {}): SpaceNode => ({
  id,
  kind: 'page',
  title: id,
  order: 0,
  archived: false,
  links: [],
  externalLinks: [],
  attachments: [],
  createdAt: at,
  updatedAt: at,
  ...over,
});

describe('the SPACE model', () => {
  const nodes = [
    node('projects', { kind: 'section', title: 'Projects', key: 'projects' }),
    node('personal', { kind: 'section', title: 'Personal', key: 'personal', order: 4 }),
    node('folder', { kind: 'section', title: 'Engine', key: 'project:p1', parentId: 'projects' }),
    node('slot', {
      kind: 'section',
      title: 'Planning',
      key: 'project:p1:planning',
      parentId: 'folder',
    }),
    node('plan', { title: 'Plan', parentId: 'slot', body: '# Plan\n\nShip the **engine** soon' }),
    node('notes', {
      title: 'Notes',
      parentId: 'folder',
      order: 1,
      blocks: [{ id: 'b', type: 'paragraph', text: 'See [plan](space:plan)' }],
    }),
    node('old', { title: 'Old idea', parentId: 'folder', order: 2, archived: true }),
    node('diary', { title: 'Diary', parentId: 'personal' }),
  ];
  const index = indexNodes(nodes);

  it('knows each page’s path, project, privacy and documents', () => {
    expect(pathOf(index, 'plan').map((n) => n.title)).toEqual([
      'Projects',
      'Engine',
      'Planning',
      'Plan',
    ]);
    expect(projectIdOf(index, 'plan')).toBe('p1');
    expect(projectIdOf(index, 'diary')).toBeUndefined();
    expect(isPersonal(index, 'diary')).toBe(true);
    expect(documentsUnder(index, 'folder').map((n) => n.id)).toEqual(['plan', 'notes']);
    expect(documentsUnder(index, 'folder', true)).toHaveLength(3);
    expect(index.children.get('')!.map((n) => n.key)).toEqual(['projects', 'personal']);
  });

  it('finds backlinks from content links', () => {
    expect(backlinksOf(nodes, 'plan').map((n) => n.id)).toEqual(['notes']);
  });

  it('searches titles, content and provenance, titles first, with an excerpt', () => {
    const docs = buildSearch(nodes);
    const hits = searchDocs(docs, 'engine');
    expect(hits[0]!.id).toBe('folder');
    expect(hits.map((h) => h.id)).toContain('plan');
    expect(hits.find((h) => h.id === 'plan')).toMatchObject({
      location: 'Projects / Engine / Planning',
      excerpt: expect.stringContaining('Ship the engine soon'),
    });
    expect(searchDocs(docs, 'ship soon').map((h) => h.id)).toEqual(['plan']);
    expect(
      searchDocs(buildSearch(nodes, { include: (n) => !isPersonal(index, n.id) }), 'diary'),
    ).toEqual([]);
  });

  it('stays fast at the size of a real import (150 pages, 26 tables, 300 rows)', () => {
    const big: SpaceNode[] = [node('root', { kind: 'section', title: 'Root', key: 'projects' })];
    for (let i = 0; i < 150; i++) {
      big.push(
        node(`p${i}`, {
          parentId: i < 10 ? 'root' : `p${i % 10}`,
          title: `Page ${i}`,
          body: `# Heading ${i}\n\n${'Some words here. '.repeat(120)}\n- item ${i}`,
        }),
      );
    }
    for (let t = 0; t < 26; t++) {
      big.push(
        node(`t${t}`, {
          kind: 'table',
          parentId: 'root',
          title: `Table ${t}`,
          table: {
            columns: Array.from({ length: 8 }, (_, c) => ({
              id: `c${c}`,
              name: `Col ${c}`,
              type: 'text' as const,
            })),
            rows: Array.from({ length: 12 }, (_, r) => ({
              id: `r${r}`,
              cells: Object.fromEntries(
                Array.from({ length: 8 }, (_, c) => [`c${c}`, `cell t${t}r${r}c${c}`]),
              ),
            })),
          },
        }),
      );
    }
    const t0 = performance.now();
    const docs = buildSearch(big);
    const built = performance.now() - t0;
    const t1 = performance.now();
    const hits = searchDocs(docs, 'cell t7r3c5');
    const searched = performance.now() - t1;
    expect(hits[0]!.title).toBe('Table 7');
    // Generous bounds for a busy CI machine; typically a few milliseconds each.
    expect(built).toBeLessThan(500);
    expect(searched).toBeLessThan(50);
    expect(indexNodes(big).children.get('root')!.length).toBe(36);
  });
});
