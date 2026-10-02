/*
 * Inline Markdown ↔ the HTML an editable block shows (v2 PHASE 014). Text
 * blocks store a small inline Markdown subset: **bold**, *italic*, `code`,
 * ~~strike~~ and [links](url). Only those elements are ever produced or read
 * back; everything else is treated as plain text, so pasted markup can't
 * smuggle anything in.
 */

const NBSP = new RegExp(String.fromCharCode(160), 'g');

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Where a stored link opens in the app (`space:<id>` → the page). */
export function hrefOf(target: string): string {
  if (target.startsWith('space:')) return `/space/${target.slice(6)}`;
  return target;
}

const SAFE_URL = /^(https?:|mailto:|space:|attachment:|\/)/i;

export function inlineToHtml(md: string): string {
  // Code spans first, so their content is never formatted.
  const codes: string[] = [];
  let s = md.replace(/`([^`\n]+)`/g, (_m, c: string) => {
    codes.push(c);
    return `\uE000${codes.length - 1}\uE000`;
  });
  s = escapeHtml(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) =>
      SAFE_URL.test(url) ? `<a href="${escapeHtml(url)}">${text}</a>` : `${text} (${url})`,
    )
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/\n/g, '<br>');
  return s.replace(
    /\uE000(\d+)\uE000/g,
    (_m, i: string) => `<code>${escapeHtml(codes[+i]!)}</code>`,
  );
}

/** The inline Markdown of an editable element's content. */
export function htmlToInline(root: Node): string {
  const walk = (node: Node): string => {
    if (node.nodeType === 3) return (node.textContent ?? '').replace(NBSP, ' ');
    if (node.nodeType !== 1) return '';
    const el = node as HTMLElement;
    const inner = () => [...el.childNodes].map(walk).join('');
    switch (el.tagName) {
      case 'BR':
        return '\n';
      case 'STRONG':
      case 'B': {
        const t = inner();
        return t.trim() ? `**${t}**` : t;
      }
      case 'EM':
      case 'I': {
        const t = inner();
        return t.trim() ? `*${t}*` : t;
      }
      case 'S':
      case 'STRIKE':
      case 'DEL': {
        const t = inner();
        return t.trim() ? `~~${t}~~` : t;
      }
      case 'CODE':
        return `\`${el.textContent ?? ''}\``;
      case 'A': {
        const href = el.getAttribute('href') ?? '';
        const t = inner();
        return href ? `[${t}](${href})` : t;
      }
      case 'DIV':
      case 'P': {
        const t = inner();
        return el.previousSibling ? `\n${t}` : t;
      }
      default:
        return inner();
    }
  };
  return [...root.childNodes].map(walk).join('').replace(/\n$/, '');
}

/** Caret offset in characters of plain text from the element's start, or -1. */
export function caretOffset(el: HTMLElement): number {
  const sel = el.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0) return -1;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return -1;
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/** Splits an editable element's content at the caret into inline Markdown before and after. */
export function splitAtCaret(el: HTMLElement): [string, string] {
  const sel = el.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
    return [htmlToInline(el), ''];
  }
  const range = sel.getRangeAt(0);
  const before = range.cloneRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  const after = range.cloneRange();
  after.selectNodeContents(el);
  after.setStart(range.endContainer, range.endOffset);
  const frag = (r: Range) => {
    const holder = el.ownerDocument.createElement('div');
    holder.appendChild(r.cloneContents());
    return htmlToInline(holder);
  };
  return [frag(before), frag(after)];
}

/** Puts the caret at a plain-text offset inside an element (end when past it). */
export function placeCaret(el: HTMLElement, offset: number | 'end') {
  const doc = el.ownerDocument;
  const sel = doc.getSelection();
  if (!sel) return;
  const range = doc.createRange();
  if (offset === 'end') {
    range.selectNodeContents(el);
    range.collapse(false);
  } else {
    let left = offset;
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let placed = false;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const len = n.textContent?.length ?? 0;
      if (left <= len) {
        range.setStart(n, left);
        placed = true;
        break;
      }
      left -= len;
    }
    if (!placed) {
      range.selectNodeContents(el);
      range.collapse(offset === 0);
    } else range.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}
