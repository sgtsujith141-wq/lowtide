import { useEffect, useId, useRef, type ReactNode } from 'react'

/* ---------------------------------------------------------------- *
 * Small, shared pieces of the PAPER system.
 * ---------------------------------------------------------------- */

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string
  title: string
  lede?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="lt-rise mb-8 flex flex-col gap-5 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? <p className="lt-eyebrow mb-2.5">{eyebrow}</p> : null}
        <h1 className="lt-display text-[2rem] leading-[1.1] sm:text-[2.6rem]">{title}</h1>
        {lede ? <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">{lede}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function Panel({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article' | 'aside'
}) {
  return <Tag className={`lt-card p-5 sm:p-6 ${className}`}>{children}</Tag>
}

export function SectionTitle({
  children,
  count,
  action,
}: {
  children: ReactNode
  count?: number
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-rule pb-2.5">
      <h2 className="lt-eyebrow">
        {children}
        {typeof count === 'number' ? <span className="ml-2 tabular-nums opacity-70">{count}</span> : null}
      </h2>
      {action}
    </div>
  )
}

export function Quiet({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-sm leading-relaxed text-muted ${className}`}>{children}</p>
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="lt-prose rounded-md border border-dashed border-rule px-4 py-6 text-center text-[0.9375rem] text-muted">
      {children}
    </p>
  )
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div>
      <label className="lt-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1.5 text-xs leading-relaxed text-muted">{hint}</p> : null}
    </div>
  )
}

/** A labelled textarea that grows with its content. */
export function GrowTextarea({
  value,
  onChange,
  minRows = 2,
  ...rest
}: {
  value: string
  onChange: (value: string) => void
  minRows?: number
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      {...rest}
      ref={ref}
      rows={minRows}
      className={`lt-field ${rest.className ?? ''}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/**
 * Modal built on <dialog>, so focus containment, Esc and inertness come from
 * the platform rather than a hand-rolled trap.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const handleClose = () => onClose()
    el.addEventListener('close', handleClose)
    return () => el.removeEventListener('close', handleClose)
  }, [onClose])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`m-auto w-[calc(100vw-2rem)] rounded-lg border border-rule bg-surface p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-[rgb(33_56_44_/_0.28)] backdrop:backdrop-blur-[2px] ${
        wide ? 'max-w-2xl' : 'max-w-lg'
      }`}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
    >
      <div className="max-h-[85dvh] overflow-y-auto p-5 sm:p-6">
        <div className="mb-4">
          <h2 id={titleId} className="lt-display text-2xl">
            {title}
          </h2>
          {description ? <Quiet className="mt-2">{description}</Quiet> : null}
        </div>
        {children}
        {footer ? (
          <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-rule pt-4">{footer}</div>
        ) : null}
      </div>
    </dialog>
  )
}

export function Tag({ children, tone = 'calm' }: { children: ReactNode; tone?: 'calm' | 'attention' | 'accent' }) {
  const toneClass =
    tone === 'attention'
      ? 'border-[color-mix(in_srgb,var(--color-attention)_40%,var(--color-rule))] bg-attention-wash text-attention'
      : tone === 'accent'
        ? 'border-[color-mix(in_srgb,var(--color-accent)_35%,var(--color-rule))] bg-accent-wash text-accent-deep'
        : ''
  return <span className={`lt-tag ${toneClass}`}>{children}</span>
}
