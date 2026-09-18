import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastApi, type ToastOptions } from '../lib/toast-context.ts'

interface ToastRecord extends ToastOptions {
  id: number
  message: string
}

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      show(message, options = {}) {
        const id = nextId++
        const tone = options.tone ?? 'calm'
        const duration = options.duration ?? (tone === 'problem' ? 12_000 : 5_000)
        setToasts((list) => [...list.slice(-2), { ...options, id, message, tone }])
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        )
      },
    }),
    [dismiss],
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const timer of map.values()) clearTimeout(timer)
      map.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:pb-6"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rise pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border px-4 py-3 shadow-[var(--shadow-lift)] ${
              toast.tone === 'problem'
                ? 'border-[color-mix(in_srgb,var(--color-brown)_40%,var(--color-line))] bg-sand text-ink'
                : 'border-line bg-paper text-ink'
            }`}
            role={toast.tone === 'problem' ? 'alert' : 'status'}
          >
            <p className="flex-1 text-sm leading-relaxed">{toast.message}</p>
            {toast.action ? (
              <button
                type="button"
                className="btn btn-soft -my-1 shrink-0"
                onClick={() => {
                  void toast.action?.run()
                  dismiss(toast.id)
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost -my-1 -mr-2 shrink-0"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss message"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
