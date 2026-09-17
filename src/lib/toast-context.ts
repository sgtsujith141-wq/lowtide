import { createContext, useContext } from 'react'

export interface ToastAction {
  label: string
  run: () => void | Promise<void>
}

export interface ToastOptions {
  tone?: 'calm' | 'problem'
  action?: ToastAction
  /** ms; problems stay until dismissed by default. */
  duration?: number
}

export interface ToastApi {
  show(message: string, options?: ToastOptions): void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside <ToastProvider>')
  return api
}
