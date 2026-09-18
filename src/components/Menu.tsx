import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  key: string
  label: string
  hint?: string
  checked?: boolean
  onSelect: () => void
}

/**
 * A small popover menu — the alternative to opening a dialog for a one-word
 * decision. Roving focus, Home/End, Esc returns focus to the trigger, and a
 * click anywhere else closes it.
 */
export function Menu({
  items,
  children,
  label,
  triggerClassName = 'chip',
  align = 'left',
  onOpenChange,
}: {
  items: MenuItem[]
  children: ReactNode
  label: string
  triggerClassName?: string
  align?: 'left' | 'right'
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpenState] = useState(false)

  /**
   * Always set the menu's state from an event handler with the value already
   * known. Notifying the parent from inside a state updater would be a setState
   * during another component's render, which React rightly refuses.
   */
  const setOpen = useCallback(
    (value: boolean) => {
      setOpenState((current) => {
        if (current !== value) queueMicrotask(() => onOpenChange?.(value))
        return value
      })
    },
    [onOpenChange],
  )
  const [active, setActive] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => itemRefs.current[active]?.focus())
    // Only when the menu opens: focus follows the item chosen at open time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent) {
      const target = event.target as Node
      if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open, setOpen])

  function close(restoreFocus = true) {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function move(delta: number) {
    const next = (active + delta + items.length) % items.length
    setActive(next)
    itemRefs.current[next]?.focus()
  }

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => {
          const checked = items.findIndex((item) => item.checked)
          setActive(checked >= 0 ? checked : 0)
          setOpen(!open)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const checked = items.findIndex((item) => item.checked)
            setActive(checked >= 0 ? checked : 0)
            setOpen(true)
          }
        }}
      >
        {children}
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={id}
          role="menu"
          aria-label={label}
          className={`rise absolute top-[calc(100%+6px)] z-30 min-w-[11rem] overflow-hidden rounded-lg border border-line bg-paper p-1 shadow-[var(--shadow-lift)] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              close()
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              move(1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              move(-1)
            } else if (event.key === 'Home') {
              event.preventDefault()
              setActive(0)
              itemRefs.current[0]?.focus()
            } else if (event.key === 'End') {
              event.preventDefault()
              setActive(items.length - 1)
              itemRefs.current[items.length - 1]?.focus()
            } else if (event.key === 'Tab') {
              setOpen(false)
            }
          }}
        >
          {items.map((item, index) => (
            <li key={item.key}>
              <button
                ref={(el) => {
                  itemRefs.current[index] = el
                }}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked === undefined ? undefined : item.checked}
                tabIndex={index === active ? 0 : -1}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] transition-colors ${
                  item.checked
                    ? 'bg-sage text-forest-deep'
                    : 'text-ink hover:bg-[color-mix(in_srgb,var(--color-sage)_65%,transparent)]'
                }`}
                onClick={() => {
                  item.onSelect()
                  close()
                }}
              >
                <span className="flex-1">{item.label}</span>
                {item.hint ? (
                  <span className="font-mono text-[0.65rem] text-muted">{item.hint}</span>
                ) : null}
                {item.checked ? (
                  <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="m5 12.5 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  )
}
