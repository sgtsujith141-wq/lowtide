import type {
  EntityLink,
  SpaceAttachment,
  SpaceBlock,
  SpaceBodyFormat,
  SpaceNode,
} from '../types/domain';

/*
 * SPACE page content as blocks (v2 PHASE 014, ADR-067). Pure; shared by the
 * repositories, the editor, search and the MCP tools.
 *
 * - `blocksOf(node)`: what a page shows. Its own `blocks` once written in
 *   LOWTIDE; otherwise its imported or Markdown `body`, parsed here on the
 *   fly. The stored body is never rewritten.
 * - `parseBody`: Markdown, and Notion's enhanced Markdown (callouts, tables,
 *   columns, tabs, toggles), into blocks. Anything else that looks like a
 *   block-level tag becomes a read-only `fallback` block holding it as it
 *   was, so imported content is never silently dropped.
 * - `blocksToMarkdown`: the reverse, for AI clients and plain-text search.
 */

export interface ParseOptions {
  format?: SpaceBodyFormat;
  attachments?: readonly SpaceAttachment[];
  /** Block ids: `imp-<n>` by default, stable for the same body. */
  idPrefix?: string;
}

const ATTR = (attrs: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];

/** Notion inline markup to the editor's inline Markdown. */
export function cleanInline(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<mention-date\b[^>]*\bstart="([^"]*)"[^>]*\/?>(?:<\/mention-date>)?/g, '$1')
    .replace(/<mention-user\b[^>]*>([\s\S]*?)<\/mention-user>/g, '$1')
    .replace(/<span\b[^>]*>([\s\S]*?)<\/span>/g, '$1')
    .replace(/<\/?(?:u|underline)>/g, '')
    .replace(/\s*\{color="[^"]*"\}\s*$/g, '')
    .replace(/\\([~*_`[\]()#>|-])/g, '$1');
}

const BLOCK_TAG = /^<([a-z][a-z0-9_-]*)\b([^>]*)>/;
const SELF_CLOSING = /^<([a-z][a-z0-9_-]*)\b[^>]*\/>\s*$/;

/** Index of the line closing `<tag>` opened on `lines[start]`, or -1. */
function closing(lines: readonly string[], start: number, tag: string): number {
  let depth = 0;
  const open = new RegExp(`<${tag}\\b(?![^>]*\\/>)`, 'g');
  const close = new RegExp(`</${tag}>`, 'g');
  for (let i = start; i < lines.length; i++) {
    depth += (lines[i]!.match(open) ?? []).length;
    depth -= (lines[i]!.match(close) ?? []).length;
    if (depth <= 0) return i;
  }
  return -1;
}

const stripTags = (s: string) => cleanInline(s).replace(/<\/?[a-z][^>]*>/g, '');

function parseGrid(source: string): string[][] {
  const rows: string[][] = [];
  for (const tr of source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    rows.push(
      [...tr[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
        stripTags(c[1]!).trim(),
      ),
    );
  }
  return rows;
}

export function parseBody(body: string, options: ParseOptions = {}): SpaceBlock[] {
  const notion = options.format === 'notion';
  const prefix = options.idPrefix ?? 'imp';
  const attachments = new Map((options.attachments ?? []).map((a) => [a.id, a]));
  const out: SpaceBlock[] = [];
  const push = (block: Omit<SpaceBlock, 'id'>) =>
    out.push({ id: `${prefix}-${out.length}`, ...block } as SpaceBlock);
  const lines = body.replace(/\r\n?/g, '\n').split('\n');

  const walk = (src: readonly string[]) => {
    let paragraph: string[] = [];
    const flush = () => {
      if (paragraph.length) push({ type: 'paragraph', text: paragraph.join('\n') });
      paragraph = [];
    };
    for (let i = 0; i < src.length; i++) {
      const raw = src[i]!;
      const tabs = /^\t*/.exec(raw)![0].length;
      const line = notion ? raw.slice(tabs) : raw;
      const trimmed = line.trim();

      // Fenced code: kept exactly.
      const fence = /^(\s*)```(.*)$/.exec(line);
      if (fence) {
        flush();
        const code: string[] = [];
        let j = i + 1;
        for (
          ;
          j < src.length && !/^\s*```\s*$/.test(notion ? src[j]!.replace(/^\t*/, '') : src[j]!);
          j++
        ) {
          code.push(notion ? src[j]!.replace(/^\t*/, '') : src[j]!);
        }
        push({
          type: 'code',
          text: code.join('\n'),
          ...(fence[2]!.trim() ? { language: fence[2]!.trim().slice(0, 40) } : {}),
        });
        i = j;
        continue;
      }

      if (notion) {
        const tag = BLOCK_TAG.exec(trimmed);
        if (tag && SELF_CLOSING.test(trimmed) && tag[1] === 'empty-block') continue;
        if (tag) {
          const name = tag[1]!;
          const attrs = tag[2]!;
          const end = closing(src, i, name);
          if (end >= 0) {
            flush();
            const chunk = src.slice(i, end + 1);
            const inner = chunk
              .join('\n')
              .replace(new RegExp(`^\\s*<${name}\\b[^>]*>`), '')
              .replace(new RegExp(`</${name}>\\s*$`), '');
            if (name === 'callout') {
              const text = inner
                .split('\n')
                .map((l) => stripTags(l.replace(/^\t*/, '')).trim())
                .filter(Boolean)
                .join('\n');
              push({
                type: 'callout',
                text,
                ...(ATTR(attrs, 'icon') ? { icon: ATTR(attrs, 'icon')! } : {}),
              });
            } else if (name === 'table') {
              push({ type: 'grid', rows: parseGrid(inner) });
            } else if (name === 'columns' || name === 'column' || name === 'tabs') {
              walk(inner.split('\n'));
            } else if (name === 'tab') {
              const title = ATTR(attrs, 'title');
              if (title) push({ type: 'heading3', text: cleanInline(title) });
              walk(inner.split('\n'));
            } else if (name === 'details') {
              const summary = /<summary>([\s\S]*?)<\/summary>/.exec(inner);
              if (summary) push({ type: 'heading3', text: stripTags(summary[1]!).trim() });
              walk(inner.replace(/<summary>[\s\S]*?<\/summary>/, '').split('\n'));
            } else {
              // Unknown structure: kept exactly, read-only.
              push({ type: 'fallback', text: chunk.map((l) => l.replace(/^\t*/, '')).join('\n') });
            }
            i = end;
            continue;
          }
        }
      }

      if (!trimmed) {
        flush();
        continue;
      }
      const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
      if (heading) {
        flush();
        const level = Math.min(3, heading[1]!.length);
        push({ type: `heading${level}` as 'heading1', text: cleanInline(heading[2]!) });
        continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flush();
        push({ type: 'divider' });
        continue;
      }
      const spaces = /^ */.exec(line)![0].length;
      const indent = Math.min(3, notion ? tabs : Math.floor(spaces / 2));
      const check = /^[-*+]\s+\[([ xX])\]\s?(.*)$/.exec(trimmed);
      if (check) {
        flush();
        push({
          type: 'check',
          text: cleanInline(check[2]!),
          checked: check[1] !== ' ',
          ...(indent ? { indent } : {}),
        });
        continue;
      }
      const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
      if (bullet) {
        flush();
        push({ type: 'bullet', text: cleanInline(bullet[1]!), ...(indent ? { indent } : {}) });
        continue;
      }
      const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
      if (numbered) {
        flush();
        push({ type: 'numbered', text: cleanInline(numbered[1]!), ...(indent ? { indent } : {}) });
        continue;
      }
      const quote = /^>\s?(.*)$/.exec(trimmed);
      if (quote) {
        flush();
        const last = out.at(-1);
        if (last?.type === 'quote' && src[i - 1]?.trim().startsWith('>')) {
          last.text = `${last.text}\n${cleanInline(quote[1]!)}`;
        } else push({ type: 'quote', text: cleanInline(quote[1]!) });
        continue;
      }
      // A line that is only a link to a file or a page reads as its own block.
      const only = /^\[([^\]]*)\]\(((?:attachment|space):[^)]+)\)$/.exec(trimmed);
      if (only) {
        flush();
        const [, label, target] = only;
        if (target!.startsWith('attachment:')) {
          const a = attachments.get(target!.slice('attachment:'.length));
          push({
            type: 'file',
            file: {
              name: a?.name ?? label ?? 'File',
              kind: a?.kind ?? 'file',
              ...(a?.url ? { url: a.url } : {}),
              ...(a ? { attachmentId: a.id } : {}),
            },
          });
        } else {
          push({
            type: 'link',
            link: {
              type: 'spaceNode',
              id: target!.slice('space:'.length),
              ...(label ? { label } : {}),
            },
          });
        }
        continue;
      }
      if (notion) {
        flush();
        push({ type: 'paragraph', text: cleanInline(trimmed) });
      } else paragraph.push(cleanInline(line.trimEnd()));
    }
    flush();
  };
  walk(lines);
  return out;
}

/** What a page shows: its own blocks, else its body parsed. */
export function blocksOf(
  node: Pick<SpaceNode, 'blocks' | 'body' | 'bodyFormat' | 'attachments'>,
): SpaceBlock[] {
  if (node.blocks) return node.blocks;
  if (!node.body) return [];
  return parseBody(node.body, {
    ...(node.bodyFormat ? { format: node.bodyFormat } : {}),
    attachments: node.attachments,
  });
}

/** Inline Markdown as plain text (search, excerpts). */
export function plainInline(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)(.*?)\1/g, '$2')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
}

/** A block's readable text. */
export function blockText(block: SpaceBlock): string {
  if (block.type === 'grid') return (block.rows ?? []).map((r) => r.join(' · ')).join('\n');
  if (block.type === 'file') return block.file?.name ?? '';
  if (block.type === 'link') return block.link?.label ?? '';
  if (block.type === 'bookmark')
    return [block.title, block.url, block.text].filter(Boolean).join(' · ');
  if (block.type === 'code' || block.type === 'fallback') return block.text ?? '';
  return plainInline(block.text ?? '');
}

/** Records the blocks point at: link blocks, embedded tables and inline `space:` links. */
export function linksInBlocks(blocks: readonly SpaceBlock[]): EntityLink[] {
  const out: EntityLink[] = [];
  for (const b of blocks) {
    if ((b.type === 'link' || b.type === 'table') && b.link) out.push(b.link);
    if (b.text && b.type !== 'code' && b.type !== 'fallback') {
      for (const m of b.text.matchAll(/\[([^\]]*)\]\(space:([^)\s]+)\)/g)) {
        out.push({ type: 'spaceNode', id: m[2]!, ...(m[1] ? { label: m[1] } : {}) });
      }
    }
  }
  return out;
}

/** Every record a page links to (its own links and its content's), once each. */
export function linksOf(node: SpaceNode): EntityLink[] {
  const seen = new Set<string>();
  const out: EntityLink[] = [];
  for (const link of [...node.links, ...linksInBlocks(blocksOf(node))]) {
    const key = `${link.type}:${link.id}:${link.rowId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

const LIST_MARK: Partial<Record<SpaceBlock['type'], string>> = {
  bullet: '- ',
  numbered: '1. ',
};

/** Blocks as Markdown (for AI clients and exports). */
export function blocksToMarkdown(blocks: readonly SpaceBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    const pad = '  '.repeat(b.indent ?? 0);
    const t = b.text ?? '';
    switch (b.type) {
      case 'heading1':
        parts.push(`# ${t}`);
        break;
      case 'heading2':
        parts.push(`## ${t}`);
        break;
      case 'heading3':
        parts.push(`### ${t}`);
        break;
      case 'bullet':
      case 'numbered':
        parts.push(`${pad}${LIST_MARK[b.type]}${t}`);
        break;
      case 'check':
        parts.push(`${pad}- [${b.checked ? 'x' : ' '}] ${t}`);
        break;
      case 'quote':
        parts.push(
          t
            .split('\n')
            .map((l) => `> ${l}`)
            .join('\n'),
        );
        break;
      case 'callout':
        parts.push(
          t
            .split('\n')
            .map((l) => `> ${b.icon ? `${b.icon} ` : ''}${l}`)
            .join('\n'),
        );
        break;
      case 'code':
        parts.push(`\`\`\`${b.language ?? ''}\n${t}\n\`\`\``);
        break;
      case 'divider':
        parts.push('---');
        break;
      case 'file':
        parts.push(`[${b.file?.name ?? 'File'}](${b.file?.url ?? ''})`);
        break;
      case 'link':
      case 'table':
        parts.push(
          b.link
            ? `[${b.link.label ?? b.link.type}](${b.link.type === 'spaceNode' ? `space:${b.link.id}` : `lowtide:${b.link.type}/${b.link.id}`})`
            : '',
        );
        break;
      case 'grid': {
        const [head = [], ...rest] = b.rows ?? [];
        parts.push(
          [head, head.map(() => '---'), ...rest]
            .map((r) => `| ${r.map((c) => c.replace(/\n/g, ' ')).join(' | ')} |`)
            .join('\n'),
        );
        break;
      }
      case 'fallback':
        parts.push(t);
        break;
      case 'bookmark':
        parts.push(`[${b.title || b.url || 'Link'}](${b.url ?? ''})${t ? ` — ${t}` : ''}`);
        break;
      default:
        parts.push(t);
    }
  }
  return parts.join('\n\n');
}
