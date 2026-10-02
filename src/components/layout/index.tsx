import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/*
 * Layout primitives (v2 PHASE 011). Composition and whitespace first: most of
 * these draw no box at all. `Panel` is the one contained surface; use it only
 * when something really is a separate object (a form, a sheet, a drawer).
 */

export type PageWidth = 'reading' | 'standard' | 'wide';

const WIDTH: Record<PageWidth, string> = {
  /** Forms, settings, prose: a comfortable measure. */
  reading: 'max-w-[46rem]',
  /** Lists and mixed screens. */
  standard: 'max-w-[76rem]',
  /** Grids, boards and calendars: use the display. */
  wide: 'max-w-[120rem]',
};

/** A screen's frame: its width, centred in the canvas. */
export function Page({ width = 'standard', children }: { width?: PageWidth; children: ReactNode }) {
  return <div className={`mx-auto w-full min-w-0 ${WIDTH[width]}`}>{children}</div>;
}

/** Title row: the screen's h1, an optional line under it, and its actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-page font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled region of a screen, separated by space and a hairline, not a box. */
export function ContentSection({
  title,
  id,
  actions,
  description,
  children,
  divided = true,
  className = '',
}: {
  title: ReactNode;
  id?: string;
  actions?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** A hairline above the section (off for the first one on a screen). */
  divided?: boolean;
  className?: string;
}) {
  const generated = useId();
  const headingId = id ?? `section-${generated}`;
  return (
    <section
      aria-labelledby={headingId}
      className={`mt-8 ${divided ? 'border-t border-line pt-6' : ''} ${className}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 id={headingId} className="text-section font-semibold">
          {title}
        </h2>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Main content with a side column on wide screens; stacks below `lg`. */
export function SplitView({
  children,
  aside,
  asideLabel,
}: {
  children: ReactNode;
  aside: ReactNode;
  asideLabel?: string;
}) {
  return (
    <div className="grid min-w-0 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
      <div className="min-w-0">{children}</div>
      <aside aria-label={asideLabel} className="min-w-0">
        {aside}
      </aside>
    </div>
  );
}

export interface Metric {
  label: string;
  value: ReactNode;
  /** A short qualifier under the value ("this week", "of 7"). */
  hint?: ReactNode;
}

/** Figures in a row, divided by hairlines: read at a glance, never boxed. */
export function DataStrip({ metrics, label }: { metrics: Metric[]; label?: string }) {
  return (
    <dl
      aria-label={label}
      className="flex flex-wrap gap-y-3 divide-x divide-line border-y border-line py-3"
    >
      {metrics.map((m) => (
        <div key={m.label} className="min-w-[7rem] flex-1 px-4 first:pl-0">
          <dt className="text-xs text-fg-muted">{m.label}</dt>
          <dd className="figure mt-0.5 text-xl font-semibold">{m.value}</dd>
          {m.hint && <dd className="text-xs text-fg-subtle">{m.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** A labelled cluster of figures (inside a section, beside a chart). */
export function MetricGroup({ label, metrics }: { label: string; metrics: Metric[] }) {
  return (
    <div role="group" aria-label={label}>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-6 gap-y-3">
        {metrics.map((m) => (
          <div key={m.label}>
            <dt className="text-xs text-fg-muted">{m.label}</dt>
            <dd className="figure text-lg font-semibold">{m.value}</dd>
            {m.hint && <dd className="text-xs text-fg-subtle">{m.hint}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Nothing here yet: one line, and the action that fixes it. */
export function EmptyState({
  title,
  action,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
      <p className="text-fg-muted">{title}</p>
      {children}
      {action}
    </div>
  );
}

/** A row of commands for the current screen or selection. */
export function CommandBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className="flex flex-wrap items-center gap-2 border-b border-line pb-3"
    >
      {children}
    </div>
  );
}

/** The one contained surface. Use when something is a separate object. */
export function Panel({
  children,
  className = '',
  as: Tag = 'div',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'form' | 'aside';
} & Record<`aria-${string}`, string | undefined>) {
  return (
    <Tag className={`rounded-lg border border-line bg-raised ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * A side sheet over the screen (a modal dialog): focus moves in and is kept
 * there by the browser, Escape and the close button dismiss it, and focus
 * returns to what opened it.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  side = 'right',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Which edge the sheet comes from. */
  side?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop (the dialog box itself, outside the sheet) closes it.
        if (event.target === event.currentTarget) onClose();
      }}
      className={`lt-drawer m-0 h-dvh max-h-dvh w-full max-w-md bg-raised p-0 text-fg shadow-[var(--lt-shadow)] backdrop:bg-scrim ${side === 'left' ? 'mr-auto' : 'ml-auto'}`}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 id={titleId} className="text-section font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </dialog>
  );
}
