import { blocksOf, blocksToMarkdown } from '../../lib/space-blocks';
import { tableToCsv } from '../../lib/space-database';
import { zipFiles } from '../../lib/zip';
import type { SpaceNode } from '../../types/domain';
import type { SpaceIndex } from './model';

/* Exporting SPACE (v2.1): Markdown pages, CSV databases, zipped folders. */

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A page as Markdown, a database as CSV, a folder as a .zip of both. */
export function exportNode(index: SpaceIndex, node: SpaceNode) {
  if (node.table) {
    download(`${safeName(node.title)}.csv`, tableToCsv(node.table), 'text/csv');
    return;
  }
  if (node.kind === 'page') {
    download(
      `${safeName(node.title)}.md`,
      `# ${node.title}\n\n${blocksToMarkdown(blocksOf(node))}\n`,
      'text/markdown',
    );
    return;
  }
  const files = new Map<string, string>();
  const walk = (n: SpaceNode, prefix: string) => {
    for (const c of index.children.get(n.id) ?? []) {
      if (c.archived) continue;
      const name = `${prefix}${safeName(c.title)}`;
      if (c.table) files.set(`${name}.csv`, tableToCsv(c.table));
      else if (c.kind === 'page')
        files.set(`${name}.md`, `# ${c.title}\n\n${blocksToMarkdown(blocksOf(c))}\n`);
      walk(c, `${name}/`);
    }
  };
  walk(node, `${safeName(node.title)}/`);
  download(
    `${safeName(node.title)}.zip`,
    zipFiles(files, new Date()) as Uint8Array<ArrayBuffer>,
    'application/zip',
  );
}
