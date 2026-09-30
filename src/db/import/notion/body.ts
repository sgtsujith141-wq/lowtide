import type { SpaceAttachment, SpaceAttachmentKind } from '../../../types/domain';
import type { NotionId } from './types';
import { notionIdOf } from './values';

/*
 * Notion page bodies (enhanced Markdown) as SPACE bodies (ADR-062). Pure.
 *
 * - Child pages, child databases and mentions become Markdown links: to the
 *   SPACE node when the target was imported (`space:<id>`), otherwise to the
 *   original Notion URL, so nothing silently points nowhere.
 * - Files, images, PDFs, video and audio become attachment records. The MCP
 *   can't download them, so each is kept as an external reference (name,
 *   source URL) and the body links to it (`attachment:<id>`).
 * - Everything else (callouts, toggles, tables, colours) stays as Notion
 *   wrote it; the node's `bodyFormat` is `notion` so a renderer knows.
 */

export interface ConvertedBody {
  body: string;
  attachments: SpaceAttachment[];
  /** Notion ids the body links to (child pages, databases, mentions). */
  references: NotionId[];
}

const ATTACHMENT_TAG = /<(file|image|pdf|video|audio)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
const REF_TAG =
  /<(page|database|mention-page|mention-database)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
  return match?.[1];
}

function fileName(url: string | undefined, fallback: string): string {
  if (!url) return fallback;
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : fallback;
  } catch {
    return fallback;
  }
}

/** Plain text of a tag's inner content (drops nested tags and brackets). */
const plain = (value: string | undefined) =>
  (value ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/[[\]]/g, '')
    .trim();

/**
 * `resolve(notionId)` returns the SPACE node id for an imported target, or
 * undefined. `attachmentId(pageId, n)` must be stable for the same page and
 * position, so a re-import produces the same body.
 */
export function convertBody(
  body: string,
  pageId: NotionId,
  resolve: (id: NotionId) => string | undefined,
  titleOf: (id: NotionId) => string | undefined,
): ConvertedBody {
  const attachments: SpaceAttachment[] = [];
  const references: NotionId[] = [];

  let converted = body.replace(
    ATTACHMENT_TAG,
    (_all, tag: SpaceAttachmentKind, attrs: string, inner?: string) => {
      const url = attribute(attrs, 'src') ?? attribute(attrs, 'source') ?? attribute(attrs, 'url');
      const id = `${pageId}#${tag}-${attachments.length + 1}`;
      const name = plain(inner) || fileName(url, `${tag} ${attachments.length + 1}`);
      attachments.push({
        id,
        kind: tag,
        name,
        status: 'external',
        ...(url ? { url } : {}),
        note: 'Referenced from Notion; the file itself was not downloaded.',
      });
      return `[${name}](attachment:${id})`;
    },
  );

  converted = converted.replace(REF_TAG, (all, tag: string, attrs: string, inner?: string) => {
    const url = attribute(attrs, 'url');
    const id = url ? notionIdOf(url) : undefined;
    if (!id) return all;
    references.push(id);
    const label =
      plain(inner) ||
      titleOf(id) ||
      (tag === 'database' || tag === 'mention-database' ? 'Linked database view' : 'Untitled page');
    const node = resolve(id);
    return `[${label}](${node ? `space:${node}` : url})`;
  });

  converted = converted.replace(/<empty-block\s*\/>/g, '');
  return { body: converted, attachments, references };
}
