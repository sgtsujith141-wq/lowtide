/*
 * Shared class strings for controls (v2 PHASE 011), so every field, segment
 * and tab looks and behaves the same. Colours are semantic tokens only.
 */

/** Text inputs, textareas, selects and date inputs. */
export const fieldClass =
  'w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-subtle transition-[border-color,background-color] duration-150 hover:border-fg-subtle/50 focus:border-accent focus:bg-raised aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-canvas disabled:text-fg-subtle';

/** A compact inline select or input (toolbars, rows). */
export const compactFieldClass =
  'h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-fg transition-[border-color] duration-150 hover:border-fg-subtle/50 focus:border-accent disabled:text-fg-subtle';

export const labelClass = 'mb-1 block text-xs font-medium text-fg-muted';

/** A segmented control's track (a radiogroup of pill-less segments). */
export const segmentedClass =
  'inline-flex flex-wrap items-center gap-0.5 rounded-md border border-line bg-surface p-0.5';

/** One segment; pass whether it is the current choice. */
export function segmentClass(active: boolean): string {
  return `inline-flex h-7 cursor-pointer items-center gap-1 rounded-[5px] px-2.5 text-xs font-medium transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-[var(--lt-focus)] ${
    active
      ? 'bg-raised text-fg shadow-[0_0_0_1px_var(--lt-line-strong)]'
      : 'text-fg-muted hover:text-fg'
  }`;
}

/** A tab in a tablist that sits on a hairline; the current tab is underlined. */
export function tabClass(active: boolean): string {
  return `relative -mb-px inline-flex h-9 shrink-0 items-center border-b-2 px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-200 ${
    active ? 'border-fg text-fg' : 'border-transparent text-fg-muted hover:text-fg'
  }`;
}

/** A small status label (never colour alone: it always has text). */
export const badgeClass =
  'inline-flex items-center gap-1 rounded-sm bg-hover px-1.5 py-px text-[11px] font-medium text-fg-muted';
