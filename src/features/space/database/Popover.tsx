import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

/**
 * A small menu anchored to a button (v2.1). Fixed to the viewport so a
 * scrolling table can't clip it; Escape or a click elsewhere closes it and
 * focus goes back to the button. Its first item takes focus when it opens.
 */
export function Popover({
  anchor,
  open,
  onClose,
  label,
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Placed beside its button by writing the position straight to the element.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !anchor.current || !el) return;
    const r = anchor.current.getBoundingClientRect();
    const width = 224;
    el.style.top = `${r.bottom + 4}px`;
    el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    const close = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node))
        return;
      onClose();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, onClose, anchor]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
          anchor.current?.focus();
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
          const at = items.indexOf(document.activeElement as HTMLElement);
          const next = items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
          if (next) {
            e.preventDefault();
            next.focus();
          }
        }
      }}
      className="lt-pop fixed z-50 w-56 rounded-md border border-line bg-raised p-1 text-sm shadow-[var(--lt-shadow)]"
    >
      {children}
    </div>
  );
}

export function MenuItem({
  onClick,
  children,
  danger = false,
  disabled = false,
}: {
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover focus:bg-hover disabled:text-fg-subtle disabled:hover:bg-transparent ${danger ? 'text-danger' : ''}`}
    >
      {children}
    </button>
  );
}
