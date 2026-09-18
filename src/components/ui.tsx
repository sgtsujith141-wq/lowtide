import { useEffect, useId, useRef, type ReactNode } from 'react'

/* ---------------------------------------------------------------- *
 * Shared pieces of the WARM PAPER system. Compact by default: this is
 * a workspace, not a landing page.
 * ---------------------------------------------------------------- */

export function Panel({
  children,
  className = '',
  as: Tag = 'section',
  tone = 'paper',
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article' | 'aside'
  tone?: 'paper' | 'paper-2'
}) {
  return <Tag className={`${tone === 'paper' ? 'paper' : 'paper-2'} p-4 ${className}`}>{children}</Tag>
}

export function PageHead({
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
    <header className="rise mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-xl">
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <h1 className="display text-[1.6rem] sm:text-[1.9rem]">{title}</h1>
        {lede ? <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted">{lede}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function SectionHead({
  children,
  count,
  action,
  className = '',
}: {
  children: ReactNode
  count?: number
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`mb-2.5 flex items-baseline justify-between gap-3 ${className}`}>
      <h2 className="eyebrow">
        {children}
        {typeof count === 'number' ? (
          <span className="ml-1.5 tabular-nums opacity-65">{count}</span>
        ) : null}
      </h2>
      {action}
    </div>
  )
}

export function Quiet({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-[0.8125rem] leading-relaxed text-muted ${className}`}>{children}</p>
}

/** Empty states are written, not drawn: a line in the margin of the page. */
export function Empty({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`aside-hand rounded-lg border border-dashed border-line px-4 py-5 text-center text-[0.9375rem] ${className}`}
    >
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
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-[0.7rem] leading-relaxed text-muted">{hint}</p> : null}
    </div>
  )
}

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
      className={`field ${rest.className ?? ''}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function Tag({
  children,
  tone = 'plain',
}: {
  children: ReactNode
  tone?: 'plain' | 'green' | 'sand'
}) {
  const cls = tone === 'green' ? 'chip-green' : tone === 'sand' ? 'chip-sand' : ''
  return <span className={`chip ${cls}`}>{children}</span>
}

/** Modal on native <dialog>: focus containment and Esc come from the platform. */
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
      className={`m-auto w-[calc(100vw-2rem)] rounded-xl border border-line bg-paper p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-[rgb(41_57_47_/_0.3)] backdrop:backdrop-blur-[2px] ${
        wide ? 'max-w-2xl' : 'max-w-md'
      }`}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
    >
      <div className="max-h-[82dvh] overflow-y-auto p-5">
        <h2 id={titleId} className="display text-xl">
          {title}
        </h2>
        {description ? <Quiet className="mt-1.5">{description}</Quiet> : null}
        <div className="mt-4">{children}</div>
        {footer ? (
          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  )
}
