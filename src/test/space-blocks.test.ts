import { describe, expect, it } from 'vitest';
import { blocksOf, blocksToMarkdown, linksOf, parseBody, plainInline } from '../lib/space-blocks';
import type { SpaceNode } from '../types/domain';

const kinds = (body: string, format?: 'notion' | 'markdown') =>
  parseBody(body, format ? { format } : {}).map((b) => b.type);

describe('SPACE blocks from Markdown', () => {
  it('reads headings, lists, checklists, quotes, code and dividers', () => {
    const blocks = parseBody(
      [
        '# Title',
        '## Part',
        '#### Deep',
        'A paragraph',
        'that wraps.',
        '',
        '- one',
        '  - nested',
        '1. first',
        '- [ ] todo',
        '- [x] done',
        '> quoted',
        '```ts',
        'const x = 1;',
        '```',
        '---',
      ].join('\n'),
    );
    expect(blocks.map((b) => [b.type, b.text ?? '', b.indent ?? 0])).toEqual([
      ['heading1', 'Title', 0],
      ['heading2', 'Part', 0],
      ['heading3', 'Deep', 0],
      ['paragraph', 'A paragraph\nthat wraps.', 0],
      ['bullet', 'one', 0],
      ['bullet', 'nested', 1],
      ['numbered', 'first', 0],
      ['check', 'todo', 0],
      ['check', 'done', 0],
      ['quote', 'quoted', 0],
      ['code', 'const x = 1;', 0],
      ['divider', '', 0],
    ]);
    expect(blocks.find((b) => b.type === 'code')?.language).toBe('ts');
    expect(blocks.filter((b) => b.type === 'check').map((b) => b.checked)).toEqual([false, true]);
  });

  it('round-trips through Markdown', () => {
    const md = '# Plan\n\n- one\n\n- [x] done\n\n> note\n\n---';
    expect(blocksToMarkdown(parseBody(md)).replace(/\n\n/g, '\n')).toBe(
      '# Plan\n- one\n- [x] done\n> note\n---',
    );
  });
});

describe('SPACE blocks from Notion’s enhanced Markdown', () => {
  it('reads callouts, tables, columns, tabs and toggles, and strips inline markup', () => {
    const body = [
      '<callout icon="💡" color="blue_bg">',
      '\t**Read first.**',
      '\tSecond line<br>third',
      '</callout>',
      '<table header-row="true">',
      '<tr><td>Name</td><td>Size</td></tr>',
      '<tr><td>Alpha</td><td><span color="red">2</span></td></tr>',
      '</table>',
      '<columns>',
      '\t<column>',
      '\t\tLeft side',
      '\t</column>',
      '</columns>',
      '<tabs>',
      '<tab title="Setup">',
      '\tInstall it',
      '</tab>',
      '</tabs>',
      '<details>',
      '<summary>More</summary>',
      '\tHidden text',
      '</details>',
      'Due <mention-date start="2026-01-05"/> {color="gray"}',
    ].join('\n');
    const blocks = parseBody(body, { format: 'notion' });
    expect(blocks.map((b) => b.type)).toEqual([
      'callout',
      'grid',
      'paragraph',
      'heading3',
      'paragraph',
      'heading3',
      'paragraph',
      'paragraph',
    ]);
    expect(blocks[0]).toMatchObject({ icon: '💡', text: '**Read first.**\nSecond line\nthird' });
    expect(blocks[1]!.rows).toEqual([
      ['Name', 'Size'],
      ['Alpha', '2'],
    ]);
    expect(blocks.at(-1)!.text).toBe('Due 2026-01-05');
  });

  it('keeps an unknown structure exactly, read-only, instead of dropping it', () => {
    const blocks = parseBody('<synced_block id="1">\n\tShared text\n</synced_block>\nAfter', {
      format: 'notion',
    });
    expect(blocks[0]).toMatchObject({
      type: 'fallback',
      text: '<synced_block id="1">\nShared text\n</synced_block>',
    });
    expect(blocks[1]).toMatchObject({ type: 'paragraph', text: 'After' });
  });

  it('keeps literal angle-bracket text that isn’t a structure', () => {
    expect(parseBody('Name it <episode-id> later', { format: 'notion' })[0]!.text).toBe(
      'Name it <episode-id> later',
    );
  });

  it('turns lone page and file references into link and file blocks', () => {
    const blocks = parseBody('[Spec](space:abc)\n[deck.pdf](attachment:p#pdf-1)', {
      format: 'notion',
      attachments: [
        {
          id: 'p#pdf-1',
          kind: 'pdf',
          name: 'deck.pdf',
          status: 'external',
          url: 'https://x/deck.pdf',
        },
      ],
    });
    expect(blocks[0]).toMatchObject({
      type: 'link',
      link: { type: 'spaceNode', id: 'abc', label: 'Spec' },
    });
    expect(blocks[1]).toMatchObject({
      type: 'file',
      file: { name: 'deck.pdf', kind: 'pdf', url: 'https://x/deck.pdf', attachmentId: 'p#pdf-1' },
    });
  });
});

describe('page content and links', () => {
  const node = (over: Partial<SpaceNode>): SpaceNode => ({
    id: 'n',
    kind: 'page',
    title: 'T',
    order: 0,
    archived: false,
    links: [],
    externalLinks: [],
    attachments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });

  it('shows its own blocks once written, else its body parsed (without changing it)', () => {
    const imported = node({ body: '# Hi', bodyFormat: 'notion' });
    expect(blocksOf(imported).map((b) => b.text)).toEqual(['Hi']);
    expect(imported.body).toBe('# Hi');
    expect(blocksOf(node({ body: '# Hi', blocks: [] }))).toEqual([]);
  });

  it('gathers links from the record, link blocks, tables and inline page links, once each', () => {
    const n = node({
      links: [{ type: 'project', id: 'p1' }],
      blocks: [
        { id: 'a', type: 'link', link: { type: 'project', id: 'p1' } },
        { id: 'b', type: 'paragraph', text: 'See [the spec](space:s1) and [web](https://x)' },
        { id: 'c', type: 'table', link: { type: 'spaceNode', id: 't1' } },
        { id: 'd', type: 'code', text: '[not](space:zzz)' },
      ],
    });
    expect(linksOf(n).map((l) => `${l.type}:${l.id}`)).toEqual([
      'project:p1',
      'spaceNode:s1',
      'spaceNode:t1',
    ]);
  });

  it('reads inline Markdown as plain text', () => {
    expect(plainInline('**Bold** and *it* with `code` and [a link](https://x)')).toBe(
      'Bold and it with code and a link',
    );
    expect(kinds('plain')).toEqual(['paragraph']);
  });
});
